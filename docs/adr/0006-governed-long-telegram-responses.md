# ADR 0006: Governed Notion pages for long Telegram responses

## Status

Accepted — 2026-08-09

## Context

Telegram delivery split every completed response into 3,800-character outbox messages. Detailed research could therefore produce several low-context messages, while the durable result was difficult to read and share. Creating a Notion page is an external mutation, so improving delivery must not weaken the rule that existing Notion content is read-only or lose provenance, recovery, audit, and human-visible validation state.

## Decision

- Configure the web-side routing threshold with `TELEGRAM_NOTION_RESPONSE_THRESHOLD` (default 3,500; allowed range 500–10,000). Responses at or below the threshold keep the existing Telegram text path.
- For a longer response, transactionally create a `notion.telegram-response.publish` child task and a `notion_response_publications` saga record. Do not enqueue the full Telegram response at that point.
- Keep `NOTION_TOKEN` and the explicitly granted `NOTION_TELEGRAM_PARENT_PAGE_ID` only on the local worker. The capability may call Notion search and page creation only. It does not update, archive, move, delete, or append blocks to any existing page.
- Create one new child page whose title and top callout visibly say `AI UNVALIDATED`. Include origin, validation state, source task ID, source run ID, creation timestamp, idempotency key, content hash, and the complete response in the create request.
- Use `telegram:notion-response:<source-run-id>` as the durable idempotency key. Before creation and after an ambiguous create error, search for the exact deterministic title under the configured parent. A recovered page is recorded instead of creating another. A lease-expired create is audited as outcome-unknown before the bounded retry performs the same lookup.
- Persist planned, creating, created, retry, outcome-unknown, and failed transitions with continuous aggregate versions. Store only sanitized error codes; never persist connector error bodies or credentials.
- After verified page creation, enqueue one concise deterministic summary plus the HTTPS Notion link. If creation fails terminally or returns an invalid result, enqueue the original response through the existing bounded/chunked Telegram path.

## Limits and failure behavior

- A configured parent must be a page in an AI-output area shared with the integration. Creating the dedicated child changes only that new artifact; pre-existing page properties and blocks remain untouched.
- Notion search can be eventually consistent. The deterministic title, visible idempotency marker, durable saga, bounded three attempts, and exact-parent lookup reduce duplication and make ambiguous outcomes observable; they do not claim transactional exactly-once semantics from the Notion API.
- Missing Notion configuration fails the publication task terminally and immediately uses the existing Telegram fallback. Rate limits and server failures remain retryable within the task attempt bound.
- The concise summary is the first sentence, capped at 480 characters. It is labeled AI-unvalidated and is not a new model-generated claim.

## Consequences

- Long operator results become readable and shareable without flooding Telegram.
- Every new page remains visibly non-authoritative and traceable to durable source work.
- Delivery waits for the publication child task, while failures remain recoverable through the previous text behavior.
- Production must apply migration `0005_notion_response_publications.sql` before enabling the two new configuration variables.
