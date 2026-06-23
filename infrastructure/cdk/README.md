# CDK Deployment

This directory contains the CDK implementation of the same infrastructure defined in `infrastructure/template.yaml` (SAM). Both deploy materially equivalent AWS resources. The CDK version additionally automates Amazon Connect contact flow creation and phone number association.

## Prerequisites

- Node.js 20.x
- AWS CLI configured with credentials for the target account
- AWS CDK CLI: `npm install -g aws-cdk`
- CDK bootstrap run once in the target account/region (see step 1 below)
- An Amazon Connect instance (`CONNECT_INSTANCE_ID`) — required for contact flow automation
- A claimed phone number in that instance (`CONNECT_PHONE_NUMBER_ID`) — required for phone number routing automation

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

## Step 3: Configure environment variables (required for contact flow automation)

The stack reads two optional environment variables. If both are omitted, the stack deploys infrastructure only (DynamoDB, Lambdas, API Gateway) and the contact flow must be configured manually — identical to the SAM path.

| Variable | Required | Description |
|---|---|---|
| `CONNECT_INSTANCE_ID` | For contact flow automation | Amazon Connect instance UUID |
| `CONNECT_PHONE_NUMBER_ID` | For phone number routing | Claimed phone number UUID (requires `CONNECT_INSTANCE_ID`) |

**Finding the values:**

```bash
# CONNECT_INSTANCE_ID
aws connect list-instances --region us-west-2 \
  --query 'InstanceSummaryList[*].{Id:Id,Alias:InstanceAlias}'

# CONNECT_PHONE_NUMBER_ID (requires CONNECT_INSTANCE_ID)
aws connect list-phone-numbers-v2 \
  --instance-id <CONNECT_INSTANCE_ID> \
  --region us-west-2 \
  --query 'ListPhoneNumbersSummaryList[*].{Id:PhoneNumberId,Number:PhoneNumber}'
```

**Setting the variables** — choose one approach:

Option A — export in your shell session:

```bash
export CONNECT_INSTANCE_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
export CONNECT_PHONE_NUMBER_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
```

Option B — prefix on the deploy command:

```bash
CONNECT_INSTANCE_ID=xxxxxxxx CONNECT_PHONE_NUMBER_ID=xxxxxxxx npm run deploy
```

Option C — `.env.local` file (recommended for repeated local use):

Create `infrastructure/cdk/.env.local` (already gitignored by the root `.gitignore`):

```bash
# infrastructure/cdk/.env.local
CONNECT_INSTANCE_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
CONNECT_PHONE_NUMBER_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
```

Then use the `*:env` scripts (Step 4 below) — they source `.env.local` automatically before running CDK.

## Step 4: Deploy

The `*:env` scripts source `.env.local` automatically so no prefix or export is needed:

```bash
npm run synth:env   # synthesize and print the CloudFormation template
npm run diff:env    # show what will change vs. the deployed stack
npm run deploy:env  # deploy (prompts for IAM/security confirmation)
```

Or, if you exported the variables via Option A or B above, the plain scripts work the same:

```bash
npm run deploy
```

CDK will show a summary of IAM and security changes and prompt for confirmation before deploying.

The deploy produces the same three outputs as the SAM stack:

| Output | Description |
|---|---|
| `VanityConverterFunctionArn` | Lambda ARN (also added to Connect automatically via `addPermission`) |
| `VanityCallLogTableName` | DynamoDB table name |
| `RecentCallersApiUrl` | `GET /callers` endpoint for the web app |

If `CONNECT_INSTANCE_ID` was set, the stack also outputs:

| Output | Description |
|---|---|
| `ContactFlowId` | Connect contact flow ID — already associated to your phone number if `CONNECT_PHONE_NUMBER_ID` was also set |

## Step 5: Run the web app against the deployed stack

After deploying, set `VITE_API_URL` to the `RecentCallersApiUrl` output:

```bash
echo "VITE_API_URL=<RecentCallersApiUrl>" > web/.env.local
```

**Local development (recommended for reviewers):**

```bash
npm run dev:web   # hot-reloading at http://localhost:5173
```

**Deploying to S3:** `npm run deploy:web` syncs `web/dist/` to the author's S3 bucket (`vanity-web-141262468065`). To deploy to your own account, create an S3 bucket with static website hosting enabled and update the bucket name in the root `package.json` `deploy:web` script before running it.

## Comparing CDK and SAM

| Aspect | SAM | CDK |
|---|---|---|
| DynamoDB, Lambdas, API Gateway | ✅ | ✅ |
| Lambda `addPermission` for Connect | Manual console step | ✅ Automated |
| Contact flow deployment | Manual console import | ✅ Automated (`connectInstanceId` required) |
| Contact flow: Set logging behavior | ❌ Not included | ✅ |
| Contact flow: Set voice (Matthew) | ✅ | ✅ |
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
