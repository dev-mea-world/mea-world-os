import { randomUUID } from "node:crypto";
import { computeProposalHash, type ProposalHashInput } from "@meaworld/approvals";
import type {
  DashboardSnapshot,
  EventRecord,
  GitPublicationCommand,
  GitPublicationRecord,
  HeartbeatPayload,
  LeasedWork,
  ProposalDecision,
  ProposalRecord,
  RunComplete,
  RunRecord,
  TaskRecord,
  WorkerRecord
} from "@meaworld/domain";
import { createOpaqueToken, hashOpaqueToken } from "@meaworld/security";
import type { Database } from "./database.js";

type Row = Record<string, unknown>;

function asString(value: unknown): string {
  if (typeof value === "string") return value;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function asNullableString(value: unknown): string | null {
  return value === null || value === undefined ? null : asString(value);
}

function asNumber(value: unknown): number {
  return typeof value === "number" ? value : Number(value);
}

function asBoolean(value: unknown): boolean {
  return value === true || value === "true";
}

function asObject(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  }
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asObjectArray(value: unknown): Array<Record<string, unknown>> {
  if (typeof value === "string") {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(asObject) : [];
  }
  return Array.isArray(value) ? value.map(asObject) : [];
}

function taskFromRow(row: Row): TaskRecord {
  return {
    id: asString(row.id),
    kind: asString(row.kind),
    objective: asString(row.objective),
    status: asString(row.status) as TaskRecord["status"],
    priority: asNumber(row.priority),
    risk: asString(row.risk) as TaskRecord["risk"],
    payload: asObject(row.payload),
    dedupeKey: asString(row.dedupe_key),
    assignedWorkerId: asNullableString(row.assigned_worker_id),
    leaseToken: asNullableString(row.lease_token),
    leaseExpiresAt: asNullableString(row.lease_expires_at),
    attemptCount: asNumber(row.attempt_count),
    maxAttempts: asNumber(row.max_attempts),
    version: asNumber(row.aggregate_version),
    createdAt: asString(row.created_at),
    updatedAt: asString(row.updated_at)
  };
}

function runFromRow(row: Row): RunRecord {
  return {
    id: asString(row.id),
    taskId: asString(row.task_id),
    workerId: asString(row.worker_id),
    attempt: asNumber(row.attempt),
    runtime: asString(row.runtime),
    status: asString(row.status) as RunRecord["status"],
    leaseToken: asString(row.lease_token),
    runtimeThreadId: asNullableString(row.runtime_thread_id),
    output: row.output === null || row.output === undefined ? null : asObject(row.output),
    errorSummary: asNullableString(row.error_summary),
    version: asNumber(row.aggregate_version),
    startedAt: asNullableString(row.started_at),
    completedAt: asNullableString(row.completed_at),
    createdAt: asString(row.created_at)
  };
}

function gitPublicationFromRow(row: Row): GitPublicationRecord {
  return {
    id: asString(row.id),
    taskId: asString(row.task_id),
    currentRunId: asString(row.current_run_id),
    currentWorkerId: asString(row.current_worker_id),
    remote: asString(row.remote),
    targetBranch: asString(row.target_branch),
    baseSha: asString(row.base_sha),
    treeSha: asNullableString(row.tree_sha),
    commitSha: asNullableString(row.commit_sha),
    remoteSha: asNullableString(row.remote_sha),
    stage: asString(row.stage) as GitPublicationRecord["stage"],
    lastErrorCode: asNullableString(row.last_error_code),
    retryable: row.retryable === null || row.retryable === undefined
      ? null
      : asBoolean(row.retryable),
    version: asNumber(row.aggregate_version),
    createdAt: asString(row.created_at),
    updatedAt: asString(row.updated_at)
  };
}

function workerFromRow(row: Row): WorkerRecord {
  return {
    id: asString(row.id),
    displayName: asString(row.display_name),
    status: asString(row.effective_status ?? row.status) as WorkerRecord["status"],
    bootId: asString(row.boot_id),
    lastSequence: asNumber(row.last_sequence),
    version: asString(row.software_version),
    activeRunId: asNullableString(row.active_run_id),
    lastHeartbeatAt: asString(row.last_heartbeat_at),
    revokedAt: asNullableString(row.revoked_at)
  };
}

function proposalFromRow(row: Row): ProposalRecord {
  return {
    id: asString(row.id),
    target: asString(row.target),
    operation: asString(row.operation),
    beforeSnapshot: asObject(row.before_snapshot),
    afterSnapshot: asObject(row.after_snapshot),
    reason: asString(row.reason),
    evidence: asObjectArray(row.evidence),
    risk: asString(row.risk) as ProposalRecord["risk"],
    proposalHash: asString(row.proposal_hash),
    status: asString(row.status) as ProposalRecord["status"],
    version: asNumber(row.aggregate_version),
    decidedAt: asNullableString(row.decided_at),
    createdAt: asString(row.created_at)
  };
}

function eventFromRow(row: Row): EventRecord {
  return {
    id: asString(row.id),
    occurredAt: asString(row.occurred_at),
    type: asString(row.type),
    actorType: asString(row.actor_type),
    actorId: asString(row.actor_id),
    aggregateType: asString(row.aggregate_type),
    aggregateId: asString(row.aggregate_id),
    aggregateVersion: asNumber(row.aggregate_version),
    taskId: asNullableString(row.task_id),
    runId: asNullableString(row.run_id),
    proposalId: asNullableString(row.proposal_id),
    correlationId: asString(row.correlation_id),
    payload: asObject(row.payload)
  };
}

function errorCode(error: unknown): string | undefined {
  if (error && typeof error === "object" && "code" in error) {
    return String((error as { code: unknown }).code);
  }
  return undefined;
}

export class StoreError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 409
  ) {
    super(message);
    this.name = "StoreError";
  }
}

interface EventInput {
  type: string;
  actorType: string;
  actorId: string;
  aggregateType: string;
  aggregateId: string;
  aggregateVersion: number;
  correlationId: string;
  taskId?: string | null;
  runId?: string | null;
  proposalId?: string | null;
  payload?: Record<string, unknown>;
}

async function appendEvent(database: Database, input: EventInput): Promise<void> {
  await database.query(
    `INSERT INTO events (
      id, type, actor_type, actor_id, aggregate_type, aggregate_id, aggregate_version,
      task_id, run_id, proposal_id, correlation_id, payload
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, ($12::jsonb #>> '{}')::jsonb)`,
    [
      randomUUID(),
      input.type,
      input.actorType,
      input.actorId,
      input.aggregateType,
      input.aggregateId,
      input.aggregateVersion,
      input.taskId ?? null,
      input.runId ?? null,
      input.proposalId ?? null,
      input.correlationId,
      JSON.stringify(input.payload ?? {})
    ]
  );
}

