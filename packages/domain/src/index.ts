import { z } from "zod";

export const taskStatuses = [
  "ready",
  "leased",
  "running",
  "waiting_tool",
  "waiting_human",
  "verifying",
  "succeeded",
  "failed_retryable",
  "failed_terminal",
  "cancelled",
  "superseded"
] as const;

export const runStatuses = [
  "leased",
  "running",
  "succeeded",
  "failed_retryable",
  "failed_terminal",
  "interrupted",
  "cancelled"
] as const;

export const repositoryMutationTaskKinds = [
  "repo.update",
  "failure.remediation"
] as const;

export function isRepositoryMutationTaskKind(kind: string): boolean {
  return (repositoryMutationTaskKinds as readonly string[]).includes(kind);
}

export const proposalStatuses = ["pending", "approved", "rejected", "superseded"] as const;

export type TaskStatus = (typeof taskStatuses)[number];
export type RunStatus = (typeof runStatuses)[number];
export type ProposalStatus = (typeof proposalStatuses)[number];
export type ProposalDecision = "approve" | "reject";

export const HeartbeatPayloadSchema = z.object({
  workerId: z.string().min(1).max(128),
  displayName: z.string().min(1).max(128),
  bootId: z.string().uuid(),
  sequence: z.number().int().nonnegative(),
  version: z.string().min(1).max(128),
  activeRunId: z.string().uuid().nullable(),
  sentAt: z.string().datetime()
});

export const LeaseRequestSchema = z.object({
  leaseSeconds: z.number().int().min(15).max(300).default(90)
});

export const RunStartSchema = z.object({
  leaseToken: z.string().uuid()
});

export const RunCheckpointSchema = z.object({
  leaseToken: z.string().uuid(),
  checkpoint: z.record(z.string(), z.unknown())
});

export const RunRenewSchema = z.object({
  leaseToken: z.string().uuid(),
  leaseSeconds: z.number().int().min(15).max(300)
});

export const RunCompleteSchema = z.object({
  leaseToken: z.string().uuid(),
  outcome: z.enum(["succeeded", "failed_retryable", "failed_terminal"]),
  runtimeThreadId: z.string().max(256).nullable(),
  output: z.record(z.string(), z.unknown()).nullable(),
  errorSummary: z.string().max(2_000).nullable()
});

export const ProposalDecisionSchema = z.object({
  decision: z.enum(["approve", "reject"]),
  expectedHash: z.string().regex(/^[a-f0-9]{64}$/),
  reason: z.string().trim().max(1_000).default("")
});

const TelegramIdentifierSchema = z.number().int().safe();

export const TelegramUpdateSchema = z.object({
  update_id: TelegramIdentifierSchema.nonnegative(),
  message: z.object({
    message_id: TelegramIdentifierSchema.nonnegative(),
    from: z.object({
      id: TelegramIdentifierSchema,
      is_bot: z.boolean(),
      username: z.string().max(64).optional()
    }).passthrough(),
    chat: z.object({
      id: TelegramIdentifierSchema,
      type: z.string()
    }).passthrough(),
    text: z.string().max(4_096).optional()
  }).passthrough().optional(),
  callback_query: z.object({
    id: z.string().min(1).max(128),
    from: z.object({
      id: TelegramIdentifierSchema,
      is_bot: z.boolean(),
      username: z.string().max(64).optional()
    }).passthrough(),
    message: z.object({
      message_id: TelegramIdentifierSchema.nonnegative(),
      chat: z.object({
        id: TelegramIdentifierSchema,
        type: z.string()
      }).passthrough()
    }).passthrough().optional(),
    data: z.string().max(64).optional()
  }).passthrough().optional()
}).passthrough();

export const TelegramOutboxLeaseSchema = z.object({
  leaseSeconds: z.number().int().min(15).max(120).default(30)
});

export const TelegramOutboxCompleteSchema = z.object({
  leaseToken: z.string().uuid(),
  outcome: z.enum(["sent", "retryable_failure", "delivery_unknown"]),
  telegramMessageId: TelegramIdentifierSchema.nonnegative().nullable(),
  errorCode: z.string().min(1).max(128).regex(/^[a-z0-9][a-z0-9._-]*$/).nullable()
});

export const gitPublicationStages = [
  "planned",
  "committed",
  "pushed",
  "verified",
  "no_changes"
] as const;

export const GitRemoteSchema = z.string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/);

export const GitTargetBranchSchema = z.string()
  .min(12)
  .max(255)
  .regex(/^automation\/[A-Za-z0-9][A-Za-z0-9._/-]*$/)
  .refine((branch) => branch.split("/").every(
    (component) => /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(component)
  ))
  .refine((branch) => !branch.includes(".."))
  .refine((branch) => !branch.includes("//"))
  .refine((branch) => !branch.includes("@{"))
  .refine((branch) => !branch.endsWith("."))
  .refine((branch) => branch.split("/").every((component) => !component.endsWith(".lock")))
  .refine((branch) => branch !== "main" && branch !== "master");

export const GitShaSchema = z.string().regex(/^[a-f0-9]{40,64}$/);
const GitPublicationLeaseSchema = z.object({
  leaseToken: z.string().uuid()
});

