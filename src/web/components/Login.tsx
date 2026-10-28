import type { AppInfo } from '../../shared/types';

export function Login({ info }: { info: AppInfo }) {
  const error = new URLSearchParams(location.search).get('loginError');
  return (
    <div className="center-page login-page">
      <div className="card login-card">
        <img src="/favicon.svg" alt="" width={72} height={72} className="login-logo" />
        <h1>Legion {info.legion}</h1>
        <p className="lead">Daily- &amp; Weekly-Checkliste für AION2 · {info.server}</p>
        <ul className="login-points">
          <li>⚡ Odyl-Energie, Albtraum-Tickets &amp; Shugo-Schlüssel werden automatisch hochgerechnet</li>
          <li>🔔 Warnung, bevor Tickets überlaufen oder Kontingente verfallen</li>
          <li>🧩 Eigene Checkliste zusammenbauen – für Main und Twinks</li>
        </ul>
        {error && <p className="alert alert-danger">{error}</p>}
        <a className="btn btn-steam" href="/auth/steam">
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden>
            <path fill="currentColor" d="M12 2a10 10 0 0 0-9.96 9.04l5.35 2.21a2.83 2.83 0 0 1 1.6-.49h.16l2.38-3.45v-.05a3.77 3.77 0 1 1 3.77 3.77h-.09l-3.4 2.42v.13a2.84 2.84 0 0 1-5.62.57L2.4 14.6A10 10 0 1 0 12 2Zm-4.72 15.2-1.22-.5a2.13 2.13 0 1 0 1.17-2.9l1.27.52a1.57 1.57 0 1 1-1.22 2.88Zm9.1-5.47a2.51 2.51 0 1 0-2.5-2.51 2.51 2.51 0 0 0 2.5 2.5Zm0-4.4a1.89 1.89 0 1 1-1.88 1.9 1.89 1.89 0 0 1 1.88-1.9Z" />
          </svg>
          Mit Steam anmelden
        </a>
        {info.devLogin && (
          <a className="btn btn-ghost" href="/auth/dev">
            Test-Login (DEV_LOGIN)
          </a>
        )}
        <p className="fine">Nur für Mitglieder der Legion {info.legion}. Nach dem Login trägst du deinen Main ein – wir prüfen über PlayNC, ob er in der Legion ist.</p>
      </div>
    </div>
  );
}
