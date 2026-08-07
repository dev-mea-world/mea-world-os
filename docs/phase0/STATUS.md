# Phase 0 status

Last updated: 2026-08-07

This file is updated from measured evidence. `PASS` means the exact gate was exercised; `BLOCKED` names the missing external prerequisite. The latest live database and remote-ref gate ran at 2026-08-07 17:32 CEST.

| Gate | Status | Evidence |
| --- | --- | --- |
| PostgreSQL and migrations work | PASS | PostgreSQL 17 container is healthy; migration `0001_phase0.sql` applied idempotently and the live gate connected successfully. |
| GitHub push works | PASS | The configured `origin` is `https://github.com/dev-mea-world/mea-world-os.git`; live branch `agent/phase0-automatic-git-publication` contains local bootstrap commit `4166e04`. The separate GitHub CLI session is expired, so PR creation remains unavailable until `gh auth login`, but Git push authentication works through the configured credential helper. |
| Notion read test works | PASS | The locally configured token returned a bounded SDK sample of 5 objects with additional results available. Only stable inventory metadata and hashes were persisted; no page content was stored and no write API was called. |
| Local control loop runs | PASS | At 17:32 CEST the live gate found the authenticated worker heartbeat fresh after the updated daemon restarted; the dashboard and worker remain active locally. |
| Automatic Git publication works | PASS | A real durable `repo.update` task ran Codex in an isolated worktree, passed the repository suite and all project typechecks, and published exactly one file. PostgreSQL stage `verified`, recorded commit/remote SHA, and the live `automation/phase0-updates` ref all match `71b570c`. No force push or protected-branch update occurred. |
| Vercel dashboard reachable | BLOCKED | No Vercel project/authentication is configured yet. |
| Dashboard authentication works | PASS | Browser smoke rejected an invalid code, accepted the configured code, persisted an opaque hashed session, and revoked it on logout. Cookies are HTTP-only and SameSite strict; HTTPS configuration enables `Secure`. |
| Mac mini heartbeat visible | PASS | Signed heartbeat was accepted, persisted, shown by the dashboard, and reported fresh by the live gate; nonce replay and heartbeat ordering are covered by tests. |
| Test Codex task executes | PASS | Three live runs returned and persisted the exact `PHASE0_CODEX_OK` marker through the official Codex SDK adapter. The newest live output is a JSONB object. |
| Active work remains leased | PASS | A 15-second live lease was renewed while Codex ran; one `task.lease_renewed` event exists and the run completed once. |
| Incomplete work reconciles after restart | PASS | A worker was killed after a durable checkpoint; after expiry the old run became `interrupted`, attempt 2 was leased with a new token, and completed successfully. |
| Approval supports approve/reject | PASS | Browser smoke approved the fake no-op proposal; automated tests cover reject, stale-hash refusal, single-decision enforcement, and correlation to the persisted session actor. |
| Audit event for each transition | PASS | State changes and events share transactions; append-only triggers reject update/delete, and the live aggregate-version gap query returned zero gaps. |
| Build and regression suite | PASS | 38 tests passed across 6 files, all 11 TypeScript projects type-checked, and the Next.js production build completed with the signed Git-publication route. |

No exhaustive Notion ingestion or external mutation has been performed.

## Minimum actions to unblock the external gates

1. Select a Vercel project and production PostgreSQL database, configure server-side secrets, deploy, and verify HTTPS `/api/health`.
2. Review and explicitly install the launchd plist; repository setup does not load it automatically.
