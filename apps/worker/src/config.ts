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

const booleanFromEnvironment = (fallback: boolean) =>
  z.string().optional().transform((value, context) => {
    if (value === undefined) return fallback;
    if (value === "true") return true;
    if (value === "false") return false;
    context.addIssue({ code: "custom", message: "Expected true or false" });
    return z.NEVER;
  });

const WorkerConfigSchema = z.object({
  DATABASE_URL: z.string().url(),
  WORKER_BASE_URL: z.string().url(),
  WORKER_ID: z.string().min(1).max(128),
  WORKER_DISPLAY_NAME: z.string().min(1).max(128).default("Mac mini Phase 0"),
  WORKER_SECRET: z.string().min(32),
  WORKER_VERSION: z.string().min(1).max(128).default("phase0-dev"),
  WORKER_HEARTBEAT_INTERVAL_MS: integerFromEnvironment(30_000, 5_000, 120_000),
  WORKER_LEASE_SECONDS: integerFromEnvironment(300, 15, 300),
  NOTION_TOKEN: z.string().optional(),
  NOTION_SAMPLE_LIMIT: integerFromEnvironment(5, 1, 20),
  NOTION_RESEARCH_MAX_PAGES: integerFromEnvironment(15, 1, 30),
  NOTION_RESEARCH_MAX_CHARACTERS: integerFromEnvironment(60_000, 5_000, 120_000),
  TELEGRAM_BOT_TOKEN: z.preprocess(
    (value) => value === "" ? undefined : value,
    z.string().min(30).max(256).optional()
  ),
  CODEX_WORKING_DIRECTORY: z.string().min(1),
  GIT_AUTO_PUBLISH_ENABLED: booleanFromEnvironment(false),
  GIT_REMOTE: z.string().regex(/^[A-Za-z0-9._-]+$/).default("origin"),
  GIT_BASE_BRANCH: z.string().regex(/^[A-Za-z0-9._/-]+$/).default("main"),
  GIT_TARGET_BRANCH: z.string().regex(/^automation\/[A-Za-z0-9._/-]+$/)
    .default("automation/phase0-updates"),
  GIT_VALIDATION_TIMEOUT_MS: integerFromEnvironment(10 * 60_000, 30_000, 30 * 60_000)
});

export interface WorkerConfig {
  databaseUrl: string;
  baseUrl: string;
  id: string;
  displayName: string;
  secret: string;
  version: string;
  heartbeatIntervalMs: number;
  leaseSeconds: number;
  notionToken: string | undefined;
  notionSampleLimit: number;
  notionResearchMaxPages: number;
  notionResearchMaxCharacters: number;
  telegramBotToken: string | undefined;
  codexWorkingDirectory: string;
  gitAutoPublishEnabled: boolean;
  gitRemote: string;
  gitBaseBranch: string;
  gitTargetBranch: string;
  gitStateDirectory: string;
  gitValidationTimeoutMs: number;
}

export function getWorkerConfig(): WorkerConfig {
  const parsed = WorkerConfigSchema.parse(process.env);
  return {
    databaseUrl: parsed.DATABASE_URL,
    baseUrl: parsed.WORKER_BASE_URL,
    id: parsed.WORKER_ID,
    displayName: parsed.WORKER_DISPLAY_NAME,
    secret: parsed.WORKER_SECRET,
    version: parsed.WORKER_VERSION,
    heartbeatIntervalMs: parsed.WORKER_HEARTBEAT_INTERVAL_MS,
    leaseSeconds: parsed.WORKER_LEASE_SECONDS,
    notionToken: parsed.NOTION_TOKEN,
    notionSampleLimit: parsed.NOTION_SAMPLE_LIMIT,
    notionResearchMaxPages: parsed.NOTION_RESEARCH_MAX_PAGES,
    notionResearchMaxCharacters: parsed.NOTION_RESEARCH_MAX_CHARACTERS,
    telegramBotToken: parsed.TELEGRAM_BOT_TOKEN,
    codexWorkingDirectory: parsed.CODEX_WORKING_DIRECTORY,
    gitAutoPublishEnabled: parsed.GIT_AUTO_PUBLISH_ENABLED,
    gitRemote: parsed.GIT_REMOTE,
    gitBaseBranch: parsed.GIT_BASE_BRANCH,
    gitTargetBranch: parsed.GIT_TARGET_BRANCH,
    gitStateDirectory: `${parsed.CODEX_WORKING_DIRECTORY}/.phase0/git-publisher`,
    gitValidationTimeoutMs: parsed.GIT_VALIDATION_TIMEOUT_MS
  };
}
