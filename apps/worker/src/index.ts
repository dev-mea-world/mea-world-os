import { randomUUID } from "node:crypto";
import { CodexSdkRuntime } from "@meaworld/codex";
import { sampleNotionInventory } from "@meaworld/notion";
import { log } from "@meaworld/observability";
import { WorkerApiClient } from "./client.js";
import { getWorkerConfig } from "./config.js";
import { Phase0Worker } from "./worker.js";

async function runNotionSmoke(): Promise<void> {
  const config = getWorkerConfig();
  const worker = new Phase0Worker(config);
  await worker.heartbeat();
  if (!config.notionToken) {
    const client = new WorkerApiClient(config.baseUrl, config.id, config.secret);
    await client.recordNotionSample({
      objects: [],
      truncated: true,
      nextCursor: null,
      status: "failed",
      errorCode: "not_configured"
    });
    throw new Error("NOTION_TOKEN is required; a capability gap was persisted");
  }

  try {
    const sample = await sampleNotionInventory(config.notionToken, config.notionSampleLimit);
    const client = new WorkerApiClient(config.baseUrl, config.id, config.secret);
    await client.recordNotionSample({ ...sample, status: "sampled", errorCode: null });
    log({
      level: "info",
      event: "notion.sample_succeeded",
      message: "Bounded read-only Notion sample persisted",
      data: { sampledCount: sample.objects.length, truncated: sample.truncated }
    });
  } catch (error) {
    const client = new WorkerApiClient(config.baseUrl, config.id, config.secret);
    await client.recordNotionSample({
      objects: [],
      truncated: true,
      nextCursor: null,
      status: "failed",
      errorCode: "notion_read_failed"
    });
    throw error;
  }
}

async function runCodexSmoke(): Promise<void> {
  const config = getWorkerConfig();
  const runtime = new CodexSdkRuntime();
  const result = await runtime.start({
    runId: randomUUID(),
    prompt: "Return exactly PHASE0_CODEX_OK. Do not inspect or modify files and do not call tools.",
    workingDirectory: config.codexWorkingDirectory
  });
  if (result.status !== "succeeded" || result.finalResponse.trim() !== "PHASE0_CODEX_OK") {
    throw new Error("Codex runtime returned an unexpected smoke response");
  }
  log({
    level: "info",
    event: "codex.smoke_succeeded",
    message: "Local Codex SDK returned the expected marker",
    data: { runtimeThreadId: result.runtimeThreadId }
  });
}

async function main(): Promise<void> {
  const command = process.argv[2] ?? "once";
  if (command === "notion-smoke") return runNotionSmoke();
  if (command === "codex-smoke") return runCodexSmoke();

  const worker = new Phase0Worker(getWorkerConfig());
  if (command === "once") return worker.runOnce();
  if (command === "crash-after-checkpoint") return worker.crashAfterCheckpoint();
  if (command === "daemon") {
    process.once("SIGTERM", () => worker.stop());
    process.once("SIGINT", () => worker.stop());
    return worker.runDaemon();
  }
  throw new Error(`Unknown worker command: ${command}`);
}

main().catch((error: unknown) => {
  log({
    level: "error",
    event: "worker.command_failed",
    message: error instanceof Error ? error.message : "Unknown worker error"
  });
  process.exitCode = 1;
});
