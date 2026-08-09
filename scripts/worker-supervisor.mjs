import { spawn } from "node:child_process";
import { existsSync, readdirSync, watch } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "..");
const runtimeDirectory = process.env.MEAWORLD_WORKER_RUNTIME_DIRECTORY
  ? resolve(process.env.MEAWORLD_WORKER_RUNTIME_DIRECTORY)
  : repositoryRoot;
const environmentFile = resolve(repositoryRoot, ".env.local");
const childArguments = [
  `--env-file=${environmentFile}`,
  "--import",
  resolve(repositoryRoot, "node_modules/tsx/dist/loader.mjs"),
  resolve(repositoryRoot, "apps/worker/src/index.ts"),
  "daemon"
];
const gracefulShutdownMs = 10_000;
const restartDebounceMs = 750;
const maximumRestartBackoffMs = 30_000;

function writeLog(level, event, message, data = {}) {
  process.stdout.write(`${JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    event,
    message,
    data
  })}\n`);
}

function requiredPath(path, description) {
  if (!existsSync(path)) {
    writeLog("error", "supervisor.configuration_invalid", `Missing ${description}`);
    process.exit(78);
  }
}

requiredPath(environmentFile, ".env.local");
requiredPath(resolve(repositoryRoot, "apps/worker/src/index.ts"), "worker entrypoint");
requiredPath(resolve(repositoryRoot, "node_modules/tsx/dist/loader.mjs"), "tsx dependency");
requiredPath(runtimeDirectory, "worker runtime directory");

if (process.argv[2] === "check") {
  writeLog("info", "supervisor.configuration_valid", "Worker supervisor configuration is valid", {
    repositoryRoot
  });
  process.exit(0);
}

let child = null;
let childStartedAt = 0;
let forcedKillTimer = null;
let restartTimer = null;
let restartBackoffMs = 1_000;
let restartReason = "initial_start";
let shuttingDown = false;
let exitCode = 0;
const watchers = [];

function clearForcedKillTimer() {
  if (forcedKillTimer) clearTimeout(forcedKillTimer);
  forcedKillTimer = null;
}

function terminateChild(reason) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const target = child;
  writeLog("info", "supervisor.worker_stopping", "Stopping worker child", {
    pid: target.pid,
    reason
  });
  target.kill("SIGTERM");
  clearForcedKillTimer();
  forcedKillTimer = setTimeout(() => {
    if (child === target && target.exitCode === null && target.signalCode === null) {
      writeLog("warn", "supervisor.worker_killed", "Worker child exceeded graceful shutdown deadline", {
        pid: target.pid,
        reason
      });
      target.kill("SIGKILL");
    }
  }, gracefulShutdownMs);
  forcedKillTimer.unref();
}

function scheduleStart(delayMs) {
  if (shuttingDown || restartTimer) return;
  restartTimer = setTimeout(() => {
    restartTimer = null;
    startChild();
  }, delayMs);
}

function startChild() {
  if (shuttingDown || child) return;
  const reason = restartReason;
  restartReason = "unexpected_exit";
  childStartedAt = Date.now();
  child = spawn(process.execPath, childArguments, {
    cwd: runtimeDirectory,
    env: process.env,
    stdio: "inherit"
  });
  writeLog("info", "supervisor.worker_started", "Worker child started", {
    pid: child.pid,
    reason
  });
  child.once("error", (error) => {
    writeLog("error", "supervisor.worker_spawn_failed", "Worker child could not start", {
      code: typeof error.code === "string" ? error.code : "unknown"
    });
  });
  child.once("exit", (code, signal) => {
    const uptimeMs = Date.now() - childStartedAt;
    clearForcedKillTimer();
    child = null;
    writeLog(code === 0 && !signal ? "info" : "warn", "supervisor.worker_exited", "Worker child exited", {
      code,
      signal,
      uptimeMs
    });
    if (shuttingDown) {
      process.exit(exitCode);
    }
    if (uptimeMs >= 60_000) restartBackoffMs = 1_000;
    const delay = restartReason === "code_or_configuration_changed"
      ? restartDebounceMs
      : restartBackoffMs;
    if (restartReason !== "code_or_configuration_changed") {
      restartBackoffMs = Math.min(restartBackoffMs * 2, maximumRestartBackoffMs);
    }
    scheduleStart(delay);
  });
}

