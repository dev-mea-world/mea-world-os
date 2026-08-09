# MeaWorld Autonomous Company OS

Phase 0 is a deliberately small vertical slice: an authenticated control plane, a signed Mac worker, durable PostgreSQL state, one safe Codex smoke task, a read-only Notion sample, a fake governed proposal, audit events, and restart recovery.

The constitutional source is [`PROJECT_SEED.md`](./PROJECT_SEED.md). Phase 0 does **not** perform exhaustive Notion ingestion and never writes to existing Notion content.

## Local bootstrap

Prerequisites: Node.js 20.9+, pnpm, and PostgreSQL. Docker Compose is provided for a disposable local database.

1. Copy `.env.example` to `.env.local` and populate the required values. Never commit that file.
2. Start PostgreSQL with `docker compose up -d postgres`.
3. Set `DATABASE_URL` in the shell used for commands. For the included container it is `postgres://meaworld:local-only-meaworld@localhost:54329/meaworld`.
4. Run `pnpm install`, `pnpm db:migrate`, and `pnpm phase0:seed`.
5. Run `pnpm dev` and open `http://localhost:3000`.
6. In another shell run `pnpm worker:daemon`.

The worker and web app must share `WORKER_ID` and `WORKER_SECRET`. The web app also needs `DASHBOARD_ACCESS_CODE`, `SESSION_SECRET`, and `PUBLIC_APP_URL`. Use at least 32 random bytes for both secrets.

## Automatic repository updates

The worker can publish a `repo.update` task automatically when `GIT_AUTO_PUBLISH_ENABLED=true`. Every run uses its own worker-owned Git worktree, never the human checkout, so a retry cannot inherit files left by a failed attempt. Codex receives write access only to that worktree and no tool-network access. The host worker then blocks sensitive files and likely secrets, runs the full test suite and all project typechecks in a second macOS sandbox with no network or host credentials, creates an attributable commit, and pushes it without force.

The default remote target is `origin` branch `automation/phase0-updates`. `main` and `master` are rejected as automatic targets. A task is successful only after the worker reads the remote ref back and verifies its commit SHA. Commit/push progress is persisted in PostgreSQL so an interrupted attempt can reconcile instead of publishing a duplicate.

Configure the `GIT_*` variables listed in `.env.example`; Git authentication must already work on the Mac without embedding credentials in the repository or remote URL. A repository update can be enqueued deliberately with:

```sh
LOOP_UPDATE_OBJECTIVE="Document the worker runbook" \
LOOP_UPDATE_PROMPT="Update the worker runbook, keeping the change scoped and tested." \
pnpm loop:enqueue-update
```

The same prompt is deduplicated automatically. Set `LOOP_UPDATE_DEDUPE_KEY` when a caller needs an explicit stable idempotency key.

The validation boundary uses macOS Seatbelt at `/usr/bin/sandbox-exec`. Run the worker from a normal terminal or host service; launching it inside another Seatbelt sandbox makes validation fail closed because macOS does not permit nested sandbox application.

## Verification

```sh
pnpm test
pnpm typecheck
pnpm build
pnpm notion:smoke
pnpm codex:smoke
pnpm phase0:gate
```

`notion:smoke` only enumerates a bounded sample. `codex:smoke` asks the local Codex SDK for a fixed harmless response. Both commands fail explicitly when their credential/runtime prerequisite is absent. `phase0:gate` reports machine-readable `PASS`, `FAIL`, or `BLOCKED` evidence from the live database and exits non-zero only for implemented gates that regress.

The detailed acceptance matrix and current evidence live in [`docs/phase0/PLAN.md`](./docs/phase0/PLAN.md) and [`docs/phase0/STATUS.md`](./docs/phase0/STATUS.md).

## Deployment

Deploy `apps/web` to Vercel with the same server-side secrets and a production PostgreSQL URL. Never expose `WORKER_SECRET`, `SESSION_SECRET`, `DASHBOARD_ACCESS_CODE`, or `NOTION_TOKEN` through `NEXT_PUBLIC_*` variables. After deployment, set `WORKER_BASE_URL` on the Mac to the HTTPS deployment URL and verify that its heartbeat is visible.

The launchd template is installed explicitly with `scripts/install-launchd.sh`; it is not installed automatically by repository setup. The installer captures the current Node/pnpm runtime path so the service does not depend on an interactive shell profile.

## Telegram operator channel

The production dashboard exposes `/api/telegram/webhook` as a bounded operator channel. Configure `TELEGRAM_WEBHOOK_SECRET` and `TELEGRAM_PAIRING_CODE` as sensitive production variables, deploy, then register the HTTPS webhook with Telegram using the same webhook secret and allow both `message` and `callback_query` updates. Keep `TELEGRAM_BOT_TOKEN` only in the local worker environment: the worker uses it to drain the durable notification outbox, and it must never be committed, logged, stored in PostgreSQL, or added to Vercel.

Telegram `/ask` runs a read-only conversational question. Free text and `/request` go to the durable supervisor, which can answer from supplied context, execute bounded read-only Notion research, report real task status, ask a clarification, record a missing capability, or propose a repository update. Repository updates require confirmation from the paired operator and then use the isolated, validated Git publication flow. Results are sent automatically while `/result` remains available as a diagnostic fallback.

Responses longer than `TELEGRAM_NOTION_RESPONSE_THRESHOLD` (default 3,500 characters) are routed through a durable Notion publication task. Configure `NOTION_TELEGRAM_PARENT_PAGE_ID` on the local worker to an integration-shared AI-output page. The worker creates a new dedicated child page, visibly marks it AI-generated and unvalidated, records task/run provenance, timestamp, content hash, and idempotency, then sends Telegram only a short summary and the page link. It never updates existing Notion page properties or blocks. If configuration or page creation fails, the audited saga falls back to the existing chunked Telegram text delivery. Apply migration `0005_notion_response_publications.sql` before enabling this path.

Notion research searches at most five title queries, fetches a bounded set of accessible pages through the local worker, synthesizes without network access, validates source citations, and records source version/hash, confidence, validation state, and measured coverage. It is not the exhaustive Phase 1 mirror and never mutates existing Notion content.

Only one private chat can be paired. Send `/pair <code>` once, then use `/status`, `/tasks`, `/result [task-id]`, `/ask <question>`, or plain text. Questions become durable `operator.query` tasks and execute locally through Codex in read-only mode with network and side effects disabled. Results are visible in the live dashboard and through `/result`.
