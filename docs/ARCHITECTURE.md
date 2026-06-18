# Architecture

## System Overview

```
Caller (PSTN)
    │
    ▼
Amazon Connect
  Phone Number
    │
    ▼
Contact Flow
    │
    ├─[No caller ID]──► Play error message ──► Disconnect
    │
    ├─ Invoke Lambda: VanityConverter (timeout: 8s)
    │     │
    │     ├─[Lambda error]──► Play error message ──► Disconnect
    │     │
    │     └─[success] vanity1, vanity2, vanity3
    │
    ▼
Play TTS prompt with vanity1, vanity2, vanity3
    │
    ▼
Disconnect

──────────────────────────────────────────────

Browser
    │
    ▼
Static Web App (S3)
    │  GET /callers
    ▼
API Gateway (HTTP API)
    │
    ▼
Lambda: RecentCallers
    │  Query GSI (last 5 by timestamp)
    ▼
DynamoDB: VanityCallLog
```

## Components

### Amazon Connect

- Claimed phone number routes inbound calls to a contact flow.
- Contact flow checks for caller ID, invokes the VanityConverter Lambda, and speaks the result.
- The contact flow is exported to `connect/contact-flow.json` for import into any Connect instance.

### VanityConverter Lambda

**Runtime:** Node.js 20.x  
**Trigger:** Amazon Connect (synchronous invocation from contact flow)  
**Timeout:** 8 seconds (set in SAM template; configured to 8s in the Connect contact flow block)

Responsibilities:

1. Parse the caller's E.164 phone number from the Connect event.
2. Generate vanity candidates for the 7-digit subscriber portion of the number.
3. Score and rank candidates using the scoring formula (see [DECISIONS.md](DECISIONS.md)).
4. Write the top 5 results to DynamoDB.
5. Return the top 3 as flat string attributes for the contact flow.

### RecentCallers Lambda

**Runtime:** Node.js 20.x  
**Trigger:** API Gateway HTTP API (GET /callers)  
**Timeout:** 5 seconds

Responsibilities:

1. Query the DynamoDB GSI `TimestampIndex` for the 5 most recent call records.
2. Return structured JSON for the web app.

### DynamoDB: VanityCallLog

**Billing mode:** PAY_PER_REQUEST (on-demand)

#### Base table

| Attribute | Type | Role |
|---|---|---|
| `callerNumber` | String | Partition key |
| `timestamp` | String (ISO 8601) | Sort key |
| `vanityNumbers` | List\<String\> | Top 5 scored results (formatted as `{areaCode}-{candidate}`) |
| `callId` | String | Connect ContactId |
| `gsiPk` | String | Fixed value `"CALL"` (GSI partition key) |
| `ttl` | Number (Unix epoch) | Expiry timestamp — 90 days after the call; used by DynamoDB TTL |

#### GSI: TimestampIndex

| Attribute | Type | Role |
|---|---|---|
| `gsiPk` | String | Partition key — always `"CALL"` |
| `timestamp` | String | Sort key |

Query pattern for web app:

```
KeyConditionExpression: gsiPk = "CALL"
ScanIndexForward: false
Limit: 5
```

Note: Using a fixed GSI partition key is a known anti-pattern at high call volume (hot partition). It is acceptable for this assignment. At scale, the alternative is a time-bucketed partition key (e.g., `"CALL#2026-06"`) or a separate append-only history table with a time-series design.

### API Gateway

HTTP API (not REST API) — lower cost, simpler configuration, no usage plans needed at this scale. Single route: `GET /callers`.

CORS is enabled on the API Gateway to allow the S3-hosted web app (different origin) to call the API.

### Static Web App (S3)

Plain HTML, CSS, and JavaScript — no build step, no framework. Polls `GET /callers` on page load and displays a table of the last 5 callers and their vanity numbers. The S3 bucket is configured for static website hosting.

## Data Flow: Inbound Call

1. Caller dials the Connect number.
2. Connect passes the call to the contact flow.
3. Contact flow checks `CustomerEndpoint.Address`. If null, plays an error and disconnects.
4. Contact flow invokes VanityConverter Lambda with the Connect event payload.
5. Lambda extracts the caller number, runs the vanity algorithm, writes to DynamoDB, returns top 3.
6. Contact flow reads `vanity1`, `vanity2`, `vanity3` from Lambda response attributes and speaks them via TTS.
7. Contact flow disconnects.