export interface RateLimitState {
  allowed: boolean;
  retryAfterSeconds: number;
}

export interface SessionResult {
  id: string;
  token: string;
  expiresAt: string;
}

export interface SessionPrincipal {
  id: string;
  actorFingerprint: string;
}

export interface NotionSampleObject {
  externalId: string;
  objectType: string;
  url: string | null;
  lastEditedAt: string | null;
  contentHash: string;
  metadata: Record<string, unknown>;
}

export interface NotionSampleInput {
  objects: NotionSampleObject[];
  truncated: boolean;
  nextCursor: string | null;
  status: "sampled" | "failed";
  errorCode: string | null;
}

export class Phase0Store {
  constructor(private readonly database: Database) {}

  async enqueueTask(input: {
    kind: string;
    objective: string;
    payload: Record<string, unknown>;
    dedupeKey: string;
    priority?: number;
    maxAttempts?: number;
    risk?: "low" | "medium" | "high";
  }): Promise<TaskRecord> {
    return this.database.transaction(async (transaction) => {
      const existing = await transaction.query<Row>(
        "SELECT * FROM tasks WHERE dedupe_key = $1 FOR UPDATE",
        [input.dedupeKey]
      );
      if (existing[0]) return taskFromRow(existing[0]);

      const id = randomUUID();
      const inserted = await transaction.query<Row>(
        `INSERT INTO tasks (
           id, kind, objective, status, priority, risk, payload, dedupe_key, max_attempts
         ) VALUES ($1, $2, $3, 'ready', $4, $5, ($6::jsonb #>> '{}')::jsonb, $7, $8)
         RETURNING *`,
        [
          id,
          input.kind,
          input.objective,
          input.priority ?? 0,
          input.risk ?? "low",
          JSON.stringify(input.payload),
          input.dedupeKey,
          input.maxAttempts ?? 3
        ]
      );
      const task = taskFromRow(inserted[0] ?? {});
      await appendEvent(transaction, {
        type: "task.created",
        actorType: "system",
        actorId: "task-enqueuer",
        aggregateType: "task",
        aggregateId: id,
        aggregateVersion: 1,
        correlationId: randomUUID(),
        taskId: id,
        payload: { kind: input.kind, dedupeKey: input.dedupeKey }
      });
      return task;
    });
  }

  async checkLoginRateLimit(fingerprintValue: string): Promise<RateLimitState> {
    const rows = await this.database.query<Row>(
      `SELECT blocked_until,
        CASE WHEN blocked_until IS NOT NULL AND blocked_until > CURRENT_TIMESTAMP
          THEN CEIL(EXTRACT(EPOCH FROM (blocked_until - CURRENT_TIMESTAMP)))::integer
          ELSE 0
        END AS retry_after
      FROM auth_rate_limits WHERE fingerprint = $1`,
      [fingerprintValue]
    );
    const row = rows[0];
    if (!row) return { allowed: true, retryAfterSeconds: 0 };
    const retryAfterSeconds = Math.max(0, asNumber(row.retry_after));
    return { allowed: retryAfterSeconds === 0, retryAfterSeconds };
  }

  async recordFailedLogin(fingerprintValue: string): Promise<RateLimitState> {
    return this.database.transaction(async (transaction) => {
      const rows = await transaction.query<Row>(
        "SELECT * FROM auth_rate_limits WHERE fingerprint = $1 FOR UPDATE",
        [fingerprintValue]
      );
      const existing = rows[0];

      if (!existing) {
        await transaction.query(
          `INSERT INTO auth_rate_limits (fingerprint, window_started_at, failures)
           VALUES ($1, CURRENT_TIMESTAMP, 1)`,
          [fingerprintValue]
        );
        return { allowed: true, retryAfterSeconds: 0 };
      }

      const windowStarted = new Date(asString(existing.window_started_at)).getTime();
      const windowExpired = Date.now() - windowStarted >= 15 * 60_000;
      const failures = windowExpired ? 1 : asNumber(existing.failures) + 1;
      const shouldBlock = failures >= 5;

      const updated = await transaction.query<Row>(
        `UPDATE auth_rate_limits
         SET window_started_at = CASE WHEN $2 THEN CURRENT_TIMESTAMP ELSE window_started_at END,
             failures = $3,
             blocked_until = CASE WHEN $4 THEN CURRENT_TIMESTAMP + INTERVAL '15 minutes' ELSE NULL END,
             updated_at = CURRENT_TIMESTAMP
         WHERE fingerprint = $1
         RETURNING blocked_until`,
        [fingerprintValue, windowExpired, failures, shouldBlock]
      );
      const blockedUntil = asNullableString(updated[0]?.blocked_until);
      return {
        allowed: !blockedUntil,
        retryAfterSeconds: blockedUntil
          ? Math.max(1, Math.ceil((new Date(blockedUntil).getTime() - Date.now()) / 1_000))
          : 0
      };
    });
  }

  async clearLoginFailures(fingerprintValue: string): Promise<void> {
    await this.database.query("DELETE FROM auth_rate_limits WHERE fingerprint = $1", [fingerprintValue]);
  }

  async createSession(actorFingerprint: string, ttlSeconds = 8 * 60 * 60): Promise<SessionResult> {
    const id = randomUUID();
    const token = createOpaqueToken();
    const tokenHash = hashOpaqueToken(token);
    const correlationId = randomUUID();
    const rows = await this.database.transaction(async (transaction) => {
      const inserted = await transaction.query<Row>(
        `INSERT INTO sessions (id, token_hash, actor_fingerprint, expires_at)
         VALUES ($1, $2, $3, CURRENT_TIMESTAMP + ($4::integer * INTERVAL '1 second'))
         RETURNING expires_at`,
        [id, tokenHash, actorFingerprint, ttlSeconds]
      );
      await appendEvent(transaction, {
        type: "session.created",
        actorType: "human",
        actorId: actorFingerprint,
        aggregateType: "session",
        aggregateId: id,
        aggregateVersion: 1,
        correlationId
      });
      return inserted;
    });

    return { id, token, expiresAt: asString(rows[0]?.expires_at) };
  }

  async sessionIsValid(token: string): Promise<boolean> {
    return (await this.getSessionPrincipal(token)) !== null;
  }

  async getSessionPrincipal(token: string): Promise<SessionPrincipal | null> {
    if (!token) return null;
    const rows = await this.database.query<Row>(
      `SELECT id, actor_fingerprint FROM sessions
       WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > CURRENT_TIMESTAMP`,
      [hashOpaqueToken(token)]
    );
    const row = rows[0];
    return row
      ? { id: asString(row.id), actorFingerprint: asString(row.actor_fingerprint) }
      : null;
  }

