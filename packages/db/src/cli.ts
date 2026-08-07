import { createHash } from "node:crypto";
import { log } from "@meaworld/observability";
import { connectPostgres } from "./database.js";
import { migrate } from "./migrate.js";
import { Phase0Store } from "./store.js";

async function main(): Promise<void> {
  const command = process.argv[2];
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }

  const connection = connectPostgres(databaseUrl, { max: 1 });
  try {
    if (command === "migrate") {
      const result = await migrate(connection.database);
      log({
        level: "info",
        event: "database.migrated",
        message: "Database migrations completed",
        data: { ...result }
      });
      return;
    }

    if (command === "seed") {
      await migrate(connection.database);
      const seed = await new Phase0Store(connection.database).ensurePhase0Seed();
      log({
        level: "info",
        event: "phase0.seeded",
        message: "Phase 0 smoke task and fake proposal are ready",
        data: { taskId: seed.task.id, proposalId: seed.proposal.id }
      });
      return;
    }

    if (command === "seed-recovery") {
      await migrate(connection.database);
      const task = await new Phase0Store(connection.database).enqueueTask({
        kind: "phase0.codex-smoke",
        objective: "Prove an incomplete Codex task is reclaimed after an intentional worker crash",
        payload: {
          prompt: "Return exactly PHASE0_CODEX_OK. Do not inspect or modify files and do not call tools."
        },
        dedupeKey: "phase0:codex-recovery:v1",
        priority: 110,
        maxAttempts: 3
      });
      log({
        level: "info",
        event: "phase0.recovery_seeded",
        message: "Phase 0 recovery smoke task is ready",
        taskId: task.id
      });
      return;
    }

    if (command === "enqueue-repo-update") {
      const prompt = process.env.LOOP_UPDATE_PROMPT?.trim();
      if (!prompt) throw new Error("LOOP_UPDATE_PROMPT is required");
      await migrate(connection.database);
      const promptHash = createHash("sha256").update(prompt).digest("hex");
      const task = await new Phase0Store(connection.database).enqueueTask({
        kind: "repo.update",
        objective: process.env.LOOP_UPDATE_OBJECTIVE?.trim() || "Apply a governed repository update",
        payload: { prompt },
        dedupeKey: process.env.LOOP_UPDATE_DEDUPE_KEY?.trim() || `repo:update:${promptHash}`,
        priority: 50,
        risk: "medium",
        maxAttempts: 3
      });
      log({
        level: "info",
        event: "repo_update.enqueued",
        message: "Governed repository update task is ready",
        taskId: task.id,
        data: { dedupeKey: task.dedupeKey }
      });
      return;
    }

    throw new Error(`Unknown command: ${command ?? "<missing>"}`);
  } finally {
    await connection.close();
  }
}

main().catch((error: unknown) => {
  log({
    level: "error",
    event: "database.cli_failed",
    message: error instanceof Error ? error.message : "Unknown database CLI error"
  });
  process.exitCode = 1;
});
