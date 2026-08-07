# MEAWORLD AUTONOMOUS COMPANY OS

## Project Seed, Architecture, Governance & Execution Roadmap

**Status:** Seed specification\
**Version:** 0.1 --- 2026-08-07\
**Primary runtime:** Mac mini + Codex\
**Control plane:** Web app on Vercel\
**Knowledge source:** Notion\
**Code source:** GitHub

> **Operating principle:** Humans define direction and exercise critical
> judgment. AI performs everything else that can be safely delegated.

------------------------------------------------------------------------

# 0. How to use this file

Place this document as `PROJECT_SEED.md` in an otherwise empty Git
repository. The first Codex session must read it completely, create
`AGENTS.md`, initialize the repository, write an implementation plan,
and execute **Phase 0 only** unless a human explicitly authorizes more.

The first run must be deliberately fast. It is not the full
knowledge-ingestion run. Its job is to prove the foundation:

1.  repository works locally and on GitHub;
2.  Notion connection works;
3.  the system can enumerate what the integration can read;
4.  a minimal dashboard works locally and on Vercel;
5.  Mac mini and dashboard exchange authenticated state;
6.  Codex can execute one durable test task;
7.  the dashboard can display that task;
8.  a human can approve/reject one controlled proposal;
9.  the worker can recover from an intentional restart.

Only after this vertical slice passes should exhaustive ingestion begin.

This file is constitutional guidance, not frozen implementation detail.
Codex may improve schemas, libraries, algorithms and architecture when
evidence supports it, but must never silently weaken approval
boundaries, provenance, auditability, recoverability, or human control.

------------------------------------------------------------------------

# 1. Mission

Build an always-on, self-improving **Company Operating System for
MeaWorld**.

The system continuously observes accessible company knowledge,
understands the organization, identifies useful work, plans it,
delegates it to specialized agents, verifies results, asks humans only
when judgment or authority is genuinely required, learns from those
interventions, and resumes autonomously.

``` text
OBSERVE → UNDERSTAND → UPDATE WORLD MODEL
   → IDENTIFY GAPS / OPPORTUNITIES / OBLIGATIONS
   → PRIORITIZE → PLAN → SPAWN SPECIALISTS → EXECUTE
   → VERIFY / CRITIQUE / TEST
   → SAFE + AUTHORIZED?
       YES → COMMIT / CREATE / PUBLISH INTERNALLY
       NO  → HUMAN DECISION REQUEST
   → LEARN PRECEDENT → RESUME → OBSERVE
```

The loop should continue indefinitely until an authorized human pauses
or stops it.

"Always on" does not mean "always changing things." Waiting,
researching, verifying, deduplicating, or escalating can be the correct
autonomous action.

------------------------------------------------------------------------

# 2. Philosophy

## 2.1 Human responsibility

Humans retain: - strategic direction and goals; - critical thinking and
value judgments; - resolution of material ambiguity; - approval of
mutations to pre-existing authoritative knowledge; - granting
credentials/access; - override, pause and stop authority; - creative
intervention where the AI lacks adequate capability.

Humans must not become glue code.

## 2.2 AI responsibility

Whenever tools, evidence and permissions allow, AI should perform: -
extraction and normalization; - classification and entity resolution; -
graph construction; - research and synthesis; - planning and
execution; - coding, testing, documentation and QA; - contradiction and
gap detection; - process/SOP extraction; - backlog and opportunity
generation; - monitoring and maintenance; - creation of new internal
knowledge; - spawning and coordination of specialized agents; - recovery
after interruption; - improvement of its own operating environment.

## 2.3 Autonomy invariant

> If useful work advances an explicit MeaWorld objective without
> violating a permission, governance, safety, budget or approval
> boundary, the system should continue rather than wait for a human to
> assign the next micro-task.

## 2.4 Escalation invariant

> **Escalate decisions, not chores.**

A human request must contain: issue, evidence, why the system cannot
resolve it safely, options, tradeoffs, recommendation, confidence,
impact, urgency, and the exact decision requested.

