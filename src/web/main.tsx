import { StrictMode, useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { api, type Catalog, type Settings } from './api';
import { AppCtx, Icon, useRoute, useToasts, type Draft } from './components/ui';
import { Dashboard } from './pages/Dashboard';
import { Analyze } from './pages/Analyze';
import { Admin } from './pages/Admin';
import { Discovery } from './pages/Discovery';
import { Builder } from './pages/Builder';
import { Library } from './pages/Library';
import { Workspace } from './pages/Workspace';
import { Backtests } from './pages/Backtests';
import { Research } from './pages/Research';
import { SettingsPage } from './pages/Settings';

const NAV = [
  { path: '/', label: 'Market Dashboard', icon: 'home' },
  { path: '/discover', label: 'Strategy Discovery', icon: 'star' },
  { group: 'Advanced tools' },
  { path: '/overview', label: 'Scripts Overview', icon: 'layers' },
  { path: '/builder', label: 'Strategy Builder', icon: 'wand' },
  { path: '/library', label: 'Strategy Library', icon: 'book' },
  { path: '/scripts', label: 'Scripts & Launcher', icon: 'code' },
  { path: '/backtests', label: 'Backtest Analysis', icon: 'chart' },
  { path: '/research', label: 'Market Research', icon: 'globe' },
  { path: '/settings', label: 'Settings', icon: 'gear' },
  { group: 'Administration' },
  { path: '/admin', label: 'Administrator', icon: 'layers' },
];

function App() {
  const route = useRoute();
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [theme, setTheme] = useState<string>(() => {
    try {
      return localStorage.getItem('pf-theme') ?? 'system';
    } catch {
      return 'system';
    }
  });
  const { toast, view } = useToasts();
  const go = useCallback((p: string) => {
    location.hash = p;
  }, []);
  const reloadSettings = useCallback(() => {
    api.settings().then(setSettings).catch(() => undefined);
  }, []);
  useEffect(() => {
    // Retry until the API answers (it may be restarting), instead of leaving the app without a catalog.
    let timer: ReturnType<typeof setTimeout>;
    let warned = false;
    const loadCatalog = () =>
      api
        .catalog()
        .then((c) => {
          setCatalog(c);
          reloadSettings();
        })
        .catch((e) => {
          if (!warned) toast(`Cannot reach the API: ${e.message} — retrying…`, 'bad');
          warned = true;
          timer = setTimeout(loadCatalog, 3000);
        });
    loadCatalog();
    return () => clearTimeout(timer);
  }, [toast, reloadSettings]);
  useEffect(() => {
    if (theme === 'system') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', theme);
    try {
      localStorage.setItem('pf-theme', theme);
    } catch {
      /* storage unavailable */
    }
  }, [theme]);

  const [, top, sub] = route.split('/');
  let page;
  switch (top) {
    case 'builder':
      page = <Builder />;
      break;
    case 'library':
      page = <Library />;
      break;
    case 'scripts':
      page = <Workspace scriptId={sub} />;
      break;
    case 'backtests':
      page = <Backtests selected={sub} />;
      break;
    case 'research':
      page = <Research />;
      break;
    case 'settings':
      page = <SettingsPage />;
      break;
    case 'discover':
      page = <Discovery />;
      break;
    case 'admin':
      page = <Admin />;
      break;
    case 'overview':
      page = <Dashboard />;
      break;
    default:
      page = <Analyze />;
  }
  const active = '/' + (top ?? '');
  return (
    <AppCtx.Provider value={{ catalog, settings, reloadSettings, draft, setDraft, toast, go }}>
      <div className="app">
        <nav className="sidebar" aria-label="Main">
          <div className="brand">
            <span className="brand-mark">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 17l6-7 4 4 8-9" />
              </svg>
            </span>
            Pine Forge
          </div>
          {NAV.map((n) =>
            !n.path ? (
              <div key={n.group} className="nav-group">
                {n.group}
              </div>
            ) : (
              <a key={n.path} href={`#${n.path}`} className={`nav-item ${active === n.path || (n.path === '/' && active === '/') ? 'active' : ''}`}>
                <Icon name={n.icon} />
                <span>{n.label}</span>
              </a>
            ),
          )}
          <div className="sidebar-foot">
            <label className="field">
              Theme
              <select value={theme} onChange={(e) => setTheme(e.target.value)}>
                <option value="system">System</option>
                <option value="light">Light</option>
                <option value="dark">Dark</option>
              </select>
            </label>
            <span>Pine Script v6 · educational tool. Not investment advice.</span>
          </div>
        </nav>
        <main className="main">{page}</main>
      </div>
      {view}
    </AppCtx.Provider>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
