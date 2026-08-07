import { PGlite } from "@electric-sql/pglite";
import type { Database } from "@meaworld/db";

interface Queryable {
  query<Row>(statement: string, parameters?: unknown[]): Promise<{ rows: Row[] }>;
  exec(statement: string): Promise<unknown>;
}

class PGliteDatabase implements Database {
  constructor(
    private readonly client: Queryable,
    private readonly root: PGlite
  ) {}

  async query<Row extends Record<string, unknown>>(
    statement: string,
    parameters: readonly unknown[] = []
  ): Promise<Row[]> {
    const result = await this.client.query<Row>(statement, [...parameters]);
    return result.rows;
  }

  async exec(statement: string): Promise<void> {
    await this.client.exec(statement);
  }

  async transaction<Result>(operation: (database: Database) => Promise<Result>): Promise<Result> {
    if ("transaction" in this.client && typeof this.client.transaction === "function") {
      return this.root.transaction(async (transaction) =>
        operation(new PGliteDatabase(transaction as unknown as Queryable, this.root))
      );
    }
    return operation(this);
  }
}

export async function createTestDatabase(): Promise<{
  database: Database;
  raw: PGlite;
  close: () => Promise<void>;
}> {
  const raw = new PGlite();
  await raw.waitReady;
  return {
    database: new PGliteDatabase(raw, raw),
    raw,
    close: () => raw.close()
  };
}
