# Amazon Connect Vanity Number Generator

A take-home assignment for TTEC Digital demonstrating an Amazon Connect contact flow that converts caller phone numbers to vanity numbers and presents the best options via text-to-speech, backed by a DynamoDB call log and a web app showing recent callers.

- [What It Does](#what-it-does)
- [Architecture](#architecture)
- [Prerequisites](#prerequisites)
- [Local Development](#local-development)
- [Deployment](#deployment)
- [Testing the Solution](#testing-the-solution)
- [Screenshots](#screenshots)
- [Bonus: Live Phone Number](#bonus-live-phone-number)
- [Documentation](#documentation)

## What It Does

1. A caller dials an Amazon Connect phone number.
2. A Lambda function converts the caller's number to vanity candidates, scores them, stores the top 5 in DynamoDB, and returns the top 3 to the contact flow.
3. The contact flow speaks the top 3 vanity options to the caller.
4. A Cloudscape React dashboard queries an API to show the vanity numbers from the last 5 callers.

## Architecture

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full architecture diagram and component breakdown.

## Prerequisites

- Node.js 20.x
- AWS CLI configured with appropriate credentials
- AWS SAM CLI (`brew install aws-sam-cli`)
- An Amazon Connect instance with a claimed phone number

## Project Structure

```
.
├── src/
│   ├── vanity-converter/   # Lambda invoked by Connect
│   └── recent-callers/     # Lambda invoked by API Gateway for the web app
├── tests/unit/             # Jest unit tests (95 tests, 100% coverage)
├── web/                    # Cloudscape React app (Vite)
├── infrastructure/         # SAM template
├── docs/                   # Architecture, decisions, engineering notes
└── scripts/                # Local dev helpers (demo-vanity)
```

## Local Development

### 1. Install dependencies

```bash
npm install
```

### 2. Run unit tests

```bash
npm test
```

### 3. Type-check

```bash
npm run build
```

### 4. Build Lambda bundles

```bash
npm run build:sam
```

## Deployment

### 1. Build Lambda bundles

```bash
npm run build:sam
```

### 2. Deploy (guided first run)

```bash
sam deploy --template-file infrastructure/template.yaml --guided
```

This prompts for stack name, region, and IAM capability confirmation. Settings are saved to `samconfig.toml`. Subsequent deploys:

```bash
sam deploy --template-file infrastructure/template.yaml
```

### 3. Wire up Amazon Connect

After deploying:

1. Note the `VanityConverterFunctionArn` from the SAM output.
2. In the Amazon Connect console, go to **AWS Lambda** and add the function ARN to the allowed list.
3. Build the contact flow manually in the Connect console. See [docs/ARCHITECTURE.md — Contact Flow Design](docs/ARCHITECTURE.md#contact-flow-design) for the exact flow structure.
4. Assign the contact flow to your claimed phone number.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for step-by-step Connect setup instructions.

### 4. Run the web app locally

After `sam deploy`, copy the `RecentCallersApiUrl` output value, then:

```bash
# web/.env.local — git-ignored
echo "VITE_API_URL=https://<api-id>.execute-api.us-west-2.amazonaws.com" > web/.env.local

npm run dev:web
# Opens http://localhost:5173
```

The app shows a Cloudscape table with the caller number, timestamp, and vanity numbers for the last 5 callers.

## Testing the Solution

1. Call the Connect phone number from any phone.
2. Listen for 3 vanity number options.
3. Open `http://localhost:5173` (after running `npm run dev:web`) — your number should appear as the most recent caller.

## Screenshots

**Architecture diagram:**

![Architecture diagram](docs/screenshots/architecture-diagram.jpg)

**Contact flow in Amazon Connect:**

![Contact flow](docs/screenshots/contact-flow.jpg)

**Recent Callers web dashboard:**

![Recent Callers dashboard](docs/screenshots/web.jpg)

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