  async revokeSession(token: string): Promise<void> {
    if (!token) return;
    await this.database.transaction(async (transaction) => {
      const rows = await transaction.query<Row>(
        `SELECT id, actor_fingerprint, revoked_at FROM sessions
         WHERE token_hash = $1 FOR UPDATE`,
        [hashOpaqueToken(token)]
      );
      const session = rows[0];
      if (!session || session.revoked_at) return;
      await transaction.query(
        "UPDATE sessions SET revoked_at = CURRENT_TIMESTAMP WHERE id = $1",
        [session.id]
      );
      await appendEvent(transaction, {
        type: "session.revoked",
        actorType: "human",
        actorId: asString(session.actor_fingerprint),
        aggregateType: "session",
        aggregateId: asString(session.id),
        aggregateVersion: 2,
        correlationId: randomUUID()
      });
    });
  }

  async consumeWorkerNonce(workerId: string, nonce: string, requireRegistered: boolean): Promise<void> {
    try {
      await this.database.transaction(async (transaction) => {
        if (requireRegistered) {
          const workers = await transaction.query<Row>(
            "SELECT revoked_at FROM workers WHERE id = $1 FOR UPDATE",
            [workerId]
          );
          if (!workers[0]) throw new StoreError("unknown_worker", "Worker is not registered", 401);
          if (workers[0].revoked_at) throw new StoreError("revoked_worker", "Worker is revoked", 403);
        }
        await transaction.query(
          "INSERT INTO worker_nonces (worker_id, nonce) VALUES ($1, $2)",
          [workerId, nonce]
        );
        await transaction.query(
          "DELETE FROM worker_nonces WHERE seen_at < CURRENT_TIMESTAMP - INTERVAL '24 hours'"
        );
      });
    } catch (error) {
      if (errorCode(error) === "23505") {
        throw new StoreError("replayed_nonce", "Worker nonce has already been used", 401);
      }
      throw error;
    }
  }

  async recordHeartbeat(payload: HeartbeatPayload, correlationId: string = randomUUID()): Promise<WorkerRecord> {
    return this.database.transaction(async (transaction) => {
      const rows = await transaction.query<Row>(
        "SELECT * FROM workers WHERE id = $1 FOR UPDATE",
        [payload.workerId]
      );
      const existing = rows[0];
      if (existing?.revoked_at) {
        throw new StoreError("revoked_worker", "Worker is revoked", 403);
      }
      if (
        existing &&
        asString(existing.boot_id) === payload.bootId &&
        asNumber(existing.last_sequence) >= payload.sequence
      ) {
        throw new StoreError("heartbeat_out_of_order", "Heartbeat sequence must increase", 409);
      }

      const aggregateVersion = existing ? asNumber(existing.aggregate_version) + 1 : 1;
      const updated = await transaction.query<Row>(
        `INSERT INTO workers (
          id, display_name, status, boot_id, last_sequence, software_version,
          active_run_id, last_heartbeat_at, aggregate_version
        ) VALUES ($1, $2, 'online', $3, $4, $5, $6, $7, $8)
        ON CONFLICT (id) DO UPDATE SET
          display_name = EXCLUDED.display_name,
          status = 'online',
          boot_id = EXCLUDED.boot_id,
          last_sequence = EXCLUDED.last_sequence,
          software_version = EXCLUDED.software_version,
          active_run_id = EXCLUDED.active_run_id,
          last_heartbeat_at = EXCLUDED.last_heartbeat_at,
          aggregate_version = EXCLUDED.aggregate_version,
          updated_at = CURRENT_TIMESTAMP
        RETURNING *`,
        [
          payload.workerId,
          payload.displayName,
          payload.bootId,
          payload.sequence,
          payload.version,
          payload.activeRunId,
          payload.sentAt,
          aggregateVersion
        ]
      );
      await appendEvent(transaction, {
        type: existing ? "worker.heartbeat" : "worker.registered",
        actorType: "worker",
        actorId: payload.workerId,
        aggregateType: "worker",
        aggregateId: payload.workerId,
        aggregateVersion,
        correlationId,
        payload: {
          bootId: payload.bootId,
          sequence: payload.sequence,
          softwareVersion: payload.version,
          activeRunId: payload.activeRunId
        }
      });
      return workerFromRow(updated[0] ?? {});
    });
  }

  async leaseNextTask(workerId: string, leaseSeconds: number, correlationId: string = randomUUID()): Promise<LeasedWork | null> {
    return this.database.transaction(async (transaction) => {
      const workers = await transaction.query<Row>(
        "SELECT revoked_at FROM workers WHERE id = $1 FOR UPDATE",
        [workerId]
      );
      if (!workers[0]) throw new StoreError("unknown_worker", "Worker is not registered", 401);
      if (workers[0].revoked_at) throw new StoreError("revoked_worker", "Worker is revoked", 403);

      const candidates = await transaction.query<Row>(
        `SELECT * FROM tasks
         WHERE attempt_count < max_attempts
           AND (
             status IN ('ready', 'failed_retryable')
             OR (status IN ('leased', 'running') AND lease_expires_at <= CURRENT_TIMESTAMP)
           )
         ORDER BY priority DESC, created_at ASC
         FOR UPDATE SKIP LOCKED
         LIMIT 1`
      );
      const candidate = candidates[0];
      if (!candidate) return null;

      const recovered = ["leased", "running"].includes(asString(candidate.status));
      if (recovered) {
        const priorRuns = await transaction.query<Row>(
          `SELECT * FROM runs
           WHERE task_id = $1 AND status IN ('leased', 'running')
           ORDER BY attempt DESC LIMIT 1 FOR UPDATE`,
          [candidate.id]
        );
        const priorRun = priorRuns[0];
        if (priorRun) {
          const interrupted = await transaction.query<Row>(
            `UPDATE runs SET status = 'interrupted', completed_at = CURRENT_TIMESTAMP,
               error_summary = 'Lease expired before completion', aggregate_version = aggregate_version + 1
             WHERE id = $1 RETURNING *`,
            [priorRun.id]
          );
          const interruptedRun = interrupted[0];
          if (interruptedRun) {
            await appendEvent(transaction, {
              type: "run.interrupted",
              actorType: "system",
              actorId: "lease-reconciler",
              aggregateType: "run",
              aggregateId: asString(interruptedRun.id),
              aggregateVersion: asNumber(interruptedRun.aggregate_version),
              correlationId,
              taskId: asString(candidate.id),
              runId: asString(interruptedRun.id),
              payload: { reason: "lease_expired" }
            });
          }
        }
      }

      const leaseToken = randomUUID();
      const runId = randomUUID();
      const updatedTasks = await transaction.query<Row>(
        `UPDATE tasks SET
           status = 'leased', assigned_worker_id = $2, lease_token = $3,
           lease_expires_at = CURRENT_TIMESTAMP + ($4::integer * INTERVAL '1 second'),
           attempt_count = attempt_count + 1,
           aggregate_version = aggregate_version + 1,
           updated_at = CURRENT_TIMESTAMP
         WHERE id = $1 RETURNING *`,
        [candidate.id, workerId, leaseToken, leaseSeconds]
      );
      const task = taskFromRow(updatedTasks[0] ?? {});
      const runtime = task.kind === "repo.update" || task.kind.startsWith("phase0.codex")
        ? "codex-sdk"
        : "deterministic";
      const insertedRuns = await transaction.query<Row>(
        `INSERT INTO runs (
          id, task_id, worker_id, attempt, runtime, status, lease_token
        ) VALUES ($1, $2, $3, $4, $5, 'leased', $6)
        RETURNING *`,
        [runId, task.id, workerId, task.attemptCount, runtime, leaseToken]
      );
      const run = runFromRow(insertedRuns[0] ?? {});

      await appendEvent(transaction, {
        type: recovered ? "task.recovered_and_leased" : "task.leased",
        actorType: "worker",
        actorId: workerId,
        aggregateType: "task",
        aggregateId: task.id,
        aggregateVersion: task.version,
        correlationId,
        taskId: task.id,
        runId,
        payload: { attempt: task.attemptCount, recovered, leaseExpiresAt: task.leaseExpiresAt }
      });
      await appendEvent(transaction, {
        type: "run.created",
        actorType: "worker",
        actorId: workerId,
        aggregateType: "run",
        aggregateId: run.id,
        aggregateVersion: run.version,
        correlationId,
        taskId: task.id,
        runId: run.id,
        payload: { attempt: run.attempt, runtime: run.runtime }
      });

      return { task, run, recovered };
    });
  }

