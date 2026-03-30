import { useEffect, useState } from 'react';
import ArenaView from './pages/ArenaView';
import CourtView from './pages/CourtView';

export default function App() {
  const [view, setView] = useState('court');
  const [theme, setTheme] = useState(() => {
    const saved = localStorage.getItem('stt_theme');
    if (saved === 'light' || saved === 'dark') return saved;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('stt_theme', theme);
  }, [theme]);

  return (
    <div className="app-shell">
      <nav className="app-nav">
        <div className="app-brand">
          <span className="app-brand-title">STT Notery Public</span>
          <span className="app-brand-subtitle">Arabic Speech Platform</span>
        </div>

        <div className="app-tabs" role="tablist" aria-label="Application mode">
          <button
            className={`app-tab ${view === 'court' ? 'active' : ''}`}
            onClick={() => setView('court')}
          >
            Court
          </button>
          <button
            className={`app-tab ${view === 'arena' ? 'active' : ''}`}
            onClick={() => setView('arena')}
          >
            Arena
          </button>
        </div>

        <div style={{ flex: 1 }} />

        <button
          className="stt-btn stt-btn-ghost"
          onClick={() => setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'))}
          style={{ minWidth: 88 }}
        >
          {theme === 'dark' ? 'Light' : 'Dark'}
        </button>
      </nav>

      {view === 'court' ? <CourtView /> : <ArenaView />}
    </div>
  );
}

