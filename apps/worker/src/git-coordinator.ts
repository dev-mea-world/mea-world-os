import type { AgentRuntime } from "@meaworld/codex";
import type {
  GitPublicationCommand,
  GitPublicationRecord,
  TaskRecord
} from "@meaworld/domain";
import {
  RepositoryPublisher,
  RepositoryPublisherError
} from "@meaworld/git";
import { log } from "@meaworld/observability";
import { executeTask, type TaskExecutionResult } from "@meaworld/orchestration";

interface GitPublicationApi {
  checkpoint(
    runId: string,
    leaseToken: string,
    checkpoint: Record<string, unknown>,
    correlationId?: string
  ): Promise<{ sequence: number }>;
  recordGitPublication(
    runId: string,
    command: GitPublicationCommand,
    correlationId?: string
  ): Promise<{ publication: GitPublicationRecord | null }>;
}

type RepositoryPublisherPort = Pick<RepositoryPublisher,
  | "resolveBase"
  | "prepareWorkspace"
  | "inspectTaskCommit"
  | "validateAndCommit"
  | "pushAndVerify"
  | "cleanup"
>;

export interface GitUpdateCoordinatorConfig {
  enabled: boolean;
  repositoryRoot: string;
  stateDirectory: string;
  remote: string;
  baseBranch: string;
  targetBranch: string;
  validationTimeoutMs: number;
}

interface ExecuteGitUpdateInput {
  task: TaskRecord;
  runId: string;
  leaseToken: string;
  correlationId: string;
  runtime: AgentRuntime;
}

function requirePublication(publication: GitPublicationRecord | null): GitPublicationRecord {
  if (!publication) throw new Error("Git publication transition returned no record");
  return publication;
}

export class GitUpdateCoordinator {
  private readonly publisher: RepositoryPublisherPort | null;

  constructor(
    private readonly config: GitUpdateCoordinatorConfig,
    private readonly client: GitPublicationApi,
    publisher?: RepositoryPublisherPort
  ) {
    this.publisher = config.enabled
      ? publisher ?? new RepositoryPublisher({
          repositoryRoot: config.repositoryRoot,
          stateDirectory: config.stateDirectory,
          remote: config.remote,
          baseBranch: config.baseBranch,
          targetBranch: config.targetBranch,
          commandTimeoutMs: config.validationTimeoutMs
        })
      : null;
  }

