import * as cdk from 'aws-cdk-lib';
import { VanityNumberStack } from '../lib/stack';

const app = new cdk.App();

new VanityNumberStack(app, 'VanityNumberCdkStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
  description:
    'Amazon Connect Vanity Number Generator — VanityConverter Lambda, RecentCallers Lambda, HTTP API, and DynamoDB table.',
});
