import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  RepositoryPublisher,
  RepositoryPublisherError
} from "@meaworld/git";

const TASK_ONE = "11111111-1111-4111-8111-111111111111";
const TASK_TWO = "22222222-2222-4222-8222-222222222222";
const TASK_THREE = "33333333-3333-4333-8333-333333333333";
const RUN_ONE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function git(cwd: string, arguments_: string[]): string {
  return execFileSync("git", arguments_, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: "0"
    }
  }).trim();
}

async function createRepository(): Promise<{
  temporaryDirectory: string;
  repository: string;
  remote: string;
}> {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "meaworld-git-publisher-"));
  const remote = join(temporaryDirectory, "remote.git");
  const repository = join(temporaryDirectory, "repository");
  git(temporaryDirectory, ["init", "--bare", remote]);
  git(temporaryDirectory, ["init", "--initial-branch=main", repository]);
  await writeFile(join(repository, ".gitignore"), ".phase0/\nnode_modules/\n", "utf8");
  await writeFile(join(repository, "README.md"), "baseline\n", "utf8");
  await mkdir(join(repository, "node_modules"));
  git(repository, ["add", ".gitignore", "README.md"]);
  git(repository, [
    "-c", "user.name=Test", "-c", "user.email=test@example.invalid",
    "commit", "-m", "initial"
  ]);
  git(repository, ["remote", "add", "origin", remote]);
  git(repository, ["push", "-u", "origin", "main"]);
  git(remote, ["symbolic-ref", "HEAD", "refs/heads/main"]);
  return { temporaryDirectory, repository, remote };
}

function publisher(repository: string): RepositoryPublisher {
  return new RepositoryPublisher({
    repositoryRoot: repository,
    stateDirectory: join(repository, ".phase0", "git-publisher"),
    remote: "origin",
    baseBranch: "main",
    targetBranch: "automation/phase0-updates",
    validationCommands: [{
      name: "fixture",
      executable: process.execPath,
      args: ["-e", "process.exit(0)"]
    }],
    commandTimeoutMs: 30_000
  });
}

