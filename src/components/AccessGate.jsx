import { useState, useEffect } from 'react';

/**
 * If the server has ACCESS_CODE set, this component blocks the app
 * behind a simple code-entry screen. The verified code is stored
 * in sessionStorage so it survives page refreshes within the tab.
 */
export default function AccessGate({ children }) {
  const [state, setState] = useState('loading'); // loading | open | locked
  const [code, setCode] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/auth/status')
      .then((r) => r.json())
      .then((data) => {
        if (!data.required) {
          setState('open');
        } else {
          // Check if we already verified this session
          const saved = sessionStorage.getItem('access_code');
          if (saved) {
            verify(saved, true);
          } else {
            setState('locked');
          }
        }
      })
      .catch(() => setState('open')); // if server unreachable, let it through
  }, []);

  async function verify(value, silent) {
    try {
      const res = await fetch('/api/auth/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: value }),
      });
      const data = await res.json();
      if (data.ok) {
        sessionStorage.setItem('access_code', value);
        setState('open');
      } else {
        sessionStorage.removeItem('access_code');
        if (!silent) setError('Invalid access code');
        setState('locked');
      }
    } catch {
      if (!silent) setError('Connection error');
      setState('locked');
    }
  }

  function handleSubmit(e) {
    e.preventDefault();
    setError('');
    verify(code.trim());
  }

  if (state === 'loading') {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ color: 'var(--muted)', fontSize: 14 }}>Loading...</span>
      </div>
    );
  }

  if (state === 'open') return children;

  // Locked — show code entry
  return (
    <div
      style={{
        minHeight: '100vh',
        background: 'var(--bg)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: 'Manrope, sans-serif',
      }}
    >
      <form
        onSubmit={handleSubmit}
        style={{
          background: 'var(--panel)',
          border: '1px solid var(--border)',
          borderRadius: 16,
          padding: '40px 36px',
          maxWidth: 380,
          width: '100%',
          textAlign: 'center',
        }}
      >
        <div style={{ fontSize: 32, marginBottom: 12 }}>Lock</div>
        <h2 style={{ color: 'var(--text)', fontSize: 18, fontWeight: 700, margin: '0 0 6px' }}>
          Access Required
        </h2>
        <p style={{ color: 'var(--muted)', fontSize: 13, margin: '0 0 24px', lineHeight: 1.5 }}>
          Enter the access code to use the Arabic STT Platform.
        </p>

        <input
          type="password"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="Access code"
          autoFocus
          style={{
            width: '100%',
            padding: '12px 16px',
            borderRadius: 8,
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            color: 'var(--text)',
            fontSize: 14,
            outline: 'none',
            fontFamily: 'JetBrains Mono, monospace',
            boxSizing: 'border-box',
            marginBottom: 12,
          }}
        />

        {error && (
          <div style={{ color: 'var(--danger)', fontSize: 12, marginBottom: 12 }}>{error}</div>
        )}

        <button
          type="submit"
          disabled={!code.trim()}
          className="stt-btn"
          style={{
            width: '100%',
            padding: '12px 0',
            background: code.trim() ? 'var(--accent)' : 'var(--surface)',
            border: `1px solid ${code.trim() ? 'var(--accent)' : 'var(--border)'}`,
            color: code.trim() ? '#fff' : 'var(--muted)',
            fontSize: 14,
            fontWeight: 700,
            cursor: code.trim() ? 'pointer' : 'default',
            transition: 'all 0.2s',
          }}
        >
          Verify
        </button>
      </form>
    </div>
  );
}

/**
 * Helper to retrieve the stored access code (for WS connections).
 */
export function getAccessCode() {
  return sessionStorage.getItem('access_code') || '';
}

/**
 * Helper to build fetch options with the access code Authorization header.
 * Merges with any existing options.
 */
export function authFetch(url, opts = {}) {
  const code = getAccessCode();
  if (code) {
    opts.headers = { ...opts.headers, Authorization: `Bearer ${code}` };
  }
  return fetch(url, opts);
}
