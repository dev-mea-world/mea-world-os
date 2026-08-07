# Phase 0 status

Last updated: 2026-08-07

This file is updated from measured evidence. `PASS` means the exact gate was exercised; `BLOCKED` names the missing external prerequisite. The latest live database gate ran at 2026-08-07 16:51 CEST.

| Gate | Status | Evidence |
| --- | --- | --- |
| PostgreSQL and migrations work | PASS | PostgreSQL 17 container is healthy; migration `0001_phase0.sql` applied idempotently and the live gate connected successfully. |
| GitHub push works | PASS | `origin` points to `https://github.com/mea-world/os.git`; remote `main` and local `HEAD` both resolve to `69d7acc`, and `git push --dry-run origin main` completed successfully on 2026-08-07. The separate Codex GitHub App still returns 404 for this repository and would need installation access for connector-backed PR operations. |
| Notion read test works | PASS | The locally configured token returned a bounded SDK sample of 5 objects with additional results available. Only stable inventory metadata and hashes were persisted; no page content was stored and no write API was called. |
| Local control loop runs | PASS | At 16:51 CEST `/api/health` returned HTTP 200 with the database reachable, the worker online, and Notion sampled; the daemon then advanced to its next signed heartbeat. |
| Vercel dashboard reachable | BLOCKED | No Vercel project/authentication is configured yet. |
| Dashboard authentication works | PASS | Browser smoke rejected an invalid code, accepted the configured code, persisted an opaque hashed session, and revoked it on logout. Cookies are HTTP-only and SameSite strict; HTTPS configuration enables `Secure`. |
| Mac mini heartbeat visible | PASS | Signed heartbeat was accepted, persisted, shown by the dashboard, and reported fresh by the live gate; nonce replay and heartbeat ordering are covered by tests. |
| Test Codex task executes | PASS | Three live runs returned and persisted the exact `PHASE0_CODEX_OK` marker through the official Codex SDK adapter. The newest live output is a JSONB object. |
| Active work remains leased | PASS | A 15-second live lease was renewed while Codex ran; one `task.lease_renewed` event exists and the run completed once. |
| Incomplete work reconciles after restart | PASS | A worker was killed after a durable checkpoint; after expiry the old run became `interrupted`, attempt 2 was leased with a new token, and completed successfully. |
| Approval supports approve/reject | PASS | Browser smoke approved the fake no-op proposal; automated tests cover reject, stale-hash refusal, single-decision enforcement, and correlation to the persisted session actor. |
| Audit event for each transition | PASS | State changes and events share transactions; append-only triggers reject update/delete, and the live aggregate-version gap query returned zero gaps. |
| Build and regression suite | PASS | 15 tests passed, all 10 TypeScript projects type-checked, web lint passed, and the Next.js production build completed with the worker renewal route. |

No exhaustive Notion ingestion or external mutation has been performed.

## Minimum actions to unblock the external gates

1. Select a Vercel project and production PostgreSQL database, configure server-side secrets, deploy, and verify HTTPS `/api/health`.
2. Review and explicitly install the launchd plist; repository setup does not load it automatically.
