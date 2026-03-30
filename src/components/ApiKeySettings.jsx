import { useState, useEffect } from 'react';
import { authFetch } from './AccessGate';

const PROVIDERS = [
  { id: 'deepgram', name: 'Deepgram Nova-3', color: '#00C6C6', badge: 'DG' },
  { id: 'munsit', name: 'Munsit', color: '#FF6B35', badge: 'MU' },
  { id: 'soniox', name: 'Soniox', color: '#059669', badge: 'SX' },
  { id: 'speechmatics', name: 'Speechmatics', color: '#8b5cf6', badge: 'SM' },
  { id: 'azure', name: 'Azure Speech', color: '#0078d4', badge: 'AZ' },
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
      } else {
        setMessage('Failed to update keys');
      }
    } catch (_) {
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
        background: 'rgba(8, 12, 20, 0.55)',
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
          background: 'var(--panel)',
          border: '1px solid var(--border)',
          borderRadius: 14,
          padding: 24,
          maxWidth: 560,
          width: '100%',
          maxHeight: '90vh',
          overflowY: 'auto',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
          <div>
            <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0, color: 'var(--text)' }}>API Keys</h2>
            <p style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4, fontFamily: 'JetBrains Mono, monospace' }}>
              Runtime key update for this session
            </p>
          </div>
          <button className="stt-btn stt-btn-ghost" onClick={onClose} style={{ padding: '4px 9px' }}>
            Close
          </button>
        </div>

        <div
          style={{
            background: 'var(--surface)',
            borderRadius: 8,
            padding: '10px 12px',
            marginBottom: 18,
            fontSize: 11,
            color: 'var(--muted)',
            lineHeight: 1.6,
            border: '1px solid var(--border)',
            fontFamily: 'JetBrains Mono, monospace',
          }}
        >
          Keys in this modal update the running server process only. For persistent keys, keep values in .env.
        </div>

        {PROVIDERS.map((p) => (
          <div key={p.id} style={{ marginBottom: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 800,
                  borderRadius: 5,
                  border: `1px solid ${p.color}`,
                  color: p.color,
                  padding: '1px 5px',
                  fontFamily: 'JetBrains Mono, monospace',
                }}
              >
                {p.badge}
              </span>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{p.name}</span>
              <span
                style={{
                  fontSize: 9,
                  fontWeight: 700,
                  fontFamily: 'JetBrains Mono, monospace',
                  padding: '2px 6px',
                  borderRadius: 4,
                  background: keyStatus[p.id] ? 'var(--success-soft)' : 'var(--danger-soft)',
                  color: keyStatus[p.id] ? 'var(--success)' : 'var(--danger)',
                }}
              >
                {keyStatus[p.id] ? 'SET' : 'MISSING'}
              </span>
            </div>

            <input
              type="password"
              placeholder={keyStatus[p.id] ? 'Already set, enter new value to replace' : `Enter ${p.name} key`}
              value={keys[p.id]}
              onChange={(e) => setKeys((prev) => ({ ...prev, [p.id]: e.target.value }))}
              style={{
                width: '100%',
                padding: '9px 12px',
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: 6,
                color: 'var(--text)',
                fontSize: 12,
                fontFamily: 'JetBrains Mono, monospace',
              }}
            />
          </div>
        ))}

        {message && (
          <div
            style={{
              fontSize: 11,
              marginBottom: 12,
              padding: '8px 10px',
              borderRadius: 6,
              fontFamily: 'JetBrains Mono, monospace',
              background: message.includes('success') ? 'var(--success-soft)' : 'var(--danger-soft)',
              color: message.includes('success') ? 'var(--success)' : 'var(--danger)',
            }}
          >
            {message}
          </div>
        )}

        <button className="stt-btn stt-btn-primary" onClick={handleSave} disabled={saving} style={{ width: '100%', padding: '10px 16px' }}>
          {saving ? 'Saving...' : 'Update Keys'}
        </button>
      </div>
    </div>
  );
}
