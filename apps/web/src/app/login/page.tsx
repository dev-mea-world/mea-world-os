import { hasValidSession } from "@/lib/auth";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  if (await hasValidSession()) redirect("/");

  return (
    <main className="login-shell">
      <section className="login-card">
        <div className="brand-mark" aria-hidden="true">M</div>
        <p className="eyebrow">MeaWorld · Control plane</p>
        <h1>Company OS</h1>
        <p className="muted">
          Accesso riservato alla vertical slice di Phase 0.
        </p>
        <form action="/api/auth/login" method="post" className="login-form">
          <label className="visually-hidden" htmlFor="username">Account</label>
          <input
            className="visually-hidden"
            id="username"
            name="username"
            type="text"
            value="meaworld-control-plane"
            autoComplete="username"
            readOnly
            tabIndex={-1}
          />
          <label htmlFor="accessCode">Codice di accesso</label>
          <input
            id="accessCode"
            name="accessCode"
            type="password"
            autoComplete="current-password"
            minLength={8}
            required
            autoFocus
          />
          <button type="submit" className="primary-button">Entra nel sistema</button>
        </form>
        <p className="security-note">Sessione HTTP-only · tentativi limitati · nessun segreto nel browser</p>
      </section>
    </main>
  );
}
