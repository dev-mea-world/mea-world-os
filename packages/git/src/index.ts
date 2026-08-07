import { execFile } from "node:child_process";
import {
  lstat,
  mkdir,
  readdir,
  readlink,
  realpath,
  symlink,
  unlink
} from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";

const GIT_SHA = /^[a-f0-9]{40,64}$/;
const TASK_ID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const REMOTE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const BRANCH_NAME = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;
const MAX_COMMAND_OUTPUT = 8 * 1024 * 1024;

const ENVIRONMENT_KEYS = new Set([
  "HOME",
  "PATH",
  "TMPDIR",
  "USER",
  "LOGNAME",
  "SHELL",
  "LANG",
  "TERM",
  "SSH_AUTH_SOCK",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "ALL_PROXY",
  "NO_PROXY",
  "http_proxy",
  "https_proxy",
  "all_proxy",
  "no_proxy",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
  "NODE_EXTRA_CA_CERTS"
]);

function commandEnvironment(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {
    GIT_TERMINAL_PROMPT: "0",
    GCM_INTERACTIVE: "Never"
  };
  for (const [key, value] of Object.entries(source)) {
    if (value !== undefined && (ENVIRONMENT_KEYS.has(key) || key.startsWith("LC_"))) {
      environment[key] = value;
    }
  }
  return environment;
}

interface CommandResult {
  stdout: string;
  stderr: string;
}

interface CommandFailure extends Error {
  code?: string | number;
  killed?: boolean;
  stdout?: string;
  stderr?: string;
}

function runFile(
  executable: string,
  arguments_: string[],
  options: { cwd: string; timeoutMs: number; maxBuffer?: number }
): Promise<CommandResult> {
  return new Promise((resolvePromise, rejectPromise) => {
    execFile(executable, arguments_, {
      cwd: options.cwd,
      encoding: "utf8",
      env: commandEnvironment(),
      timeout: options.timeoutMs,
      maxBuffer: options.maxBuffer ?? MAX_COMMAND_OUTPUT
    }, (error, stdout, stderr) => {
      if (error) {
        const failure = error as CommandFailure;
        failure.stdout = stdout;
        failure.stderr = stderr;
        rejectPromise(failure);
        return;
      }
      resolvePromise({ stdout, stderr });
    });
  });
}

function isPathWithin(parent: string, child: string): boolean {
  const pathFromParent = relative(parent, child);
  return pathFromParent === "" || (
    pathFromParent !== ".."
    && !pathFromParent.startsWith(`..${sep}`)
    && !isAbsolute(pathFromParent)
  );
}

function validateBranch(branch: string, target = false): void {
  if (
    !BRANCH_NAME.test(branch)
    || branch.includes("..")
    || branch.includes("//")
    || branch.includes("@{")
    || branch.endsWith(".")
    || branch.endsWith(".lock")
  ) {
    throw new RepositoryPublisherError("git_invalid_branch", false);
  }
  if (target && (!branch.startsWith("automation/") || ["main", "master"].includes(branch))) {
    throw new RepositoryPublisherError("git_protected_target_branch", false);
  }
}

function validateSha(sha: string): void {
  if (!GIT_SHA.test(sha)) {
    throw new RepositoryPublisherError("git_invalid_sha", false);
  }
}

function parseRemoteSha(output: string): string | null {
  const trimmed = output.trim();
  if (!trimmed) return null;
  const [sha] = trimmed.split(/\s+/, 1);
  if (!sha || !GIT_SHA.test(sha)) {
    throw new RepositoryPublisherError("git_invalid_remote_response", false);
  }
  return sha;
}

