import { describe, expect, it } from "vitest";
import type {
  AgentContinuation,
  AgentRun,
  AgentRunState,
  AgentRuntime,
  AgentTaskInput
} from "@meaworld/codex";
import type {
  GitPublicationCommand,
  GitPublicationRecord,
  TaskRecord
} from "@meaworld/domain";
import type { RepositoryPublisher } from "@meaworld/git";
import { GitUpdateCoordinator } from "../apps/worker/src/git-coordinator";

const TASK_ID = "11111111-1111-4111-8111-111111111111";
const RUN_ID = "22222222-2222-4222-8222-222222222222";
const LEASE_TOKEN = "33333333-3333-4333-8333-333333333333";
const PUBLICATION_ID = "44444444-4444-4444-8444-444444444444";
const BASE_SHA = "a".repeat(40);
const TREE_SHA = "b".repeat(40);
const COMMIT_SHA = "c".repeat(40);

const task: TaskRecord = {
  id: TASK_ID,
  kind: "repo.update",
  objective: "Update the repository",
  status: "running",
  priority: 50,
  risk: "medium",
  payload: { prompt: "Create a bounded documentation update." },
  dedupeKey: "repo:update:test",
  assignedWorkerId: "worker",
  leaseToken: LEASE_TOKEN,
  leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
  attemptCount: 1,
  maxAttempts: 3,
  version: 2,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
};

