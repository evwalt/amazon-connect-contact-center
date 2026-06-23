# Engineering Notes

This document covers process notes, struggles, shortcuts, and what I would have done differently with more time. It is written for a reviewer who wants to understand how I approached the problem, not just what I built.

---

## Process

I approached this assignment architecture-first rather than code-first. Before writing any implementation, I:

1. Wrote out explicit requirements (stated and implied) and identified ambiguities in the assignment.
2. Challenged my own assumptions — particularly around "best," the DynamoDB access patterns, and the Amazon Connect Lambda contract.
3. Finalized the data model, Lambda I/O contracts, and contact flow design before touching code.
4. Wrote documentation stubs first so that decisions were recorded as they were made, not reconstructed afterward.

This order matters: the DynamoDB schema drives the Lambda, the Lambda drives the contact flow, and the contact flow drives the output contract. Getting that chain wrong at the start costs significant rework.

The key decisions I had to lock before implementation:

- **What does "best" mean?** (Answered in DECISIONS.md §1)
- **Call log or upsert?** (Answered in DECISIONS.md §2 — the web app requirement determined this)
- **What does the Connect payload look like, and what does it require back?** (Answered in ARCHITECTURE.md — the flat string-map requirement is the sharpest edge in the whole project)

---

## Planned Shortcuts and Tradeoffs

### Shortcuts Taken

**1. Fixed GSI partition key**
The `TimestampIndex` GSI uses a fixed partition key (`gsiPk = "CALL"`) to enable sorted queries across all callers. This creates a hot partition at scale. Acceptable for a demo; a production system would use time-bucketed partition keys or a separate time-series design.

**2. Web app hosted on S3 (HTTP only, no CloudFront)**
The dashboard is deployed to an S3 static website endpoint (`npm run deploy:web`) for reviewer accessibility. The S3 bucket is provisioned outside the SAM stack to avoid complicating the primary Lambda/API deployment. The endpoint is HTTP only — no CloudFront distribution or ACM certificate. In production the right approach is S3 + CloudFront (HTTPS, caching, custom domain, WAF); see DECISIONS.md §12 for the full rationale.

**3. No authentication on the web app API**
The `GET /callers` endpoint is publicly accessible. In production, this would be behind Cognito, an API key, or at minimum IP-restricted. The data is not sensitive (vanity number mappings), but exposing any internal data without auth is a bad practice.

**4. No DynamoDB TTL enforcement**
The schema includes a `ttl` attribute and DynamoDB TTL is enabled, but the TTL value is set far in the future (90 days). In production, call records older than a configurable window would be automatically expired. This keeps operational costs predictable and avoids unbounded table growth.

**5. Word list is not externally configurable**
The word list and blocklist are static files bundled with the Lambda. Updating them requires a new deployment. In production, these would be stored in S3 or SSM Parameter Store and reloaded on Lambda startup, allowing updates without redeployment.

