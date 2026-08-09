import { randomUUID } from "node:crypto";
import { CodexSdkRuntime, type AgentRuntime } from "@meaworld/codex";
import { log } from "@meaworld/observability";
import { executeTask } from "@meaworld/orchestration";
import { WorkerApiClient } from "./client.js";
import type { WorkerConfig } from "./config.js";
import { GitUpdateCoordinator } from "./git-coordinator.js";

const sleep = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

export class Phase0Worker {
  private readonly bootId = randomUUID();
  private readonly client: WorkerApiClient;
  private readonly runtime: AgentRuntime;
  private readonly gitUpdates: GitUpdateCoordinator;
  private sequence = 0;
  private activeRunId: string | null = null;
  private stopping = false;

  constructor(
    private readonly config: WorkerConfig,
    runtime: AgentRuntime = new CodexSdkRuntime()
  ) {
    this.client = new WorkerApiClient(config.baseUrl, config.id, config.secret);
    this.runtime = runtime;
    this.gitUpdates = new GitUpdateCoordinator({
      enabled: config.gitAutoPublishEnabled,
      repositoryRoot: config.codexWorkingDirectory,
      stateDirectory: config.gitStateDirectory,
      remote: config.gitRemote,
      baseBranch: config.gitBaseBranch,
      targetBranch: config.gitTargetBranch,
      validationTimeoutMs: config.gitValidationTimeoutMs
    }, this.client);
  }

  stop(): void {
    this.stopping = true;
  }

  async heartbeat(): Promise<void> {
    this.sequence += 1;
    await this.client.heartbeat({
      workerId: this.config.id,
      displayName: this.config.displayName,
      bootId: this.bootId,
      sequence: this.sequence,
      version: this.config.version,
      activeRunId: this.activeRunId,
      sentAt: new Date().toISOString()
    });
    log({
      level: "info",
      event: "worker.heartbeat_sent",
      message: "Worker heartbeat accepted",
      runId: this.activeRunId ?? undefined,
      data: { bootId: this.bootId, sequence: this.sequence }
    });
  }

  async processOneTask(): Promise<boolean> {
    const { work } = await this.client.lease(this.config.leaseSeconds);
    if (!work) return false;

    this.activeRunId = work.run.id;
    const correlationId = randomUUID();
    try {
      await this.heartbeat();
      log({
        level: "info",
        event: work.recovered ? "worker.task_recovered" : "worker.task_leased",
        message: "Worker leased a durable task",
        taskId: work.task.id,
        runId: work.run.id,
        data: { attempt: work.run.attempt, kind: work.task.kind }
      });

      await this.client.startRun(work.run.id, work.run.leaseToken, correlationId);
      await this.client.checkpoint(work.run.id, work.run.leaseToken, {
        stage: "runtime_starting",
        recordedAt: new Date().toISOString()
      }, correlationId);

      let renewalFailure: unknown;
      let renewalQueue = Promise.resolve();
      const renewalIntervalMs = Math.max(5_000, Math.floor(this.config.leaseSeconds * 1_000 / 3));
      const renewalTimer = setInterval(() => {
        renewalQueue = renewalQueue.then(async () => {
          if (renewalFailure) return;
          try {
            await this.client.renewLease(
              work.run.id,
              work.run.leaseToken,
              this.config.leaseSeconds,
              correlationId
            );
          } catch (error) {
            renewalFailure = error;
            log({
              level: "error",
              event: "worker.lease_renewal_failed",
              message: error instanceof Error ? error.message : "Unknown lease renewal error",
              taskId: work.task.id,
              runId: work.run.id
            });
          }
        });
      }, renewalIntervalMs);

      let result: Awaited<ReturnType<typeof executeTask>>;
      try {
        result = work.task.kind === "repo.update"
          ? await this.gitUpdates.execute({
              task: work.task,
              runId: work.run.id,
              leaseToken: work.run.leaseToken,
              correlationId,
              runtime: this.runtime
            })
          : await executeTask({
              task: work.task,
              runId: work.run.id,
              runtime: this.runtime,
              workingDirectory: this.config.codexWorkingDirectory
            });
      } finally {
        clearInterval(renewalTimer);
        await renewalQueue;
      }
      if (renewalFailure) throw renewalFailure;

      await this.client.completeRun(work.run.id, {
        leaseToken: work.run.leaseToken,
        outcome: result.outcome,
        runtimeThreadId: result.runtimeThreadId,
        output: result.output,
        errorSummary: result.errorSummary
      }, correlationId);
      log({
        level: result.outcome === "succeeded" ? "info" : "warn",
        event: `worker.task_${result.outcome}`,
        message: "Worker persisted the task result",
        taskId: work.task.id,
        runId: work.run.id,
        data: { outcome: result.outcome }
      });
      return true;
    } finally {
      this.activeRunId = null;
      await this.heartbeat().catch((error: unknown) => {
        log({
          level: "error",
          event: "worker.heartbeat_failed",
          message: error instanceof Error ? error.message : "Unknown worker heartbeat error"
        });
      });
    }
  }

  async runOnce(): Promise<void> {
    await this.heartbeat();
    await this.processOneTask();
    await this.heartbeat();
  }

  async crashAfterCheckpoint(): Promise<never> {
    await this.heartbeat();
    const { work } = await this.client.lease(this.config.leaseSeconds);
    if (!work) throw new Error("No recovery smoke task is ready");
    this.activeRunId = work.run.id;
    await this.client.startRun(work.run.id, work.run.leaseToken);
    await this.client.checkpoint(work.run.id, work.run.leaseToken, {
      stage: "intentional_crash",
      recordedAt: new Date().toISOString()
    });
    log({
      level: "warn",
      event: "worker.intentional_crash",
      message: "Terminating after a durable checkpoint to exercise lease recovery",
      taskId: work.task.id,
      runId: work.run.id
    });
    process.kill(process.pid, "SIGKILL");
    throw new Error("SIGKILL did not terminate the worker");
  }

  async runDaemon(): Promise<void> {
    await this.heartbeat();
    const heartbeatTimer = setInterval(() => {
      void this.heartbeat().catch((error: unknown) => {
        log({
          level: "error",
          event: "worker.heartbeat_failed",
          message: error instanceof Error ? error.message : "Unknown heartbeat error"
        });
      });
    }, this.config.heartbeatIntervalMs);

    try {
      while (!this.stopping) {
        try {
          const processed = await this.processOneTask();
          if (!processed) await sleep(Math.min(this.config.heartbeatIntervalMs, 10_000));
        } catch (error) {
          log({
            level: "error",
            event: "worker.loop_failed",
            message: error instanceof Error ? error.message : "Unknown worker loop error",
            runId: this.activeRunId ?? undefined
          });
          this.activeRunId = null;
          await sleep(5_000);
        }
      }
    } finally {
      clearInterval(heartbeatTimer);
      await this.heartbeat().catch(() => undefined);
    }
  }
}
