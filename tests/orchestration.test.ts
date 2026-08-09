import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CodexSdkRuntime,
  type AgentRuntime,
  type AgentTaskInput,
  type AgentContinuation,
  type AgentRun,
  type AgentRunState
} from "@meaworld/codex";
import type { TaskRecord } from "@meaworld/domain";
import { executeTask } from "@meaworld/orchestration";

class FakeRuntime implements AgentRuntime {
  readonly starts: AgentTaskInput[] = [];

  constructor(
    private readonly response: string,
    private readonly status: AgentRun["status"] = "succeeded",
    private readonly error?: unknown
  ) {}

  async start(input: AgentTaskInput): Promise<AgentRun> {
    this.starts.push(input);
    if (this.error !== undefined) throw this.error;
    return {
      runId: input.runId,
      runtimeThreadId: "fake-thread",
      status: this.status,
      finalResponse: this.response,
      usage: { inputTokens: 1 }
    };
  }
  resume(input: AgentContinuation): Promise<AgentRun> { return this.start(input); }
  async cancel(): Promise<void> {}
  async inspect(runId: string): Promise<AgentRunState> { return { runId, status: "succeeded" }; }
}

const smokeTask: TaskRecord = {
  id: "c3b3913d-894e-4a8a-8d75-c491ab007fcb",
  kind: "phase0.codex-smoke",
  objective: "smoke",
  status: "running",
  priority: 100,
  risk: "low",
  payload: { prompt: "Return exactly PHASE0_CODEX_OK" },
  dedupeKey: "phase0:test",
  assignedWorkerId: "worker",
  leaseToken: "c89d557b-47ce-4ca2-af2e-5c94056796f4",
  leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
  attemptCount: 1,
  maxAttempts: 3,
  version: 2,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
};

function taskWith(kind: string, payload: Record<string, unknown>): TaskRecord {
  return { ...smokeTask, kind, objective: kind, payload };
}

describe("Codex SDK runtime", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("passes explicit permissions and safe defaults to start and resume", async () => {
    const runtime = new CodexSdkRuntime({ codexPathOverride: "/nonexistent/codex" });
    const codex = (runtime as unknown as {
      codex: {
        startThread(options: Record<string, unknown>): unknown;
        resumeThread(id: string, options: Record<string, unknown>): unknown;
      };
    }).codex;
    const thread = {
      id: "sdk-thread",
      run: vi.fn().mockResolvedValue({ finalResponse: "done", usage: null })
    };
    const startThread = vi.spyOn(codex, "startThread").mockReturnValue(thread);
    const resumeThread = vi.spyOn(codex, "resumeThread").mockReturnValue(thread);

    await runtime.start({
      runId: "start-run",
      prompt: "start",
      workingDirectory: "/tmp/worktree",
      sandboxMode: "workspace-write",
      networkAccessEnabled: true
    });
    expect(startThread).toHaveBeenCalledWith({
      workingDirectory: "/tmp/worktree",
      sandboxMode: "workspace-write",
      approvalPolicy: "never",
      networkAccessEnabled: true,
      webSearchMode: "disabled",
      skipGitRepoCheck: false
    });

    await runtime.resume({
      runId: "resume-run",
      runtimeThreadId: "existing-thread",
      prompt: "resume",
      workingDirectory: "/tmp/worktree"
    });
    expect(resumeThread).toHaveBeenCalledWith("existing-thread", {
      workingDirectory: "/tmp/worktree",
      sandboxMode: "read-only",
      approvalPolicy: "never",
      networkAccessEnabled: false,
      webSearchMode: "disabled",
      skipGitRepoCheck: false
    });
  });

  it("constructs Codex with only the allowlisted process environment", async () => {
    vi.stubEnv("CODEX_HOME", "/tmp/codex-home");
    vi.stubEnv("LC_TEST", "it_IT");
    vi.stubEnv("HTTPS_PROXY", "http://proxy.invalid");
    vi.stubEnv("NOTION_TOKEN", "notion-placeholder");
    vi.stubEnv("WORKER_SECRET", "worker-placeholder");
    vi.stubEnv("SESSION_SECRET", "session-placeholder");
    vi.stubEnv("DASHBOARD_ACCESS_CODE", "dashboard-placeholder");
    vi.stubEnv("OPENAI_API_KEY", "openai-placeholder");
    vi.stubEnv("DATABASE_URL", "postgres://project-placeholder");

    const runtime = new CodexSdkRuntime({ codexPathOverride: "/nonexistent/codex" });
    const env = (runtime as unknown as {
      codex: { exec: { envOverride: Record<string, string> } };
    }).codex.exec.envOverride;
    expect(env).toMatchObject({
      CODEX_HOME: "/tmp/codex-home",
      LC_TEST: "it_IT",
      HTTPS_PROXY: "http://proxy.invalid"
    });
    expect(env).not.toHaveProperty("NOTION_TOKEN");
    expect(env).not.toHaveProperty("WORKER_SECRET");
    expect(env).not.toHaveProperty("SESSION_SECRET");
    expect(env).not.toHaveProperty("DASHBOARD_ACCESS_CODE");
    expect(env).not.toHaveProperty("OPENAI_API_KEY");
    expect(env).not.toHaveProperty("DATABASE_URL");
  });
});

