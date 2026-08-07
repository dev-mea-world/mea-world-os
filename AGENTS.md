# MeaWorld Company OS agent rules

These rules apply to the entire repository.

1. Read `PROJECT_SEED.md` before making architectural or governance changes.
2. Preserve the governance invariants in the seed. Never weaken approval, provenance, audit, recovery, or human-control boundaries to make a demo pass.
3. Never commit secrets or log their values. Keep `.env.example` to variable names and explanatory comments only.
4. Every persistent schema change requires a forward migration. Do not edit an applied migration.
5. Run the relevant tests and the repository typecheck before claiming completion.
6. Prefer small, reversible changes and commits. Never destroy the only known-good branch.
7. Durable operational state belongs in PostgreSQL, not in chat memory or an in-process singleton.
8. Knowledge records and derived claims must retain source identity, version, run, confidence, and validation state where applicable.
9. Existing Notion content is read-only unless an immutable proposal has explicit human approval.
10. AI-created Notion content must be visibly labeled AI-generated and unvalidated, with provenance and run identifiers.
11. Never claim access, coverage, deployment, or capability that has not been measured and verified.
12. When a credential or tool is missing, record a precise capability/setup request and continue unrelated safe work.
13. Resolve discoverable questions autonomously before escalating. Escalate decisions, not chores.
14. Human decision requests must include evidence, options, tradeoffs, a recommendation, confidence, impact, urgency, and the exact decision required.
15. Checkpoint long-running work. Tasks must be restart-safe through leases, idempotency keys, and durable transitions.
16. Give every side effect an idempotency/deduplication strategy and audit event.
17. Bound attempts, concurrency, recursion, and runtime. Detect and stop runaway loops.
18. Record significant architectural decisions in `docs/adr/`.
19. Phase 0 must not perform exhaustive Notion ingestion or mutate existing Notion content.
20. Every protected mutation must authenticate server-side; worker calls must be signed and replay-protected.