  async startRun(runId: string, workerId: string, leaseToken: string, correlationId: string = randomUUID()): Promise<RunRecord> {
    return this.database.transaction(async (transaction) => {
      const rows = await transaction.query<Row>(
        `SELECT r.*, t.status AS task_status, t.lease_token AS task_lease_token,
           t.lease_expires_at AS task_lease_expires_at, t.aggregate_version AS task_version
         FROM runs r JOIN tasks t ON t.id = r.task_id
         WHERE r.id = $1 FOR UPDATE OF r, t`,
        [runId]
      );
      const current = rows[0];
      this.assertActiveLease(current, workerId, leaseToken, ["leased"]);

      const updatedTasks = await transaction.query<Row>(
        `UPDATE tasks SET status = 'running', aggregate_version = aggregate_version + 1,
           updated_at = CURRENT_TIMESTAMP WHERE id = $1 RETURNING *`,
        [current?.task_id]
      );
      const updatedRuns = await transaction.query<Row>(
        `UPDATE runs SET status = 'running', started_at = CURRENT_TIMESTAMP,
           aggregate_version = aggregate_version + 1 WHERE id = $1 RETURNING *`,
        [runId]
      );
      const task = taskFromRow(updatedTasks[0] ?? {});
      const run = runFromRow(updatedRuns[0] ?? {});
      await appendEvent(transaction, {
        type: "task.started",
        actorType: "worker",
        actorId: workerId,
        aggregateType: "task",
        aggregateId: task.id,
        aggregateVersion: task.version,
        correlationId,
        taskId: task.id,
        runId
      });
      await appendEvent(transaction, {
        type: "run.started",
        actorType: "worker",
        actorId: workerId,
        aggregateType: "run",
        aggregateId: runId,
        aggregateVersion: run.version,
        correlationId,
        taskId: task.id,
        runId
      });
      return run;
    });
  }

  async checkpointRun(
    runId: string,
    workerId: string,
    leaseToken: string,
    checkpoint: Record<string, unknown>,
    correlationId: string = randomUUID()
  ): Promise<number> {
    return this.database.transaction(async (transaction) => {
      const rows = await transaction.query<Row>(
        `SELECT r.*, t.status AS task_status, t.lease_token AS task_lease_token,
           t.lease_expires_at AS task_lease_expires_at
         FROM runs r JOIN tasks t ON t.id = r.task_id
         WHERE r.id = $1 FOR UPDATE OF r, t`,
        [runId]
      );
      const current = rows[0];
      this.assertActiveLease(current, workerId, leaseToken, ["running"]);
      const sequences = await transaction.query<Row>(
        "SELECT COALESCE(MAX(sequence), 0) + 1 AS sequence FROM run_checkpoints WHERE run_id = $1",
        [runId]
      );
      const sequence = asNumber(sequences[0]?.sequence);
      await transaction.query(
        `INSERT INTO run_checkpoints (id, run_id, sequence, payload)
         VALUES ($1, $2, $3, ($4::jsonb #>> '{}')::jsonb)`,
        [randomUUID(), runId, sequence, JSON.stringify(checkpoint)]
      );
      const updated = await transaction.query<Row>(
        "UPDATE runs SET aggregate_version = aggregate_version + 1 WHERE id = $1 RETURNING *",
        [runId]
      );
      const run = runFromRow(updated[0] ?? {});
      await appendEvent(transaction, {
        type: "run.checkpointed",
        actorType: "worker",
        actorId: workerId,
        aggregateType: "run",
        aggregateId: runId,
        aggregateVersion: run.version,
        correlationId,
        taskId: run.taskId,
        runId,
        payload: { sequence }
      });
      return sequence;
    });
  }

  async renewRunLease(
    runId: string,
    workerId: string,
    leaseToken: string,
    leaseSeconds: number,
    correlationId: string = randomUUID()
  ): Promise<{ leaseExpiresAt: string }> {
    if (!Number.isInteger(leaseSeconds) || leaseSeconds < 1 || leaseSeconds > 300) {
      throw new StoreError("invalid_lease_duration", "Lease duration must be between 1 and 300 seconds", 400);
    }
    return this.database.transaction(async (transaction) => {
      const rows = await transaction.query<Row>(
        `SELECT r.*, t.status AS task_status, t.lease_token AS task_lease_token,
           t.lease_expires_at AS task_lease_expires_at
         FROM runs r JOIN tasks t ON t.id = r.task_id
         WHERE r.id = $1 FOR UPDATE OF r, t`,
        [runId]
      );
      const current = rows[0];
      this.assertActiveLease(current, workerId, leaseToken, ["running"]);
      const updatedTasks = await transaction.query<Row>(
        `UPDATE tasks SET
           lease_expires_at = CURRENT_TIMESTAMP + ($2::integer * INTERVAL '1 second'),
           aggregate_version = aggregate_version + 1,
           updated_at = CURRENT_TIMESTAMP
         WHERE id = $1 RETURNING *`,
        [current?.task_id, leaseSeconds]
      );
      const task = taskFromRow(updatedTasks[0] ?? {});
      await appendEvent(transaction, {
        type: "task.lease_renewed",
        actorType: "worker",
        actorId: workerId,
        aggregateType: "task",
        aggregateId: task.id,
        aggregateVersion: task.version,
        correlationId,
        taskId: task.id,
        runId,
        payload: { leaseExpiresAt: task.leaseExpiresAt }
      });
      return { leaseExpiresAt: task.leaseExpiresAt ?? "" };
    });
  }

