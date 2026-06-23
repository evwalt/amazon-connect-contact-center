import * as fs from 'fs';
import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as apigwv2_integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as cr from 'aws-cdk-lib/custom-resources';

// Root of the monorepo, relative to this file (infrastructure/cdk/lib/).
const REPO_ROOT = path.join(__dirname, '../../..');

// Hardcoded ARN from the exported contact flow JSON — replaced at synth time.
const EXPORTED_LAMBDA_ARN =
  'arn:aws:lambda:us-west-2:141262468065:function:amazon-connect-contact-cen-VanityConverterFunction-YlAP785LybYK';

interface VanityNumberStackProps extends cdk.StackProps {
  connectInstanceId?: string;
  phoneNumberId?: string;
}

export class VanityNumberStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: VanityNumberStackProps) {
    super(scope, id, props);

    const connectInstanceId = props?.connectInstanceId;

    // ── DynamoDB ──────────────────────────────────────────────────────────────

    const table = new dynamodb.Table(this, 'VanityCallLogTable', {
      partitionKey: { name: 'callerNumber', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'timestamp', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'ttl',
      // Retain on stack deletion so call records survive a cdk destroy.
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // GSI for "last N callers" query: fixed PK gsiPk="CALL", SK timestamp.
    // Acknowledged hot-partition anti-pattern at scale; acceptable for this scope.
    table.addGlobalSecondaryIndex({
      indexName: 'TimestampIndex',
      partitionKey: { name: 'gsiPk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'timestamp', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // ── Lambda: VanityConverter ───────────────────────────────────────────────

    const vanityConverter = new nodejs.NodejsFunction(this, 'VanityConverterFunction', {
      entry: path.join(REPO_ROOT, 'src/vanity-converter/handler.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      architecture: lambda.Architecture.X86_64,
      timeout: cdk.Duration.seconds(10),
      environment: {
        TABLE_NAME: table.tableName,
      },
      bundling: {
        minify: false,
        sourceMap: true,
        target: 'es2020',
        // @aws-sdk/* is available in the Node 20.x runtime; exclude from bundle
        // to keep the artifact small. Matches the intent of the SAM esbuild config.
        externalModules: ['@aws-sdk/*'],
      },
      depsLockFilePath: path.join(REPO_ROOT, 'package-lock.json'),
    });

    // Least-privilege: PutItem only, on the base table (not GSI).
    vanityConverter.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['dynamodb:PutItem'],
        resources: [table.tableArn],
      }),
    );

    // Grant Amazon Connect permission to invoke this Lambda.
    // This replaces the manual "add Lambda ARN in Connect console > AWS Lambda" step.
    vanityConverter.addPermission('AllowConnectInvoke', {
      principal: new iam.ServicePrincipal('connect.amazonaws.com'),
      action: 'lambda:InvokeFunction',
      sourceAccount: this.account,
    });

    // ── Lambda: RecentCallers ─────────────────────────────────────────────────

    const recentCallers = new nodejs.NodejsFunction(this, 'RecentCallersFunction', {
      entry: path.join(REPO_ROOT, 'src/recent-callers/handler.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      architecture: lambda.Architecture.X86_64,
      timeout: cdk.Duration.seconds(10),
      environment: {
        TABLE_NAME: table.tableName,
      },
      bundling: {
        minify: false,
        sourceMap: true,
        target: 'es2020',
        externalModules: ['@aws-sdk/*'],
      },
      depsLockFilePath: path.join(REPO_ROOT, 'package-lock.json'),
    });

    // Least-privilege: Query only, scoped to the GSI ARN (not the base table).
    recentCallers.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['dynamodb:Query'],
        resources: [`${table.tableArn}/index/TimestampIndex`],
      }),
    );

    // ── API Gateway: HTTP API v2 ──────────────────────────────────────────────

    const api = new apigwv2.HttpApi(this, 'RecentCallersApi', {
      corsPreflight: {
        allowOrigins: ['*'],
        allowMethods: [apigwv2.CorsHttpMethod.GET],
        allowHeaders: ['Content-Type'],
      },
    });

    api.addRoutes({
      path: '/callers',
      methods: [apigwv2.HttpMethod.GET],
      integration: new apigwv2_integrations.HttpLambdaIntegration(
        'RecentCallersIntegration',
        recentCallers,
      ),
    });

    // ── Contact Flow (optional — requires connectInstanceId context) ──────────

    if (connectInstanceId) {
      // Read the exported contact flow JSON and replace the hardcoded Lambda ARN
      // with a Fn::Sub placeholder so CloudFormation injects the real ARN at deploy
      // time. This is necessary because the ARN is only known after the Lambda
      // resource is created.
      const rawFlow = fs.readFileSync(
        path.join(__dirname, '../../contact-flow.json'),
        'utf8',
      );
      const flowTemplate = rawFlow.replace(EXPORTED_LAMBDA_ARN, '${VanityConverterArn}');
      const resolvedContent = cdk.Fn.sub(flowTemplate, {
        VanityConverterArn: vanityConverter.functionArn,
      });

      const instanceArn = `arn:aws:connect:${this.region}:${this.account}:instance/${connectInstanceId}`;

      const contactFlow = new cr.AwsCustomResource(this, 'ContactFlow', {
        resourceType: 'Custom::ConnectContactFlow',
        onCreate: {
          service: 'Connect',
          action: 'createContactFlow',
          parameters: {
            InstanceId: connectInstanceId,
            Name: 'Vanity Number Generator - CDK v2',
            Type: 'CONTACT_FLOW',
            Content: resolvedContent,
          },
          // ContactFlowId from the response becomes the physical resource ID,
          // which onUpdate references via PhysicalResourceIdReference.
          physicalResourceId: cr.PhysicalResourceId.fromResponse('ContactFlowId'),
        },
        onUpdate: {
          service: 'Connect',
          action: 'updateContactFlowContent',
          parameters: {
            InstanceId: connectInstanceId,
            // Resolves to the ContactFlowId set by onCreate.
            ContactFlowId: new cr.PhysicalResourceIdReference(),
            Content: resolvedContent,
          },
          // updateContactFlowContent returns {} — no new physical ID to extract.
          // CDK keeps the physical ID from onCreate when physicalResourceId is omitted here.
        },
        // No onDelete: the contact flow is retained when the stack is destroyed.
        // Callers would get an error if the flow disappeared mid-session.
        installLatestAwsSdk: false,
        policy: cr.AwsCustomResourcePolicy.fromStatements([
          new iam.PolicyStatement({
            actions: ['connect:CreateContactFlow', 'connect:UpdateContactFlowContent'],
            resources: [`${instanceArn}/*`],
          }),
        ]),
      });

      // AwsCustomResource wraps an inner CustomResource child named 'Resource'.
      // Its Ref == physical resource ID, which was set to ContactFlowId on onCreate
      // and is retained on every update. getResponseField('ContactFlowId') would break
      // on UPDATE because updateContactFlowContent returns {} and clears Data.ContactFlowId.
      const contactFlowId = (contactFlow.node.findChild('Resource') as cdk.CustomResource).ref;

      new cdk.CfnOutput(this, 'ContactFlowId', {
        description: 'Amazon Connect contact flow ID — assign to your claimed phone number.',
        value: contactFlowId,
      });

      const phoneNumberId = props?.phoneNumberId;

      if (phoneNumberId) {
        const phoneNumberArn = `arn:aws:connect:${this.region}:${this.account}:phone-number/${phoneNumberId}`;

        const phoneAssociation = new cr.AwsCustomResource(this, 'PhoneNumberAssociation', {
          resourceType: 'Custom::ConnectPhoneAssociation',
          onCreate: {
            service: 'Connect',
            action: 'associatePhoneNumberContactFlow',
            parameters: {
              InstanceId: connectInstanceId,
              PhoneNumberId: phoneNumberId,
              ContactFlowId: contactFlowId,
            },
            // associatePhoneNumberContactFlow returns {} — use a static physical ID.
            physicalResourceId: cr.PhysicalResourceId.of(
              `${connectInstanceId}:${phoneNumberId}`,
            ),
          },
          // No onUpdate: contact flow content updates must not re-run this association.
          // updateContactFlowContent returns {} so getResponseField('ContactFlowId') would
          // resolve to empty, causing the associate API call to fail with an invalid ID.
          // The association is permanent once set; a content change doesn't affect routing.
          installLatestAwsSdk: false,
          policy: cr.AwsCustomResourcePolicy.fromStatements([
            new iam.PolicyStatement({
              actions: ['connect:AssociatePhoneNumberContactFlow'],
              resources: [phoneNumberArn, `${instanceArn}/*`],
            }),
          ]),
        });

        // Ensure the contact flow exists before the association runs.
        phoneAssociation.node.addDependency(contactFlow);
      }
    }

    // ── Outputs (matching SAM output key names) ────────────────────────────────

    new cdk.CfnOutput(this, 'VanityConverterFunctionArn', {
      description:
        'Lambda ARN — add to Amazon Connect under Contact flows > AWS Lambda before configuring the contact flow.',
      value: vanityConverter.functionArn,
    });

    new cdk.CfnOutput(this, 'VanityCallLogTableName', {
      description: 'DynamoDB table name for call log records.',
      value: table.tableName,
    });

    new cdk.CfnOutput(this, 'RecentCallersApiUrl', {
      description:
        'GET /callers endpoint — returns the 5 most recent call records. Set VITE_API_URL to this value before running the web app.',
      value: api.apiEndpoint,
    });
  }
}