## Data Flow: Web App

1. Browser loads `index.html` from S3.
2. `app.js` sends `GET /callers` to API Gateway.
3. API Gateway invokes RecentCallers Lambda.
4. Lambda queries DynamoDB GSI for 5 most recent records.
5. Lambda returns JSON array of caller records.
6. Browser renders results in a table.

## Lambda Input/Output Contracts

### VanityConverter — Input

Amazon Connect sends this event shape:

```json
{
  "Details": {
    "ContactData": {
      "CustomerEndpoint": {
        "Address": "+12065551234",
        "Type": "TELEPHONE_NUMBER"
      },
      "ContactId": "abc-123-def-456",
      "Channel": "VOICE"
    },
    "Parameters": {}
  },
  "Name": "ContactFlowEvent"
}
```

`CustomerEndpoint.Address` may be null if the caller has suppressed their number.

### VanityConverter — Output (success)

Amazon Connect requires a flat `string → string` map. Nested objects and arrays are not supported.

```json
{
  "status": "success",
  "vanity1": "1-800-FLOWERS",
  "vanity2": "1-800-FLORIST",
  "vanity3": "1-800-FLOPPERS"
}
```

### VanityConverter — Output (error)

```json
{
  "status": "error",
  "vanity1": "",
  "vanity2": "",
  "vanity3": ""
}
```

The contact flow checks `$.Attributes.status`. An `"error"` value routes to the error branch.

### RecentCallers — Output

```json
{
  "callers": [
    {
      "callerNumber": "+12065551234",
      "vanityNumbers": [
        "800-FLOWERS",
        "800-FLORIST",
        "800-FLOPPERS",
        "800-FLOSSED",
        "800-FLOPPED"
      ],
      "timestamp": "2026-06-17T14:23:00.000Z",
      "callId": "abc-123-def-456"
    }
  ]
}
```

## Contact Flow Design

The contact flow has three branches:

```
[Start]
    │
    ▼
[Check CustomerEndpoint.Address]
    ├─ [null/empty] ──► [Play: "We could not identify your number. Goodbye."] ──► [End]
    │
    ▼
[Invoke Lambda: VanityConverter, timeout 8s]
    ├─ [error/timeout] ──► [Play: "We encountered an error. Please try again later. Goodbye."] ──► [End]
    │
    ▼
[Play prompt]:
  "We found vanity numbers for your phone number.
   Option 1: <vanity1>
   Option 2: <vanity2>
   Option 3: <vanity3>
   Thank you for calling. Goodbye."
    │
    ▼
[End]
```

The TTS prompt references Connect flow attributes `$.Attributes.vanity1`, `$.Attributes.vanity2`, and `$.Attributes.vanity3` set by the Lambda response.

## Amazon Connect Setup (Manual Steps)

After running `sam deploy`:

1. Open the Amazon Connect console and navigate to your instance.
2. Under **AWS Lambda**, add the `VanityConverterFunction` ARN (output from SAM) to the allowed Lambda list.
3. In the **Contact flows** section, choose **Import flow** and upload `connect/contact-flow.json`.
4. Open the imported flow, find the **Invoke AWS Lambda function** block, and update the Lambda ARN to the deployed function ARN.
5. Save and publish the contact flow.
6. Navigate to **Phone numbers**, select your claimed number, and assign it to the imported contact flow.
7. Test by calling the number.

## Infrastructure

Managed with AWS SAM. Key resources in `infrastructure/template.yaml`:

| Resource | Type |
|---|---|
| VanityConverterFunction | AWS::Serverless::Function |
| RecentCallersFunction | AWS::Serverless::Function |
| VanityCallLogTable | AWS::DynamoDB::Table |
| CallerApi | AWS::Serverless::HttpApi |
| WebAppBucket | AWS::S3::Bucket |

IAM follows least-privilege: each Lambda has only the DynamoDB actions it requires (`PutItem` for VanityConverter, `Query` for RecentCallers).
