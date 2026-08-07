import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { Database } from "./database.js";

const migrationsDirectory = fileURLToPath(new URL("./migrations", import.meta.url));

export interface MigrationResult {
  applied: string[];
  alreadyApplied: string[];
}

export async function migrate(database: Database): Promise<MigrationResult> {
  await database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  const names = (await readdir(migrationsDirectory))
    .filter((name) => name.endsWith(".sql"))
    .sort();
  const applied: string[] = [];
  const alreadyApplied: string[] = [];

  for (const name of names) {
    const existing = await database.query<{ name: string }>(
      "SELECT name FROM schema_migrations WHERE name = $1",
      [name]
    );
    if (existing.length > 0) {
      alreadyApplied.push(name);
      continue;
    }

    const sql = await readFile(new URL(`./migrations/${name}`, import.meta.url), "utf8");
    await database.transaction(async (transaction) => {
      await transaction.exec(sql);
      await transaction.query(
        "INSERT INTO schema_migrations (name) VALUES ($1)",
        [name]
      );
    });
    applied.push(name);
  }

  return { applied, alreadyApplied };
}