------------------------------------------------------------------------

# 3. Governance invariants

These must become automated policy tests.

## 3.1 Notion reads

The system may read **everything the configured Notion integration is
authorized and technically able to read**.

"100% of Notion" means 100% of API-exposed content shared with the
integration. The system must never claim total coverage without
measuring it.

Inventory all exposed object types, including pages, blocks and nested
blocks, databases/data sources, properties, relations, users,
comments/files where available, hierarchy, timestamps, authors/editors
where exposed, archived state, meeting notes and client information
represented in Notion.

Anything unsupported, inaccessible, malformed or skipped becomes a
visible **coverage gap**.

## 3.2 Existing Notion content

AI must not modify, overwrite, move, archive or delete pre-existing
authoritative Notion content without explicit human approval.

``` text
PROPOSED_CHANGE
→ REVIEW_REQUIRED
→ APPROVED / REJECTED / EDITED
→ EXECUTE
→ VERIFY
→ AUDIT
```

Approval binds to an immutable proposal hash. Material proposal changes
invalidate approval.

## 3.3 New AI-created Notion content

AI may create new pages/areas/artifacts without pre-approval if: -
creation is within granted permissions; - content is visibly marked
AI-generated and unvalidated; - it does not impersonate human
approval; - it does not silently replace authoritative content; -
provenance and run IDs are recorded.

Recommended metadata:

``` yaml
origin: ai
validation_status: unvalidated
created_by_agent: <agent_id>
source_run: <run_id>
confidence: <0..1>
provenance_refs: [...]
```

After human validation, status may become `human_validated`.

## 3.4 External side effects

Until a capability is explicitly connected and governed, the system must
not pretend it can send email, call, publish, purchase, or mutate
external systems. It creates an **Access/Capability Request** instead.

## 3.5 Git/code

Prefer isolated branch/worktree → implementation → tests → review →
commit → PR/merge policy. Never allow autonomous agents to destroy the
only known-good branch.

------------------------------------------------------------------------

# 4. Success criteria

Steady-state success means: 1. knowledge continuously synchronizes; 2.
the system knows what it knows and what it cannot access; 3. knowledge
becomes a structured, provenance-preserving world model; 4. procedures
become executable/semi-executable workflows; 5. goals generate
autonomous operational work; 6. specialized agents can be spawned; 7.
work is observable remotely; 8. every action is auditable; 9.
authoritative knowledge is protected by approval gates; 10. AI-created
knowledge is identifiable; 11. humans receive high-signal decision
requests; 12. decisions become reusable precedent; 13. crashes recover
automatically; 14. the system evaluates and improves itself; 15.
authorized humans can pause/stop it immediately.

------------------------------------------------------------------------

# 5. Architecture

## 5.1 Control plane --- Vercel

The web app is the remote command center: - access/authentication; -
goals; - runs/tasks/agents; - human decision inbox; - proposals and
approvals; - knowledge coverage; - health/heartbeats; - logs/events; -
permissions/capability gaps; - pause/resume/drain/stop controls.

Vercel is not the sole durable orchestration state.

## 5.2 Execution plane --- Mac mini

Persistent local services: - supervisor; - orchestrator; - Codex
workers; - Notion ingestion; - indexing/graph jobs; - research and
specialist workers; - Git operations; - heartbeat; -
checkpoint/recovery; - local secret access.

The system must survive worker crash, orchestrator crash, temporary
network loss and Mac reboot.

## 5.3 Durable state over chat state

Chat transcripts are evidence, not the source of truth. Persist goals,
initiatives, tasks, runs, steps, agents, events, artifacts, proposals,
approvals, sources, knowledge objects, claims, decisions, checkpoints,
errors, retries, permissions and capabilities.

## 5.4 Events + reconciliation

Use webhooks/events for low latency, incremental cursors/checkpoints for
sync, scheduled reconciliation for correctness, and periodic full audits
for missed changes.

## 5.5 Idempotency

