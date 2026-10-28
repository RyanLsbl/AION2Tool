import { useCallback, useEffect, useState } from 'react';
import type { AppInfo, Me } from '../shared/types';
import { get, post } from './api';
import { Admin } from './components/Admin';
import { Board } from './components/Board';
import { Builder } from './components/Builder';
import { Characters } from './components/Characters';
import { Header } from './components/Header';
import { Login } from './components/Login';
import { Onboarding } from './components/Onboarding';
import { Settings } from './components/Settings';
import { BOARD_TOUR, Tour } from './components/Tour';
import { SetupWizard } from './components/Wizard';
import { Spinner } from './ui';

export type Route = 'board' | 'setup' | 'chars' | 'settings' | 'admin';
const ROUTES: Route[] = ['board', 'setup', 'chars', 'settings', 'admin'];

function readRoute(): { route: Route; sub: string } {
  const [r, sub = ''] = location.hash.replace(/^#\/?/, '').split('/');
  return { route: ROUTES.includes(r as Route) ? (r as Route) : 'board', sub };
}

export interface Session {
  me: Me;
  info: AppInfo;
  setMe: (me: Me) => void;
  reload: () => Promise<void>;
  /** Einrichtungs-Assistent bzw. Rundgang (erneut) starten */
  startWizard: () => void;
  startTour: () => void;
}

export function App() {
  const [state, setState] = useState<{ me: Me | null; info: AppInfo } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [{ route, sub }, setRoute] = useState(readRoute);
  // null = automatisch (Assistent, solange er noch nicht erledigt ist)
  const [wizard, setWizard] = useState<boolean | null>(null);
  const [tour, setTour] = useState(false);

  const reload = useCallback(async () => {
    try {
      setState(await get<{ me: Me | null; info: AppInfo }>('/api/me'));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void reload();
    const onHash = () => setRoute(readRoute());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, [reload]);

  if (error && !state) {
    return (
      <div className="center-page">
        <div className="card narrow">
          <h1>Keine Verbindung</h1>
          <p className="muted">{error}</p>
          <button className="btn" onClick={() => void reload()}>
            Erneut versuchen
          </button>
        </div>
      </div>
    );
  }
  if (!state) {
    return (
      <div className="center-page">
        <Spinner />
      </div>
    );
  }
  if (!state.me) return <Login info={state.info} />;

  const showTour = () => {
    if (route !== 'board') location.hash = '#/board';
    setTour(true);
  };
  const session: Session = {
    me: state.me,
    info: state.info,
    setMe: (me) => setState((s) => (s ? { ...s, me } : s)),
    reload,
    startWizard: () => {
      setTour(false);
      setWizard(true);
    },
    startTour: showTour,
  };
  const logout = async () => {
    await post('/api/logout').catch(() => undefined);
    location.hash = '';
    await reload();
  };

  if (state.me.access !== 'ok') {
    return (
      <>
        <Header session={session} route={null} onLogout={logout} />
        <Onboarding session={session} />
      </>
    );
  }

  // Beim ersten Login (nach der Freischaltung) führt der Assistent durch die Einrichtung
  if (wizard ?? !state.me.tutorialDone) {
    return (
      <>
        <Header session={session} route={null} onLogout={logout} />
        <SetupWizard
          session={session}
          onFinish={(startTour) => {
            setWizard(false);
            if (startTour) showTour();
          }}
        />
      </>
    );
  }

  return (
    <>
      <Header session={session} route={route} onLogout={logout} />
      {tour && <Tour steps={BOARD_TOUR} onClose={() => setTour(false)} />}
      <main className="page">
        {route === 'board' && <Board session={session} />}
        {route === 'setup' && <Builder session={session} />}
        {route === 'chars' && <Characters session={session} />}
        {route === 'settings' && <Settings session={session} onLogout={logout} />}
        {route === 'admin' && (state.me.isOfficer ? <Admin session={session} tab={sub} /> : <p className="muted">Nur für Offiziere.</p>)}
      </main>
    </>
  );
}
