import { z } from "zod";

const WebEnvSchema = z.object({
  DATABASE_URL: z.string().url(),
  DASHBOARD_ACCESS_CODE: z.string().min(8),
  SESSION_SECRET: z.string().min(32),
  PUBLIC_APP_URL: z.string().url(),
  WORKER_ID: z.string().min(1).max(128),
  WORKER_SECRET: z.string().min(32)
});

export type WebEnv = z.infer<typeof WebEnvSchema>;

let cached: WebEnv | undefined;

export function getWebEnv(): WebEnv {
  cached ??= WebEnvSchema.parse(process.env);
  return cached;
}
