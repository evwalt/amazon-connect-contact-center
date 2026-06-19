# Design Decisions

This document records the key decisions made during architecture and implementation, the alternatives considered, and the rationale for each choice. The goal is to make the thinking transparent — not just what was built, but why.

---

## 1. Defining "Best" Vanity Numbers

### Decision

Score each candidate using a three-tier formula:

```
primary   = (has_word ? 10_000 : 0) + (longest_word × 10 + word_count) − (digit_count × 10)
tiebreaker = longest_contiguous_alpha_run
```

- `has_word`: whether any dictionary word (length 3–7) appears anywhere in the candidate
- `longest_word`: character length of the longest matched word
- `word_count`: number of distinct dictionary words found
- `digit_count`: number of literal `0` or `1` characters in the candidate (these map to no keypad letters and break readability; each deducts 10 points)
- `longest_contiguous_alpha_run`: used only to break ties after the primary score

The top 5 by score are stored; the top 3 are spoken.

**Example:** For `+1-800-356-9377` (subscriber `3569377`):

- `FLOWERS` is a candidate: 1 word, longest = 7 letters, no 0/1 digits
- `primary = 10_000 + (7 × 10 + 1) − 0 = 10_071`
- Ranks first; other 7-letter candidates without a full word score at most `70 + word_count`

### Why This Formula

The 10,000-point word-presence offset keeps any word-matching candidate strictly above all no-word candidates, regardless of digit penalties. Within each tier, longer single words beat shorter ones (memorability), and word count breaks further ties. The digit penalty discourages candidates where unavoidable `0`/`1` positions appear mid-word, since those positions cannot be converted to letters.

### Alternatives Considered

| Option | Rejected Because |
|---|---|
| Brute-force all permutations, rank by length | Generates too many low-quality candidates with no quality signal |
| Frequency-weighted scoring (common words score higher) | Requires a frequency corpus; adds complexity without clear benefit at this scope |
| ML/embedding-based memorability score | Massive over-engineering for a take-home assignment |
| Phonetic scoring (Soundex/Metaphone) | Adds complexity; the dictionary-word presence signal is already phonetically sensible |

### Edge Cases

- **Digits 0 and 1** have no keypad letter mapping. If the subscriber number contains them, the corresponding position is treated as a literal digit and skipped during word search. The result may be a partial vanity string (e.g., `800-FL0WERS` with a zero in position).
- **No words found**: Return the top 5 candidates by longest-run-of-alpha-characters, or the raw alpha substitution if no run exists. The contact flow still speaks 3 options — they may just be numeric-looking strings.
- **Offensive words**: A blocklist is applied before scoring. Candidates matching any blocklist entry are discarded.

---

## 2. Call Log vs. Upsert Design

### Decision

Use an **append-only call log**. Each call creates a new DynamoDB item with a composite key of `callerNumber` (PK) + `timestamp` (SK). Repeated calls from the same number create additional records.

### Why

The web app requirement is "last 5 callers" — meaning 5 call events, not 5 unique numbers. An upsert design (one record per caller number) would collapse repeated callers into a single record and misrepresent the web app's intent. The call log design also preserves history without additional design effort.

### Tradeoff

The call log grows unboundedly. In production, a TTL attribute would automatically expire old records (DynamoDB TTL, no cost). For this assignment, a TTL attribute is included in the schema but set to a long expiry (e.g., 90 days) to avoid cluttering a live demo instance.

---

## 3. DynamoDB Table Design

### Decision

Single table `VanityCallLog` with:

- Base table PK: `callerNumber`, SK: `timestamp`
- GSI `TimestampIndex`: fixed PK `gsiPk = "CALL"`, SK `timestamp`

### Why Single Table

There is only one entity type (call records) and two access patterns (write by caller/time, read most recent). A single table is sufficient.

### Why the GSI

The "last 5 callers" query needs records ordered by timestamp across all callers. Without a GSI, the only option is a full table scan sorted client-side — which works at small scale but is wrong in principle. The GSI with a fixed partition key enables a proper `Query` with `ScanIndexForward=false, Limit=5`.

### Known Anti-Pattern

A fixed GSI partition key (`"CALL"`) creates a hot partition as call volume grows. Acceptable for this assignment. Production mitigation: time-bucketed partition key (e.g., `"CALL#2026-06"`) combined with a query that checks the current and previous bucket.

### Alternative Considered

**Scan + client-side sort**: Simpler to implement. Rejected because it doesn't demonstrate correct DynamoDB query design and would fail at any meaningful scale.

---

## 4. Language and Runtime

### Decision

Node.js 20.x for both Lambdas.

### Why

- Fast cold starts (critical for the synchronous Connect invocation path)
- Native JSON handling for the Connect event payload and DynamoDB responses
- Straightforward for a take-home assignment with a single reviewer deploying it
- The AWS SDK v3 for JavaScript has a clean DynamoDB DocumentClient

### Alternatives Considered

| Runtime | Rejected Because |
|---|---|
| Python 3.12 | Also a valid choice; Node.js preferred for consistent cold start behavior |
| Java 21 | Cold start latency unacceptable in a synchronous Connect flow |
| Go | Valid but less common in Connect-adjacent Lambda work; adds unfamiliar toolchain for reviewers |

