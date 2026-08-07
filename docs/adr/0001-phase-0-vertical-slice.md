# ADR 0001: Phase 0 vertical-slice architecture

- Status: accepted
- Date: 2026-08-07

## Context

Phase 0 must prove cloud control-plane and Mac execution-plane communication without introducing full knowledge ingestion or distributed infrastructure.

## Decision

Use a pnpm TypeScript monorepo with:

- Next.js App Router on Vercel for the dashboard and worker-facing HTTP endpoints;
- PostgreSQL as the operational source of truth and queue;
- bounded task leases with authenticated renewal during active work and expiry-based crash recovery;
- HMAC-SHA256 worker request signatures with timestamps and single-use nonces;
- an HTTP-only opaque dashboard session cookie whose token is hashed in PostgreSQL, plus database-backed login throttling;
- the official Notion SDK in read-only sample mode;
- the official Codex TypeScript SDK behind an `AgentRuntime` abstraction;
- transactional audit events for state transitions;
- a launchd-managed worker on the Mac mini.

The initial proposal is intentionally fake and targets a `phase0://` resource. Approve/reject records a hash-bound decision but causes no external mutation.

## Consequences

The slice has one deployable web app and one persistent worker. PostgreSQL remains required even locally; in-memory fallbacks are intentionally excluded because they would invalidate recovery evidence. External gates can be independently blocked by missing credentials without blocking unit and embedded-PostgreSQL validation.
