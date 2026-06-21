# CDK Deployment

This directory contains the CDK implementation of the same infrastructure defined in `infrastructure/template.yaml` (SAM). Both deploy materially equivalent AWS resources. The CDK version additionally automates Amazon Connect contact flow creation and phone number association.

## Prerequisites

- Node.js 20.x
- AWS CLI configured with credentials for the target account
- AWS CDK CLI: `npm install -g aws-cdk`
- CDK bootstrap run once in the target account/region (see step 1 below)

## Step 1: Bootstrap (one-time per account/region)

CDK requires a bootstrap stack in the target account before the first deploy. If you have not deployed a CDK app to this account and region before, run:

```bash
cdk bootstrap aws://<account-id>/us-west-2
```

You can find your account ID with `aws sts get-caller-identity`.

This is a one-time setup. Subsequent deploys skip this step.

## Step 2: Install CDK dependencies

```bash
cd infrastructure/cdk
npm install
```

Or from the repo root:

```bash
npm install --prefix infrastructure/cdk
```

## Step 3: Configure context (required for contact flow automation)

Open `infrastructure/cdk/cdk.json` and fill in the two context values:

```json
{
  "app": "npx ts-node --prefer-ts-exts bin/app.ts",
  "context": {
    "connectInstanceId": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
    "phoneNumberId":    "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
  }
}
```

**Finding `connectInstanceId`:**

```bash
aws connect list-instances --region us-west-2 \
  --query 'InstanceSummaryList[*].{Id:Id,Alias:InstanceAlias}'
```

**Finding `phoneNumberId`** (requires `connectInstanceId` first):

```bash
aws connect list-phone-numbers-v2 \
  --instance-id <connectInstanceId> \
  --region us-west-2 \
  --query 'ListPhoneNumbersSummaryList[*].{Id:PhoneNumberId,Number:PhoneNumber}'
```

**If you leave both values empty** (`""`), the stack deploys infrastructure only (DynamoDB, Lambdas, API Gateway). The contact flow and phone number association must be configured manually in the Connect console, the same as the SAM path. The contact flow JSON at `infrastructure/contact-flow.json` can be imported manually.

## Step 4: Deploy

From `infrastructure/cdk/`:

```bash
npm run deploy
```

Or from the repo root:

```bash
npm run deploy:cdk
```

CDK will show a summary of IAM and security changes and prompt for confirmation before deploying.

The deploy produces the same three outputs as the SAM stack:

| Output | Description |
|---|---|
| `VanityConverterFunctionArn` | Lambda ARN (also added to Connect automatically via `addPermission`) |
| `VanityCallLogTableName` | DynamoDB table name |
| `RecentCallersApiUrl` | `GET /callers` endpoint for the web app |

If `connectInstanceId` was set, a fourth output appears:

| Output | Description |
|---|---|
| `ContactFlowId` | Connect contact flow ID — already associated to your phone number if `phoneNumberId` was also set |

## Step 5: Update and redeploy the web app

The live S3 dashboard (`deploy:web`) is built against the API URL of whichever stack was last used to build it. After deploying the CDK stack, note the `RecentCallersApiUrl` output and rebuild:

```bash
echo "VITE_API_URL=https://<cdk-api-id>.execute-api.us-west-2.amazonaws.com" > web/.env.local
npm run deploy:web
```

This rebuilds the Vite bundle and syncs it to the existing S3 bucket. The dashboard will then fetch from the CDK stack's API.

## Comparing CDK and SAM

| Aspect | SAM | CDK |
|---|---|---|
| DynamoDB, Lambdas, API Gateway | ✅ | ✅ |
| Lambda `addPermission` for Connect | Manual console step | ✅ Automated |
| Contact flow deployment | Manual console build | ✅ Automated (`connectInstanceId` required) |
| Phone number → flow association | Manual console step | ✅ Automated (`phoneNumberId` required) |
| AWS SDK in Lambda bundle | Bundled by esbuild | Provided by Node.js 20.x runtime |
| DynamoDB on stack delete | Deleted | Retained (`RemovalPolicy.RETAIN`) |

**SDK bundling note:** SAM's esbuild config bundles `@aws-sdk/*` into the Lambda ZIP. The CDK stack excludes it and relies on the SDK built into the Node.js 20.x Lambda runtime. Both work correctly; the runtime SDK version may differ slightly from the one pinned in `package.json`, but the API surface used here is stable.

## Known behavior: duplicate contact flow names

Amazon Connect allows multiple flows with the same display name. If you deploy the CDK stack with `connectInstanceId` set while the manually-created SAM flow ("Vanity Number Generator") still exists in your Connect instance, you will see two identically-named flows in the Connect console. This is cosmetic — the phone number routes to whichever flow it is currently assigned to. The CDK stack's `ContactFlowId` output identifies the new flow.

## Destroying the stack

```bash
npm run destroy  # from infrastructure/cdk/
```

Or: `cdk destroy` from `infrastructure/cdk/`.

The DynamoDB table is retained on stack deletion (`RemovalPolicy.RETAIN`). The contact flow is also retained — it is not deleted when the stack is destroyed. Both can be removed manually from the AWS console if needed.