Every side effect needs an idempotency strategy. Retrying must not
duplicate pages, tasks, events or writes.

## 5.6 Provenance

Every derived claim must answer: - source? - source version? - explicit
or inferred? - model/run? - confidence? - human validated? - source
changed since inference?

------------------------------------------------------------------------

# 6. Recommended baseline stack

Prefer a TypeScript monorepo initially.

``` text
/
├── AGENTS.md
├── PROJECT_SEED.md
├── README.md
├── .env.example
├── apps/
│   ├── web/                 # Next.js/Vercel control plane
│   └── worker/              # Mac mini daemon
├── packages/
│   ├── db/
│   ├── domain/
│   ├── notion/
│   ├── codex/
│   ├── orchestration/
│   ├── knowledge/
│   ├── graph/
│   ├── retrieval/
│   ├── approvals/
│   ├── observability/
│   └── security/
├── skills/
├── docs/
│   ├── adr/
│   ├── architecture/
│   ├── policies/
│   └── runbooks/
├── scripts/
└── tests/
```

Recommended initial components: - Next.js + TypeScript for dashboard; -
PostgreSQL for operational truth; - PostgreSQL-backed queue initially; -
logical knowledge graph in PostgreSQL first; - vector extension only
when retrieval is introduced; - GitHub for code/PR history; - Vercel for
web deployment; - Mac mini service managed by `launchd` or equivalent
supervisor.

Avoid premature Kafka, Kubernetes, Neo4j, microservices or distributed
complexity.

## 6.1 Codex runtime

Create an abstraction rather than coupling orchestration to UI
automation:

``` ts
interface AgentRuntime {
  start(input: AgentTaskInput): Promise<AgentRun>;
  resume(runId: string, continuation?: AgentContinuation): Promise<AgentRun>;
  cancel(runId: string): Promise<void>;
  inspect(runId: string): Promise<AgentRunState>;
}
```

Current Codex supports local CLI use and a TypeScript SDK. Prefer the
SDK for structured programmatic orchestration where it meets
requirements, with a CLI adapter available for diagnostics/fallback.
Verify current behavior against official documentation during
implementation.

Official starting references: - https://openai.com/codex/ -
https://openai.com/codex/get-started/ - https://developers.openai.com/ -
https://openai.com/index/codex-now-generally-available/

------------------------------------------------------------------------

# 7. Security

## 7.1 Least privilege

Model permissions explicitly:

``` text
principal → capability → resource scope → read/write/delete/execute
```

Every denied capability is observable, not hidden.

## 7.2 Secrets

Never commit secrets. `.env.example` contains names only. Use Vercel
secrets for cloud values and secure local secret storage/environment on
the Mac mini. Redact logs. Add rotation procedures.

## 7.3 Dashboard auth

Phase 0: single access code, stored server-side as a secret, secure
session cookie, TLS, rate limiting, logout, protected mutation
endpoints.

Later: simple email/password authentication. Avoid SSO until justified.

## 7.4 Worker auth

The Mac mini gets a unique worker ID and secret/key. Use authenticated
signed communication with replay protection. Make workers revocable.
Never expose an unauthenticated local endpoint publicly.

# 8. Domain model

Persist at minimum: `Goal`, `Initiative`, `Task`, `Run`, `Agent`,
`Event`, `Artifact`, `Proposal`, `Approval`, `HumanDecision`,
`CapabilityRequest`, `KnowledgeSource`, `KnowledgeSnapshot`,
`KnowledgeNode`, `KnowledgeEdge`, `Claim`, `Evidence`, `Checkpoint`,
`Permission`.

A task is a durable schedulable unit with objective, priority, risk,
required capabilities, source goals, parent, dedupe key, status,
assigned agent, attempts and timestamps. A run is one execution attempt
with runtime, context references, checkpoints, outputs, telemetry and
result.

A proposal represents a governed mutation and stores target, operation,
before/after snapshots, diff, reason, evidence, risk, immutable proposal
hash and status.

