# Amazon Connect Vanity Number Generator

A take-home assignment for TTEC Digital demonstrating an Amazon Connect contact flow that converts caller phone numbers to vanity numbers and presents the best options via text-to-speech, backed by a DynamoDB call log and a web app showing recent callers.

## What It Does

1. A caller dials an Amazon Connect phone number.
2. A Lambda function converts the caller's number to vanity candidates, scores them, stores the top 5 in DynamoDB, and returns the top 3 to the contact flow.
3. The contact flow speaks the top 3 vanity options to the caller.
4. A static web app queries an API to show the vanity numbers from the last 5 callers.

## Architecture

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full architecture diagram and component breakdown.

## Prerequisites

- Node.js 20.x
- AWS CLI configured with appropriate credentials
- AWS SAM CLI (`brew install aws-sam-cli`)
- An Amazon Connect instance with a claimed phone number
- Docker (for local DynamoDB during development)

## Project Structure

```
.
├── src/
│   ├── vanity-converter/   # Lambda invoked by Connect
│   └── recent-callers/     # Lambda invoked by API Gateway for the web app
├── tests/
│   ├── unit/               # Pure function tests, no AWS
│   └── integration/        # Tests against DynamoDB Local
├── web/                    # Static web app (HTML/JS/CSS)
├── connect/                # Exported contact flow JSON
├── infrastructure/         # SAM template
└── scripts/                # Local dev helpers
```

## Local Development

### 1. Start DynamoDB Local

```bash
docker-compose -f scripts/docker-compose.yml up -d
```

### 2. Install dependencies

```bash
npm install --prefix src/vanity-converter
npm install --prefix src/recent-callers
```

### 3. Run unit tests

```bash
npm test --prefix src/vanity-converter
```

### 4. Seed test data

```bash
node scripts/seed.js
```

### 5. Run integration tests

```bash
AWS_ENDPOINT_URL=http://localhost:8000 npm run test:integration --prefix src/vanity-converter
```

## Deployment

Deployment instructions are the intended path and may be updated as implementation progresses.

### 1. Build

```bash
sam build
```

### 2. Deploy (guided first run)

```bash
sam deploy --guided
```

This will prompt for:

- Stack name (e.g., `vanity-numbers-dev`)
- AWS region
- Amazon Connect instance ARN
- Confirmation to create IAM roles

Subsequent deploys:

```bash
sam deploy
```

### 3. Wire up Amazon Connect

After deploying:

1. Note the `VanityConverterFunctionArn` from the SAM output.
2. In the Amazon Connect console, grant the Connect instance permission to invoke that Lambda (Connect → AWS Lambda → Add Lambda Function).
3. Import `connect/contact-flow.json` as a new contact flow.
4. Update the "Invoke AWS Lambda function" block with the deployed Lambda ARN.
5. Assign the contact flow to a phone number.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for step-by-step Connect setup instructions.

### 4. Deploy the web app

The SAM template creates an S3 bucket for the web app. After `sam deploy`:

```bash
aws s3 sync web/ s3://<WebAppBucketName>/ --delete
```

The bucket URL is output by the SAM stack as `WebAppUrl`.

## Testing the Solution

1. Call the Connect phone number from any phone.
2. Listen for 3 vanity number options.
3. Open the web app URL in a browser — your number should appear as the most recent caller.

## Bonus: Live Phone Number

A live Amazon Connect phone number is available for testing:

> **+1 (XXX) XXX-XXXX**

*(Number populated after deployment.)*

## Documentation

| Document | Contents |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | System diagram, component descriptions, Connect setup |
| [docs/DECISIONS.md](docs/DECISIONS.md) | Design decisions, tradeoffs, and rationale |
| [docs/ENGINEERING_NOTES.md](docs/ENGINEERING_NOTES.md) | Process notes, struggles, shortcuts, and what I'd do with more time |
