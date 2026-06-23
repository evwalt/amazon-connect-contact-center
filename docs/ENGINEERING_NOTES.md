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
Structured logging with correlation IDs (the Connect `ContactId`) is implemented, but there are no CloudWatch alarms, dashboards, or X-Ray tracing configured. In production: alarms on Lambda error rate and duration, X-Ray for distributed tracing across Lambda and DynamoDB, and a dashboard showing call volume and vanity generation success rate.

**9. No WAF on API Gateway**
The API is exposed to the public internet without WAF rules. In production: WAF with rate limiting to prevent abuse of the `/callers` endpoint.

---

## What I Would Do With More Time

**Real-time web app updates**
Currently the web app polls on page load. With more time, I'd replace the polling pattern with API Gateway WebSocket or AWS AppSync subscriptions, so the web app updates automatically when a new call comes in.

**Vanity number quality improvements**
The scoring formula is simple and works, but it doesn't account for word frequency (common words are more memorable than obscure ones) or phonetic quality (some alpha strings are pronounceable even without being words). A better approach would weight by word frequency from a corpus and add a syllable-structure score.

**Area code vanity mapping**
The current implementation only converts the 7-digit subscriber number. A natural extension is to also generate vanity candidates for the full 10-digit number (area code + subscriber), or specifically for toll-free area codes (800, 888, etc.) where the area code is already part of the brand identity.

**Contact flow as code** *(implemented)*
The contact flow is now deployed as code from `infrastructure/contact-flow.json` via the CDK stack (`infrastructure/cdk/`). The CDK `AwsCustomResource` calls the Connect API to create or update the flow on every `cdk deploy`, and phone number association is also automated. The SAM path still requires a manual import.

**Call history per caller**
The current web app shows the 5 most recent call events globally. A useful extension would be a per-caller history view — click on a number to see all past calls and their vanity results. This is supported by the call log schema (query by PK = callerNumber) without schema changes.

**CloudFront + custom domain**
Serving the web app over HTTPS with a custom domain via CloudFront and ACM. This is table stakes for a production web property but was scoped out due to the SAM/CloudFront integration complexity.

**CI/CD pipeline**
A GitHub Actions workflow that runs unit tests on every push, integration tests on PRs, and deploys to a dev stack automatically. The SAM template is already parameterized to support this.

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

**Set Logging — Connect API schema incompatibility**
The Connect console allows enabling flow logging via a "Set logging behavior" block. However, the API-format contact flow schema (used by `createContactFlow` / `updateContactFlowContent`) and the visual-designer export format are not the same. The correct action type (`UpdateFlowLoggingBehavior`) was identified, but no combination of parameter values accepted by the API could be determined. All values for the `FlowLoggingBehavior` parameter were rejected, and the parameter format is not documented for the API schema. Rather than ship a flow that might fail silently or behave unexpectedly, this block was left out. The safe resolution is to configure logging in the Connect console, then `describe-contact-flow` to extract the exact API-format JSON, and incorporate that into `contact-flow.json`.