A human decision stores question, context, options, recommendation,
confidence, impact, urgency, response and a reusable precedent key.

A capability request stores the missing tool/access, why it is needed,
blocked tasks, expected value, minimum required permission and setup
instructions.

------------------------------------------------------------------------

# 9. Exhaustive Notion ingestion

## 9.1 Inventory first

Before semantic processing, create a raw inventory. For every accessible
object record stable Notion ID, type, parent, URL if exposed,
timestamps, archive state, metadata, last fetch, content hash, API
version, ingestion state and errors.

Produce a visible coverage report with
discovered/fetched/fully-traversed/partial/inaccessible objects,
attachments, API limitations, retries and coverage confidence.

## 9.2 Layered knowledge

``` text
L0 source pointers
L1 immutable raw snapshots
L2 normalized documents
L3 structural units/chunks
L4 entities
L5 claims + evidence
L6 semantic relationships/graph
L7 procedures/workflows
L8 decisions/precedents
L9 retrieval indexes
```

Never make semantic extraction the only copy of source data.

## 9.3 Preserve structure

Preserve headings, block hierarchy, lists, tables, callouts, database
rows/properties, links, mentions, dates, people, page hierarchy and
semantic sections. Do not flatten the company into anonymous chunks.

## 9.4 Semantic extraction

Extract with provenance: people/roles, customers, prospects, companies,
projects, products, services, tools, processes, SOPs, goals, metrics,
decisions, policies, constraints, dependencies, risks, assumptions,
commitments, deadlines, unresolved questions, lessons, research,
definitions and training knowledge.

## 9.5 Graph

Useful edge types:

``` text
PART_OF, OWNS, RESPONSIBLE_FOR, DEPENDS_ON, BLOCKS, RELATES_TO,
DECIDED_BY, SUPERSEDES, CONTRADICTS, SUPPORTS, MENTIONS, APPLIES_TO,
REQUIRES, PRODUCES, CONSUMES, GOVERNS, DERIVED_FROM, VALIDATED_BY
```

Every inferred edge needs evidence and confidence.

Maintain a separate document graph for hierarchy, links, database
membership, versions, duplicate clusters and supersession.

## 9.6 Process compiler

Transform procedural knowledge into candidates containing trigger,
preconditions, inputs, steps, roles, tools, decision points, approval
points, exceptions, outputs, success conditions, failure modes, source
references, confidence and validation status.

Unclear procedure = question/research task, never invented certainty.

## 9.7 Incremental updates

For each object: compare timestamp/hash → skip unchanged → fetch changed
structure → recompute affected normalized units → invalidate/recompute
dependent claims/edges/indexes → detect new contradictions → enqueue
downstream tasks.

------------------------------------------------------------------------

# 10. Retrieval/context engineering

RAG is not vector search alone. Use permission filtering,
exact/structured lookup, lexical search, vector similarity, graph
expansion, recency, source authority, validation state, contradiction
awareness and reranking.

An agent context packet should include objective, constraints, relevant
policies, evidence, known unknowns, precedents, allowed/forbidden
capabilities, output schema and verification requirements.

The agent must distinguish **inaccessible** from **nonexistent**.

------------------------------------------------------------------------

# 11. Human-in-the-loop

Escalate when a governed mutation needs approval, access is missing,
evidence conflicts materially, an irreversible/high-impact action
exceeds policy, a strategic tradeoff has no delegated preference,
repeated attempts fail, or confidence is too low relative to error cost.

Do not escalate merely because a task is hard.

Every dashboard decision card must show: decision needed, why now,
concise context, evidence, options/tradeoffs, recommendation,
confidence, impact/reversibility, urgency and actions.

Human answers become structured precedents. Retrieve precedents before
escalating similar cases, but never generalize a decision beyond
reasonable scope.

------------------------------------------------------------------------

# 12. Orchestrator and recovery

The orchestrator is a durable scheduler/state machine, not an immortal
chat.

