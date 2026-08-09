import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  Phase0Store,
  StoreError,
  type Database
} from "@meaworld/db";
import { migrate } from "@meaworld/db/migrate";
import {
  GitPublicationCommandSchema,
  type GitPublicationRecord,
  type HeartbeatPayload
} from "@meaworld/domain";
import { createTestDatabase } from "./helpers/pglite";

describe("Phase 0 durable store", () => {
  let database: Database;
  let store: Phase0Store;
  let close: () => Promise<void>;

  beforeEach(async () => {
    const testDatabase = await createTestDatabase();
    database = testDatabase.database;
    close = testDatabase.close;
    await migrate(database);
    store = new Phase0Store(database);
  });

  afterEach(async () => {
    await close();
  });

  async function registerWorker(workerId = "mac-mini-phase0"): Promise<HeartbeatPayload> {
    const payload: HeartbeatPayload = {
      workerId,
      displayName: "Test Mac",
      bootId: randomUUID(),
      sequence: 1,
      version: "test",
      activeRunId: null,
      sentAt: new Date().toISOString()
    };
    const nonce = randomUUID();
    await store.consumeWorkerNonce(workerId, nonce, false);
    await store.recordHeartbeat(payload);
    return payload;
  }

  async function startRepoUpdateRun(workerId = "mac-mini-phase0") {
    await registerWorker(workerId);
    await store.enqueueTask({
      kind: "repo.update",
      objective: "Publish a tested repository update",
      payload: {},
      dedupeKey: `repo-update:${randomUUID()}`,
      priority: 50,
      maxAttempts: 3,
      risk: "medium"
    });
    const work = await store.leaseNextTask(workerId, 300);
    if (!work) throw new Error("Expected repo.update work");
    await store.startRun(work.run.id, workerId, work.run.leaseToken);
    return work;
  }

  function requirePublication(
    publication: GitPublicationRecord | null
  ): GitPublicationRecord {
    if (!publication) throw new Error("Expected a Git publication");
    return publication;
  }

  it("applies migrations once and reruns idempotently", async () => {
    const rerun = await migrate(database);
    expect(rerun.applied).toEqual([]);
    expect(rerun.alreadyApplied).toEqual([
      "0001_phase0.sql",
      "0002_git_publications.sql",
      "0003_telegram_operator.sql",
      "0004_telegram_requests_outbox.sql"
    ]);

    const constraints = await database.query<{ count: number }>(
      "SELECT COUNT(*)::integer AS count FROM information_schema.table_constraints WHERE table_name = 'tasks'"
    );
    expect(Number(constraints[0]?.count)).toBeGreaterThan(0);
  });

  it("persists hashed sessions, logout, and database-backed throttling", async () => {
    const session = await store.createSession("f".repeat(64), 60);
    expect(await store.sessionIsValid(session.token)).toBe(true);
    expect(await store.getSessionPrincipal(session.token)).toEqual({
      id: session.id,
      actorFingerprint: "f".repeat(64)
    });
    const rows = await database.query<{ token_hash: string }>("SELECT token_hash FROM sessions WHERE id = $1", [session.id]);
    expect(rows[0]?.token_hash).not.toBe(session.token);

    await store.revokeSession(session.token);
    expect(await store.sessionIsValid(session.token)).toBe(false);
    expect(await store.getSessionPrincipal(session.token)).toBeNull();

    const identity = "a".repeat(64);
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      expect((await store.recordFailedLogin(identity)).allowed).toBe(true);
    }
    const blocked = await store.recordFailedLogin(identity);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
    expect((await store.checkLoginRateLimit(identity)).allowed).toBe(false);
  });

  it("rejects nonce replay and out-of-order heartbeats", async () => {
    const payload = await registerWorker();
    const nonce = randomUUID();
    await store.consumeWorkerNonce(payload.workerId, nonce, true);
    await expect(store.consumeWorkerNonce(payload.workerId, nonce, true)).rejects.toMatchObject({
      code: "replayed_nonce"
    });
    await expect(store.recordHeartbeat(payload)).rejects.toMatchObject({
      code: "heartbeat_out_of_order"
    });
  });

  it("pairs one Telegram operator, deduplicates updates, and enqueues audited queries", async () => {
    const invalidPair = await store.processTelegramCommand({
      updateId: 1,
      chatId: 101,
      userId: 202,
      username: "operator",
      messageId: 1,
      action: "pair",
      pairCodeValid: false,
      prompt: null
    });
    expect(invalidPair).toMatchObject({
      duplicate: false,
      authorized: false,
      paired: false,
      reason: "invalid_pairing_code"
    });

    const paired = await store.processTelegramCommand({
      updateId: 2,
      chatId: 101,
      userId: 202,
      username: "operator",
      messageId: 2,
      action: "pair",
      pairCodeValid: true,
      prompt: null
    });
    expect(paired).toMatchObject({
      duplicate: false,
      authorized: true,
      paired: true,
      reason: "ok"
    });

    const deniedSecondOperator = await store.processTelegramCommand({
      updateId: 3,
      chatId: 303,
      userId: 404,
      username: "intruder",
      messageId: 1,
      action: "pair",
      pairCodeValid: true,
      prompt: null
    });
    expect(deniedSecondOperator.reason).toBe("already_paired");

    const queued = await store.processTelegramCommand({
      updateId: 4,
      chatId: 101,
      userId: 202,
      username: "operator",
      messageId: 3,
      action: "ask",
      pairCodeValid: false,
      prompt: "Spiegami lo stato del progetto."
    });
    expect(queued.task).toMatchObject({
      kind: "operator.query",
      status: "ready",
      risk: "low",
      maxAttempts: 2
    });
    expect(queued.task?.payload).toMatchObject({
      source: "telegram",
      telegramChatId: "101",
      telegramUserId: "202"
    });

    const duplicate = await store.processTelegramCommand({
      updateId: 4,
      chatId: 101,
      userId: 202,
      username: "operator",
      messageId: 3,
      action: "ask",
      pairCodeValid: false,
      prompt: "Non deve essere accodata due volte."
    });
    expect(duplicate.duplicate).toBe(true);
    expect(await store.telegramTasks(101)).toHaveLength(1);

    const taskRows = await database.query<{ count: number }>(
      "SELECT COUNT(*)::integer AS count FROM tasks WHERE dedupe_key = 'telegram:update:4'"
    );
    expect(taskRows[0]?.count).toBe(1);
    const auditGaps = await database.query(
      `SELECT aggregate_type, aggregate_id
       FROM events
       GROUP BY aggregate_type, aggregate_id
       HAVING MIN(aggregate_version) <> 1
          OR MAX(aggregate_version) <> COUNT(*)`
    );
    expect(auditGaps).toEqual([]);

    const snapshot = await store.dashboardSnapshot();
    expect(snapshot.telegram).toMatchObject({
      paired: true,
      lastCommand: "ask",
      lastTaskId: queued.task?.id
    });
    expect(snapshot.events.some((event) => event.type === "worker.heartbeat")).toBe(false);
  });

  it("persists Telegram change confirmation, outbound delivery, and approved repo work", async () => {
    await store.processTelegramCommand({
      updateId: 101,
      chatId: 501,
      userId: 601,
      username: "operator",
      messageId: 1,
      action: "pair",
      pairCodeValid: true,
      prompt: null
    });
    const routed = await store.processTelegramCommand({
      updateId: 102,
      chatId: 501,
      userId: 601,
      username: "operator",
      messageId: 2,
      action: "request",
      pairCodeValid: false,
      prompt: "Invia automaticamente le risposte Telegram."
    });
    expect(routed.task).toMatchObject({ kind: "supervisor.request", status: "ready" });

    await registerWorker();
    const work = await store.leaseNextTask("mac-mini-phase0", 300);
    if (!work) throw new Error("Expected operator request work");
    await store.startRun(work.run.id, "mac-mini-phase0", work.run.leaseToken);
    await store.completeRun(work.run.id, "mac-mini-phase0", {
      leaseToken: work.run.leaseToken,
      outcome: "succeeded",
      runtimeThreadId: "router-thread",
      output: {
        intent: "repo_update",
        objective: "Invia automaticamente le risposte Telegram",
        implementationPrompt: "Implementa notifiche Telegram durevoli e automatiche."
      },
      errorSummary: null
    });

    const requests = await database.query<{
      id: string;
      status: string;
    }>("SELECT id, status FROM telegram_change_requests");
    expect(requests).toHaveLength(1);
    expect(requests[0]?.status).toBe("pending_confirmation");
    expect((await store.dashboardSnapshot()).telegram).toMatchObject({
      pendingConfirmations: 1,
      pendingNotifications: 1
    });

    const notification = await store.leaseTelegramOutbox("mac-mini-phase0", 30);
    expect(notification).toMatchObject({
      chatId: 501,
      attemptCount: 1,
      replyMarkup: {
        inline_keyboard: [[
          expect.objectContaining({ text: "Approva" }),
          expect.objectContaining({ text: "Annulla" })
        ]]
      }
    });
    if (!notification) throw new Error("Expected Telegram notification");
    await store.completeTelegramOutbox(notification.id, "mac-mini-phase0", {
      leaseToken: notification.leaseToken,
      outcome: "sent",
      telegramMessageId: 9001,
      errorCode: null
    });

    const approved = await store.processTelegramCallback({
      updateId: 103,
      callbackQueryId: "callback-103",
      chatId: 501,
      userId: 601,
      messageId: 3,
      changeRequestId: requests[0]?.id ?? "",
      decision: "approve"
    });
    expect(approved).toMatchObject({
      duplicate: false,
      authorized: true,
      reason: "ok",
      task: { kind: "repo.update", status: "ready", risk: "medium" }
    });
    expect(approved.task?.payload).toMatchObject({
      source: "telegram",
      telegramChatId: "501",
      telegramChangeRequestId: requests[0]?.id
    });

    const duplicate = await store.processTelegramCallback({
      updateId: 103,
      callbackQueryId: "callback-duplicate",
      chatId: 501,
      userId: 601,
      messageId: 3,
      changeRequestId: requests[0]?.id ?? "",
      decision: "approve"
    });
    expect(duplicate.duplicate).toBe(true);
    const repoTasks = await database.query<{ count: number }>(
      "SELECT COUNT(*)::integer AS count FROM tasks WHERE kind = 'repo.update'"
    );
    expect(Number(repoTasks[0]?.count)).toBe(1);
    expect((await store.dashboardSnapshot()).telegram).toMatchObject({
      pendingConfirmations: 0,
      pendingNotifications: 0
    });

    const auditGaps = await database.query(
      `SELECT aggregate_type, aggregate_id
       FROM events
       GROUP BY aggregate_type, aggregate_id
       HAVING MIN(aggregate_version) <> 1
          OR MAX(aggregate_version) <> COUNT(*)`
    );
    expect(auditGaps).toEqual([]);
  });

  it("pushes completed Telegram answers through the durable outbox", async () => {
    await store.processTelegramCommand({
      updateId: 201,
      chatId: 701,
      userId: 801,
      username: "operator",
      messageId: 1,
      action: "pair",
      pairCodeValid: true,
      prompt: null
    });
    const queued = await store.processTelegramCommand({
      updateId: 202,
      chatId: 701,
      userId: 801,
      username: "operator",
      messageId: 2,
      action: "ask",
      pairCodeValid: false,
      prompt: "Dammi una risposta breve."
    });
    await registerWorker();
    const work = await store.leaseNextTask("mac-mini-phase0", 300);
    if (!work) throw new Error("Expected operator query work");
    await store.startRun(work.run.id, "mac-mini-phase0", work.run.leaseToken);
    await store.completeRun(work.run.id, "mac-mini-phase0", {
      leaseToken: work.run.leaseToken,
      outcome: "succeeded",
      runtimeThreadId: "answer-thread",
      output: { response: "Risposta pronta." },
      errorSummary: null
    });

    const notification = await store.leaseTelegramOutbox("mac-mini-phase0", 30);
    expect(notification).toMatchObject({
      chatId: 701,
      text: "Risposta pronta.",
      replyMarkup: null
    });
    expect(queued.task?.id).toBe(work.task.id);
  });

  it("executes supervisor Notion research and answers follow-up status from durable context", async () => {
    await store.processTelegramCommand({
      updateId: 301,
      chatId: 901,
      userId: 902,
      username: "operator",
      messageId: 1,
      action: "pair",
      pairCodeValid: true,
      prompt: null
    });
    const requested = await store.processTelegramCommand({
      updateId: 302,
      chatId: 901,
      userId: 902,
      username: "operator",
      messageId: 2,
      action: "request",
      pairCodeValid: false,
      prompt: "Analizza su Notion pipeline, formazione e processi commerciali."
    });
    expect(requested.task).toMatchObject({
      kind: "notion.research",
      payload: {
        searchQueries: ["pipeline", "formazione", "processi", "commerciali"]
      }
    });

    await registerWorker();
    const researchTaskId = requested.task?.id ?? "";
    const researchWork = await store.leaseNextTask("mac-mini-phase0", 300);
    if (!researchWork) throw new Error("Expected Notion research work");
    expect(researchWork.task.id).toBe(researchTaskId);
    await store.startRun(researchWork.run.id, "mac-mini-phase0", researchWork.run.leaseToken);
    await store.completeRun(researchWork.run.id, "mac-mini-phase0", {
      leaseToken: researchWork.run.leaseToken,
      outcome: "succeeded",
      runtimeThreadId: "research-thread",
      output: {
        response: "La pipeline include qualificazione e follow-up [N1]. Sintesi AI non validata.",
        confidence: 0.75,
        validationState: "ai_generated_unvalidated",
        sources: [{
          reference: "N1",
          externalId: "notion-page-commerciale",
          title: "Pipeline Commerciale",
          url: "https://notion.so/pipeline",
          lastEditedAt: "2026-08-08T10:00:00.000Z",
          contentHash: "a".repeat(64),
          matchedQueries: ["Pipeline Commerciale"],
          partial: false
        }],
        coverage: {
          requestedQueries: ["Pipeline Commerciale"],
          searchResultCount: 1,
          uniquePagesFound: 1,
          fetchedPages: 1,
          inaccessiblePages: 0,
          partial: false,
          limits: { maxPages: 15, maxCharacters: 60_000 }
        }
      },
      errorSummary: null
    });

    const sourceRows = await database.query<{
      external_id: string;
      content_hash: string;
      metadata: Record<string, unknown>;
    }>("SELECT external_id, content_hash, metadata FROM source_objects WHERE external_id = $1", [
      "notion-page-commerciale"
    ]);
    expect(sourceRows).toHaveLength(1);
    expect(sourceRows[0]).toMatchObject({
      external_id: "notion-page-commerciale",
      content_hash: "a".repeat(64)
    });

    const followUp = await store.processTelegramCommand({
      updateId: 303,
      chatId: 901,
      userId: 902,
      username: "operator",
      messageId: 3,
      action: "request",
      pairCodeValid: false,
      prompt: "Quindi lo hai fatto?"
    });
    const context = followUp.task?.payload.conversationContext;
    expect(followUp.task).toMatchObject({
      kind: "supervisor.status",
      payload: { targetTaskId: researchTaskId }
    });
    expect(context).toEqual(expect.arrayContaining([
      expect.objectContaining({
        taskId: researchTaskId,
        kind: "notion.research",
        status: "succeeded",
        responsePreview: expect.stringContaining("qualificazione")
      })
    ]));

    const statusWork = await store.leaseNextTask("mac-mini-phase0", 300);
    if (!statusWork) throw new Error("Expected status supervisor work");
    await store.startRun(statusWork.run.id, "mac-mini-phase0", statusWork.run.leaseToken);
    await store.completeRun(statusWork.run.id, "mac-mini-phase0", {
      leaseToken: statusWork.run.leaseToken,
      outcome: "succeeded",
      runtimeThreadId: "status-thread",
      output: { intent: "task_status", taskId: researchTaskId },
      errorSummary: null
    });

    const outboxRows = await database.query<{ text: string }>(
      "SELECT text FROM telegram_outbox WHERE chat_id = 901 ORDER BY created_at"
    );
    expect(outboxRows.some(({ text }) => text.includes("La pipeline include qualificazione"))).toBe(true);
    expect(outboxRows.some(({ text }) => text.startsWith("Sì.") && text.includes("qualificazione"))).toBe(true);

    const auditGaps = await database.query(
      `SELECT aggregate_type, aggregate_id
       FROM events
       GROUP BY aggregate_type, aggregate_id
       HAVING MIN(aggregate_version) <> 1
          OR MAX(aggregate_version) <> COUNT(*)`
    );
    expect(auditGaps).toEqual([]);
  });

  it("leases once under contention and recovers an expired in-flight run", async () => {
    await registerWorker();
    const seed = await store.ensurePhase0Seed();

    const leases = await Promise.all([
      store.leaseNextTask("mac-mini-phase0", 300),
      store.leaseNextTask("mac-mini-phase0", 300)
    ]);
    const first = leases.find((lease) => lease !== null);
    expect(first).toBeTruthy();
    expect(leases.filter(Boolean)).toHaveLength(1);
    if (!first) throw new Error("Expected one lease");

    await store.startRun(first.run.id, "mac-mini-phase0", first.run.leaseToken);
    await store.checkpointRun(
      first.run.id,
      "mac-mini-phase0",
      first.run.leaseToken,
      { stage: "before_crash" }
    );
    await database.query(
      "UPDATE tasks SET lease_expires_at = CURRENT_TIMESTAMP - INTERVAL '1 second' WHERE id = $1",
      [seed.task.id]
    );

    const recovered = await store.leaseNextTask("mac-mini-phase0", 300);
    expect(recovered).not.toBeNull();
    expect(recovered?.recovered).toBe(true);
    expect(recovered?.run.attempt).toBe(2);
    expect(recovered?.run.id).not.toBe(first.run.id);

    await expect(store.completeRun(first.run.id, "mac-mini-phase0", {
      leaseToken: first.run.leaseToken,
      outcome: "succeeded",
      runtimeThreadId: null,
      output: { stale: true },
      errorSummary: null
    })).rejects.toBeInstanceOf(StoreError);

    if (!recovered) throw new Error("Expected recovery lease");
    await store.startRun(recovered.run.id, "mac-mini-phase0", recovered.run.leaseToken);
    await store.completeRun(recovered.run.id, "mac-mini-phase0", {
      leaseToken: recovered.run.leaseToken,
      outcome: "succeeded",
      runtimeThreadId: "test-thread",
      output: { marker: "PHASE0_CODEX_OK" },
      errorSummary: null
    });

    const snapshot = await store.dashboardSnapshot();
    expect(snapshot.tasks.find((task) => task.id === seed.task.id)?.status).toBe("succeeded");
    expect(snapshot.runs.find((run) => run.id === first.run.id)?.status).toBe("interrupted");
    expect(snapshot.runs.find((run) => run.id === recovered.run.id)?.status).toBe("succeeded");

    const jsonTypes = await database.query<{ output_type: string; payload_type: string }>(
      `SELECT jsonb_typeof(r.output) AS output_type, jsonb_typeof(e.payload) AS payload_type
       FROM runs r JOIN events e ON e.run_id = r.id
       WHERE r.id = $1 AND r.output IS NOT NULL LIMIT 1`,
      [recovered.run.id]
    );
    expect(jsonTypes[0]).toEqual({ output_type: "object", payload_type: "object" });

    const auditGaps = await database.query(
      `SELECT aggregate_type, aggregate_id
       FROM events
       GROUP BY aggregate_type, aggregate_id
       HAVING MIN(aggregate_version) <> 1
          OR MAX(aggregate_version) <> COUNT(*)`
    );
    expect(auditGaps).toEqual([]);
  });

  it("renews an active run before its original deadline without duplicating it", async () => {
    await registerWorker();
    await store.ensurePhase0Seed();
    const work = await store.leaseNextTask("mac-mini-phase0", 1);
    if (!work) throw new Error("Expected work");
    await store.startRun(work.run.id, "mac-mini-phase0", work.run.leaseToken);
    const originalExpiry = new Date(work.task.leaseExpiresAt ?? 0).getTime();

    const renewed = await store.renewRunLease(
      work.run.id,
      "mac-mini-phase0",
      work.run.leaseToken,
      5
    );
    expect(new Date(renewed.leaseExpiresAt).getTime()).toBeGreaterThan(originalExpiry);
    await new Promise((resolve) => setTimeout(resolve, 1_100));

    expect(await store.leaseNextTask("mac-mini-phase0", 30)).toBeNull();
    const events = await database.query<{ type: string }>(
      "SELECT type FROM events WHERE task_id = $1 ORDER BY aggregate_version",
      [work.task.id]
    );
    expect(events.map((event) => event.type)).toContain("task.lease_renewed");
  });

  it("binds approve/reject to the immutable proposal hash", async () => {
    const { proposal } = await store.ensurePhase0Seed();
    const session = await store.createSession("c".repeat(64), 60);
    const principal = await store.getSessionPrincipal(session.token);
    if (!principal) throw new Error("Expected an authenticated principal");
    await expect(store.decideProposal(
      proposal.id,
      "approve",
      "0".repeat(64),
      "human-test",
      "stale card"
    )).rejects.toMatchObject({ code: "proposal_hash_mismatch" });

    const approved = await store.decideProposal(
      proposal.id,
      "approve",
      proposal.proposalHash,
      principal.actorFingerprint,
      "safe no-op"
    );
    expect(approved.status).toBe("approved");
    await expect(store.decideProposal(
      proposal.id,
      "reject",
      proposal.proposalHash,
      "human-test",
      "too late"
    )).rejects.toMatchObject({ code: "proposal_already_decided" });

    const decisions = await database.query<{ decision: string; proposal_hash: string; actor: string }>(
      "SELECT decision, proposal_hash, actor FROM proposal_decisions WHERE proposal_id = $1",
      [proposal.id]
    );
    expect(decisions).toEqual([{
      decision: "approve",
      proposal_hash: proposal.proposalHash,
      actor: principal.actorFingerprint
    }]);
    const approvalEvent = await database.query<{ actor_id: string }>(
      "SELECT actor_id FROM events WHERE proposal_id = $1 AND type = 'proposal.approved'",
      [proposal.id]
    );
    expect(approvalEvent[0]?.actor_id).toBe(principal.actorFingerprint);
  });

  it("records rejection through the same hash-bound decision path", async () => {
    const { proposal } = await store.ensurePhase0Seed();
    const rejected = await store.decideProposal(
      proposal.id,
      "reject",
      proposal.proposalHash,
      "human-test",
      "not approved"
    );
    expect(rejected.status).toBe("rejected");
    const events = await database.query<{ type: string }>(
      "SELECT type FROM events WHERE proposal_id = $1 ORDER BY aggregate_version",
      [proposal.id]
    );
    expect(events.map((event) => event.type)).toEqual(["proposal.created", "proposal.rejected"]);
  });

  it("records the Git publication saga idempotently with continuous audit versions", async () => {
    const work = await startRepoUpdateRun();
    expect(work.task.risk).toBe("medium");
    const correlationId = randomUUID();
    const baseSha = "a".repeat(40);
    const treeSha = "b".repeat(40);
    const commitSha = "c".repeat(40);

    expect(await store.recordGitPublication(
      work.run.id,
      work.run.workerId,
      { action: "inspect", leaseToken: work.run.leaseToken },
      correlationId
    )).toBeNull();

    const planned = requirePublication(await store.recordGitPublication(
      work.run.id,
      work.run.workerId,
      {
        action: "plan",
        leaseToken: work.run.leaseToken,
        remote: "origin",
        branch: "automation/repo-update",
        baseSha
      },
      correlationId
    ));
    expect(planned).toMatchObject({
      taskId: work.task.id,
      currentRunId: work.run.id,
      currentWorkerId: work.run.workerId,
      remote: "origin",
      targetBranch: "automation/repo-update",
      baseSha,
      stage: "planned",
      version: 1
    });

    const duplicatePlan = requirePublication(await store.recordGitPublication(
      work.run.id,
      work.run.workerId,
      {
        action: "plan",
        leaseToken: work.run.leaseToken,
        remote: "origin",
        branch: "automation/repo-update",
        baseSha
      },
      correlationId
    ));
    expect(duplicatePlan.id).toBe(planned.id);
    expect(duplicatePlan.version).toBe(1);

    const failed = requirePublication(await store.recordGitPublication(
      work.run.id,
      work.run.workerId,
      {
        action: "fail",
        leaseToken: work.run.leaseToken,
        errorCode: "git_auth_failed",
        retryable: true
      },
      correlationId
    ));
    expect(failed).toMatchObject({
      stage: "planned",
      lastErrorCode: "git_auth_failed",
      retryable: true,
      version: 2
    });
    const duplicateFailure = requirePublication(await store.recordGitPublication(
      work.run.id,
      work.run.workerId,
      {
        action: "fail",
        leaseToken: work.run.leaseToken,
        errorCode: "git_auth_failed",
        retryable: true
      },
      correlationId
    ));
    expect(duplicateFailure.version).toBe(2);

    const committed = requirePublication(await store.recordGitPublication(
      work.run.id,
      work.run.workerId,
      {
        action: "commit",
        leaseToken: work.run.leaseToken,
        treeSha,
        commitSha
      },
      correlationId
    ));
    expect(committed).toMatchObject({
      stage: "committed",
      treeSha,
      commitSha,
      lastErrorCode: null,
      retryable: null,
      version: 3
    });
    expect(requirePublication(await store.recordGitPublication(
      work.run.id,
      work.run.workerId,
      {
        action: "commit",
        leaseToken: work.run.leaseToken,
        treeSha,
        commitSha
      },
      correlationId
    )).version).toBe(3);

    const pushed = requirePublication(await store.recordGitPublication(
      work.run.id,
      work.run.workerId,
      { action: "push", leaseToken: work.run.leaseToken, remoteSha: commitSha },
      correlationId
    ));
    expect(pushed).toMatchObject({ stage: "pushed", remoteSha: commitSha, version: 4 });
    expect(requirePublication(await store.recordGitPublication(
      work.run.id,
      work.run.workerId,
      { action: "push", leaseToken: work.run.leaseToken, remoteSha: commitSha },
      correlationId
    )).version).toBe(4);

    const verified = requirePublication(await store.recordGitPublication(
      work.run.id,
      work.run.workerId,
      { action: "verify", leaseToken: work.run.leaseToken, remoteSha: commitSha },
      correlationId
    ));
    expect(verified).toMatchObject({
      stage: "verified",
      remoteSha: commitSha,
      lastErrorCode: null,
      retryable: null,
      version: 5
    });
    expect(requirePublication(await store.recordGitPublication(
      work.run.id,
      work.run.workerId,
      { action: "verify", leaseToken: work.run.leaseToken, remoteSha: commitSha },
      correlationId
    )).version).toBe(5);

    const events = await database.query<{
      type: string;
      aggregate_version: number;
      correlation_id: string;
    }>(
      `SELECT type, aggregate_version, correlation_id
       FROM events
       WHERE aggregate_type = 'git_publication' AND aggregate_id = $1
       ORDER BY aggregate_version`,
      [planned.id]
    );
    expect(events.map((event) => event.type)).toEqual([
      "git.publish_planned",
      "git.publish_failed",
      "git.commit_created",
      "git.push_recorded",
      "git.push_verified"
    ]);
    expect(events.map((event) => Number(event.aggregate_version))).toEqual([1, 2, 3, 4, 5]);
    expect(events.every((event) => event.correlation_id === correlationId)).toBe(true);

    const capabilityRequests = await database.query<{ dedupe_key: string }>(
      "SELECT dedupe_key FROM capability_requests WHERE dedupe_key = 'git:publish:origin'"
    );
    expect(capabilityRequests).toEqual([{ dedupe_key: "git:publish:origin" }]);

    await database.query(
      "UPDATE tasks SET lease_expires_at = CURRENT_TIMESTAMP - INTERVAL '1 second' WHERE id = $1",
      [work.task.id]
    );
    const recovered = await store.leaseNextTask(work.run.workerId, 300);
    if (!recovered) throw new Error("Expected recovered verified work");
    await store.startRun(recovered.run.id, recovered.run.workerId, recovered.run.leaseToken);
    const terminal = requirePublication(await store.recordGitPublication(
      recovered.run.id,
      recovered.run.workerId,
      {
        action: "plan",
        leaseToken: recovered.run.leaseToken,
        remote: "origin",
        branch: "automation/repo-update",
        baseSha
      },
      correlationId
    ));
    expect(terminal).toMatchObject({
      stage: "verified",
      currentRunId: work.run.id,
      version: 5
    });
    const terminalEvents = await database.query<{ type: string }>(
      `SELECT type FROM events
       WHERE aggregate_type = 'git_publication' AND aggregate_id = $1
       ORDER BY aggregate_version`,
      [planned.id]
    );
    expect(terminalEvents.map((event) => event.type)).toEqual([
      "git.publish_planned",
      "git.publish_failed",
      "git.commit_created",
      "git.push_recorded",
      "git.push_verified"
    ]);
    const completed = await store.completeRun(recovered.run.id, recovered.run.workerId, {
      leaseToken: recovered.run.leaseToken,
      outcome: "succeeded",
      runtimeThreadId: null,
      output: { publicationId: terminal.id },
      errorSummary: null
    });
    expect(completed.task.status).toBe("succeeded");
    expect(completed.run.status).toBe("succeeded");
  });

  it("rejects conflicting Git publication values and remote verification mismatches", async () => {
    const work = await startRepoUpdateRun();
    const baseSha = "1".repeat(40);
    const treeSha = "2".repeat(40);
    const commitSha = "3".repeat(40);
    const conflictingSha = "4".repeat(40);

    await store.recordGitPublication(work.run.id, work.run.workerId, {
      action: "plan",
      leaseToken: work.run.leaseToken,
      remote: "origin",
      branch: "automation/conflict-test",
      baseSha
    });
    await expect(store.recordGitPublication(work.run.id, work.run.workerId, {
      action: "plan",
      leaseToken: work.run.leaseToken,
      remote: "upstream",
      branch: "automation/conflict-test",
      baseSha
    })).rejects.toMatchObject({ code: "git_publication_conflict" });
    await expect(store.recordGitPublication(work.run.id, work.run.workerId, {
      action: "push",
      leaseToken: work.run.leaseToken,
      remoteSha: commitSha
    })).rejects.toMatchObject({ code: "git_publication_invalid_transition" });

    await store.recordGitPublication(work.run.id, work.run.workerId, {
      action: "commit",
      leaseToken: work.run.leaseToken,
      treeSha,
      commitSha
    });
    await expect(store.recordGitPublication(work.run.id, work.run.workerId, {
      action: "commit",
      leaseToken: work.run.leaseToken,
      treeSha,
      commitSha: conflictingSha
    })).rejects.toMatchObject({ code: "git_publication_conflict" });

    await store.recordGitPublication(work.run.id, work.run.workerId, {
      action: "push",
      leaseToken: work.run.leaseToken,
      remoteSha: commitSha
    });
    await expect(store.recordGitPublication(work.run.id, work.run.workerId, {
      action: "push",
      leaseToken: work.run.leaseToken,
      remoteSha: conflictingSha
    })).rejects.toMatchObject({ code: "git_publication_conflict" });
    await expect(store.recordGitPublication(work.run.id, work.run.workerId, {
      action: "verify",
      leaseToken: work.run.leaseToken,
      remoteSha: conflictingSha
    })).rejects.toMatchObject({ code: "git_remote_sha_mismatch" });
  });

  it("resumes a task-scoped Git publication on a recovered active run", async () => {
    const first = await startRepoUpdateRun();
    const baseSha = "5".repeat(40);
    const treeSha = "6".repeat(40);
    const commitSha = "7".repeat(40);
    const planned = requirePublication(await store.recordGitPublication(
      first.run.id,
      first.run.workerId,
      {
        action: "plan",
        leaseToken: first.run.leaseToken,
        remote: "origin",
        branch: "automation/recovery-test",
        baseSha
      }
    ));
    await store.recordGitPublication(first.run.id, first.run.workerId, {
      action: "commit",
      leaseToken: first.run.leaseToken,
      treeSha,
      commitSha
    });
    await database.query(
      "UPDATE tasks SET lease_expires_at = CURRENT_TIMESTAMP - INTERVAL '1 second' WHERE id = $1",
      [first.task.id]
    );

    const recovered = await store.leaseNextTask(first.run.workerId, 300);
    if (!recovered) throw new Error("Expected recovered repo.update work");
    await store.startRun(recovered.run.id, recovered.run.workerId, recovered.run.leaseToken);
    const inspected = requirePublication(await store.recordGitPublication(
      recovered.run.id,
      recovered.run.workerId,
      { action: "inspect", leaseToken: recovered.run.leaseToken }
    ));
    expect(inspected).toMatchObject({
      id: planned.id,
      currentRunId: first.run.id,
      stage: "committed",
      commitSha
    });

    const resumed = requirePublication(await store.recordGitPublication(
      recovered.run.id,
      recovered.run.workerId,
      {
        action: "plan",
        leaseToken: recovered.run.leaseToken,
        remote: "origin",
        branch: "automation/recovery-test",
        baseSha
      }
    ));
    expect(resumed).toMatchObject({
      id: planned.id,
      currentRunId: recovered.run.id,
      currentWorkerId: recovered.run.workerId,
      stage: "committed",
      commitSha,
      version: 3
    });
    expect(requirePublication(await store.recordGitPublication(
      recovered.run.id,
      recovered.run.workerId,
      {
        action: "plan",
        leaseToken: recovered.run.leaseToken,
        remote: "origin",
        branch: "automation/recovery-test",
        baseSha
      }
    )).version).toBe(3);

    const events = await database.query<{ type: string; aggregate_version: number }>(
      `SELECT type, aggregate_version FROM events
       WHERE aggregate_type = 'git_publication' AND aggregate_id = $1
       ORDER BY aggregate_version`,
      [planned.id]
    );
    expect(events.map((event) => event.type)).toEqual([
      "git.publish_planned",
      "git.commit_created",
      "git.publish_resumed"
    ]);
    expect(events.map((event) => Number(event.aggregate_version))).toEqual([1, 2, 3]);
  });

  it("records no_changes as a terminal idempotent publication without resuming it", async () => {
    const first = await startRepoUpdateRun();
    const baseSha = "8".repeat(40);
    const planned = requirePublication(await store.recordGitPublication(
      first.run.id,
      first.run.workerId,
      {
        action: "plan",
        leaseToken: first.run.leaseToken,
        remote: "origin",
        branch: "automation/no-changes",
        baseSha
      }
    ));
    const noChanges = requirePublication(await store.recordGitPublication(
      first.run.id,
      first.run.workerId,
      { action: "no_changes", leaseToken: first.run.leaseToken }
    ));
    expect(noChanges).toMatchObject({
      id: planned.id,
      stage: "no_changes",
      treeSha: null,
      commitSha: null,
      remoteSha: null,
      version: 2
    });
    expect(requirePublication(await store.recordGitPublication(
      first.run.id,
      first.run.workerId,
      { action: "no_changes", leaseToken: first.run.leaseToken }
    )).version).toBe(2);

    await database.query(
      "UPDATE tasks SET lease_expires_at = CURRENT_TIMESTAMP - INTERVAL '1 second' WHERE id = $1",
      [first.task.id]
    );
    const recovered = await store.leaseNextTask(first.run.workerId, 300);
    if (!recovered) throw new Error("Expected recovered repo.update work");
    await store.startRun(recovered.run.id, recovered.run.workerId, recovered.run.leaseToken);
    const terminal = requirePublication(await store.recordGitPublication(
      recovered.run.id,
      recovered.run.workerId,
      {
        action: "plan",
        leaseToken: recovered.run.leaseToken,
        remote: "origin",
        branch: "automation/no-changes",
        baseSha
      }
    ));
    expect(terminal).toMatchObject({
      stage: "no_changes",
      currentRunId: first.run.id,
      version: 2
    });
    expect(requirePublication(await store.recordGitPublication(
      recovered.run.id,
      recovered.run.workerId,
      { action: "no_changes", leaseToken: recovered.run.leaseToken }
    )).version).toBe(2);

    const events = await database.query<{ type: string }>(
      `SELECT type FROM events
       WHERE aggregate_type = 'git_publication' AND aggregate_id = $1
       ORDER BY aggregate_version`,
      [planned.id]
    );
    expect(events.map((event) => event.type)).toEqual([
      "git.publish_planned",
      "git.no_changes"
    ]);
  });

  it("requires an active matching lease before reading or mutating Git publication state", async () => {
    const work = await startRepoUpdateRun();
    await expect(store.recordGitPublication(work.run.id, work.run.workerId, {
      action: "inspect",
      leaseToken: randomUUID()
    })).rejects.toMatchObject({ code: "stale_lease" });

    await database.query(
      "UPDATE tasks SET lease_expires_at = CURRENT_TIMESTAMP - INTERVAL '1 second' WHERE id = $1",
      [work.task.id]
    );
    await expect(store.recordGitPublication(work.run.id, work.run.workerId, {
      action: "plan",
      leaseToken: work.run.leaseToken,
      remote: "origin",
      branch: "automation/expired-lease",
      baseSha: "9".repeat(40)
    })).rejects.toMatchObject({ code: "expired_lease" });

    const rows = await database.query<{ count: number }>(
      "SELECT COUNT(*)::integer AS count FROM git_publications"
    );
    expect(Number(rows[0]?.count)).toBe(0);
  });

  it("fails closed when a repo.update run completes before a terminal Git publication", async () => {
    const work = await startRepoUpdateRun();
    const completion = {
      leaseToken: work.run.leaseToken,
      outcome: "succeeded" as const,
      runtimeThreadId: null,
      output: null,
      errorSummary: null
    };
    await expect(store.completeRun(
      work.run.id,
      work.run.workerId,
      completion
    )).rejects.toMatchObject({ code: "git_publication_incomplete" });
    const stillActive = await database.query<{
      task_status: string;
      run_status: string;
      task_lease_token: string | null;
    }>(
      `SELECT t.status AS task_status, r.status AS run_status,
         t.lease_token AS task_lease_token
       FROM tasks t JOIN runs r ON r.task_id = t.id
       WHERE r.id = $1`,
      [work.run.id]
    );
    expect(stillActive[0]).toEqual({
      task_status: "running",
      run_status: "running",
      task_lease_token: work.run.leaseToken
    });

    await store.recordGitPublication(work.run.id, work.run.workerId, {
      action: "plan",
      leaseToken: work.run.leaseToken,
      remote: "origin",
      branch: "automation/completion-gate",
      baseSha: "d".repeat(40)
    });
    await expect(store.completeRun(
      work.run.id,
      work.run.workerId,
      completion
    )).rejects.toMatchObject({ code: "git_publication_incomplete" });

    await store.recordGitPublication(work.run.id, work.run.workerId, {
      action: "no_changes",
      leaseToken: work.run.leaseToken
    });
    const completed = await store.completeRun(
      work.run.id,
      work.run.workerId,
      completion
    );
    expect(completed.task.status).toBe("succeeded");
    expect(completed.run.status).toBe("succeeded");
  });

  it("validates logical remotes, automation branches, SHAs, and Git error codes", () => {
    const leaseToken = randomUUID();
    const baseSha = "a".repeat(40);
    expect(GitPublicationCommandSchema.safeParse({
      action: "plan",
      leaseToken,
      remote: "origin",
      branch: "automation/safe-update",
      baseSha
    }).success).toBe(true);
    expect(GitPublicationCommandSchema.safeParse({
      action: "plan",
      leaseToken,
      remote: "https://example.test/repo.git",
      branch: "automation/safe-update",
      baseSha
    }).success).toBe(false);
    expect(GitPublicationCommandSchema.safeParse({
      action: "plan",
      leaseToken,
      remote: "origin",
      branch: "main",
      baseSha
    }).success).toBe(false);
    expect(GitPublicationCommandSchema.safeParse({
      action: "plan",
      leaseToken,
      remote: "origin",
      branch: "automation/path/.hidden",
      baseSha
    }).success).toBe(false);
    expect(GitPublicationCommandSchema.safeParse({
      action: "commit",
      leaseToken,
      treeSha: "not-a-sha",
      commitSha: baseSha
    }).success).toBe(false);
    expect(GitPublicationCommandSchema.safeParse({
      action: "fail",
      leaseToken,
      errorCode: "secret value",
      retryable: false
    }).success).toBe(false);
  });

  it("keeps audit events append-only", async () => {
    await store.ensurePhase0Seed();
    await expect(database.query("UPDATE events SET type = 'tampered'")).rejects.toThrow(/append-only/);
    await expect(database.query("DELETE FROM events")).rejects.toThrow(/append-only/);
  });
});
