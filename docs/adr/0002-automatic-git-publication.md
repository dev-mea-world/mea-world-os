# ADR 0002: Automatic Git publication for loop updates

- Status: accepted
- Date: 2026-08-07

## Context

Repository-update tasks need to publish their verified changes without turning a human into deployment glue. A Git push is an external side effect: it must remain attributable, idempotent, restart-safe, auditable, and unable to overwrite the only known-good branch. The worker's primary checkout may also contain unrelated human work, so it cannot be staged or cleaned by automation.

## Decision

Treat automatic Git publication as an explicit worker capability:

- only `repo.update` tasks receive a writable Codex sandbox;
- each run operates in a deterministic, worker-owned Git worktree and local branch; a retry gets a clean worktree while the previous run's uncommitted evidence remains isolated;
- Codex cannot use the network and never receives Git publishing credentials or responsibility;
- shared dependencies are absent while Codex edits the repository and are linked read-only only for validation;
- the worker independently checks the diff, blocks sensitive files and likely secrets, and runs the repository test suite and every project typecheck inside a macOS Seatbelt profile with no network, an empty HOME, a scrubbed environment, restricted host reads, and writes limited to the task worktree and its disposable validation directory;
- Git hooks and task-created dependency paths are disabled or rejected before the worker creates the commit;
- commits contain trusted task/run identifiers rather than prompt text;
- the worker pushes normally, never forcibly, to the configured `automation/*` branch and never to `main` or `master`;
- the task succeeds only after the remote ref is read back and its commit SHA is verified;
- publication stages and normalized failures are persisted in PostgreSQL with append-only audit events;
- retries reconcile the ledger, local commit and remote ref before running Codex or creating another commit.

The default target is `automation/phase0-updates`. Merge or pull-request policy remains a separate governed action.

## Consequences

The main checkout, index and known-good branch remain untouched by loop updates. A network interruption after a successful push can be reconciled without duplicating the commit. A retry before commit cannot inherit mutable files from a failed run. Test, sandbox, secret-policy and non-fast-forward failures leave the remote unchanged and are visible as explicit task/publication failures.

Automatic publication requires the worker configuration switch, macOS Seatbelt (`/usr/bin/sandbox-exec`), and usable Git authentication on the host. The worker must run as a normal host service rather than inside another Seatbelt sandbox because macOS rejects nested sandbox application. It does not grant permission to merge, force-push, delete branches, publish secrets, or bypass tests.
