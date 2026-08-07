import { redactSecrets } from "@meaworld/security";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface StructuredLog {
  level: LogLevel;
  event: string;
  message: string;
  correlationId?: string | undefined;
  taskId?: string | undefined;
  runId?: string | undefined;
  data?: Record<string, unknown> | undefined;
}

export function log(entry: StructuredLog): void {
  const output = {
    timestamp: new Date().toISOString(),
    ...entry,
    ...(entry.data ? { data: redactSecrets(entry.data) } : {})
  };
  process.stdout.write(`${JSON.stringify(output)}\n`);
}