describe("task execution", () => {
  it("keeps the smoke task read-only and accepts only its exact harmless marker", async () => {
    const runtime = new FakeRuntime("PHASE0_CODEX_OK");
    const result = await executeTask({
      task: smokeTask,
      runId: "07e053b2-727b-465c-a23c-209743ad5bd2",
      runtime,
      workingDirectory: process.cwd()
    });
    expect(result.outcome).toBe("succeeded");
    expect(result.output).toMatchObject({ marker: "PHASE0_CODEX_OK" });
    expect(runtime.starts).toEqual([
      expect.objectContaining({
        prompt: "Return exactly PHASE0_CODEX_OK",
        sandboxMode: "read-only",
        networkAccessEnabled: false
      })
    ]);
  });

  it("fails closed on an unexpected response", async () => {
    const result = await executeTask({
      task: smokeTask,
      runId: "37f5789a-215f-4831-a325-18200419de5c",
      runtime: new FakeRuntime("almost"),
      workingDirectory: process.cwd()
    });
    expect(result.outcome).toBe("failed_terminal");
  });

  it("runs repo updates workspace-write without network and never persists the response", async () => {
    const sensitiveResponse = "completed with NOTION_TOKEN=should-not-persist";
    const runtime = new FakeRuntime(sensitiveResponse);
    const result = await executeTask({
      task: taskWith("repo.update", { prompt: "Update the requested repository files." }),
      runId: "d029d914-9852-4bce-b159-34a480857889",
      runtime,
      workingDirectory: "/tmp/provided-worktree"
    });

    expect(result).toEqual({
      outcome: "succeeded",
      runtimeThreadId: "fake-thread",
      output: {
        runtimeStatus: "succeeded",
        usage: { inputTokens: 1 }
      },
      errorSummary: null
    });
    expect(JSON.stringify(result)).not.toContain(sensitiveResponse);
    expect(runtime.starts[0]).toMatchObject({
      workingDirectory: "/tmp/provided-worktree",
      sandboxMode: "workspace-write",
      networkAccessEnabled: false
    });
    expect(runtime.starts[0]?.prompt).toContain("Update the requested repository files.");
    expect(runtime.starts[0]?.prompt).toContain("only inside the provided worktree");
    expect(runtime.starts[0]?.prompt).toContain("Do not read secret files");
    expect(runtime.starts[0]?.prompt).toContain("Do not commit or push");
    expect(runtime.starts[0]?.prompt).toContain("Do not use the network");
    expect(runtime.starts[0]?.prompt).toContain("for a separate verifier");
  });

  it("runs failure remediation through the same bounded repository mutation contract", async () => {
    const runtime = new FakeRuntime("recovery complete");
    const result = await executeTask({
      task: taskWith("failure.remediation", {
        prompt: "Fix the deterministic publisher failure and complete the source task."
      }),
      runId: "d91610cb-0ed4-4e82-8319-4841019ed35a",
      runtime,
      workingDirectory: "/tmp/recovery-worktree"
    });

    expect(result.outcome).toBe("succeeded");
    expect(runtime.starts[0]).toMatchObject({
      workingDirectory: "/tmp/recovery-worktree",
      sandboxMode: "workspace-write",
      networkAccessEnabled: false
    });
    expect(runtime.starts[0]?.prompt).toContain("Fix the deterministic publisher failure");
  });

  it("runs Telegram operator queries read-only without tools or network", async () => {
    const runtime = new FakeRuntime("Risposta concisa");
    const result = await executeTask({
      task: taskWith("operator.query", { prompt: "Che cosa puoi fare?" }),
      runId: "987e053b-3ed5-4981-bbac-e04518ef743e",
      runtime,
      workingDirectory: "/tmp/operator-context"
    });

    expect(result).toEqual({
      outcome: "succeeded",
      runtimeThreadId: "fake-thread",
      output: {
        response: "Risposta concisa",
        usage: { inputTokens: 1 }
      },
      errorSummary: null
    });
    expect(runtime.starts[0]).toMatchObject({
      workingDirectory: "/tmp/operator-context",
      sandboxMode: "read-only",
      networkAccessEnabled: false
    });
    expect(runtime.starts[0]?.prompt).toContain("Do not inspect files");
    expect(runtime.starts[0]?.prompt).toContain("Do not call tools");
    expect(runtime.starts[0]?.prompt).toContain("Che cosa puoi fare?");
  });

  it("routes Telegram change requests into a strict confirmation decision", async () => {
    const runtime = new FakeRuntime(JSON.stringify({
      intent: "repo_update",
      objective: "Invia automaticamente le risposte Telegram",
      implementationPrompt: "Implementa una outbox Telegram durevole e notifiche automatiche."
    }));
    const result = await executeTask({
      task: taskWith("operator.request", {
        prompt: "Migliora il bot e inviami automaticamente le risposte."
      }),
      runId: "a7cf35fc-0dd3-4f16-8c2a-c861c6275412",
      runtime,
      workingDirectory: "/tmp/operator-context"
    });

    expect(result).toMatchObject({
      outcome: "succeeded",
      output: {
        intent: "repo_update",
        objective: "Invia automaticamente le risposte Telegram"
      }
    });
    expect(runtime.starts[0]).toMatchObject({
      sandboxMode: "read-only",
      networkAccessEnabled: false
    });
    expect(runtime.starts[0]?.prompt).toContain("Use repo_update when the operator asks");
    expect(runtime.starts[0]?.prompt).toContain("Migliora il bot");
  });

  it("routes explicit Notion analysis to executable research with durable context", async () => {
    const runtime = new FakeRuntime(JSON.stringify({
      intent: "notion_research",
      objective: "Valutare pipeline, formazione e processi commerciali",
      searchQueries: ["Pipeline Commerciale", "Formazione commerciale", "Processi commerciali"]
    }));
    const result = await executeTask({
      task: taskWith("supervisor.request", {
        prompt: "Analizza su Notion la pipeline Commerciale e la formazione.",
        conversationContext: [{
          taskId: "11111111-1111-4111-8111-111111111111",
          kind: "notion.research",
          status: "running"
        }]
      }),
      runId: "b7cf35fc-0dd3-4f16-8c2a-c861c6275412",
      runtime,
      workingDirectory: "/tmp/operator-context"
    });

    expect(result).toMatchObject({
      outcome: "succeeded",
      output: {
        intent: "notion_research",
        searchQueries: ["Pipeline Commerciale", "Formazione commerciale", "Processi commerciali"]
      }
    });
    expect(runtime.starts[0]?.prompt).toContain("Use notion_research whenever");
    expect(runtime.starts[0]?.prompt).toContain("11111111-1111-4111-8111-111111111111");
    expect(runtime.starts[0]?.prompt).toContain("A paraphrase, plan, acknowledgement");
  });

  it("answers deterministic supervisor status tasks without invoking the model", async () => {
    const runtime = new FakeRuntime("unused");
    const result = await executeTask({
      task: taskWith("supervisor.status", {
        targetTaskId: "11111111-1111-4111-8111-111111111111"
      }),
      runId: "e7cf35fc-0dd3-4f16-8c2a-c861c6275412",
      runtime,
      workingDirectory: "/tmp/operator-context"
    });
    expect(result).toEqual({
      outcome: "succeeded",
      runtimeThreadId: null,
      output: {
        intent: "task_status",
        taskId: "11111111-1111-4111-8111-111111111111"
      },
      errorSummary: null
    });
    expect(runtime.starts).toEqual([]);
  });

  it("synthesizes Notion evidence with validated citations and strips raw source text", async () => {
    const runtime = new FakeRuntime(JSON.stringify({
      response: "La pipeline è descritta con una fase di qualificazione [N1]. Risultato AI non validato.",
      confidence: 0.72
    }));
    const result = await executeTask({
      task: taskWith("notion.research", {
        researchObjective: "Valuta la pipeline commerciale",
        searchQueries: ["Pipeline Commerciale"]
      }),
      runId: "c7cf35fc-0dd3-4f16-8c2a-c861c6275412",
      runtime,
      workingDirectory: "/tmp/operator-context",
      notionResearch: {
        sources: [{
          reference: "N1",
          externalId: "notion-page-1",
          title: "Pipeline Commerciale",
          url: "https://notion.so/pipeline",
          lastEditedAt: "2026-08-08T10:00:00.000Z",
          contentHash: "a".repeat(64),
          markdown: "SEGRETO-DI-TEST qualificazione lead",
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
      }
    });

    expect(result).toMatchObject({
      outcome: "succeeded",
      output: {
        response: expect.stringContaining("[N1]"),
        confidence: 0.72,
        validationState: "ai_generated_unvalidated",
        sources: [expect.objectContaining({ externalId: "notion-page-1" })]
      }
    });
    expect(JSON.stringify(result.output)).not.toContain("SEGRETO-DI-TEST");
    expect(runtime.starts[0]).toMatchObject({ sandboxMode: "read-only", networkAccessEnabled: false });

    const invalid = await executeTask({
      task: taskWith("notion.research", { researchObjective: "Valuta", searchQueries: ["Pipeline"] }),
      runId: "d7cf35fc-0dd3-4f16-8c2a-c861c6275412",
      runtime: new FakeRuntime(JSON.stringify({ response: "Fonte inesistente [N2]", confidence: 0.8 })),
      workingDirectory: "/tmp/operator-context",
      notionResearch: {
        sources: [{
          reference: "N1",
          externalId: "notion-page-1",
          title: "Pipeline",
          url: null,
          lastEditedAt: null,
          contentHash: "b".repeat(64),
          markdown: "contenuto",
          matchedQueries: ["Pipeline"],
          partial: false
        }],
        coverage: {
          requestedQueries: ["Pipeline"],
          searchResultCount: 1,
          uniquePagesFound: 1,
          fetchedPages: 1,
          inaccessiblePages: 0,
          partial: false,
          limits: { maxPages: 15, maxCharacters: 60_000 }
        }
      }
    });
    expect(invalid.outcome).toBe("failed_retryable");
  });

  it("fails closed when Telegram request routing returns non-JSON or extra fields", async () => {
    for (const response of [
      "I would change the repository",
      JSON.stringify({ intent: "answer", response: "ok", extra: true })
    ]) {
      const result = await executeTask({
        task: taskWith("operator.request", { prompt: "Richiesta" }),
        runId: randomUUID(),
        runtime: new FakeRuntime(response),
        workingDirectory: "/tmp/operator-context"
      });
      expect(result.outcome).toBe("failed_retryable");
      expect(result.output).not.toHaveProperty("response");
    }
  });

  it.each([
    ["missing", {}],
    ["empty", { prompt: "  " }],
    ["oversized", { prompt: "x".repeat(4_001) }]
  ])("fails closed on a %s operator query", async (_label, payload) => {
    const runtime = new FakeRuntime("unused");
    const result = await executeTask({
      task: taskWith("operator.query", payload),
      runId: "f0e6848b-c434-4ad1-a0b3-5a82252df9b4",
      runtime,
      workingDirectory: process.cwd()
    });
    expect(result.outcome).toBe("failed_terminal");
    expect(runtime.starts).toEqual([]);
  });

  it.each([
    ["missing", {}],
    ["non-string", { prompt: 42 }],
    ["empty", { prompt: " \n\t" }],
    ["oversized", { prompt: "x".repeat(20_001) }]
  ])("fails closed on a %s repo update prompt", async (_label, payload) => {
    const runtime = new FakeRuntime("unused");
    const result = await executeTask({
      task: taskWith("repo.update", payload),
      runId: "15f7482a-1f92-4aa9-8956-3d269c5208f5",
      runtime,
      workingDirectory: process.cwd()
    });

    expect(result).toMatchObject({
      outcome: "failed_terminal",
      runtimeThreadId: null,
      output: null
    });
    expect(runtime.starts).toEqual([]);
  });

  it("sanitizes repo update runtime exceptions", async () => {
    const result = await executeTask({
      task: taskWith("repo.update", { prompt: "Make a bounded update." }),
      runId: "98df2684-2084-4254-a291-140b1f3c72d7",
      runtime: new FakeRuntime("", "failed", new Error("WORKER_SECRET=should-not-persist")),
      workingDirectory: process.cwd()
    });

    expect(result).toEqual({
      outcome: "failed_retryable",
      runtimeThreadId: null,
      output: null,
      errorSummary: "Codex repository update execution failed"
    });
    expect(JSON.stringify(result)).not.toContain("should-not-persist");
  });
});