---

## 5. IaC Tool: AWS SAM

### Decision

AWS SAM for all infrastructure.

### Why

SAM is purpose-built for Lambda + API Gateway workloads. It requires less boilerplate than CDK for this scope and is more accessible to reviewers deploying into their own accounts without installing CDK dependencies. The `sam deploy --guided` flow is intentionally reviewer-friendly.

### What SAM Cannot Do Cleanly

SAM does not natively manage CloudFront distributions. For this assignment the web app runs locally via Vite (`npm run dev:web`) — no S3 bucket or CloudFront distribution is deployed. In production the right approach is S3 + CloudFront for HTTPS, caching, and a custom domain — documented as a "more time" item.

### Alternative Considered

**AWS CDK**: More powerful, better TypeScript integration, cleaner CloudFront support. Rejected because it requires a CDK bootstrap step and is more setup friction for a reviewer deploying from scratch.

---

## 6. Web App: Cloudscape React + Vite

### Decision

React with [Cloudscape Design System](https://cloudscape.design/) components, bundled by Vite. Runs locally via `npm run dev:web`; no S3 or CloudFront hosting for this assignment.

### Why Cloudscape

Cloudscape is the open-source design system used across AWS console products. For an Amazon Connect assignment, using Cloudscape signals familiarity with AWS-aligned UI conventions and produces a professional result without custom CSS. The `AppLayout` + `Table` pattern matches exactly how the Connect console itself presents tabular data.

### Why Local-Only (No S3 Hosting)

SAM does not manage CloudFront distributions natively, and adding S3 static website hosting to the SAM template introduces significant additional configuration (bucket policy, CORS, OAI or OAC, output URL) that is not the focus of this assignment. The feature requirement is "display the last 5 callers" — a Vite dev server satisfies that for demo purposes. Documented as a "more time" item.

### Tradeoff

The web app cannot be accessed without running `npm run dev:web` locally. In production: S3 + CloudFront via CDK (SAM's CloudFront support is limited), with HTTPS and a custom domain.

---

## 7. API Design: HTTP API vs. REST API

### Decision

API Gateway HTTP API (v2) for the `/callers` endpoint.

### Why

HTTP API is lower cost (~$1/million requests vs. ~$3.50 for REST API), has lower latency, and is simpler to configure for this single-route use case. REST API features (usage plans, request validation, caching) are not needed here.

### CORS

CORS is explicitly configured on the HTTP API (`AllowOrigins: *`) to allow the locally-served Vite app to call the API from a different origin. This is a common gotcha when the web app and API are on different origins — it is handled in the SAM template, not discovered at demo time.

---

## 8. Vanity Number Scope: 7-Digit Subscriber Number Only

### Decision

Apply the vanity conversion only to the last 7 digits of the phone number (the subscriber number, excluding area code and country code).

### Why

Traditional vanity numbers (1-800-FLOWERS) use the 7-digit subscriber portion. The area code is a routing artifact, not part of the memorable identifier. Including the area code would generate longer, less recognizable vanity strings.

### Exception

If the area code is `800`, `888`, `877`, `866`, `855`, `844`, or `833` (toll-free prefixes), that is noted in the output formatting because it contributes to the "vanity brand" — but the conversion algorithm still only operates on the last 7 digits.

---

## 9. Word List

### Decision

Embed a static JSON file of approximately 5,000 common English words in the Lambda package, filtered to words of length 3–7 (matching the usable subscriber digit count). A separate small blocklist JSON excludes offensive words.

### Why Static File

- No runtime dependency on S3 or any external service
- Deterministic: same input always produces the same output
- Fast: loaded once at Lambda cold start into module scope, reused across warm invocations
- Auditable: reviewers can inspect exactly which words are in scope

### Word List Source

The word list is derived from public domain frequency word lists (e.g., SCOWL at a common-word frequency threshold). Only words composed of letters A–Z (no hyphens, apostrophes, or accents) are included.

### Tradeoff

A smaller word list may miss valid vanity candidates that a larger dictionary would find. A larger dictionary (e.g., full Scrabble word list at ~279k words) would find more matches but would include obscure words that are not "vanity-friendly." The 5,000-word list strikes a balance.

---

## 10. Connect Lambda Timeout

### Decision

Set the Lambda timeout in the SAM template to 10 seconds. Set the timeout in the Connect contact flow's "Invoke Lambda" block to 8 seconds.

### Why

Amazon Connect's maximum Lambda invocation timeout is 8 seconds. Setting the Lambda's own timeout higher (10s) ensures the Connect timeout fires before the Lambda is killed, allowing the contact flow error branch to handle it gracefully rather than receiving an unhandled Lambda error. Target execution time is under 2 seconds on a warm invocation; the 8-second Connect timeout is a safety margin.

---

## 11. Store 5, Speak 3

### Decision

The Lambda computes and stores the top 5 vanity numbers in DynamoDB. The contact flow speaks only the top 3.

### Why

Storing more than is immediately surfaced is a standard pattern: the presentation layer decides how much to show, and the stored data can serve future use cases (web app, analytics) without re-processing. Speaking all 5 would make the IVR experience too long. Three is a common UX pattern for choice presentation in voice interfaces.
