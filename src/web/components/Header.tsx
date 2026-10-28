import { useState } from 'react';
import type { Route, Session } from '../App';
import { toggleTheme } from './Settings';

const NAV: { route: Route; label: string; icon: string; officer?: boolean }[] = [
  { route: 'board', label: 'Checkliste', icon: '✅' },
  { route: 'setup', label: 'Mein Setup', icon: '🧩' },
  { route: 'chars', label: 'Charaktere', icon: '🧙' },
  { route: 'admin', label: 'Admin', icon: '🛡️', officer: true },
];

export function Header({ session, route, onLogout }: { session: Session; route: Route | null; onLogout: () => void }) {
  const { me, info } = session;
  const [menu, setMenu] = useState(false);
  const [help, setHelp] = useState(false);
  return (
    <header className="topbar">
      <a className="brand" href="#/">
        <img src="/favicon.svg" alt="" width={30} height={30} />
        <span>
          <strong>{info.legion}</strong>
          <small>AION2 · {info.server}</small>
        </span>
      </a>
      {route && (
        <nav className="nav">
          {NAV.filter((n) => !n.officer || me.isOfficer).map((n) => (
            <a key={n.route} href={`#/${n.route}`} className={route === n.route ? 'active' : ''} data-tour={`nav-${n.route}`} title={n.label}>
              <span aria-hidden>{n.icon}</span> <span className="nav-label">{n.label}</span>
            </a>
          ))}
        </nav>
      )}
      <div className="topbar-right">
        {route && (
          <div className="user-menu">
            <button className="icon-btn help-btn" onClick={() => setHelp((h) => !h)} aria-expanded={help} aria-label="Hilfe" title="Hilfe" data-tour="help">
              ?
            </button>
            {help && (
              <div className="dropdown" onMouseLeave={() => setHelp(false)}>
                <button
                  onClick={() => {
                    setHelp(false);
                    session.startTour();
                  }}
                >
                  🧭 Rundgang durch die Checkliste
                </button>
                <button
                  onClick={() => {
                    setHelp(false);
                    session.startWizard();
                  }}
                >
                  🪄 Einrichtungs-Assistent (Stände eintragen)
                </button>
              </div>
            )}
          </div>
        )}
        <button className="icon-btn theme-btn" onClick={toggleTheme} title="Hell/Dunkel umschalten" aria-label="Hell/Dunkel umschalten">
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden>
            <circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" strokeWidth="2" />
            <path d="M12 3.5a8.5 8.5 0 0 1 0 17z" fill="currentColor" />
          </svg>
        </button>
        <div className="user-menu">
          <button className="user-btn" onClick={() => setMenu((m) => !m)} aria-expanded={menu}>
            {me.avatar ? <img src={me.avatar} alt="" width={28} height={28} /> : <span className="avatar-fallback">{me.name.slice(0, 1)}</span>}
            <span className="user-name">{me.name}</span>
          </button>
          {menu && (
            <div className="dropdown" onMouseLeave={() => setMenu(false)}>
              {route && (
                <a href="#/settings" onClick={() => setMenu(false)}>
                  ⚙️ Einstellungen
                </a>
              )}
              <button onClick={onLogout}>🚪 Abmelden</button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
