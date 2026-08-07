import { execFileSync } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
const RUN_TWO = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

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
    delete process.env.MEAWORLD_VALIDATION_TEST_SECRET;
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
    const workspace = await subject.prepareWorkspace({ taskId: TASK_ONE, runId: RUN_ONE, baseSha });
    await expect(access(join(workspace.path, "node_modules"))).rejects.toMatchObject({ code: "ENOENT" });
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
    await expect(access(join(workspace.path, "node_modules"))).rejects.toMatchObject({ code: "ENOENT" });

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
    const workspace = await subject.prepareWorkspace({ taskId: TASK_TWO, runId: RUN_ONE, baseSha });
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
    const workspace = await subject.prepareWorkspace({ taskId: TASK_THREE, runId: RUN_ONE, baseSha });
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
    const workspace = await subject.prepareWorkspace({ taskId: TASK_TWO, runId: RUN_ONE, baseSha });
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

  it("rejects dependency paths created during the repository update", async () => {
    const fixture = await createRepository();
    temporaryDirectories.push(fixture.temporaryDirectory);
    const subject = publisher(fixture.repository);
    const baseSha = await subject.resolveBase();
    const workspace = await subject.prepareWorkspace({
      taskId: TASK_THREE,
      runId: RUN_TWO,
      baseSha
    });
    await writeFile(join(workspace.path, "candidate.md"), "candidate\n", "utf8");
    await mkdir(join(workspace.path, "node_modules"));

    await expect(subject.validateAndCommit({
      taskId: TASK_THREE,
      runId: RUN_TWO,
      workspace,
      expectedBaseSha: baseSha
    })).rejects.toMatchObject<Partial<RepositoryPublisherError>>({
      code: "git_dependency_path_tampered",
      retryable: false
    });
  });

  it("rejects a non-fast-forward race without force", async () => {
    const fixture = await createRepository();
    temporaryDirectories.push(fixture.temporaryDirectory);
    const first = publisher(fixture.repository);
    const firstBase = await first.resolveBase();
    const firstWorkspace = await first.prepareWorkspace({ taskId: TASK_ONE, runId: RUN_ONE, baseSha: firstBase });
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
    const secondWorkspace = await second.prepareWorkspace({ taskId: TASK_TWO, runId: RUN_ONE, baseSha: secondBase });
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

  it("starts a retry from a clean run-scoped worktree while preserving prior evidence", async () => {
    const fixture = await createRepository();
    temporaryDirectories.push(fixture.temporaryDirectory);
    const subject = publisher(fixture.repository);
    const baseSha = await subject.resolveBase();
    const firstWorkspace = await subject.prepareWorkspace({
      taskId: TASK_ONE,
      runId: RUN_ONE,
      baseSha
    });
    const stalePath = join(firstWorkspace.path, "stale-runtime-output.md");
    await writeFile(stalePath, "uncommitted output from a crashed run\n", "utf8");

    const retryWorkspace = await subject.prepareWorkspace({
      taskId: TASK_ONE,
      runId: RUN_TWO,
      baseSha
    });

    expect(retryWorkspace.path).not.toBe(firstWorkspace.path);
    expect(retryWorkspace.branch).toBe(`meaworld-task/${TASK_ONE}/${RUN_TWO}`);
    await expect(access(join(retryWorkspace.path, "stale-runtime-output.md"))).rejects.toMatchObject({
      code: "ENOENT"
    });
    await expect(readFile(stalePath, "utf8")).resolves.toContain("crashed run");
  });

  it("runs validation without project secrets, host reads, outside writes, or network", async () => {
    const fixture = await createRepository();
    temporaryDirectories.push(fixture.temporaryDirectory);
    const hostSecretPath = join(fixture.temporaryDirectory, "host-secret.txt");
    const outsideWritePath = join(fixture.temporaryDirectory, "outside-write.txt");
    const inheritedHome = process.env.HOME ?? "";
    await writeFile(hostSecretPath, "host-only-secret\n", "utf8");
    process.env.MEAWORLD_VALIDATION_TEST_SECRET = "must-not-be-inherited";
    const validationScript = [
      "const fs=require('node:fs'),net=require('node:net'),path=require('node:path');",
      "if(process.env.MEAWORLD_VALIDATION_TEST_SECRET)process.exit(10);",
      `if(!process.env.HOME||process.env.HOME===${JSON.stringify(inheritedHome)})process.exit(11);`,
      `try{fs.readFileSync(${JSON.stringify(hostSecretPath)});process.exit(12)}catch{}`,
      `try{fs.writeFileSync(${JSON.stringify(outsideWritePath)},'blocked');process.exit(13)}catch{}`,
      "const socket=net.connect({host:'1.1.1.1',port:443});",
      "socket.on('connect',()=>process.exit(14));",
      "socket.on('error',()=>{fs.writeFileSync(path.join(process.cwd(),'sandbox-proof.txt'),'isolated\\n');process.exit(0)});",
      "setTimeout(()=>process.exit(15),1000);"
    ].join("");
    const subject = new RepositoryPublisher({
      repositoryRoot: fixture.repository,
      stateDirectory: join(fixture.repository, ".phase0", "git-publisher"),
      remote: "origin",
      baseBranch: "main",
      targetBranch: "automation/phase0-updates",
      validationCommands: [{
        name: "sandbox",
        executable: process.execPath,
        args: ["-e", validationScript]
      }],
      commandTimeoutMs: 30_000
    });
    const baseSha = await subject.resolveBase();
    const workspace = await subject.prepareWorkspace({
      taskId: TASK_THREE,
      runId: RUN_TWO,
      baseSha
    });
    await writeFile(join(workspace.path, "candidate.md"), "candidate\n", "utf8");
    const committed = await subject.validateAndCommit({
      taskId: TASK_THREE,
      runId: RUN_TWO,
      workspace,
      expectedBaseSha: baseSha
    });

    expect(committed.status).toBe("committed");
    await expect(readFile(join(workspace.path, "sandbox-proof.txt"), "utf8")).resolves.toBe("isolated\n");
    await expect(access(outsideWritePath)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