describe("automatic Git publisher", () => {
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(temporaryDirectories.splice(0).map((path) =>
      rm(path, { recursive: true, force: true })
    ));
  });

  it("commits and verifies a task worktree without touching dirty main", async () => {
    const fixture = await createRepository();
    temporaryDirectories.push(fixture.temporaryDirectory);
    const originalMain = git(fixture.repository, ["rev-parse", "HEAD"]);
    await writeFile(join(fixture.repository, "human-untracked.txt"), "preserve me\n", "utf8");

    const subject = publisher(fixture.repository);
    const baseSha = await subject.resolveBase();
    const workspace = await subject.prepareWorkspace({ taskId: TASK_ONE, baseSha });
    await writeFile(join(workspace.path, "loop-update.md"), "automatic update\n", "utf8");
    const committed = await subject.validateAndCommit({
      taskId: TASK_ONE,
      runId: RUN_ONE,
      workspace,
      expectedBaseSha: baseSha
    });
    expect(committed.status).toBe("committed");
    if (committed.status === "noop") throw new Error("Expected a commit");

    const pushed = await subject.pushAndVerify(committed.commitSha);
    expect(pushed.remoteSha).toBe(committed.commitSha);
    expect(git(fixture.repository, ["rev-parse", "HEAD"])).toBe(originalMain);
    expect(git(fixture.repository, ["status", "--porcelain"]).trim()).toContain("human-untracked.txt");

    const recovered = await subject.inspectTaskCommit(TASK_ONE);
    expect(recovered).toMatchObject({
      taskId: TASK_ONE,
      runId: RUN_ONE,
      baseSha,
      treeSha: committed.treeSha,
      commitSha: committed.commitSha,
      pushed: true
    });
    await subject.cleanup(workspace);
  });

  it("does not create an empty commit", async () => {
    const fixture = await createRepository();
    temporaryDirectories.push(fixture.temporaryDirectory);
    const subject = publisher(fixture.repository);
    const baseSha = await subject.resolveBase();
    const workspace = await subject.prepareWorkspace({ taskId: TASK_TWO, baseSha });
    await expect(subject.validateAndCommit({
      taskId: TASK_TWO,
      runId: RUN_ONE,
      workspace,
      expectedBaseSha: baseSha
    })).resolves.toEqual({ status: "noop", headSha: baseSha });
    expect(git(fixture.repository, ["ls-remote", "--heads", "origin", "refs/heads/automation/phase0-updates"])).toBe("");
    await subject.cleanup(workspace);
  });

  it("blocks sensitive paths before staging or pushing", async () => {
    const fixture = await createRepository();
    temporaryDirectories.push(fixture.temporaryDirectory);
    const subject = publisher(fixture.repository);
    const baseSha = await subject.resolveBase();
    const workspace = await subject.prepareWorkspace({ taskId: TASK_THREE, baseSha });
    await writeFile(join(workspace.path, "private.pem"), "not a real key\n", "utf8");
    await expect(subject.validateAndCommit({
      taskId: TASK_THREE,
      runId: RUN_ONE,
      workspace,
      expectedBaseSha: baseSha
    })).rejects.toMatchObject<Partial<RepositoryPublisherError>>({
      code: "git_sensitive_path_changed",
      retryable: false
    });
    expect(git(workspace.path, ["diff", "--cached", "--name-only"])).toBe("");
    expect(git(fixture.repository, ["ls-remote", "--heads", "origin", "refs/heads/automation/phase0-updates"])).toBe("");
  });

  it("blocks likely secret material before commit", async () => {
    const fixture = await createRepository();
    temporaryDirectories.push(fixture.temporaryDirectory);
    const subject = publisher(fixture.repository);
    const baseSha = await subject.resolveBase();
    const workspace = await subject.prepareWorkspace({ taskId: TASK_TWO, baseSha });
    await writeFile(
      join(workspace.path, "config.txt"),
      `GITHUB_TOKEN=ghp_${"a".repeat(32)}\n`,
      "utf8"
    );
    await expect(subject.validateAndCommit({
      taskId: TASK_TWO,
      runId: RUN_ONE,
      workspace,
      expectedBaseSha: baseSha
    })).rejects.toMatchObject<Partial<RepositoryPublisherError>>({
      code: "git_likely_secret_detected",
      retryable: false
    });
    expect(git(fixture.repository, ["ls-remote", "--heads", "origin", "refs/heads/automation/phase0-updates"])).toBe("");
  });

  it("rejects a non-fast-forward race without force", async () => {
    const fixture = await createRepository();
    temporaryDirectories.push(fixture.temporaryDirectory);
    const first = publisher(fixture.repository);
    const firstBase = await first.resolveBase();
    const firstWorkspace = await first.prepareWorkspace({ taskId: TASK_ONE, baseSha: firstBase });
    await writeFile(join(firstWorkspace.path, "first.md"), "first\n", "utf8");
    const firstCommit = await first.validateAndCommit({
      taskId: TASK_ONE,
      runId: RUN_ONE,
      workspace: firstWorkspace,
      expectedBaseSha: firstBase
    });
    if (firstCommit.status === "noop") throw new Error("Expected first commit");
    await first.pushAndVerify(firstCommit.commitSha);

    const second = publisher(fixture.repository);
    const secondBase = await second.resolveBase();
    const secondWorkspace = await second.prepareWorkspace({ taskId: TASK_TWO, baseSha: secondBase });
    await writeFile(join(secondWorkspace.path, "second.md"), "second\n", "utf8");
    const secondCommit = await second.validateAndCommit({
      taskId: TASK_TWO,
      runId: RUN_ONE,
      workspace: secondWorkspace,
      expectedBaseSha: secondBase
    });
    if (secondCommit.status === "noop") throw new Error("Expected second commit");

    const competitor = join(fixture.temporaryDirectory, "competitor");
    git(fixture.temporaryDirectory, ["clone", fixture.remote, competitor]);
    git(competitor, ["checkout", "automation/phase0-updates"]);
    await writeFile(join(competitor, "competitor.md"), "competitor\n", "utf8");
    git(competitor, ["add", "competitor.md"]);
    git(competitor, [
      "-c", "user.name=Competitor", "-c", "user.email=competitor@example.invalid",
      "commit", "-m", "advance remote"
    ]);
    git(competitor, ["push", "origin", "automation/phase0-updates"]);
    const competingHead = git(competitor, ["rev-parse", "HEAD"]);

    await expect(second.pushAndVerify(secondCommit.commitSha)).rejects.toMatchObject<Partial<RepositoryPublisherError>>({
      code: "git_push_conflict",
      retryable: false
    });
    expect(git(fixture.repository, ["ls-remote", "--heads", "origin", "refs/heads/automation/phase0-updates"]).split(/\s+/)[0]).toBe(competingHead);
  });
});