function requestWorkerRestart(changedPath) {
  if (shuttingDown) return;
  restartReason = "code_or_configuration_changed";
  restartBackoffMs = 1_000;
  writeLog("info", "supervisor.change_detected", "Worker dependency changed; restart scheduled", {
    path: changedPath
  });
  if (child) terminateChild(restartReason);
  else scheduleStart(restartDebounceMs);
}

function shutdown(code, reason) {
  if (shuttingDown) return;
  shuttingDown = true;
  exitCode = code;
  if (restartTimer) clearTimeout(restartTimer);
  restartTimer = null;
  for (const watcher of watchers) watcher.close();
  writeLog("info", "supervisor.stopping", "Worker supervisor is stopping", { reason });
  if (child) terminateChild(reason);
  else process.exit(exitCode);
}

function watchTree(relativeRoot, accepts, recursive = true) {
  const absoluteRoot = resolve(repositoryRoot, relativeRoot);
  requiredPath(absoluteRoot, relativeRoot);
  const watcher = watch(absoluteRoot, { recursive }, (_eventType, filename) => {
    if (!filename) return;
    const normalized = String(filename).replaceAll("\\", "/");
    if (normalized.split("/").includes("node_modules") || !accepts(normalized)) return;
    requestWorkerRestart(`${relativeRoot}/${normalized}`);
  });
  watcher.on("error", () => {
    writeLog("error", "supervisor.watch_failed", "A worker code watch failed", {
      path: relativeRoot
    });
  });
  watchers.push(watcher);
}

watchTree("apps/worker/src", () => true);
watchTree("apps/worker", (path) => path === "package.json", false);
for (const packageEntry of readdirSync(resolve(repositoryRoot, "packages"), { withFileTypes: true })) {
  if (!packageEntry.isDirectory()) continue;
  const packageRoot = `packages/${packageEntry.name}`;
  if (existsSync(resolve(repositoryRoot, packageRoot, "src"))) {
    watchTree(`${packageRoot}/src`, () => true);
  }
  watchTree(packageRoot, (path) => path === "package.json", false);
}

const rootWatcher = watch(repositoryRoot, { recursive: false }, (_eventType, filename) => {
  if (!filename) return;
  const changed = String(filename);
  if ([".env.local", "pnpm-lock.yaml", "pnpm-workspace.yaml", "tsconfig.base.json"].includes(changed)) {
    requestWorkerRestart(changed);
  }
});
watchers.push(rootWatcher);

const scriptWatcher = watch(scriptDirectory, { recursive: false }, (_eventType, filename) => {
  if (!["run-worker.sh", "worker-supervisor.mjs"].includes(String(filename))) return;
  writeLog("info", "supervisor.self_update_detected", "Supervisor code changed; launchd reload requested", {
    path: `scripts/${String(filename)}`
  });
  shutdown(75, "supervisor_code_changed");
});
watchers.push(scriptWatcher);

process.once("SIGTERM", () => shutdown(0, "sigterm"));
process.once("SIGINT", () => shutdown(0, "sigint"));
process.once("uncaughtException", () => shutdown(1, "uncaught_exception"));
process.once("unhandledRejection", () => shutdown(1, "unhandled_rejection"));

writeLog("info", "supervisor.started", "Always-on worker supervisor started", {
  repositoryRoot,
  runtimeDirectory,
  watchedRoots: ["apps/worker", "packages", ".env.local", "scripts"]
});
startChild();
