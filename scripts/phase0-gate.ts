import { execFileSync } from "node:child_process";
import { connectPostgres } from "../packages/db/src/index.ts";

type GateStatus = "PASS" | "FAIL" | "BLOCKED";

interface GateResult {
  status: GateStatus;
  evidence: string;
}

function gitValue(arguments_: string[]): string | null {
  try {
    return execFileSync("git", arguments_, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() || null;
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  const connection = connectPostgres(databaseUrl, { max: 1 });
  try {
    const query = <Row extends Record<string, unknown>>(statement: string) =>
      connection.database.query<Row>(statement);
    const [
      migrations,
      sessions,
      workers,
      codexRuns,
      recoveryEvents,
      leaseRenewals,
      decisions,
      auditGaps,
      notionRuns,
      gitPublications
    ] = await Promise.all([
      query<{ count: number }>("SELECT COUNT(*)::integer AS count FROM schema_migrations"),
      query<{ created: number; revoked: number }>(
        `SELECT COUNT(*)::integer AS created,
           COUNT(*) FILTER (WHERE revoked_at IS NOT NULL)::integer AS revoked
         FROM sessions`
      ),
      query<{ count: number }>(
        `SELECT COUNT(*)::integer AS count FROM workers
         WHERE revoked_at IS NULL AND last_heartbeat_at > CURRENT_TIMESTAMP - INTERVAL '10 minutes'`
      ),
      query<{ count: number }>(
        `SELECT COUNT(*)::integer AS count FROM runs
         WHERE status = 'succeeded' AND CASE jsonb_typeof(output)
           WHEN 'object' THEN output->>'marker'
           WHEN 'string' THEN ((output #>> '{}')::jsonb)->>'marker'
           ELSE NULL
         END = 'PHASE0_CODEX_OK'`
      ),
      query<{ count: number }>(
        `SELECT COUNT(*)::integer AS count FROM events
         WHERE type IN ('run.interrupted', 'task.recovered_and_leased')`
      ),
      query<{ count: number }>(
        "SELECT COUNT(*)::integer AS count FROM events WHERE type = 'task.lease_renewed'"
      ),
      query<{ count: number }>("SELECT COUNT(*)::integer AS count FROM proposal_decisions"),
      query<{ count: number }>(
        `SELECT COUNT(*)::integer AS count FROM (
           SELECT aggregate_type, aggregate_id
           FROM events
           GROUP BY aggregate_type, aggregate_id
           HAVING MIN(aggregate_version) <> 1
              OR MAX(aggregate_version) <> COUNT(*)
         ) gaps`
      ),
      query<{ status: string; sampled_count: number; error_code: string | null }>(
        "SELECT status, sampled_count, error_code FROM notion_sample_runs ORDER BY sampled_at DESC LIMIT 1"
      ),
      query<{ remote: string; target_branch: string; commit_sha: string }>(
        `SELECT remote, target_branch, commit_sha
         FROM git_publications
         WHERE stage = 'verified' AND commit_sha = remote_sha
         ORDER BY updated_at DESC LIMIT 1`
      )
    ]);

    const count = (rows: Array<{ count: number }>) => Number(rows[0]?.count ?? 0);
    const sessionRow = sessions[0];
    const notion = notionRuns[0];
    const originUrl = gitValue(["remote", "get-url", "origin"]);
    const localHead = gitValue(["rev-parse", "HEAD"]);
    const upstreamHead = gitValue(["rev-parse", "@{upstream}"]);
    const remoteMainOutput = gitValue(["ls-remote", "--heads", "origin", "refs/heads/main"]);
    const remoteMainHead = remoteMainOutput?.split(/\s+/)[0] ?? null;
    const githubUpstreamReady = Boolean(
      originUrl?.match(/github\.com[:/]/)
      && localHead
      && localHead === upstreamHead
      && localHead === remoteMainHead
    );
    const gitPublication = gitPublications[0];
    const publicationRemoteOutput = gitPublication
      ? gitValue([
          "ls-remote",
          "--heads",
          gitPublication.remote,
          `refs/heads/${gitPublication.target_branch}`
        ])
      : null;
    const publicationRemoteHead = publicationRemoteOutput?.split(/\s+/)[0] ?? null;
    const gates: Record<string, GateResult> = {
      postgres_migrations: count(migrations) > 0
        ? { status: "PASS", evidence: `${count(migrations)} migration(s) applied` }
        : { status: "FAIL", evidence: "No applied migrations" },
      dashboard_auth: Number(sessionRow?.created ?? 0) > 0 && Number(sessionRow?.revoked ?? 0) > 0
        ? { status: "PASS", evidence: "Live login and logout sessions persisted" }
        : { status: "FAIL", evidence: "No complete live login/logout evidence" },
      worker_heartbeat: count(workers) > 0
        ? { status: "PASS", evidence: "Authenticated worker heartbeat is fresh" }
        : { status: "FAIL", evidence: "No fresh worker heartbeat" },
      codex_runtime: count(codexRuns) > 0
        ? { status: "PASS", evidence: `${count(codexRuns)} Codex run(s) returned the expected marker` }
        : { status: "FAIL", evidence: "No successful Codex marker persisted" },
      restart_recovery: count(recoveryEvents) >= 2
        ? { status: "PASS", evidence: "Interrupted run and recovered lease events both exist" }
        : { status: "FAIL", evidence: "Recovery event pair is incomplete" },
      active_lease_renewal: count(leaseRenewals) > 0
        ? { status: "PASS", evidence: `${count(leaseRenewals)} active lease renewal event(s) persisted` }
        : { status: "FAIL", evidence: "No active lease renewal has been exercised" },
      fake_approval: count(decisions) > 0
        ? { status: "PASS", evidence: `${count(decisions)} hash-bound decision(s) persisted` }
        : { status: "FAIL", evidence: "No proposal decision persisted" },
      audit_continuity: count(auditGaps) === 0
        ? { status: "PASS", evidence: "No aggregate-version gaps in append-only events" }
        : { status: "FAIL", evidence: `${count(auditGaps)} aggregate(s) have audit gaps` },
      notion_runtime_read: notion?.status === "sampled" && Number(notion.sampled_count) > 0
        ? { status: "PASS", evidence: `${Number(notion.sampled_count)} bounded object(s) sampled` }
        : { status: "BLOCKED", evidence: `Runtime Notion sample unavailable (${notion?.error_code ?? "not_configured"})` },
      github_push: githubUpstreamReady
        ? { status: "PASS", evidence: `Live GitHub main contains local HEAD ${localHead?.slice(0, 8)}` }
        : { status: "BLOCKED", evidence: "Live GitHub main does not contain the local HEAD" },
      automatic_git_publication: gitPublication?.commit_sha === publicationRemoteHead
        ? {
            status: "PASS",
            evidence: `Verified automatic commit ${publicationRemoteHead.slice(0, 8)} is on ${gitPublication.target_branch}`
          }
        : {
            status: "BLOCKED",
            evidence: "No PostgreSQL-verified automatic publication matches the live remote branch"
          },
      vercel_reachability: { status: "BLOCKED", evidence: "No Vercel project/deployment is configured" }
    };

    process.stdout.write(`${JSON.stringify({ checkedAt: new Date().toISOString(), gates }, null, 2)}\n`);
    if (Object.values(gates).some((gate) => gate.status === "FAIL")) process.exitCode = 1;
  } finally {
    await connection.close();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : "Unknown gate error"}\n`);
  process.exitCode = 1;
});
