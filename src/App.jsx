import { useState } from 'react';
import ArenaView from './pages/ArenaView';
import CourtView from './pages/CourtView';

export default function App() {
  const [view, setView] = useState('court'); // 'court' | 'arena'

  return (
    <div
      style={{
        minHeight: '100vh',
        background: '#07080d',
        color: '#e2e8f0',
        fontFamily: "'DM Sans','Segoe UI',sans-serif",
      }}
    >
      {/* ── Global Navigation ───────────────────────────────── */}
      <nav
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 0,
          padding: '0 28px',
          background: '#0b0c17',
          borderBottom: '1px solid #1e2433',
          position: 'sticky',
          top: 0,
          zIndex: 200,
        }}
      >
        {/* Logo / Brand */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            marginRight: 28,
            padding: '14px 0',
          }}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M3 18h18M12 2v4M8 6l4-4 4 4M5 18V8l7-3 7 3v10" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span
            style={{
              fontSize: 15,
              fontWeight: 700,
              letterSpacing: '-0.02em',
              color: '#e2e8f0',
            }}
          >
            Arabic STT
            <span style={{ color: '#475569', fontWeight: 400 }}> Platform</span>
          </span>
        </div>

        {/* Tab buttons */}
        {[
          { key: 'court', label: '⚖️ Court Transcription', accent: '#e0a020' },
          { key: 'arena', label: '⚡ STT Arena', accent: '#00C6C6' },
        ].map((tab) => {
          const active = view === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => setView(tab.key)}
              style={{
                padding: '14px 20px',
                fontSize: 13,
                fontWeight: 600,
                color: active ? tab.accent : '#475569',
                background: 'transparent',
                border: 'none',
                borderBottom: `2px solid ${active ? tab.accent : 'transparent'}`,
                cursor: 'pointer',
                transition: 'color 0.2s, border-color 0.2s',
                fontFamily: 'inherit',
              }}
            >
              {tab.label}
            </button>
          );
        })}

        <div style={{ flex: 1 }} />

        {/* View indicator */}
        <span
          style={{
            fontSize: 10,
            fontFamily: 'Space Mono, monospace',
            color: '#334155',
            letterSpacing: '0.08em',
          }}
        >
          {view === 'court' ? 'COURT MODE' : 'ARENA MODE'}
        </span>
      </nav>

      {/* ── Active View ─────────────────────────────────────── */}
      {view === 'court' ? <CourtView /> : <ArenaView />}
    </div>
  );
}

