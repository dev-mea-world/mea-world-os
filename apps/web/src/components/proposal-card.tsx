import type { ProposalRecord } from "@meaworld/domain";

export function ProposalCard({ proposal }: { proposal: ProposalRecord }) {
  return (
    <article className="proposal-card">
      <div className="proposal-heading">
        <div>
          <p className="eyebrow">Proposta controllata · {proposal.risk} risk</p>
          <h3>{proposal.operation}</h3>
        </div>
        <span className={`status-pill status-${proposal.status}`}>{proposal.status}</span>
      </div>
      <p>{proposal.reason}</p>
      <dl className="proposal-diff">
        <div>
          <dt>Prima</dt>
          <dd><code>{JSON.stringify(proposal.beforeSnapshot)}</code></dd>
        </div>
        <div>
          <dt>Dopo</dt>
          <dd><code>{JSON.stringify(proposal.afterSnapshot)}</code></dd>
        </div>
      </dl>
      <p className="hash-line">Hash <code>{proposal.proposalHash.slice(0, 16)}…</code></p>
      {proposal.status === "pending" ? (
        <form action={`/api/proposals/${proposal.id}/decision`} method="post" className="decision-form">
          <input type="hidden" name="expectedHash" value={proposal.proposalHash} />
          <label htmlFor={`reason-${proposal.id}`}>Nota opzionale</label>
          <input id={`reason-${proposal.id}`} name="reason" maxLength={1_000} placeholder="Motivazione sintetica" />
          <div className="decision-actions">
            <button type="submit" name="decision" value="reject" className="secondary-button">Rifiuta</button>
            <button type="submit" name="decision" value="approve" className="primary-button">Approva</button>
          </div>
        </form>
      ) : null}
    </article>
  );
}
