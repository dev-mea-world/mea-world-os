# Phase 0 implementation plan

## Scope

Build only the foundation vertical slice in `PROJECT_SEED.md`: durable PostgreSQL state, authenticated dashboard, signed worker heartbeat and task execution, bounded read-only Notion sampling, a harmless Codex runtime task, fake hash-bound approval, structured audit events, launchd supervision, and restart recovery.

Out of scope: exhaustive Notion traversal, semantic extraction, vector search, real Notion mutations, autonomous goal generation, real external side effects, and later-roadmap dashboard breadth.

## Acceptance tests

| Gate | Evidence required |
| --- | --- |
| GitHub push | `origin` resolves to the intended repository and a pushed commit is visible remotely. |
| Notion read | A bounded SDK search returns at least one accessible object; no write API is called. |
| Vercel reachability | Production HTTPS `/api/health` returns a healthy/degraded structured response. |
| Dashboard auth | Invalid codes are rejected/throttled, valid code creates an HTTP-only signed cookie, logout clears it, unauthenticated mutations fail. |
| Worker heartbeat | A valid signed heartbeat updates PostgreSQL and appears on the dashboard; stale/replayed/invalid signatures fail. |
| Codex task | The official local SDK completes the harmless `phase0.codex-smoke` task and persists the output. |
| Restart recovery | Active work renews its lease; an actually expired incomplete lease is re-leased with a new run/attempt and audit events. |
| Approval flow | Approve and reject both work for pending fake proposals; a stale proposal hash is rejected. |
| Auditability | Every tested state transition creates a correlated durable event in the same transaction. |

## Minimum human-only inputs

- choose/create the GitHub repository and authenticate push access;
- provide a Vercel project/account and production PostgreSQL URL;
- provide a Notion integration token and share the intended pages/data sources;
- choose the dashboard access code and generate session/worker secrets;
- keep the local Codex runtime authenticated;
- explicitly install the generated launchd service after reviewing its paths.

Missing inputs are recorded as blocked gates, never substituted with invented success.