Responsibilities: observe, reconcile, derive work, prioritize,
deduplicate, lease, spawn agents, checkpoint, retry, escalate, enforce
policy, detect stalls, cancel obsolete work and update the dashboard.

Recommended states:

``` text
DISCOVERED → READY → LEASED → RUNNING
→ WAITING_TOOL | WAITING_HUMAN | VERIFYING
→ SUCCEEDED | FAILED_RETRYABLE | FAILED_TERMINAL | CANCELLED | SUPERSEDED
```

Workers lease tasks for bounded time and heartbeat. Expired leases make
work recoverable.

Classify failures: transient network, rate limit, unavailable tool, bad
credentials, deterministic data/code error, reasoning failure, policy
block, human required. Back off transient failures; never retry
deterministic failures forever.

A watchdog detects missing heartbeats, overlong runs, repeated identical
failures, deadlocks, queue starvation, stuck sync cursors, offline
workers and event backlog.

------------------------------------------------------------------------

# 13. Specialized agents

Spawn roles because work requires them, not to simulate an org chart.
Initial roles may include Knowledge Ingestor, Knowledge Architect,
Entity Resolver, Contradiction Analyst, Process Extractor, Retrieval
Engineer, Market Researcher, Software Engineer, QA/Test Engineer,
Security Reviewer, Planner, Critic/Verifier and Recovery Agent.

Each receives least privilege, bounded objective, explicit output
schema, evidence requirements and completion criteria. High-value work
should use maker → critic → verifier.

------------------------------------------------------------------------

# 14. Dashboard

**Overview:** RUNNING/PAUSED/DRAINING/STOPPED/DEGRADED, Mac heartbeat,
queue depth, active agents, blocked work, decisions waiting, Notion
coverage, failures, top goals.

**Human Inbox:** decisions, change approvals, capability requests,
contradictions, high-risk actions.

**Agents:** active/history, role, task, elapsed time, heartbeat, tool
summary, checkpoints, output, cancel.

**Work:** goals → initiatives → tasks → runs.

**Knowledge:** coverage, sources, graph later, claims/evidence,
contradictions, unvalidated AI content, stale content.

**Changes:** all proposed/executed mutations with before/after diff,
reason, evidence, approval, executor and verification.

**System:** workers, connectors, capabilities, sync cursors, rate
limits, queues and versions.

**Controls:** pause new work, drain, resume, emergency stop, disable
writes, set budgets/concurrency.

------------------------------------------------------------------------

# 15. Observability

Every structured event should contain event ID, timestamp, type, actor,
goal/task/run references, resources, payload and correlation ID.

Do not store hidden chain-of-thought. Store enough auditable material:
task inputs, evidence references, outputs, tool actions, policy
decisions, concise reasoning summaries and verification results.

Track task throughput, success/retry/failure, recovery time,
escalations, approval rate, duplicate suppression, knowledge coverage,
stale sources, contradictions, retrieval evals, token/cost telemetry
where available, blocked-by-capability time and progress toward goals.

------------------------------------------------------------------------

# 16. Self-improvement

The system may improve prompts, skills, retrieval, tests, routing,
context assembly, schemas, docs, runbooks and code. Self-modification
follows Git discipline and tests. Governance/policy code receives
stricter review.

Generate improvement work from repeated failures, repeated human
escalations, slow workflows, poor retrieval, duplication,
contradictions, missing tools, token waste, low-confidence output and
human corrections.

Large token availability is not permission for waste. Enforce
concurrency, max attempts/depth, dedupe, loop detection, budgets and
cancellation.

------------------------------------------------------------------------

# 17. Mac mini lifecycle

Run the worker under `launchd` or an equivalent supervisor.

Boot: load env → validate secrets → DB health → register worker →
recover expired leases/incomplete runs → start heartbeat → start
consumers → resume loop.

Shutdown: stop leasing → checkpoint → release/reassign safe work → flush
events → mark draining/offline.

Never depend on a terminal window remaining open.

# 18. Roadmap

## PHASE 0 --- Foundation vertical slice

