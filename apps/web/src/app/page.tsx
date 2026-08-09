import { requireDashboardSession } from "@/lib/auth";
import { getStore } from "@/lib/db";
import { ProposalCard } from "@/components/proposal-card";
import { LiveRefresh } from "@/components/live-refresh";

export const dynamic = "force-dynamic";

function formatDate(value: string | null): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("it-IT", {
    dateStyle: "short",
    timeStyle: "medium",
    timeZone: "Europe/Rome"
  }).format(new Date(value));
}

export default async function DashboardPage() {
  await requireDashboardSession();
  const snapshot = await getStore().dashboardSnapshot();
  const activeTasks = snapshot.tasks.filter((task) => ["ready", "leased", "running"].includes(task.status));
  const pendingProposals = snapshot.proposals.filter((proposal) => proposal.status === "pending");
  const activeRun = snapshot.worker?.activeRunId
    ? snapshot.runs.find((run) => run.id === snapshot.worker?.activeRunId) ?? null
    : null;
  const activeTask = activeRun
    ? snapshot.tasks.find((task) => task.id === activeRun.taskId) ?? null
    : null;

  return (
    <main className="dashboard-shell">
      <LiveRefresh />
      <header className="topbar">
        <div>
          <p className="eyebrow">MeaWorld · Autonomous Company OS</p>
          <h1>Foundation control plane</h1>
        </div>
        <div className="topbar-actions">
          <span className={`system-state state-${snapshot.systemStatus}`}>
            <span aria-hidden="true" />{snapshot.systemStatus}
          </span>
          <form action="/api/auth/logout" method="post">
            <button className="text-button" type="submit">Esci</button>
          </form>
        </div>
      </header>

      <section className="metric-grid" aria-label="Stato Phase 0">
        <article className="metric-card">
          <p>Mac worker</p>
          <strong>{activeTask ? "running" : snapshot.worker?.status === "online" ? "idle" : snapshot.worker?.status ?? "missing"}</strong>
          <span>{activeTask ? activeTask.objective : "In attesa di nuove task"}</span>
        </article>
        <article className="metric-card">
          <p>Work queue</p>
          <strong>{activeTasks.length}</strong>
          <span>{snapshot.runs.filter((run) => run.status === "running").length} run attive</span>
        </article>
        <article className="metric-card">
          <p>Notion sample</p>
          <strong>{snapshot.notion.sampledCount}</strong>
          <span>{snapshot.notion.status} · sample only</span>
        </article>
        <article className="metric-card">
          <p>Decision inbox</p>
          <strong>{pendingProposals.length}</strong>
          <span>proposte in attesa</span>
        </article>
        <article className="metric-card">
          <p>Telegram operator</p>
          <strong>{snapshot.telegram.paired ? "paired" : "off"}</strong>
          <span>{snapshot.telegram.failedNotifications > 0
            ? `${snapshot.telegram.failedNotifications} notifiche fallite/ambigue`
            : snapshot.telegram.pendingConfirmations > 0
              ? `${snapshot.telegram.pendingConfirmations} interazioni richieste · ${snapshot.telegram.pendingNotifications} notifiche in uscita`
            : snapshot.telegram.lastCommand
              ? `${snapshot.telegram.lastCommand} · ${formatDate(snapshot.telegram.lastUpdateAt)} · ${snapshot.telegram.pendingNotifications} notifiche in uscita`
              : "Nessun comando ricevuto"}</span>
        </article>
      </section>

      <div className="dashboard-columns">
        <section className="panel work-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Durable work</p>
              <h2>Task e run</h2>
            </div>
            <span>{snapshot.tasks.length} recenti</span>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Task</th><th>Stato</th><th>Run</th><th>Tentativo</th><th>Aggiornata</th></tr>
              </thead>
              <tbody>
                {snapshot.tasks.map((task) => (
                  (() => {
                    const run = snapshot.runs.find((candidate) => candidate.taskId === task.id);
                    const response = run?.output?.response;
                    return (
                      <tr key={task.id}>
                        <td>
                          <strong>{task.kind}</strong>
                          <span>{task.objective}</span>
                          {typeof response === "string" ? <span>Risposta: {response}</span> : null}
                        </td>
                        <td><span className={`status-pill status-${task.status}`}>{task.status}</span></td>
                        <td>{run ? <><strong>{run.status}</strong><span>{run.id}</span></> : "—"}</td>
                        <td>{task.attemptCount}/{task.maxAttempts}</td>
                        <td>{formatDate(task.updatedAt)}</td>
                      </tr>
                    );
                  })()
                ))}
                {snapshot.tasks.length === 0 ? (
                  <tr><td colSpan={5} className="empty-state">Nessuna task. Invia una richiesta dal bot Telegram.</td></tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>

        <section className="panel audit-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Append-only</p>
              <h2>Audit trail</h2>
            </div>
            <span>{snapshot.events.length} eventi</span>
          </div>
          <ol className="event-list">
            {snapshot.events.map((event) => (
              <li key={event.id}>
                <span className="event-dot" aria-hidden="true" />
                <div><strong>{event.type}</strong><p>{event.actorType} · {event.actorId.slice(0, 14)}</p></div>
                <time>{formatDate(event.occurredAt)}</time>
              </li>
            ))}
            {snapshot.events.length === 0 ? <li className="empty-state">Nessun evento.</li> : null}
          </ol>
        </section>
      </div>

      <section className="panel decisions-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Human control</p>
            <h2>Decision inbox</h2>
          </div>
          <span>Le decisioni sono legate all’hash mostrato</span>
        </div>
        <div className="proposal-grid">
          {snapshot.proposals.map((proposal) => <ProposalCard key={proposal.id} proposal={proposal} />)}
          {snapshot.proposals.length === 0 ? <p className="empty-state">Nessuna proposta.</p> : null}
        </div>
      </section>

      <footer>
        <span>Live · aggiornamento ogni 5 secondi · snapshot {formatDate(snapshot.generatedAt)}</span>
        <span>Notion read-only · azioni Telegram tracciate</span>
      </footer>
    </main>
  );
}
