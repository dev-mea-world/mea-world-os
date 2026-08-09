# ADR 0005: Executable supervisor intents and bounded Notion research

## Status

Accepted — 2026-08-09

## Context

The Telegram router could classify only conversational answers, repository updates, and clarifications. A request to analyze Notion was therefore returned as a paraphrase even though no source had been read. Follow-up questions were routed without durable task context, so the system could describe routing rather than report the actual work state.

This violated the definition of done: produced text was presented where an executed, evidenced task was required.

## Decision

- Treat free-text Telegram input as a `supervisor.request`, while retaining `operator.query` for explicit `/ask` conversations.
- Give the supervisor a strict executable decision schema: answer from supplied context, read-only Notion research, governed repository update, durable task status, clarification, or capability gap.
- Never accept a paraphrase, plan, or acknowledgement as the answer to an action request.
- Attach a bounded snapshot of recent Telegram task/run state to every supervisor request. Common follow-up phrases such as “lo hai fatto?” create a deterministic `supervisor.status` task; other status intents may be selected by the planner. Answers are rendered server-side from PostgreSQL and may reference only tasks belonging to the paired chat.
- Convert a Notion decision into a deduplicated `notion.research` child task automatically because it is read-only and low risk.
- Keep the Notion token exclusively in the local worker. The worker searches page titles, retrieves page markdown through the official API, applies page and character limits, measures incomplete/inaccessible coverage, and passes only bounded source content to a network-disabled synthesis runtime.
- Treat Notion content as untrusted evidence, not instructions. Require strict JSON synthesis, validate all `[N#]` citations against supplied sources, label the result AI-generated and unvalidated, and record a confidence value.
- Do not persist raw research content during this Phase 0 capability. Persist source identity, URL, source edit time, content hash, matched query, partial state, task/run provenance, response, confidence, validation state, and measured coverage.
- Send automatic Telegram notifications when research starts and completes. Display research source count, confidence, and coverage state in the dashboard.

## Limits and failure behavior

- This is bounded topical research, not Phase 1 exhaustive ingestion. It cannot prove that absent results do not exist.
- Search uses up to five focused title queries, at most 30 unique pages, and at most 120,000 source characters; production defaults are lower.
- Search failures and total page-fetch failure are retryable within the task attempt bound. Missing credentials, invalid queries, unsupported capabilities, and invalid source citations fail closed or create a capability request.
- Existing Notion content remains read-only. No approval or routing decision can mutate it through this capability.

## Consequences

- The operator can ask for useful Notion analysis from Telegram and receive a sourced result rather than a promise.
- Follow-ups such as “lo hai fatto?” refer to durable work state and child-task results.
- Source coverage is honest but intentionally incomplete until the Phase 1 mirror and retrieval layers exist.