**Target: fast; hours, not days.**

Deliver: - local Git repository initialized; - GitHub remote connected
and push tested; - monorepo scaffold; - `.env.example`; - PostgreSQL +
migrations; - read-only Notion connector; - Notion connectivity test and
small sample inventory; - dashboard with access-code authentication; -
dashboard deployed to Vercel; - Mac mini worker registration +
heartbeat; - durable task/run/event tables; - one Codex runtime test
task; - one safe/fake approval flow; - structured logs; -
supervisor/`launchd` setup; - restart/recovery smoke test; - README +
AGENTS.md.

**Do not ingest the full knowledge base in Phase 0.**

Exit gate:

``` text
[ ] GitHub push works
[ ] Notion read test works
[ ] Vercel dashboard reachable remotely
[ ] Dashboard authentication works
[ ] Mac mini heartbeat visible
[ ] Test Codex task executes
[ ] Incomplete work reconciles after worker restart
[ ] Approval card supports approve/reject
[ ] Audit event exists for each transition
```

## PHASE 1 --- Exhaustive Notion mirror

Recursive enumeration, snapshots, hashes/versioning, coverage report,
retry/rate-limit handling, attachment inventory, reconciliation and
incremental sync. Exit only with measured coverage and zero silent
skips.

## PHASE 2 --- Normalized knowledge

Document normalization, hierarchy, semantic units, metadata, entities,
claims/evidence, deduplication and contradiction candidates.

## PHASE 3 --- Retrieval

Lexical + embeddings + graph-assisted retrieval, provenance-aware
context packets, evaluation dataset and retrieval tests.

## PHASE 4 --- Knowledge/document graph

Semantic edges, document topology, entity resolution, authority, graph
explorer and incremental invalidation.

## PHASE 5 --- Process compiler

Detect procedures/training and extract machine-readable workflows with
tools, roles, inputs, outputs, exceptions and approval points.

## PHASE 6 --- Real human-in-the-loop

Governed Notion proposals, before/after diffs, immutable hashes,
approvals, AI-content labels, decision precedent memory and capability
requests.

## PHASE 7 --- Goal-driven orchestration

Durable goals, gap/opportunity discovery, autonomous task generation,
specialist spawning, prioritization, maker/critic/verifier, budgets and
dedupe.

## PHASE 8 --- Continuous operation

Webhooks + reconciliation, autonomous maintenance, watchdogs, recovery,
stale-knowledge detection, recurring internal reviews and
self-improvement backlog.

## PHASE 9 --- Expansion

Later add tools such as media/voice/creative systems. Every tool gets a
capability adapter and explicit policy boundary.

------------------------------------------------------------------------

# 19. Human-only setup checklist

The human should perform only unavoidable authorization:

``` text
[ ] Create/choose empty GitHub repository
[ ] Authenticate GitHub CLI / grant repo access
[ ] Create Notion integration
[ ] Share required Notion workspace/pages/data sources with it
[ ] Provide Notion token securely
[ ] Create/choose Vercel project/account
[ ] Authenticate Vercel if required
[ ] Provision PostgreSQL
[ ] Provide DB secret
[ ] Set initial dashboard access code
[ ] Install/authenticate Codex runtime on Mac mini
```

After each prerequisite exists, Codex tests it itself.

------------------------------------------------------------------------

# 20. Definition of Done

A task is not done because an agent produced text. Where applicable: -
output exists; - schema validates; - tests/typecheck pass; -
evidence/provenance attached; - policy checks pass; - side effects
verified; - events persisted; - docs updated if behavior changed; - no
unresolved critical error; - downstream state updated; - completion
recorded transactionally.

------------------------------------------------------------------------

# 21. Evaluation strategy

Create golden tests for: - Notion recursive traversal; -
normalization; - entity extraction/resolution; - claim/evidence
linking; - contradiction detection; - retrieval; - process extraction; -
proposal policy; - approval hash integrity; - retry/idempotency; - crash
recovery; - permission denial; - AI-content labeling.