  async recordGitPublication(
    runId: string,
    workerId: string,
    command: GitPublicationCommand,
    correlationId: string = randomUUID()
  ): Promise<GitPublicationRecord | null> {
    return this.database.transaction(async (transaction) => {
      const runRows = await transaction.query<Row>(
        `SELECT r.*, t.status AS task_status, t.lease_token AS task_lease_token,
           t.lease_expires_at AS task_lease_expires_at, t.kind AS task_kind
         FROM runs r JOIN tasks t ON t.id = r.task_id
         WHERE r.id = $1 FOR UPDATE OF r, t`,
        [runId]
      );
      const activeRun = runRows[0];
      this.assertActiveLease(activeRun, workerId, command.leaseToken, ["running"]);
      if (asString(activeRun.task_kind) !== "repo.update") {
        throw new StoreError(
          "git_publication_wrong_task",
          "Git publication is only available for repo.update tasks",
          409
        );
      }

      const taskId = asString(activeRun.task_id);
      const publicationRows = await transaction.query<Row>(
        "SELECT * FROM git_publications WHERE task_id = $1 FOR UPDATE",
        [taskId]
      );
      const currentRow = publicationRows[0];

      if (command.action === "inspect") {
        return currentRow ? gitPublicationFromRow(currentRow) : null;
      }

      if (command.action === "plan") {
        if (!currentRow) {
          const publicationId = randomUUID();
          const insertedRows = await transaction.query<Row>(
            `INSERT INTO git_publications (
               id, task_id, current_run_id, current_worker_id, remote,
               target_branch, base_sha, stage
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'planned')
             RETURNING *`,
            [
              publicationId,
              taskId,
              runId,
              workerId,
              command.remote,
              command.branch,
              command.baseSha
            ]
          );
          const publication = gitPublicationFromRow(insertedRows[0] ?? {});
          await appendEvent(transaction, {
            type: "git.publish_planned",
            actorType: "worker",
            actorId: workerId,
            aggregateType: "git_publication",
            aggregateId: publication.id,
            aggregateVersion: publication.version,
            correlationId,
            taskId,
            runId,
            payload: {
              remote: publication.remote,
              targetBranch: publication.targetBranch,
              baseSha: publication.baseSha
            }
          });
          return publication;
        }

        const current = gitPublicationFromRow(currentRow);
        if (
          current.remote !== command.remote ||
          current.targetBranch !== command.branch ||
          current.baseSha !== command.baseSha
        ) {
          throw new StoreError(
            "git_publication_conflict",
            "Git publication plan conflicts with the existing task publication",
            409
          );
        }
        if (
          ["verified", "no_changes"].includes(current.stage) ||
          (current.currentRunId === runId && current.currentWorkerId === workerId)
        ) {
          return current;
        }

        const resumedRows = await transaction.query<Row>(
          `UPDATE git_publications SET
             current_run_id = $2,
             current_worker_id = $3,
             last_error_code = NULL,
             retryable = NULL,
             aggregate_version = aggregate_version + 1,
             updated_at = CURRENT_TIMESTAMP
           WHERE id = $1 RETURNING *`,
          [current.id, runId, workerId]
        );
        const resumed = gitPublicationFromRow(resumedRows[0] ?? {});
        await appendEvent(transaction, {
          type: "git.publish_resumed",
          actorType: "worker",
          actorId: workerId,
          aggregateType: "git_publication",
          aggregateId: resumed.id,
          aggregateVersion: resumed.version,
          correlationId,
          taskId,
          runId,
          payload: { stage: resumed.stage, previousRunId: current.currentRunId }
        });
        return resumed;
      }

      if (!currentRow) {
        throw new StoreError(
          "git_publication_not_planned",
          "Git publication must be planned before recording progress",
          409
        );
      }
      const current = gitPublicationFromRow(currentRow);

      if (current.stage === "no_changes") {
        if (command.action === "no_changes") return current;
        throw new StoreError(
          "git_publication_terminal",
          "A no-change publication cannot transition further",
          409
        );
      }
      if (current.currentRunId !== runId || current.currentWorkerId !== workerId) {
        throw new StoreError(
          "git_publication_not_resumed",
          "The active run must resume the task publication before recording progress",
          409
        );
      }

      if (command.action === "commit") {
        if (current.treeSha !== null || current.commitSha !== null) {
          if (current.treeSha === command.treeSha && current.commitSha === command.commitSha) {
            return current;
          }
          throw new StoreError(
            "git_publication_conflict",
            "Git commit values conflict with the recorded publication",
            409
          );
        }
        this.assertGitPublicationStage(current, ["planned"], command.action);
        const updatedRows = await transaction.query<Row>(
          `UPDATE git_publications SET
             tree_sha = $2,
             commit_sha = $3,
             stage = 'committed',
             last_error_code = NULL,
             retryable = NULL,
             aggregate_version = aggregate_version + 1,
             updated_at = CURRENT_TIMESTAMP
           WHERE id = $1 RETURNING *`,
          [current.id, command.treeSha, command.commitSha]
        );
        const publication = gitPublicationFromRow(updatedRows[0] ?? {});
        await appendEvent(transaction, {
          type: "git.commit_created",
          actorType: "worker",
          actorId: workerId,
          aggregateType: "git_publication",
          aggregateId: publication.id,
          aggregateVersion: publication.version,
          correlationId,
          taskId,
          runId,
          payload: { treeSha: publication.treeSha, commitSha: publication.commitSha }
        });
        return publication;
      }

      if (command.action === "push") {
        if (current.remoteSha !== null) {
          if (current.remoteSha === command.remoteSha) return current;
          throw new StoreError(
            "git_publication_conflict",
            "Git remote SHA conflicts with the recorded publication",
            409
          );
        }
        this.assertGitPublicationStage(current, ["committed"], command.action);
        const updatedRows = await transaction.query<Row>(
          `UPDATE git_publications SET
             remote_sha = $2,
             stage = 'pushed',
             last_error_code = NULL,
             retryable = NULL,
             aggregate_version = aggregate_version + 1,
             updated_at = CURRENT_TIMESTAMP
           WHERE id = $1 RETURNING *`,
          [current.id, command.remoteSha]
        );
        const publication = gitPublicationFromRow(updatedRows[0] ?? {});
        await appendEvent(transaction, {
          type: "git.push_recorded",
          actorType: "worker",
          actorId: workerId,
          aggregateType: "git_publication",
          aggregateId: publication.id,
          aggregateVersion: publication.version,
          correlationId,
          taskId,
          runId,
          payload: { remoteSha: publication.remoteSha }
        });
        return publication;
      }

      if (command.action === "verify") {
        if (current.commitSha !== command.remoteSha) {
          throw new StoreError(
            "git_remote_sha_mismatch",
            "Verified remote SHA must match the recorded commit SHA",
            409
          );
        }
        if (current.remoteSha !== command.remoteSha) {
          throw new StoreError(
            "git_publication_conflict",
            "Verified remote SHA conflicts with the pushed SHA",
            409
          );
        }
        if (current.stage === "verified") return current;
        this.assertGitPublicationStage(current, ["pushed"], command.action);
        const updatedRows = await transaction.query<Row>(
          `UPDATE git_publications SET
             stage = 'verified',
             last_error_code = NULL,
             retryable = NULL,
             aggregate_version = aggregate_version + 1,
             updated_at = CURRENT_TIMESTAMP
           WHERE id = $1 RETURNING *`,
          [current.id]
        );
        const publication = gitPublicationFromRow(updatedRows[0] ?? {});
        await appendEvent(transaction, {
          type: "git.push_verified",
          actorType: "worker",
          actorId: workerId,
          aggregateType: "git_publication",
          aggregateId: publication.id,
          aggregateVersion: publication.version,
          correlationId,
          taskId,
          runId,
          payload: { remoteSha: publication.remoteSha }
        });
        return publication;
      }

      if (command.action === "no_changes") {
        this.assertGitPublicationStage(current, ["planned"], command.action);
        const updatedRows = await transaction.query<Row>(
          `UPDATE git_publications SET
             stage = 'no_changes',
             last_error_code = NULL,
             retryable = NULL,
             aggregate_version = aggregate_version + 1,
             updated_at = CURRENT_TIMESTAMP
           WHERE id = $1 RETURNING *`,
          [current.id]
        );
        const publication = gitPublicationFromRow(updatedRows[0] ?? {});
        await appendEvent(transaction, {
          type: "git.no_changes",
          actorType: "worker",
          actorId: workerId,
          aggregateType: "git_publication",
          aggregateId: publication.id,
          aggregateVersion: publication.version,
          correlationId,
          taskId,
          runId,
          payload: { baseSha: publication.baseSha }
        });
        return publication;
      }

      if (current.stage === "verified") {
        throw new StoreError(
          "git_publication_terminal",
          "A verified publication cannot record a Git failure",
          409
        );
      }
      if (
        current.lastErrorCode === command.errorCode &&
        current.retryable === command.retryable
      ) {
        return current;
      }

      const capabilityRequestDedupeKey = ["git_auth_failed", "git_remote_unavailable"].includes(
        command.errorCode
      )
        ? `git:publish:${current.remote}`
        : null;
      if (capabilityRequestDedupeKey) {
        await transaction.query(
          `INSERT INTO capability_requests (
             id, dedupe_key, capability, reason, minimum_permission, setup_instructions
           ) VALUES ($1, $2, 'git.publish', $3, $4, $5)
           ON CONFLICT (dedupe_key) DO UPDATE SET
             reason = EXCLUDED.reason,
             minimum_permission = EXCLUDED.minimum_permission,
             setup_instructions = EXCLUDED.setup_instructions,
             updated_at = CURRENT_TIMESTAMP`,
          [
            randomUUID(),
            capabilityRequestDedupeKey,
            `Git publication failed with ${command.errorCode} for logical remote ${current.remote}.`,
            "Authenticated push access to the configured logical Git remote for automation/* branches.",
            "Configure or restore non-interactive worker credentials for the logical Git remote, then verify push access without exposing credential values."
          ]
        );
      }

      const failedRows = await transaction.query<Row>(
        `UPDATE git_publications SET
           last_error_code = $2,
           retryable = $3,
           aggregate_version = aggregate_version + 1,
           updated_at = CURRENT_TIMESTAMP
         WHERE id = $1 RETURNING *`,
        [current.id, command.errorCode, command.retryable]
      );
      const failed = gitPublicationFromRow(failedRows[0] ?? {});
      await appendEvent(transaction, {
        type: "git.publish_failed",
        actorType: "worker",
        actorId: workerId,
        aggregateType: "git_publication",
        aggregateId: failed.id,
        aggregateVersion: failed.version,
        correlationId,
        taskId,
        runId,
        payload: {
          stage: failed.stage,
          errorCode: failed.lastErrorCode,
          retryable: failed.retryable,
          capabilityRequestDedupeKey
        }
      });
      return failed;
    });
  }