**6. No input sanitization on the API**
The `/callers` endpoint takes no user input (it's a simple GET), so there is no injection surface. However, if query parameters were added (e.g., filtering by date), input validation would be required. The Lambda does sanitize the phone number extracted from the Connect event (validates E.164 format before processing).

**7. Contact flow automation (resolved in CDK path)**
The original SAM deployment required manual ARN substitution after importing the contact flow — the Lambda ARN is environment-specific. This was resolved in the CDK stack: at synth time, the hardcoded ARN in `infrastructure/contact-flow.json` is replaced with a `Fn::Sub` placeholder, and the CDK `AwsCustomResource` calls `createContactFlow` / `updateContactFlowContent` directly, eliminating the manual step. The SAM path still requires manual wiring.

**8. No observability beyond CloudWatch defaults**
Structured logging with correlation IDs (the Connect `ContactId`) is implemented. Connect flow logging is enabled via the `UpdateFlowLoggingBehavior` block in `infrastructure/contact-flow.json`, with logs written to `/aws/connect/evwalt-contact-center`. There are no CloudWatch alarms, dashboards, or X-Ray tracing configured. In production: alarms on Lambda error rate and duration, X-Ray for distributed tracing across Lambda and DynamoDB, and a dashboard showing call volume and vanity generation success rate.

**9. No WAF on API Gateway**
The API is exposed to the public internet without WAF rules. In production: WAF with rate limiting to prevent abuse of the `/callers` endpoint.

---

## What I Would Do With More Time

**Real-time web app updates**
Currently the web app fetches on page load only — a reviewer has to reload after calling to see their result. The production pattern is API Gateway WebSocket or AWS AppSync subscriptions so the dashboard updates automatically when a new call arrives, without a reload. The current design was a deliberate simplicity tradeoff given the polling-on-load model is sufficient for a demo.

**CDK-managed web dashboard (S3 + CloudFront + HTTPS)**
The web dashboard is deployed outside any infrastructure stack via a `deploy:web` script that hardcodes the author's S3 bucket. This is the one place where "deploy into your own account" breaks down — a reviewer must create a bucket manually and update the script. The S3 bucket was intentionally scoped out of the SAM template (DECISIONS.md §12) and later the CDK stack to keep the primary deployment focused. The completion is a CDK construct that provisions the bucket, bucket policy, CloudFront distribution, and ACM certificate — giving reviewers a fully reproducible deployment and production-grade HTTPS in one step.

**Integration tests against a deployed stack**
The test suite is 100% unit tests with mocked AWS services. Every Connect-specific failure during this project — the `AwsCustomResource` lifecycle bug, the Set Logging API schema incompatibility, the truncated action identifier causing `InvalidContactFlowException` — was discovered by deploying to AWS, not by a test. An integration test suite that deploys to a real dev stack and asserts end-to-end behavior (inbound call event → DynamoDB record → API response → correct vanity output) would catch this class of error in CI rather than during manual validation.

**Vanity number quality improvements**
The scoring formula works but it doesn't account for word frequency (common words are more memorable than obscure ones) or phonetic quality (some alpha strings are pronounceable even without being dictionary words). Both alternatives were explicitly considered and deferred during the initial design — word frequency requires a corpus, phonetic scoring adds implementation complexity — in favor of getting a working, documented formula shipped first (DECISIONS.md §1).

**Operational observability**
Connect flow logging is enabled and Lambda logs include the `ContactId` as a correlation ID, so the data is there. What's missing is acting on it: a Lambda error rate alarm, an invocation duration alarm approaching the 8-second Connect timeout ceiling, DynamoDB write failure alerting, and X-Ray tracing across the Connect → Lambda → DynamoDB path. Without alarms, the current observability is passive — logs exist but nobody is notified when things go wrong. This was documented as Shortcut #8 and is table stakes for a production deployment.

**API authentication**
The `GET /callers` endpoint is publicly accessible with no authentication. The data exposed is low-sensitivity (vanity number mappings), but unauthenticated internal APIs are a bad practice regardless. The production path is a Cognito user pool with the Cloudscape web app as the client, or an API key for simpler reviewer-only access. Scoped out as Shortcut #3 because the data doesn't warrant the added deployment complexity for a demo.

**CI/CD pipeline**
A GitHub Actions workflow running unit tests on push and integration tests against a dev stack on PRs — the natural follow-on to having integration tests at all. The CDK stack is already parameterized via `CONNECT_INSTANCE_ID` and `CONNECT_PHONE_NUMBER_ID` to support environment-specific deploys.

---

## Challenges

**Amazon Connect Lambda payload format**
The most significant sharp edge in this project is the Amazon Connect requirement that Lambda return values be a flat `string → string` map. Nested objects, arrays, and non-string values are silently ignored or cause the contact flow to fail. This is not prominently documented in the Connect developer guide — I validated it through the official payload reference and by reviewing community discussions of broken contact flows. The flat-map constraint shaped the entire Lambda output contract and is the most important implementation detail for anyone extending this code.

**GSI query design**
Getting the "last 5 callers" query right required understanding that a fixed-partition GSI is the correct primitive for sorted global queries in DynamoDB, even though it is an acknowledged anti-pattern at scale. The intuitive alternative (scan + client sort) is wrong in principle even when it works in practice. Documenting this distinction was important.

**Contact flow ARN substitution**
Amazon Connect contact flows store Lambda ARNs directly in the exported JSON. This means the exported flow is environment-specific and cannot be imported into a different account without manual ARN updates. This is a known limitation of the Connect console export format. The CDK stack resolves this by replacing the hardcoded ARN with a `Fn::Sub` placeholder at synth time.

**CDK AwsCustomResource — ContactFlowId across create vs. update lifecycles**
The CDK `AwsCustomResource` for the contact flow uses `createContactFlow` on `onCreate` (which returns `ContactFlowId`) and `updateContactFlowContent` on `onUpdate` (which returns `{}`). Using `getResponseField('ContactFlowId')` to pass the ID to downstream resources compiles to a CloudFormation `GetAtt` on `Data.ContactFlowId`. After any update, `Data` is `{}` and the attribute disappears, causing downstream resources to fail with "Vendor response doesn't contain ContactFlowId attribute." The fix is to use the custom resource's physical resource ID (`node.findChild('Resource').ref`) instead — it is set to the `ContactFlowId` on `onCreate` and retained on every subsequent update, independent of the API response payload.

**Set Logging — Connect API schema and AwsCustomResource error surfacing**
Enabling flow logging required two distinct debugging passes. First: the API-format contact flow schema (used by `createContactFlow` / `updateContactFlowContent`) is not the same as the visual-designer export format. The correct action type (`UpdateFlowLoggingBehavior`) and parameter (`FlowLoggingBehavior: "Enabled"`) were only discoverable by adding the block in the Connect console and then running `describe-contact-flow` to extract the exact API-format JSON. Attempting to author the block manually from documentation alone failed.

Second: after incorporating the extracted JSON into `contact-flow.json`, CDK deployment failed with a generic `UnknownError` from CloudFormation. The real error — `InvalidContactFlowException` with `problems: [{ message: 'Invalid Action property value. Path: Actions[5].Transitions.Errors[0].NextAction' }]` — was only visible in the CloudWatch logs for the AwsCustomResource provider Lambda. The root cause was a truncated action identifier (a malformed UUID) introduced when editing the JSON. The AwsCustomResource provider catches SDK exceptions and forwards only the top-level exception type to CloudFormation, swallowing the structured `problems` array. Direct CLI testing (`aws connect update-contact-flow-content --cli-error-format json`) is the fastest path to the real error when CDK surfaces `UnknownError`. After correcting the identifier, the CDK deployment succeeded with no infrastructure code changes.
