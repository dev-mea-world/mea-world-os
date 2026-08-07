import postgres, { type Sql, type TransactionSql } from "postgres";

export interface Database {
  query<Row extends Record<string, unknown>>(statement: string, parameters?: readonly unknown[]): Promise<Row[]>;
  exec(statement: string): Promise<void>;
  transaction<Result>(operation: (database: Database) => Promise<Result>): Promise<Result>;
}

class PostgresDatabase implements Database {
  constructor(private readonly sql: Sql | TransactionSql) {}

  async query<Row extends Record<string, unknown>>(
    statement: string,
    parameters: readonly unknown[] = []
  ): Promise<Row[]> {
    const rows = await this.sql.unsafe(statement, [...parameters] as never[]);
    return rows as unknown as Row[];
  }

  async exec(statement: string): Promise<void> {
    await this.sql.unsafe(statement);
  }

  async transaction<Result>(operation: (database: Database) => Promise<Result>): Promise<Result> {
    if ("begin" in this.sql) {
      return await this.sql.begin(async (transactionSql) => operation(new PostgresDatabase(transactionSql))) as Result;
    }
    return await this.sql.savepoint(async (transactionSql) => operation(new PostgresDatabase(transactionSql))) as Result;
  }
}

export interface PostgresConnection {
  database: Database;
  close: () => Promise<void>;
}

export function connectPostgres(url: string, options: { max?: number } = {}): PostgresConnection {
  const sql = postgres(url, {
    max: options.max ?? 5,
    prepare: false,
    idle_timeout: 20,
    connect_timeout: 10
  });

  return {
    database: new PostgresDatabase(sql),
    close: async () => sql.end({ timeout: 5 })
  };
}