  private assertGitPublicationStage(
    publication: GitPublicationRecord,
    allowedStages: GitPublicationRecord["stage"][],
    action: GitPublicationCommand["action"]
  ): void {
    if (!allowedStages.includes(publication.stage)) {
      throw new StoreError(
        "git_publication_invalid_transition",
        `Cannot record ${action} while Git publication is ${publication.stage}`,
        409
      );
    }
  }

  async completeRun(
    runId: string,
    workerId: string,
    completion: RunComplete,
    correlationId: string = randomUUID()
  ): Promise<{ task: TaskRecord; run: RunRecord }> {
    return this.database.transaction(async (transaction) => {
      const rows = await transaction.query<Row>(
        `SELECT r.*, t.status AS task_status, t.lease_token AS task_lease_token,
           t.lease_expires_at AS task_lease_expires_at,
           t.attempt_count AS task_attempt_count, t.max_attempts AS task_max_attempts,
           t.kind AS task_kind
         FROM runs r JOIN tasks t ON t.id = r.task_id
         WHERE r.id = $1 FOR UPDATE OF r, t`,
        [runId]
      );
      const current = rows[0];
      this.assertActiveLease(current, workerId, completion.leaseToken, ["running"]);

      if (completion.outcome === "succeeded" && asString(current.task_kind) === "repo.update") {
        const publicationRows = await transaction.query<Row>(
          "SELECT stage, commit_sha, remote_sha FROM git_publications WHERE task_id = $1 FOR UPDATE",
          [current.task_id]
        );
        const publication = publicationRows[0];
        const stage = publication ? asString(publication.stage) : null;
        const verified = stage === "verified"
          && asNullableString(publication?.commit_sha) !== null
          && asNullableString(publication?.commit_sha) === asNullableString(publication?.remote_sha);
        if (stage !== "no_changes" && !verified) {
          throw new StoreError(
            "git_publication_incomplete",
            "A repo.update run can succeed only after Git publication is verified or records no changes",
            409
          );
        }
      }

      const retryExhausted =
        completion.outcome === "failed_retryable" &&
        asNumber(current?.task_attempt_count) >= asNumber(current?.task_max_attempts);
      const runOutcome = retryExhausted ? "failed_terminal" : completion.outcome;
      const taskStatus = runOutcome === "succeeded"
        ? "succeeded"
        : runOutcome === "failed_retryable"
          ? "ready"
          : "failed_terminal";

      const updatedTasks = await transaction.query<Row>(
        `UPDATE tasks SET status = $2, assigned_worker_id = NULL, lease_token = NULL,
           lease_expires_at = NULL, aggregate_version = aggregate_version + 1,
           updated_at = CURRENT_TIMESTAMP WHERE id = $1 RETURNING *`,
        [current?.task_id, taskStatus]
      );
      const updatedRuns = await transaction.query<Row>(
        `UPDATE runs SET status = $2, runtime_thread_id = $3, output = ($4::jsonb #>> '{}')::jsonb,
           error_summary = $5, completed_at = CURRENT_TIMESTAMP,
           aggregate_version = aggregate_version + 1
         WHERE id = $1 RETURNING *`,
        [
          runId,
          runOutcome,
          completion.runtimeThreadId,
          completion.output === null ? null : JSON.stringify(completion.output),
          completion.errorSummary
        ]
      );
      const task = taskFromRow(updatedTasks[0] ?? {});
      const run = runFromRow(updatedRuns[0] ?? {});
      await appendEvent(transaction, {
        type: `task.${taskStatus}`,
        actorType: "worker",
        actorId: workerId,
        aggregateType: "task",
        aggregateId: task.id,
        aggregateVersion: task.version,
        correlationId,
        taskId: task.id,
        runId,
        payload: { outcome: runOutcome }
      });
      await appendEvent(transaction, {
        type: `run.${runOutcome}`,
        actorType: "worker",
        actorId: workerId,
        aggregateType: "run",
        aggregateId: runId,
        aggregateVersion: run.version,
        correlationId,
        taskId: task.id,
        runId,
        payload: { errorSummary: completion.errorSummary }
      });
      return { task, run };
    });
  }