export const GitPublicationCommandSchema = z.discriminatedUnion("action", [
  GitPublicationLeaseSchema.extend({
    action: z.literal("inspect")
  }),
  GitPublicationLeaseSchema.extend({
    action: z.literal("plan"),
    remote: GitRemoteSchema,
    branch: GitTargetBranchSchema,
    baseSha: GitShaSchema
  }),
  GitPublicationLeaseSchema.extend({
    action: z.literal("commit"),
    treeSha: GitShaSchema,
    commitSha: GitShaSchema
  }),
  GitPublicationLeaseSchema.extend({
    action: z.literal("push"),
    remoteSha: GitShaSchema
  }),
  GitPublicationLeaseSchema.extend({
    action: z.literal("verify"),
    remoteSha: GitShaSchema
  }),
  GitPublicationLeaseSchema.extend({
    action: z.literal("fail"),
    errorCode: z.string().min(1).max(128).regex(/^[a-z0-9][a-z0-9._-]*$/),
    retryable: z.boolean()
  }),
  GitPublicationLeaseSchema.extend({
    action: z.literal("no_changes")
  })
]);

export type HeartbeatPayload = z.infer<typeof HeartbeatPayloadSchema>;
export type LeaseRequest = z.infer<typeof LeaseRequestSchema>;
export type RunStart = z.infer<typeof RunStartSchema>;
export type RunCheckpoint = z.infer<typeof RunCheckpointSchema>;
export type RunRenew = z.infer<typeof RunRenewSchema>;
export type RunComplete = z.infer<typeof RunCompleteSchema>;
export type TelegramUpdate = z.infer<typeof TelegramUpdateSchema>;
export type TelegramOutboxComplete = z.infer<typeof TelegramOutboxCompleteSchema>;
export type GitPublicationStage = (typeof gitPublicationStages)[number];
export type GitPublicationCommand = z.infer<typeof GitPublicationCommandSchema>;

export interface WorkerRecord {
  id: string;
  displayName: string;
  status: "online" | "stale" | "revoked";
  bootId: string;
  lastSequence: number;
  version: string;
  activeRunId: string | null;
  lastHeartbeatAt: string;
  revokedAt: string | null;
}

export interface TaskRecord {
  id: string;
  kind: string;
  objective: string;
  status: TaskStatus;
  priority: number;
  risk: "low" | "medium" | "high";
  payload: Record<string, unknown>;
  dedupeKey: string;
  assignedWorkerId: string | null;
  leaseToken: string | null;
  leaseExpiresAt: string | null;
  attemptCount: number;
  maxAttempts: number;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface RunRecord {
  id: string;
  taskId: string;
  workerId: string;
  attempt: number;
  runtime: string;
  status: RunStatus;
  leaseToken: string;
  runtimeThreadId: string | null;
  output: Record<string, unknown> | null;
  errorSummary: string | null;
  version: number;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

export interface GitPublicationRecord {
  id: string;
  taskId: string;
  currentRunId: string;
  currentWorkerId: string;
  remote: string;
  targetBranch: string;
  baseSha: string;
  treeSha: string | null;
  commitSha: string | null;
  remoteSha: string | null;
  stage: GitPublicationStage;
  lastErrorCode: string | null;
  retryable: boolean | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface LeasedWork {
  task: TaskRecord;
  run: RunRecord;
  recovered: boolean;
}

export interface ProposalRecord {
  id: string;
  target: string;
  operation: string;
  beforeSnapshot: Record<string, unknown>;
  afterSnapshot: Record<string, unknown>;
  reason: string;
  evidence: Array<Record<string, unknown>>;
  risk: "low" | "medium" | "high";
  proposalHash: string;
  status: ProposalStatus;
  version: number;
  decidedAt: string | null;
  createdAt: string;
}

export interface EventRecord {
  id: string;
  occurredAt: string;
  type: string;
  actorType: string;
  actorId: string;
  aggregateType: string;
  aggregateId: string;
  aggregateVersion: number;
  taskId: string | null;
  runId: string | null;
  proposalId: string | null;
  correlationId: string;
  payload: Record<string, unknown>;
}

export interface NotionSampleSummary {
  status: "not_configured" | "sampled" | "failed";
  sampledCount: number;
  truncated: boolean;
  sampledAt: string | null;
  errorCode: string | null;
}

export interface TelegramSummary {
  paired: boolean;
  lastUpdateAt: string | null;
  lastCommand: string | null;
  lastTaskId: string | null;
  pendingConfirmations: number;
  pendingNotifications: number;
  failedNotifications: number;
}

export interface TelegramOutboxRecord {
  id: string;
  chatId: number;
  text: string;
  replyMarkup: Record<string, unknown> | null;
  attemptCount: number;
  leaseToken: string;
  leaseExpiresAt: string;
}

export interface DashboardSnapshot {
  generatedAt: string;
  systemStatus: "running" | "degraded";
  worker: WorkerRecord | null;
  tasks: TaskRecord[];
  runs: RunRecord[];
  proposals: ProposalRecord[];
  events: EventRecord[];
  notion: NotionSampleSummary;
  telegram: TelegramSummary;
}
