import { useState, useEffect } from 'react';
import { authFetch } from './AccessGate';

const PROVIDERS = [
  { id: 'deepgram', name: 'Deepgram Nova-3', color: '#00C6C6', flag: '🇺🇸' },
  { id: 'munsit', name: 'Munsit', color: '#FF6B35', flag: '🇦🇪' },
  { id: 'soniox', name: 'Soniox', color: '#059669', flag: '🇺🇸' },
  { id: 'speechmatics', name: 'Speechmatics', color: '#8b5cf6', flag: '🇬🇧' },
  { id: 'azure', name: 'Azure Speech', color: '#0078d4', flag: '🔷' },
];

export default function ApiKeySettings({ open, onClose }) {
  const [keys, setKeys] = useState({ deepgram: '', munsit: '', soniox: '', speechmatics: '', azure: '' });
  const [keyStatus, setKeyStatus] = useState({});
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (open) {
      authFetch('/api/keys/status')
        .then((r) => r.json())
        .then(setKeyStatus)
        .catch(() => {});
      setMessage('');
    }
  }, [open]);

  const handleSave = async () => {
    setSaving(true);
    setMessage('');
    try {
      // Only send non-empty keys
      const payload = {};
      Object.entries(keys).forEach(([k, v]) => {
        if (v.trim()) payload[k] = v.trim();
      });

      if (Object.keys(payload).length === 0) {
        setMessage('Enter at least one key to update');
        setSaving(false);
        return;
      }

      const res = await authFetch('/api/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        setMessage('Keys updated successfully');
        setKeys({ deepgram: '', munsit: '', soniox: '', speechmatics: '', azure: '' });
        const status = await authFetch('/api/keys/status').then((r) => r.json());
        setKeyStatus(status);
      }
    } catch (err) {
      setMessage('Failed to update keys');
    }
    setSaving(false);
  };

  if (!open) return null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        background: '#07080dcc',
        backdropFilter: 'blur(8px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: '#0b0c17',
          border: '1px solid #1e2433',
          borderRadius: 16,
          padding: 28,
          maxWidth: 520,
          width: '100%',
          maxHeight: '90vh',
          overflowY: 'auto',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Title bar */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div>
            <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>🔑 API Keys</h2>
            <p style={{ fontSize: 11, color: '#475569', marginTop: 4, fontFamily: 'Space Mono, monospace' }}>
              Centralized key management — .env or runtime
            </p>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              color: '#475569',
              fontSize: 20,
              cursor: 'pointer',
              padding: 4,
            }}
          >
            ✕
          </button>
        </div>

        {/* Info box */}
        <div
          style={{
            background: '#131720',
            borderRadius: 8,
            padding: '10px 14px',
            marginBottom: 20,
            fontSize: 11,
            color: '#475569',
            lineHeight: 1.7,
            border: '1px solid #1e2433',
            fontFamily: 'Space Mono, monospace',
          }}
        >
          <strong style={{ color: '#7e9ab0' }}>Primary:</strong> Set keys in{' '}
          <strong style={{ color: '#00C6C6' }}>.env</strong> file (persists across restarts).
          <br />
          <strong style={{ color: '#7e9ab0' }}>Runtime:</strong> Enter below to update keys for the current session only.
        </div>

        {/* Key inputs */}
        {PROVIDERS.map((p) => (
          <div key={p.id} style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <span>{p.flag}</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: p.color }}>{p.name}</span>
              <span
                style={{
                  fontSize: 9,
                  fontWeight: 700,
                  fontFamily: 'Space Mono, monospace',
                  padding: '2px 6px',
                  borderRadius: 3,
                  background: keyStatus[p.id] ? '#22c55e18' : '#ef444418',
                  color: keyStatus[p.id] ? '#4ade80' : '#f87171',
                  border: `1px solid ${keyStatus[p.id] ? '#22c55e30' : '#ef444430'}`,
                }}
              >
                {keyStatus[p.id] ? '✓ SET' : '✗ MISSING'}
              </span>
            </div>
            <input
              type="password"
              placeholder={
                keyStatus[p.id] ? '••••••• (already set — enter to update)' : `Enter ${p.name} API key`
              }
              value={keys[p.id]}
              onChange={(e) => setKeys((prev) => ({ ...prev, [p.id]: e.target.value }))}
              style={{
                width: '100%',
                padding: '9px 12px',
                background: '#07080d',
                border: '1px solid #1e2433',
                borderRadius: 6,
                color: '#e2e8f0',
                fontSize: 12,
                fontFamily: 'Space Mono, monospace',
                outline: 'none',
              }}
              onFocus={(e) => (e.target.style.borderColor = p.color)}
              onBlur={(e) => (e.target.style.borderColor = '#1e2433')}
            />
          </div>
        ))}

        {/* Status message */}
        {message && (
          <div
            style={{
              fontSize: 11,
              marginBottom: 12,
              padding: '6px 10px',
              borderRadius: 4,
              fontFamily: 'Space Mono, monospace',
              background: message.includes('success') ? '#22c55e12' : '#ef444412',
              color: message.includes('success') ? '#4ade80' : '#f87171',
            }}
          >
            {message}
          </div>
        )}

        {/* Save button */}
        <button
          onClick={handleSave}
          disabled={saving}
          style={{
            width: '100%',
            padding: '10px 16px',
            background: '#00C6C618',
            border: '1.5px solid #00C6C640',
            borderRadius: 8,
            color: '#00C6C6',
            fontSize: 13,
            fontWeight: 700,
            cursor: 'pointer',
            fontFamily: 'DM Sans, sans-serif',
            opacity: saving ? 0.6 : 1,
          }}
        >
          {saving ? 'Saving…' : 'Update Keys'}
        </button>
      </div>
    </div>
  );
}