  private assertActiveLease(
    row: Row | undefined,
    workerId: string,
    leaseToken: string,
    allowedRunStatuses: string[]
  ): asserts row is Row {
    if (!row) throw new StoreError("run_not_found", "Run does not exist", 404);
    if (asString(row.worker_id) !== workerId) {
      throw new StoreError("wrong_worker", "Run is leased to another worker", 403);
    }
    if (asString(row.lease_token) !== leaseToken || asString(row.task_lease_token) !== leaseToken) {
      throw new StoreError("stale_lease", "Lease token is no longer active", 409);
    }
    if (!allowedRunStatuses.includes(asString(row.status))) {
      throw new StoreError("invalid_run_state", `Run is ${asString(row.status)}`, 409);
    }
    if (!["leased", "running"].includes(asString(row.task_status))) {
      throw new StoreError("invalid_task_state", `Task is ${asString(row.task_status)}`, 409);
    }
    const expiresAt = new Date(asString(row.task_lease_expires_at)).getTime();
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
      throw new StoreError("expired_lease", "Lease has expired", 409);
    }
  }

  async ensurePhase0Seed(): Promise<{ task: TaskRecord; proposal: ProposalRecord }> {
    return this.database.transaction(async (transaction) => {
      const taskDedupeKey = "phase0:codex-smoke:v1";
      let taskRows = await transaction.query<Row>(
        "SELECT * FROM tasks WHERE dedupe_key = $1 FOR UPDATE",
        [taskDedupeKey]
      );
      if (!taskRows[0]) {
        const taskId = randomUUID();
        const correlationId = randomUUID();
        taskRows = await transaction.query<Row>(
          `INSERT INTO tasks (
             id, kind, objective, status, priority, risk, payload, dedupe_key, max_attempts
           ) VALUES ($1, 'phase0.codex-smoke', $2, 'ready', 100, 'low', ($3::jsonb #>> '{}')::jsonb, $4, 3)
           RETURNING *`,
          [
            taskId,
            "Prove the local Codex runtime can complete a harmless durable task",
            JSON.stringify({
              prompt: "Return exactly PHASE0_CODEX_OK. Do not inspect or modify files and do not call tools."
            }),
            taskDedupeKey
          ]
        );
        await appendEvent(transaction, {
          type: "task.created",
          actorType: "system",
          actorId: "phase0-seed",
          aggregateType: "task",
          aggregateId: taskId,
          aggregateVersion: 1,
          correlationId,
          taskId,
          payload: { kind: "phase0.codex-smoke", dedupeKey: taskDedupeKey }
        });
      }

      const proposalDedupeKey = "phase0:fake-proposal:v1";
      let proposalRows = await transaction.query<Row>(
        "SELECT * FROM proposals WHERE dedupe_key = $1 FOR UPDATE",
        [proposalDedupeKey]
      );
      if (!proposalRows[0]) {
        const material: ProposalHashInput = {
          target: "phase0://dashboard/demo-preference",
          operation: "NOOP_PREVIEW",
          beforeSnapshot: { reviewMode: "compact" },
          afterSnapshot: { reviewMode: "detailed" },
          reason: "Exercise a controlled decision without mutating an external system.",
          evidence: [{ type: "phase0_test", reference: "PROJECT_SEED.md#phase-0" }],
          risk: "low"
        };
        const proposalId = randomUUID();
        proposalRows = await transaction.query<Row>(
          `INSERT INTO proposals (
             id, dedupe_key, target, operation, before_snapshot, after_snapshot,
             reason, evidence, risk, proposal_hash
           ) VALUES ($1, $2, $3, $4, ($5::jsonb #>> '{}')::jsonb,
             ($6::jsonb #>> '{}')::jsonb, $7, ($8::jsonb #>> '{}')::jsonb, $9, $10)
           RETURNING *`,
          [
            proposalId,
            proposalDedupeKey,
            material.target,
            material.operation,
            JSON.stringify(material.beforeSnapshot),
            JSON.stringify(material.afterSnapshot),
            material.reason,
            JSON.stringify(material.evidence),
            material.risk,
            computeProposalHash(material)
          ]
        );
        await appendEvent(transaction, {
          type: "proposal.created",
          actorType: "system",
          actorId: "phase0-seed",
          aggregateType: "proposal",
          aggregateId: proposalId,
          aggregateVersion: 1,
          correlationId: randomUUID(),
          proposalId,
          payload: { target: material.target, operation: material.operation }
        });
      }

      return {
        task: taskFromRow(taskRows[0] ?? {}),
        proposal: proposalFromRow(proposalRows[0] ?? {})
      };
    });
  }

  async decideProposal(
    proposalId: string,
    decision: ProposalDecision,
    expectedHash: string,
    actor: string,
    reason: string,
    correlationId: string = randomUUID()
  ): Promise<ProposalRecord> {
    return this.database.transaction(async (transaction) => {
      const rows = await transaction.query<Row>(
        "SELECT * FROM proposals WHERE id = $1 FOR UPDATE",
        [proposalId]
      );
      const current = rows[0];
      if (!current) throw new StoreError("proposal_not_found", "Proposal does not exist", 404);
      if (asString(current.status) !== "pending") {
        throw new StoreError("proposal_already_decided", "Proposal is no longer pending", 409);
      }
      if (asString(current.proposal_hash) !== expectedHash) {
        throw new StoreError("proposal_hash_mismatch", "Proposal changed after it was displayed", 409);
      }

      const decisionId = randomUUID();
      await transaction.query(
        `INSERT INTO proposal_decisions (
          id, proposal_id, decision, proposal_hash, actor, reason
        ) VALUES ($1, $2, $3, $4, $5, $6)`,
        [decisionId, proposalId, decision, expectedHash, actor, reason]
      );
      const status = decision === "approve" ? "approved" : "rejected";
      const updated = await transaction.query<Row>(
        `UPDATE proposals SET status = $2, decided_at = CURRENT_TIMESTAMP,
           aggregate_version = aggregate_version + 1
         WHERE id = $1 RETURNING *`,
        [proposalId, status]
      );
      const proposal = proposalFromRow(updated[0] ?? {});
      await appendEvent(transaction, {
        type: `proposal.${status}`,
        actorType: "human",
        actorId: actor,
        aggregateType: "proposal",
        aggregateId: proposalId,
        aggregateVersion: proposal.version,
        correlationId,
        proposalId,
        payload: { decision, proposalHash: expectedHash, reason }
      });
      return proposal;
    });
  }

  async recordNotionSample(input: NotionSampleInput, correlationId: string = randomUUID()): Promise<string> {
    const runId = randomUUID();
    await this.database.transaction(async (transaction) => {
      await transaction.query(
        `INSERT INTO notion_sample_runs (
          id, status, sampled_count, truncated, next_cursor, error_code
        ) VALUES ($1, $2, $3, $4, $5, $6)`,
        [runId, input.status, input.objects.length, input.truncated, input.nextCursor, input.errorCode]
      );
      for (const object of input.objects) {
        await transaction.query(
          `INSERT INTO source_objects (
             source, external_id, object_type, url, last_edited_at, content_hash, metadata
           ) VALUES ('notion', $1, $2, $3, $4, $5, ($6::jsonb #>> '{}')::jsonb)
           ON CONFLICT (source, external_id) DO UPDATE SET
             object_type = EXCLUDED.object_type,
             url = EXCLUDED.url,
             last_edited_at = EXCLUDED.last_edited_at,
             content_hash = EXCLUDED.content_hash,
             metadata = EXCLUDED.metadata,
             last_fetched_at = CURRENT_TIMESTAMP`,
          [
            object.externalId,
            object.objectType,
            object.url,
            object.lastEditedAt,
            object.contentHash,
            JSON.stringify(object.metadata)
          ]
        );
      }
      if (input.status === "failed") {
        await transaction.query(
          `INSERT INTO capability_requests (
             id, dedupe_key, capability, reason, minimum_permission, setup_instructions
           ) VALUES ($1, 'phase0:notion-read', 'notion.read', $2, 'Read-only access to explicitly shared pages/data sources', $3)
           ON CONFLICT (dedupe_key) DO UPDATE SET
             reason = EXCLUDED.reason,
             updated_at = CURRENT_TIMESTAMP`,
          [
            randomUUID(),
            `Bounded Notion sample failed: ${input.errorCode ?? "unknown"}`,
            "Create a Notion integration, share the intended pages/data sources with it, and set NOTION_TOKEN only in the worker environment."
          ]
        );
      }
      await appendEvent(transaction, {
        type: input.status === "sampled" ? "notion.sample.completed" : "notion.sample.failed",
        actorType: "worker",
        actorId: "notion-connector",
        aggregateType: "notion_sample",
        aggregateId: runId,
        aggregateVersion: 1,
        correlationId,
        payload: {
          sampledCount: input.objects.length,
          truncated: input.truncated,
          hasNextCursor: Boolean(input.nextCursor),
          errorCode: input.errorCode
        }
      });
    });
    return runId;
  }

  async ensureCapabilityRequest(input: {
    dedupeKey: string;
    capability: string;
    reason: string;
    minimumPermission: string;
    setupInstructions: string;
  }): Promise<void> {
    await this.database.query(
      `INSERT INTO capability_requests (
        id, dedupe_key, capability, reason, minimum_permission, setup_instructions
      ) VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (dedupe_key) DO UPDATE SET
        reason = EXCLUDED.reason,
        minimum_permission = EXCLUDED.minimum_permission,
        setup_instructions = EXCLUDED.setup_instructions,
        updated_at = CURRENT_TIMESTAMP`,
      [
        randomUUID(),
        input.dedupeKey,
        input.capability,
        input.reason,
        input.minimumPermission,
        input.setupInstructions
      ]
    );
  }

  async dashboardSnapshot(): Promise<DashboardSnapshot> {
    const [workers, tasks, runs, proposals, events, notionRuns] = await Promise.all([
      this.database.query<Row>(
        `SELECT *, CASE
           WHEN revoked_at IS NOT NULL THEN 'revoked'
           WHEN last_heartbeat_at < CURRENT_TIMESTAMP - INTERVAL '2 minutes' THEN 'stale'
           ELSE 'online'
         END AS effective_status
         FROM workers ORDER BY last_heartbeat_at DESC LIMIT 1`
      ),
      this.database.query<Row>("SELECT * FROM tasks ORDER BY created_at DESC LIMIT 10"),
      this.database.query<Row>("SELECT * FROM runs ORDER BY created_at DESC LIMIT 10"),
      this.database.query<Row>("SELECT * FROM proposals ORDER BY created_at DESC LIMIT 10"),
      this.database.query<Row>("SELECT * FROM events ORDER BY occurred_at DESC LIMIT 30"),
      this.database.query<Row>("SELECT * FROM notion_sample_runs ORDER BY sampled_at DESC LIMIT 1")
    ]);
    const worker = workers[0] ? workerFromRow(workers[0]) : null;
    const notionRow = notionRuns[0];
    const notion = notionRow
      ? {
          status: asString(notionRow.status) === "sampled" ? "sampled" as const : "failed" as const,
          sampledCount: asNumber(notionRow.sampled_count),
          truncated: asBoolean(notionRow.truncated),
          sampledAt: asString(notionRow.sampled_at),
          errorCode: asNullableString(notionRow.error_code)
        }
      : {
          status: "not_configured" as const,
          sampledCount: 0,
          truncated: true,
          sampledAt: null,
          errorCode: null
        };

    return {
      generatedAt: new Date().toISOString(),
      systemStatus: worker?.status === "online" && notion.status === "sampled" ? "running" : "degraded",
      worker,
      tasks: tasks.map(taskFromRow),
      runs: runs.map(runFromRow),
      proposals: proposals.map(proposalFromRow),
      events: events.map(eventFromRow),
      notion
    };
  }
}