function publication(stage: GitPublicationRecord["stage"] = "planned"): GitPublicationRecord {
  const hasCommit = ["committed", "pushed", "verified"].includes(stage);
  const hasRemote = ["pushed", "verified"].includes(stage);
  return {
    id: PUBLICATION_ID,
    taskId: TASK_ID,
    currentRunId: RUN_ID,
    currentWorkerId: "worker",
    remote: "origin",
    targetBranch: "automation/phase0-updates",
    baseSha: BASE_SHA,
    treeSha: hasCommit ? TREE_SHA : null,
    commitSha: hasCommit ? COMMIT_SHA : null,
    remoteSha: hasRemote ? COMMIT_SHA : null,
    stage,
    lastErrorCode: null,
    retryable: null,
    version: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

class FakeRuntime implements AgentRuntime {
  inputs: AgentTaskInput[] = [];

  async start(input: AgentTaskInput): Promise<AgentRun> {
    this.inputs.push(input);
    return {
      runId: input.runId,
      runtimeThreadId: "thread",
      status: "succeeded",
      finalResponse: "not persisted",
      usage: { inputTokens: 1 }
    };
  }

  resume(input: AgentContinuation): Promise<AgentRun> {
    return this.start(input);
  }

  async cancel(): Promise<void> {}

  async inspect(runId: string): Promise<AgentRunState> {
    return { runId, status: "succeeded" };
  }
}

class FakePublicationClient {
  current: GitPublicationRecord | null;
  actions: GitPublicationCommand["action"][] = [];
  checkpoints: Array<Record<string, unknown>> = [];

  constructor(initial: GitPublicationRecord | null = null) {
    this.current = initial;
  }

  async checkpoint(
    _runId: string,
    _leaseToken: string,
    checkpoint: Record<string, unknown>
  ): Promise<{ sequence: number }> {
    this.checkpoints.push(checkpoint);
    return { sequence: this.checkpoints.length };
  }

  async recordGitPublication(
    _runId: string,
    command: GitPublicationCommand
  ): Promise<{ publication: GitPublicationRecord | null }> {
    this.actions.push(command.action);
    if (command.action === "inspect") return { publication: this.current };
    if (command.action === "plan") {
      this.current ??= publication("planned");
    } else if (command.action === "commit" && this.current) {
      this.current = { ...this.current, stage: "committed", treeSha: command.treeSha, commitSha: command.commitSha };
    } else if (command.action === "push" && this.current) {
      this.current = { ...this.current, stage: "pushed", remoteSha: command.remoteSha };
    } else if (command.action === "verify" && this.current) {
      this.current = { ...this.current, stage: "verified", remoteSha: command.remoteSha };
    } else if (command.action === "no_changes" && this.current) {
      this.current = { ...this.current, stage: "no_changes" };
    }
    return { publication: this.current };
  }
}

function fakePublisher(commitStatus: "committed" | "noop" = "committed") {
  let pushes = 0;
  let cleanups = 0;
  const publisher: Pick<RepositoryPublisher,
    "resolveBase" | "prepareWorkspace" | "inspectTaskCommit" |
    "validateAndCommit" | "pushAndVerify" | "cleanup"
  > = {
    async resolveBase() { return BASE_SHA; },
    async prepareWorkspace() {
      return { taskId: TASK_ID, path: "/tmp/fake-worktree", branch: `meaworld-task/${TASK_ID}`, baseSha: BASE_SHA };
    },
    async inspectTaskCommit() { return null; },
    async validateAndCommit() {
      return commitStatus === "noop"
        ? { status: "noop", headSha: BASE_SHA }
        : { status: "committed", commitSha: COMMIT_SHA, treeSha: TREE_SHA };
    },
    async pushAndVerify() {
      pushes += 1;
      return { commitSha: COMMIT_SHA, remoteSha: COMMIT_SHA, remoteBranch: "automation/phase0-updates" };
    },
    async cleanup() { cleanups += 1; }
  };
  return { publisher, pushes: () => pushes, cleanups: () => cleanups };
}

function coordinator(client: FakePublicationClient, publisher: ReturnType<typeof fakePublisher>["publisher"]) {
  return new GitUpdateCoordinator({
    enabled: true,
    repositoryRoot: "/tmp/repository",
    stateDirectory: "/tmp/repository/.phase0/git-publisher",
    remote: "origin",
    baseBranch: "main",
    targetBranch: "automation/phase0-updates",
    validationTimeoutMs: 60_000
  }, client, publisher);
}

describe("Git update coordinator", () => {
  it("runs Codex, records the saga, and succeeds only after remote verification", async () => {
    const client = new FakePublicationClient();
    const git = fakePublisher();
    const runtime = new FakeRuntime();
    const result = await coordinator(client, git.publisher).execute({
      task,
      runId: RUN_ID,
      leaseToken: LEASE_TOKEN,
      correlationId: "55555555-5555-4555-8555-555555555555",
      runtime
    });

    expect(result.outcome).toBe("succeeded");
    expect(result.output).toMatchObject({
      git: {
        status: "published",
        commitSha: COMMIT_SHA,
        remoteSha: COMMIT_SHA
      }
    });
    expect(client.actions).toEqual(["inspect", "plan", "commit", "push", "verify"]);
    expect(runtime.inputs[0]).toMatchObject({ sandboxMode: "workspace-write", networkAccessEnabled: false });
    expect(git.pushes()).toBe(1);
    expect(git.cleanups()).toBe(1);
  });

  it("reconciles a verified publication without rerunning Codex", async () => {
    const client = new FakePublicationClient(publication("verified"));
    const git = fakePublisher();
    const runtime = new FakeRuntime();
    const result = await coordinator(client, git.publisher).execute({
      task,
      runId: RUN_ID,
      leaseToken: LEASE_TOKEN,
      correlationId: "55555555-5555-4555-8555-555555555555",
      runtime
    });

    expect(result).toMatchObject({ outcome: "succeeded", output: { recovered: true } });
    expect(client.actions).toEqual(["inspect", "plan"]);
    expect(runtime.inputs).toEqual([]);
    expect(git.pushes()).toBe(0);
  });

  it("records a no-change terminal result without pushing", async () => {
    const client = new FakePublicationClient();
    const git = fakePublisher("noop");
    const result = await coordinator(client, git.publisher).execute({
      task,
      runId: RUN_ID,
      leaseToken: LEASE_TOKEN,
      correlationId: "55555555-5555-4555-8555-555555555555",
      runtime: new FakeRuntime()
    });

    expect(result).toMatchObject({ outcome: "succeeded", output: { git: { status: "no_changes" } } });
    expect(client.actions).toEqual(["inspect", "plan", "no_changes"]);
    expect(git.pushes()).toBe(0);
    expect(git.cleanups()).toBe(1);
  });
});