Maintain a small human-reviewed benchmark set from real MeaWorld
knowledge. Improvements should be measured against it.

------------------------------------------------------------------------

# 22. Initial database sketch

Likely tables:

``` text
users / sessions
workers
goals
initiatives
tasks
task_dependencies
runs
run_checkpoints
agents
events
artifacts
proposals
approvals
human_decisions
decision_precedents
capabilities
capability_requests
connector_accounts
sync_cursors
source_objects
source_versions
documents
document_units
entities
entity_aliases
claims
evidence
knowledge_nodes
knowledge_edges
retrieval_embeddings
contradictions
processes
process_versions
```

Use migrations and foreign keys. Preserve immutable history where audit
matters.

------------------------------------------------------------------------

# 23. Suggested API surface

``` text
GET  /api/health
GET  /api/system
POST /api/system/pause
POST /api/system/resume
POST /api/system/stop
GET  /api/workers
POST /api/workers/heartbeat
GET  /api/goals
POST /api/goals
GET  /api/tasks
GET  /api/tasks/:id
POST /api/tasks/:id/cancel
GET  /api/decisions
POST /api/decisions/:id/respond
GET  /api/proposals
POST /api/proposals/:id/approve
POST /api/proposals/:id/reject
GET  /api/knowledge/coverage
GET  /api/connectors
GET  /api/capabilities
```

All mutations require server-side authorization.

------------------------------------------------------------------------

# 24. First Codex execution prompt

``` text
Read PROJECT_SEED.md completely.

You are bootstrapping the MeaWorld Autonomous Company OS.

Execute PHASE 0 only.

First:
1. inspect the environment and available tools;
2. create AGENTS.md from the constitutional rules in PROJECT_SEED.md;
3. create a concise Phase 0 implementation plan with acceptance tests;
4. initialize the repository structure;
5. identify the minimum human-only setup actions that cannot be performed autonomously.

Do not start full Notion ingestion.
Do not weaken governance rules to make the demo easier.
Prefer the smallest production-shaped vertical slice.
Persist state so worker restarts are recoverable.
Use tests and type checking.
Never commit secrets.
If a credential/authorization is missing, create a precise setup request rather than blocking unrelated work.
Continue autonomously until every Phase 0 exit criterion is either PASS or explicitly BLOCKED with evidence.
```

------------------------------------------------------------------------

# 25. AGENTS.md requirements

Codex should generate `AGENTS.md` containing at least:

1.  read `PROJECT_SEED.md` before architectural changes;
2.  preserve governance invariants;
3.  no secrets in Git;
4.  migrations for schema changes;
5.  tests/typecheck before completion;
6.  small reversible commits;
7.  durable state, not chat-only state;
8.  provenance for knowledge;
9.  no modification/deletion of existing Notion content without
    approval;
10. AI-created Notion content must be labeled;
11. never claim access/capability not actually present;
12. create capability requests when blocked;
13. prefer autonomous resolution before human escalation;
14. human decisions must be high-signal;
15. checkpoint long-running work;
16. use idempotency and dedupe;
17. stop runaway loops;
18. document significant architecture choices as ADRs.

------------------------------------------------------------------------

# 26. Failure scenarios that must be designed explicitly

-   Notion rate limiting;
-   Notion permission changes;
-   source page deleted/archived;
-   attachment URL expires;
-   malformed/unexpected block;
-   database unavailable;
-   Vercel unavailable;
-   Mac mini offline;
-   worker killed mid-task;
-   Codex run interrupted;
-   Git conflict;
-   duplicate event;
-   webhook missed;
-   approval arrives after proposal changed;
-   two agents propose conflicting changes;
-   model hallucinates nonexistent source;
-   retrieval returns stale source;
-   credentials revoked;
-   task recursively spawns itself;
-   enormous research task consumes budget;
-   human never answers a decision;
-   system upgrade occurs during active work.

Each scenario should have detection, state transition, retry/escalation
behavior and test coverage where practical.

------------------------------------------------------------------------

