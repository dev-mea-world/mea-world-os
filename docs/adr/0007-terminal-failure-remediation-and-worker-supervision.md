# ADR 0007: Terminal failure remediation and always-on worker supervision

- Status: accepted
- Date: 2026-08-09

## Context

The durable worker already recovered expired task leases, but a completed `failed_terminal` run only persisted the failure and notified the operator. Code changes also required a human to restart a manually launched daemon. This left the operator acting as monitoring and process glue, contrary to the autonomy and Mac mini lifecycle invariants.

One observed repository update completed its Codex phase and was then blocked by `git_likely_secret_detected`. The scanner inspected the entire changed TypeScript file and interpreted the existing Zod declaration `WORKER_SECRET: z.string().min(32)` as a credential value. The security gate was correct to fail closed, but its assignment grammar did not distinguish schema declarations from values.

## Decision

- A terminal task transition transactionally creates one recovery `repo.update` task, marked by `automaticRemediation`, containing the source task/run identity, normalized error, original authorized objective, and Telegram correlation fields when present. Reusing the established repository-mutation kind keeps recovery compatible during rolling control-plane/worker upgrades.
- The per-source-run dedupe key makes task creation idempotent. A reconciliation pass before leasing backfills terminal failures that predate the mechanism.
- Remediation is a repository-mutation task and therefore uses the existing isolated worktree, no-network Codex runtime, independent validation, secret policy, attributable commit, non-force push, and remote-SHA verification.
- Remediation depth is capped at one and attempts at two. A failed remediation does not create another remediation.
- The host worker also performs the same bounded PostgreSQL reconciliation directly. This backfills failures even while an older web control plane is still deployed; task creation remains deduplicated and auditable.
- The secret scanner continues to inspect every changed file, but credential assignments cannot span lines and colon-form credentials must contain a quoted literal. Private-key, provider-token, AWS-key, sensitive-path, and non-empty `.env.example` checks remain fail-closed.
- launchd keeps a small supervisor process alive. The supervisor owns the worker daemon as a child, uses bounded crash backoff, gracefully stops it before a forced kill deadline, and replaces it after relevant source or local configuration changes. Changes to the supervisor itself cause it to exit so launchd loads the new code.
- macOS blocks background LaunchAgents from opening this repository while it resides under `~/Desktop`. The installer therefore maintains a separate, non-authoritative Git runtime under `~/Library/Application Support/MeaWorld Company OS/repository`, installs its dependencies from the local pnpm store, and copies the runtime environment with mode `0600`. Automatic task worktrees are created under that runtime checkout, not the human workspace.
- `scripts/install-launchd.sh` synchronizes the runtime and installs/reloads the service idempotently. `launchctl bootout` remains the explicit operator stop boundary.

## Consequences

An operator no longer needs to watch logs, create routine repair work, or restart the worker after a code/configuration update. Failures and their recovery remain durable and auditable. Recovery cannot recurse indefinitely, bypass governance, mutate the human checkout, force-push, or introduce secrets. Failures that truly require credentials or authority remain visible rather than being hidden by automatic retries.