function classifyGitFailure(error: unknown, fallbackCode: string, fallbackRetryable: boolean): RepositoryPublisherError {
  const failure = error as CommandFailure;
  const detail = `${failure.stderr ?? ""}\n${failure.message ?? ""}`.toLowerCase();
  if (failure.killed || detail.includes("timed out")) {
    return new RepositoryPublisherError("git_command_timeout", true);
  }
  if (
    detail.includes("authentication failed")
    || detail.includes("could not read username")
    || detail.includes("permission denied")
    || detail.includes("terminal prompts disabled")
  ) {
    return new RepositoryPublisherError("git_auth_failed", false);
  }
  if (
    detail.includes("non-fast-forward")
    || detail.includes("fetch first")
    || detail.includes("failed to push some refs")
  ) {
    return new RepositoryPublisherError("git_push_conflict", false);
  }
  if (
    detail.includes("could not resolve host")
    || detail.includes("connection reset")
    || detail.includes("connection timed out")
    || detail.includes("remote end hung up")
    || detail.includes("service unavailable")
  ) {
    return new RepositoryPublisherError("git_transport_failed", true);
  }
  if (
    detail.includes("does not appear to be a git repository")
    || detail.includes("no such remote")
    || detail.includes("repository not found")
  ) {
    return new RepositoryPublisherError("git_remote_unavailable", false);
  }
  return new RepositoryPublisherError(fallbackCode, fallbackRetryable);
}

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

function splitNull(output: string): string[] {
  return output.split("\0").filter(Boolean);
}

function sensitivePath(path: string): boolean {
  const normalized = path.replaceAll("\\", "/");
  const name = basename(normalized).toLowerCase();
  if (
    isAbsolute(normalized)
    || normalized.split("/").includes("..")
    || normalized === ".phase0"
    || normalized.startsWith(".phase0/")
    || normalized === ".gitmodules"
  ) return true;
  if (name.startsWith(".env") && name !== ".env.example") return true;
  if ([".npmrc", ".netrc", "credentials", "credentials.json", "id_rsa", "id_ed25519"].includes(name)) {
    return true;
  }
  return /\.(?:pem|key|p12|pfx|keystore|jks)$/i.test(name);
}

