import { Codex } from "@openai/codex-sdk";

export type AgentSandboxMode = "read-only" | "workspace-write";

export interface AgentTaskInput {
  runId: string;
  prompt: string;
  workingDirectory: string;
  sandboxMode?: AgentSandboxMode;
  networkAccessEnabled?: boolean;
}

export interface AgentContinuation extends AgentTaskInput {
  runtimeThreadId: string;
}

export interface AgentRun {
  runId: string;
  runtimeThreadId: string | null;
  status: "succeeded" | "failed" | "cancelled";
  finalResponse: string;
  usage: unknown;
}

export interface AgentRunState {
  runId: string;
  status: "running" | "succeeded" | "failed" | "cancelled" | "unknown";
}

export interface AgentRuntime {
  start(input: AgentTaskInput): Promise<AgentRun>;
  resume(input: AgentContinuation): Promise<AgentRun>;
  cancel(runId: string): Promise<void>;
  inspect(runId: string): Promise<AgentRunState>;
}

const CODEX_ENV_KEYS = new Set([
  "HOME",
  "PATH",
  "TMPDIR",
  "USER",
  "LOGNAME",
  "SHELL",
  "LANG",
  "TERM",
  "CODEX_HOME",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "ALL_PROXY",
  "NO_PROXY",
  "http_proxy",
  "https_proxy",
  "all_proxy",
  "no_proxy",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
  "NODE_EXTRA_CA_CERTS"
]);

function createCodexEnvironment(source: NodeJS.ProcessEnv): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (value !== undefined && (CODEX_ENV_KEYS.has(key) || key.startsWith("LC_"))) {
      env[key] = value;
    }
  }
  return env;
}

export class CodexSdkRuntime implements AgentRuntime {
  private readonly codex: Codex;
  private readonly active = new Map<string, AbortController>();
  private readonly states = new Map<string, AgentRunState["status"]>();

  constructor(options: { codexPathOverride?: string } = {}) {
    this.codex = new Codex({
      ...options,
      env: createCodexEnvironment(process.env)
    });
  }

  start(input: AgentTaskInput): Promise<AgentRun> {
    const thread = this.codex.startThread({
      workingDirectory: input.workingDirectory,
      sandboxMode: input.sandboxMode ?? "read-only",
      approvalPolicy: "never",
      networkAccessEnabled: input.networkAccessEnabled ?? false,
      webSearchMode: "disabled",
      skipGitRepoCheck: false
    });
    return this.runThread(input, thread);
  }

  resume(input: AgentContinuation): Promise<AgentRun> {
    const thread = this.codex.resumeThread(input.runtimeThreadId, {
      workingDirectory: input.workingDirectory,
      sandboxMode: input.sandboxMode ?? "read-only",
      approvalPolicy: "never",
      networkAccessEnabled: input.networkAccessEnabled ?? false,
      webSearchMode: "disabled",
      skipGitRepoCheck: false
    });
    return this.runThread(input, thread);
  }

  private async runThread(
    input: AgentTaskInput,
    thread: ReturnType<Codex["startThread"]>
  ): Promise<AgentRun> {
    const abortController = new AbortController();
    this.active.set(input.runId, abortController);
    this.states.set(input.runId, "running");
    try {
      const result = await thread.run(input.prompt, { signal: abortController.signal });
      this.states.set(input.runId, "succeeded");
      return {
        runId: input.runId,
        runtimeThreadId: thread.id,
        status: "succeeded",
        finalResponse: result.finalResponse,
        usage: result.usage
      };
    } catch (error) {
      const cancelled = abortController.signal.aborted;
      this.states.set(input.runId, cancelled ? "cancelled" : "failed");
      if (cancelled) {
        return {
          runId: input.runId,
          runtimeThreadId: thread.id,
          status: "cancelled",
          finalResponse: "",
          usage: null
        };
      }
      throw error;
    } finally {
      this.active.delete(input.runId);
    }
  }

  async cancel(runId: string): Promise<void> {
    this.active.get(runId)?.abort();
  }

  async inspect(runId: string): Promise<AgentRunState> {
    return { runId, status: this.states.get(runId) ?? "unknown" };
  }
}
