import { z } from "zod";

const integerFromEnvironment = (fallback: number, minimum: number, maximum: number) =>
  z.string().optional().transform((value, context) => {
    const parsed = value === undefined ? fallback : Number.parseInt(value, 10);
    if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
      context.addIssue({ code: "custom", message: `Expected an integer between ${minimum} and ${maximum}` });
      return z.NEVER;
    }
    return parsed;
  });

const WebEnvSchema = z.object({
  DATABASE_URL: z.string().url(),
  DASHBOARD_ACCESS_CODE: z.string().min(8),
  SESSION_SECRET: z.string().min(32),
  PUBLIC_APP_URL: z.string().url(),
  WORKER_ID: z.string().min(1).max(128),
  WORKER_SECRET: z.string().min(32),
  TELEGRAM_NOTION_RESPONSE_THRESHOLD: integerFromEnvironment(3_500, 500, 10_000)
});

export type WebEnv = z.infer<typeof WebEnvSchema>;

let cached: WebEnv | undefined;

export function getWebEnv(): WebEnv {
  cached ??= WebEnvSchema.parse(process.env);
  return cached;
}