  async execute(input: ExecuteGitUpdateInput): Promise<TaskExecutionResult> {
    if (!this.publisher) {
      return {
        outcome: "failed_terminal",
        runtimeThreadId: null,
        output: null,
        errorSummary: "Automatic Git publication is not enabled"
      };
    }

    let publication: GitPublicationRecord | null = null;
    let runtimeResult: TaskExecutionResult | null = null;
    let workspace: Awaited<ReturnType<RepositoryPublisher["prepareWorkspace"]>> | null = null;

    try {
      publication = (await this.client.recordGitPublication(
        input.runId,
        { action: "inspect", leaseToken: input.leaseToken },
        input.correlationId
      )).publication;

      if (publication) {
        if (
          publication.remote !== this.config.remote
          || publication.targetBranch !== this.config.targetBranch
        ) {
          throw new RepositoryPublisherError(
            "git_publication_configuration_changed",
            false
          );
        }
      }

      const baseSha = publication?.baseSha ?? await this.publisher.resolveBase();
      publication = requirePublication((await this.client.recordGitPublication(
        input.runId,
        {
          action: "plan",
          leaseToken: input.leaseToken,
          remote: this.config.remote,
          branch: this.config.targetBranch,
          baseSha
        },
        input.correlationId
      )).publication);

      await this.checkpoint(input, {
        stage: "git_publish_planned",
        publicationId: publication.id,
        baseSha: publication.baseSha,
        targetBranch: publication.targetBranch
      });

      if (publication.stage === "verified") {
        return this.recoveredResult(publication, "published");
      }
      if (publication.stage === "no_changes") {
        return this.recoveredResult(publication, "no_changes");
      }

      let commitSha = publication.commitSha;
      let treeSha = publication.treeSha;

      if (!commitSha) {
        const existingCommit = await this.publisher.inspectTaskCommit(input.task.id);
        if (existingCommit) {
          if (existingCommit.baseSha !== publication.baseSha) {
            throw new RepositoryPublisherError("git_recovery_base_mismatch", false);
          }
          commitSha = existingCommit.commitSha;
          treeSha = existingCommit.treeSha;
          publication = requirePublication((await this.client.recordGitPublication(
            input.runId,
            {
              action: "commit",
              leaseToken: input.leaseToken,
              commitSha,
              treeSha
            },
            input.correlationId
          )).publication);
        } else {
          workspace = await this.publisher.prepareWorkspace({
            taskId: input.task.id,
            baseSha: publication.baseSha
          });
          await this.checkpoint(input, {
            stage: "git_workspace_ready",
            publicationId: publication.id,
            baseSha: publication.baseSha
          });

          runtimeResult = await executeTask({
            task: input.task,
            runId: input.runId,
            runtime: input.runtime,
            workingDirectory: workspace.path
          });
          if (runtimeResult.outcome !== "succeeded") {
            await this.recordFailure(
              input,
              "codex_repo_update_failed",
              runtimeResult.outcome === "failed_retryable"
            );
            return runtimeResult;
          }

          await this.checkpoint(input, {
            stage: "repo_update_runtime_completed",
            publicationId: publication.id
          });
          const commit = await this.publisher.validateAndCommit({
            taskId: input.task.id,
            runId: input.runId,
            workspace,
            expectedBaseSha: publication.baseSha
          });

          if (commit.status === "noop") {
            publication = requirePublication((await this.client.recordGitPublication(
              input.runId,
              { action: "no_changes", leaseToken: input.leaseToken },
              input.correlationId
            )).publication);
            await this.checkpoint(input, {
              stage: "git_no_changes",
              publicationId: publication.id,
              headSha: commit.headSha
            });
            await this.cleanup(workspace, input);
            return {
              outcome: "succeeded",
              runtimeThreadId: runtimeResult.runtimeThreadId,
              output: {
                ...(runtimeResult.output ?? {}),
                git: this.summary(publication, "no_changes")
              },
              errorSummary: null
            };
          }

          commitSha = commit.commitSha;
          treeSha = commit.treeSha;
          publication = requirePublication((await this.client.recordGitPublication(
            input.runId,
            {
              action: "commit",
              leaseToken: input.leaseToken,
              commitSha,
              treeSha
            },
            input.correlationId
          )).publication);
          await this.checkpoint(input, {
            stage: "git_commit_created",
            publicationId: publication.id,
            commitSha,
            treeSha
          });
        }
      }

      if (!commitSha || !treeSha) {
        throw new RepositoryPublisherError("git_publication_commit_missing", false);
      }

      const pushed = await this.publisher.pushAndVerify(commitSha);
      publication = requirePublication((await this.client.recordGitPublication(
        input.runId,
        { action: "push", leaseToken: input.leaseToken, remoteSha: pushed.remoteSha },
        input.correlationId
      )).publication);
      publication = requirePublication((await this.client.recordGitPublication(
        input.runId,
        { action: "verify", leaseToken: input.leaseToken, remoteSha: pushed.remoteSha },
        input.correlationId
      )).publication);
      await this.checkpoint(input, {
        stage: "git_push_verified",
        publicationId: publication.id,
        commitSha,
        remoteSha: pushed.remoteSha,
        targetBranch: publication.targetBranch
      });
      if (workspace) await this.cleanup(workspace, input);

      return {
        outcome: "succeeded",
        runtimeThreadId: runtimeResult?.runtimeThreadId ?? null,
        output: {
          ...(runtimeResult?.output ?? {}),
          git: this.summary(publication, "published")
        },
        errorSummary: null
      };
    } catch (error) {
      const failure = error instanceof RepositoryPublisherError
        ? { code: error.code, retryable: error.retryable }
        : { code: "git_publication_failed", retryable: true };
      if (publication) {
        await this.recordFailure(input, failure.code, failure.retryable).catch(() => undefined);
      }
      return {
        outcome: failure.retryable ? "failed_retryable" : "failed_terminal",
        runtimeThreadId: runtimeResult?.runtimeThreadId ?? null,
        output: null,
        errorSummary: failure.code
      };
    }
  }

  private async checkpoint(
    input: ExecuteGitUpdateInput,
    checkpoint: Record<string, unknown>
  ): Promise<void> {
    await this.client.checkpoint(
      input.runId,
      input.leaseToken,
      { ...checkpoint, recordedAt: new Date().toISOString() },
      input.correlationId
    );
  }

  private async recordFailure(
    input: ExecuteGitUpdateInput,
    errorCode: string,
    retryable: boolean
  ): Promise<void> {
    await this.client.recordGitPublication(
      input.runId,
      { action: "fail", leaseToken: input.leaseToken, errorCode, retryable },
      input.correlationId
    );
  }

  private recoveredResult(
    publication: GitPublicationRecord,
    status: "published" | "no_changes"
  ): TaskExecutionResult {
    return {
      outcome: "succeeded",
      runtimeThreadId: null,
      output: { git: this.summary(publication, status), recovered: true },
      errorSummary: null
    };
  }

  private summary(
    publication: GitPublicationRecord,
    status: "published" | "no_changes"
  ): Record<string, unknown> {
    return {
      status,
      remote: publication.remote,
      targetBranch: publication.targetBranch,
      baseSha: publication.baseSha,
      commitSha: publication.commitSha,
      remoteSha: publication.remoteSha
    };
  }

  private async cleanup(
    workspace: Awaited<ReturnType<RepositoryPublisher["prepareWorkspace"]>>,
    input: ExecuteGitUpdateInput
  ): Promise<void> {
    try {
      await this.publisher?.cleanup(workspace);
    } catch (error) {
      log({
        level: "warn",
        event: "git.workspace_cleanup_failed",
        message: "Published worktree could not be removed safely",
        taskId: input.task.id,
        runId: input.runId,
        data: {
          code: error instanceof RepositoryPublisherError
            ? error.code
            : "git_workspace_cleanup_failed"
        }
      });
    }
  }
}
