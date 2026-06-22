import * as cdk from 'aws-cdk-lib';
import { VanityNumberStack } from '../lib/stack';

const connectInstanceId = process.env.CONNECT_INSTANCE_ID || undefined;
const phoneNumberId = process.env.CONNECT_PHONE_NUMBER_ID || undefined;

if (phoneNumberId && !connectInstanceId) {
  throw new Error(
    'CONNECT_INSTANCE_ID must be set when CONNECT_PHONE_NUMBER_ID is provided.\n' +
      '  export CONNECT_INSTANCE_ID=<your-connect-instance-id>',
  );
}

const app = new cdk.App();

new VanityNumberStack(app, 'VanityNumberCdkStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
  description:
    'Amazon Connect Vanity Number Generator — VanityConverter Lambda, RecentCallers Lambda, HTTP API, and DynamoDB table.',
  connectInstanceId,
  phoneNumberId,
});