function containsLikelySecret(content: string): boolean {
  const patterns = [
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
    /\bgh[pousr]_[A-Za-z0-9]{20,}\b/,
    /\bsecret_[A-Za-z0-9]{20,}\b/,
    /\bAKIA[0-9A-Z]{16}\b/,
    /(?:^|[\s"'`])(?:NOTION_TOKEN|WORKER_SECRET|SESSION_SECRET|DASHBOARD_ACCESS_CODE|OPENAI_API_KEY|GITHUB_TOKEN|API_KEY|PASSWORD)\s*[:=]\s*["']?[^\s"']{8,}/im
  ];
  return patterns.some((pattern) => pattern.test(content));
}

function envExampleHasValues(content: string): boolean {
  return content.split(/\r?\n/).some((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return false;
    const separator = trimmed.indexOf("=");
    return separator >= 0 && trimmed.slice(separator + 1).trim().length > 0;
  });
}

export class RepositoryPublisherError extends Error {
  constructor(
    public readonly code: string,
    public readonly retryable: boolean
  ) {
    super(code);
    this.name = "RepositoryPublisherError";
  }
}

export interface RepositoryPublisherConfig {
  repositoryRoot: string;
  stateDirectory: string;
  remote: string;
  targetBranch: string;
  baseBranch: string;
  validationCommands?: Array<{ name: string; executable: string; args: string[] }>;
  commandTimeoutMs?: number;
}

export interface RepositoryWorkspace {
  taskId: string;
  path: string;
  branch: string;
  baseSha: string;
}

export interface TaskCommit {
  taskId: string;
  runId: string;
  baseSha: string;
  treeSha: string;
  commitSha: string;
  pushed: boolean;
}

export type CommitResult =
  | { status: "noop"; headSha: string }
  | { status: "committed" | "existing"; commitSha: string; treeSha: string };

export class RepositoryPublisher {
  private readonly repositoryRoot: string;
  private readonly stateDirectory: string;
  private readonly remote: string;
  private readonly targetBranch: string;
  private readonly baseBranch: string;
  private readonly validationCommands: Array<{ name: string; executable: string; args: string[] }>;
  private readonly commandTimeoutMs: number;

  constructor(config: RepositoryPublisherConfig) {
    if (!REMOTE_NAME.test(config.remote)) {
      throw new RepositoryPublisherError("git_invalid_remote", false);
    }
    validateBranch(config.targetBranch, true);
    validateBranch(config.baseBranch);
    this.repositoryRoot = resolve(config.repositoryRoot);
    this.stateDirectory = resolve(config.stateDirectory);
    if (!isPathWithin(this.repositoryRoot, this.stateDirectory)) {
      throw new RepositoryPublisherError("git_state_directory_outside_repository", false);
    }
    this.remote = config.remote;
    this.targetBranch = config.targetBranch;
    this.baseBranch = config.baseBranch;
    this.validationCommands = config.validationCommands ?? [
      { name: "tests", executable: "pnpm", args: ["test"] },
      { name: "typecheck", executable: "pnpm", args: ["typecheck"] }
    ];
    this.commandTimeoutMs = config.commandTimeoutMs ?? 10 * 60_000;
  }

  async resolveBase(): Promise<string> {
    await this.assertRepositoryRoot();
    const remoteUrl = await this.git(["remote", "get-url", "--push", this.remote], this.repositoryRoot);
    if (/^[a-z][a-z0-9+.-]*:\/\/[^/@\s]+:[^/@\s]+@/i.test(remoteUrl.stdout.trim())) {
      throw new RepositoryPublisherError("git_remote_embeds_credentials", false);
    }

    const target = await this.remoteSha(this.targetBranch);
    const branch = target ? this.targetBranch : this.baseBranch;
    const expectedSha = target ?? await this.remoteSha(this.baseBranch);
    if (!expectedSha) throw new RepositoryPublisherError("git_remote_base_missing", false);
    const fetched = await this.git(
      ["fetch", "--no-tags", this.remote, `refs/heads/${branch}`],
      this.repositoryRoot,
      "git_fetch_failed",
      true
    );
    void fetched;
    const fetchHead = (await this.git(["rev-parse", "FETCH_HEAD"], this.repositoryRoot)).stdout.trim();
    if (fetchHead !== expectedSha) {
      throw new RepositoryPublisherError("git_remote_changed_during_fetch", true);
    }
    return expectedSha;
  }

  async prepareWorkspace(input: { taskId: string; baseSha: string }): Promise<RepositoryWorkspace> {
    this.validateTaskId(input.taskId);
    validateSha(input.baseSha);
    await this.assertRepositoryRoot();
    const worktreesDirectory = resolve(this.stateDirectory, "worktrees");
    const workspacePath = resolve(worktreesDirectory, input.taskId);
    if (!isPathWithin(worktreesDirectory, workspacePath)) {
      throw new RepositoryPublisherError("git_invalid_workspace_path", false);
    }
    const branch = `meaworld-task/${input.taskId}`;
    validateBranch(branch);
    await mkdir(worktreesDirectory, { recursive: true });

    if (await exists(workspacePath)) {
      await this.assertWorkspace(workspacePath, branch, input.baseSha);
      await this.linkDependencies(workspacePath);
      return { taskId: input.taskId, path: workspacePath, branch, baseSha: input.baseSha };
    }

    const branchExists = await this.gitExitZero(
      ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`],
      this.repositoryRoot
    );
    if (branchExists) {
      const branchHead = (await this.git(["rev-parse", `refs/heads/${branch}`], this.repositoryRoot)).stdout.trim();
      if (!await this.isAncestor(input.baseSha, branchHead, this.repositoryRoot)) {
        throw new RepositoryPublisherError("git_task_branch_base_mismatch", false);
      }
      await this.git(["worktree", "add", workspacePath, branch], this.repositoryRoot);
    } else {
      await this.git(["worktree", "add", "-b", branch, workspacePath, input.baseSha], this.repositoryRoot);
    }
    await this.assertWorkspace(workspacePath, branch, input.baseSha);
    await this.linkDependencies(workspacePath);
    return { taskId: input.taskId, path: workspacePath, branch, baseSha: input.baseSha };
  }

  async inspectTaskCommit(taskId: string): Promise<TaskCommit | null> {
    this.validateTaskId(taskId);
    await this.assertRepositoryRoot();
    const localBranch = `refs/heads/meaworld-task/${taskId}`;
    let searchRef: string | null = await this.gitExitZero(
      ["show-ref", "--verify", "--quiet", localBranch],
      this.repositoryRoot
    ) ? localBranch : null;

    if (!searchRef) {
      const remoteHead = await this.remoteSha(this.targetBranch);
      if (!remoteHead) return null;
      await this.git(
        ["fetch", "--no-tags", this.remote, `refs/heads/${this.targetBranch}`],
        this.repositoryRoot,
        "git_fetch_failed",
        true
      );
      searchRef = "FETCH_HEAD";
    }

    const logResult = await this.git([
      "log",
      "-n",
      "100",
      "--format=%H%x1f%B%x1e",
      "--fixed-strings",
      `--grep=MeaWorld-Task-ID: ${taskId}`,
      searchRef
    ], this.repositoryRoot);
    const records = logResult.stdout.split("\x1e").map((record) => record.trim()).filter(Boolean);
    for (const record of records) {
      const separator = record.indexOf("\x1f");
      if (separator < 0) continue;
      const commitSha = record.slice(0, separator).trim();
      const body = record.slice(separator + 1);
      if (!body.split(/\r?\n/).includes(`MeaWorld-Task-ID: ${taskId}`)) continue;
      const runLine = body.split(/\r?\n/).find((line) => line.startsWith("MeaWorld-Run-ID: "));
      const runId = runLine?.slice("MeaWorld-Run-ID: ".length).trim();
      if (!runId || !TASK_ID.test(runId) || !GIT_SHA.test(commitSha)) {
        throw new RepositoryPublisherError("git_invalid_task_commit", false);
      }
      const baseSha = (await this.git(["rev-parse", `${commitSha}^`], this.repositoryRoot)).stdout.trim();
      const treeSha = (await this.git(["rev-parse", `${commitSha}^{tree}`], this.repositoryRoot)).stdout.trim();
      validateSha(baseSha);
      validateSha(treeSha);
      const remoteHead = await this.remoteSha(this.targetBranch);
      return {
        taskId,
        runId,
        baseSha,
        treeSha,
        commitSha,
        pushed: remoteHead === commitSha
      };
    }
    return null;
  }

  async validateAndCommit(input: {
    taskId: string;
    runId: string;
    workspace: RepositoryWorkspace;
    expectedBaseSha: string;
  }): Promise<CommitResult> {
    this.validateTaskId(input.taskId);
    this.validateTaskId(input.runId);
    validateSha(input.expectedBaseSha);
    if (input.workspace.taskId !== input.taskId || input.workspace.baseSha !== input.expectedBaseSha) {
      throw new RepositoryPublisherError("git_workspace_ownership_mismatch", false);
    }
    await this.assertWorkspace(input.workspace.path, input.workspace.branch, input.expectedBaseSha);
    const headSha = (await this.git(["rev-parse", "HEAD"], input.workspace.path)).stdout.trim();
    if (headSha !== input.expectedBaseSha) {
      const existing = await this.inspectTaskCommit(input.taskId);
      if (existing?.commitSha === headSha) {
        return { status: "existing", commitSha: headSha, treeSha: existing.treeSha };
      }
      throw new RepositoryPublisherError("git_workspace_head_changed", false);
    }

    const initialFiles = await this.changedFiles(input.workspace.path);
    if (initialFiles.length === 0) return { status: "noop", headSha };
    await this.assertChangePolicy(input.workspace.path, initialFiles);

    for (const command of this.validationCommands) {
      try {
        await runFile(command.executable, command.args, {
          cwd: input.workspace.path,
          timeoutMs: this.commandTimeoutMs
        });
      } catch {
        throw new RepositoryPublisherError(`git_validation_${command.name}_failed`, false);
      }
    }

    const finalFiles = await this.changedFiles(input.workspace.path);
    if (finalFiles.length === 0) return { status: "noop", headSha };
    await this.assertChangePolicy(input.workspace.path, finalFiles);
    await this.git([
      "add",
      "--all",
      "--",
      ".",
      ":(exclude)node_modules",
      ":(exclude,glob)**/node_modules",
      ":(exclude,glob)**/node_modules/**"
    ], input.workspace.path);
    if (!await this.gitExitZero(["diff", "--cached", "--check"], input.workspace.path)) {
      throw new RepositoryPublisherError("git_diff_check_failed", false);
    }
    await this.assertStagedPolicy(input.workspace.path, finalFiles);

    const shortTaskId = input.taskId.slice(0, 8);
    await this.git([
      "-c",
      "user.name=MeaWorld Loop",
      "-c",
      "user.email=loop@meaworld.local",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "-m",
      `chore(automation): apply update ${shortTaskId}`,
      "-m",
      `MeaWorld-Task-ID: ${input.taskId}\nMeaWorld-Run-ID: ${input.runId}`
    ], input.workspace.path, "git_commit_failed", false);
    const commitSha = (await this.git(["rev-parse", "HEAD"], input.workspace.path)).stdout.trim();
    const treeSha = (await this.git(["rev-parse", "HEAD^{tree}"], input.workspace.path)).stdout.trim();
    validateSha(commitSha);
    validateSha(treeSha);
    return { status: "committed", commitSha, treeSha };
  }

  async pushAndVerify(commitSha: string): Promise<{
    commitSha: string;
    remoteSha: string;
    remoteBranch: string;
  }> {
    validateSha(commitSha);
    const before = await this.remoteSha(this.targetBranch);
    if (before !== commitSha) {
      try {
        await this.git(
          ["push", "--porcelain", this.remote, `${commitSha}:refs/heads/${this.targetBranch}`],
          this.repositoryRoot,
          "git_push_failed",
          true
        );
      } catch (error) {
        const observed = await this.remoteSha(this.targetBranch).catch(() => null);
        if (observed !== commitSha) throw error;
      }
    }
    const remoteSha = await this.remoteSha(this.targetBranch);
    if (remoteSha !== commitSha) {
      throw new RepositoryPublisherError(
        remoteSha ? "git_push_conflict" : "git_remote_verification_failed",
        remoteSha === null
      );
    }
    return { commitSha, remoteSha, remoteBranch: this.targetBranch };
  }

  async cleanup(workspace: RepositoryWorkspace): Promise<void> {
    await this.removeDependencyLinks(workspace.path);
    const status = await this.git(["status", "--porcelain=v1", "--untracked-files=all"], workspace.path);
    if (status.stdout.trim()) {
      throw new RepositoryPublisherError("git_workspace_not_clean", false);
    }
    await this.git(["worktree", "remove", workspace.path], this.repositoryRoot, "git_workspace_cleanup_failed", false);
  }

  private async assertRepositoryRoot(): Promise<void> {
    let expected: string;
    let actual: string;
    try {
      expected = await realpath(this.repositoryRoot);
      const reported = (await this.git(["rev-parse", "--show-toplevel"], this.repositoryRoot)).stdout.trim();
      actual = await realpath(reported);
    } catch (error) {
      if (error instanceof RepositoryPublisherError) throw error;
      throw new RepositoryPublisherError("git_repository_unavailable", false);
    }
    if (actual !== expected) throw new RepositoryPublisherError("git_repository_root_mismatch", false);
  }

  private async assertWorkspace(path: string, branch: string, baseSha: string): Promise<void> {
    const actualRoot = await realpath((await this.git(["rev-parse", "--show-toplevel"], path)).stdout.trim());
    if (actualRoot !== await realpath(path)) {
      throw new RepositoryPublisherError("git_workspace_root_mismatch", false);
    }
    const actualBranch = (await this.git(["symbolic-ref", "--short", "HEAD"], path)).stdout.trim();
    if (actualBranch !== branch) {
      throw new RepositoryPublisherError("git_workspace_branch_mismatch", false);
    }
    const head = (await this.git(["rev-parse", "HEAD"], path)).stdout.trim();
    if (!await this.isAncestor(baseSha, head, path)) {
      throw new RepositoryPublisherError("git_workspace_base_mismatch", false);
    }
  }

  private async linkDependencies(workspacePath: string): Promise<void> {
    for (const { source, destination, destinationParent } of await this.dependencyLinks(workspacePath)) {
      if (await exists(destination)) continue;
      await mkdir(destinationParent, { recursive: true });
      await symlink(source, destination, "dir");
    }
  }

  private async removeDependencyLinks(workspacePath: string): Promise<void> {
    for (const { source, destination } of await this.dependencyLinks(workspacePath)) {
      if (!await exists(destination)) continue;
      const metadata = await lstat(destination);
      if (!metadata.isSymbolicLink()) continue;
      const target = resolve(dirname(destination), await readlink(destination));
      if (target === source) await unlink(destination);
    }
  }

  private async dependencyLinks(workspacePath: string): Promise<Array<{
    source: string;
    destination: string;
    destinationParent: string;
  }>> {
    const candidates = [this.repositoryRoot];
    for (const directory of ["apps", "packages"]) {
      const parent = resolve(this.repositoryRoot, directory);
      if (!await exists(parent)) continue;
      for (const entry of await readdir(parent, { withFileTypes: true })) {
        if (entry.isDirectory()) candidates.push(resolve(parent, entry.name));
      }
    }
    const links: Array<{ source: string; destination: string; destinationParent: string }> = [];
    for (const sourceParent of candidates) {
      const source = resolve(sourceParent, "node_modules");
      if (!await exists(source)) continue;
      const relativeParent = relative(this.repositoryRoot, sourceParent);
      const destinationParent = resolve(workspacePath, relativeParent);
      const destination = resolve(destinationParent, "node_modules");
      links.push({ source, destination, destinationParent });
    }
    return links;
  }

  private async changedFiles(workspacePath: string): Promise<string[]> {
    const [tracked, untracked] = await Promise.all([
      this.git(["diff", "--name-only", "-z", "HEAD", "--"], workspacePath),
      this.git(["ls-files", "--others", "--exclude-standard", "-z"], workspacePath)
    ]);
    return [...new Set([...splitNull(tracked.stdout), ...splitNull(untracked.stdout)])]
      .filter((path) => !path.replaceAll("\\", "/").split("/").includes("node_modules"))
      .sort();
  }

  private async assertChangePolicy(workspacePath: string, paths: string[]): Promise<void> {
    for (const path of paths) {
      if (sensitivePath(path)) {
        throw new RepositoryPublisherError("git_sensitive_path_changed", false);
      }
    }
    const rawDiff = await this.git(["diff", "--raw", "HEAD", "--"], workspacePath);
    if (/(?:^|\s)160000(?:\s|$)/m.test(rawDiff.stdout)) {
      throw new RepositoryPublisherError("git_gitlink_changed", false);
    }
  }

  private async assertStagedPolicy(workspacePath: string, paths: string[]): Promise<void> {
    const staged = splitNull((await this.git(["diff", "--cached", "--name-only", "-z", "--"], workspacePath)).stdout);
    const expected = [...paths].sort();
    if (staged.length !== expected.length || staged.some((path, index) => path !== expected[index])) {
      throw new RepositoryPublisherError("git_staged_scope_mismatch", false);
    }
    for (const path of staged) {
      const content = (await this.git(["show", `:${path}`], workspacePath, "git_staged_blob_unreadable", false, 12 * 1024 * 1024)).stdout;
      if (path.endsWith(".env.example") && envExampleHasValues(content)) {
        throw new RepositoryPublisherError("git_env_example_contains_value", false);
      }
      if (containsLikelySecret(content)) {
        throw new RepositoryPublisherError("git_likely_secret_detected", false);
      }
    }
  }

  private async remoteSha(branch: string): Promise<string | null> {
    try {
      const result = await this.git(
        ["ls-remote", "--heads", this.remote, `refs/heads/${branch}`],
        this.repositoryRoot,
        "git_remote_unavailable",
        true
      );
      return parseRemoteSha(result.stdout);
    } catch (error) {
      if (error instanceof RepositoryPublisherError) throw error;
      throw classifyGitFailure(error, "git_remote_unavailable", true);
    }
  }

  private async isAncestor(ancestor: string, descendant: string, cwd: string): Promise<boolean> {
    return this.gitExitZero(["merge-base", "--is-ancestor", ancestor, descendant], cwd);
  }

  private async git(
    arguments_: string[],
    cwd: string,
    failureCode = "git_command_failed",
    retryable = false,
    maxBuffer = MAX_COMMAND_OUTPUT
  ): Promise<CommandResult> {
    try {
      return await runFile("git", arguments_, {
        cwd,
        timeoutMs: this.commandTimeoutMs,
        maxBuffer
      });
    } catch (error) {
      throw classifyGitFailure(error, failureCode, retryable);
    }
  }

  private async gitExitZero(arguments_: string[], cwd: string): Promise<boolean> {
    try {
      await runFile("git", arguments_, { cwd, timeoutMs: this.commandTimeoutMs });
      return true;
    } catch {
      return false;
    }
  }

  private validateTaskId(taskId: string): void {
    if (!TASK_ID.test(taskId)) {
      throw new RepositoryPublisherError("git_invalid_task_id", false);
    }
  }
}