# 27. Knowledge authority

Not all knowledge has equal authority. Track: - source type; - human
validation; - recency; - owner; - explicit supersession; - confidence; -
contradictions.

When sources conflict, do not silently choose the most semantically
similar document. Use authority + recency + evidence + precedent, and
escalate when material uncertainty remains.

------------------------------------------------------------------------

# 28. AI-generated content lifecycle

``` text
AI_DRAFT
→ AI_UNVALIDATED
→ HUMAN_VALIDATED
→ AUTHORITATIVE (only if policy allows)
→ SUPERSEDED / ARCHIVED
```

Dashboard and Notion must make `AI_UNVALIDATED` obvious.

If AI later detects its own content is wrong, it may create a correction
proposal or a new AI page, but must not silently rewrite a
human-validated/authoritative artifact.

------------------------------------------------------------------------

# 29. Continuous company-improvement loop

The orchestrator periodically asks:

1.  What are MeaWorld's explicit active goals?
2.  What evidence shows progress?
3.  What is blocking progress?
4.  What knowledge is stale, contradictory or missing?
5.  Which processes are manual but automatable?
6.  Which repeated human decisions can become policy?
7.  Which missing capabilities have highest expected leverage?
8.  What work can safely be done now?
9.  What work should not be done?
10. What should be measured next?

This produces ranked initiatives/tasks, not uncontrolled activity.

Priority should consider:

``` text
expected business value
× confidence
× urgency
× strategic alignment
÷ cost
÷ risk
÷ dependency uncertainty
```

This formula is conceptual; calibrate it empirically.

------------------------------------------------------------------------

# 30. Future connectors

Future systems such as voice, media, design, browser/research, CRM,
email or other operational tools must enter through a generic capability
layer:

``` ts
interface Capability {
  name: string;
  scopes: Scope[];
  risk: RiskClass;
  execute(request: CapabilityRequest): Promise<CapabilityResult>;
  verify(result: CapabilityResult): Promise<VerificationResult>;
}
```

This keeps the core Company OS independent from any single vendor.

------------------------------------------------------------------------

# 31. Explicit anti-patterns

Do not: - dump all Notion text into one prompt; - assume embeddings
equal understanding; - create dozens of permanent agents before work
exists; - use one chat as workflow state; - hide failures; - retry
forever; - allow writes because "the model is confident"; - lose
provenance during summarization; - mark inaccessible knowledge as
absent; - let AI-created pages look human-approved; - build a beautiful
dashboard before the vertical slice works; - add infrastructure without
measured need; - couple everything to undocumented UI automation; - ask
humans questions the system can answer itself; - optimize token
consumption as a goal; - perform endless research without a decision
criterion.

------------------------------------------------------------------------

# 32. Final constitutional statement

MeaWorld Autonomous Company OS is not a chatbot and not merely a RAG
interface.

It is a persistent operational system that converts company knowledge
and objectives into verified work.

Its design objective is **maximum useful autonomy under explicit human
governance**.

The AI should be ambitious in analysis, research, implementation and
continuous improvement. It should be conservative about authority,
irreversible side effects and claims of certainty.

The ideal human experience is not managing agents all day. It is: -
define direction; - inspect high-level progress; - answer the few
questions that genuinely require judgment; - grant capabilities when
worthwhile; - intervene creatively when necessary; - retain ultimate
control.

Everything else should increasingly become executable by the system.

------------------------------------------------------------------------

# 33. Immediate next action

1.  Create an empty GitHub repository.
2.  Put this file at the repository root as `PROJECT_SEED.md`.
3.  Open the repository with Codex on the Mac mini.
4.  Give Codex the prompt in **Section 24**.
5.  Complete only the human setup actions Codex proves are required.
6.  Require Phase 0 acceptance tests to pass before authorizing Phase 1.
7.  Once Phase 0 is green, start the exhaustive Notion inventory.
8.  From that point onward, drive the project through the web dashboard
    as the primary human control surface.

**End of seed specification.**
