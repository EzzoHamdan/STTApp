import { useState, useEffect, useRef, useMemo } from 'react';
import { useAudioCapture } from '../hooks/useAudioCapture';
import { useSTTWebSocket } from '../hooks/useSTTWebSocket';
import TranscriptPanel from '../components/TranscriptPanel';
import ApiKeySettings from '../components/ApiKeySettings';
import { authFetch } from '../components/AccessGate';

const ALL_PROVIDERS = [
  { id: 'deepgram', name: 'Deepgram Nova-3', flag: '🇺🇸', color: '#00C6C6' },
  { id: 'munsit', name: 'Munsit', flag: '🇦🇪', color: '#FF6B35' },
  { id: 'soniox', name: 'Soniox', flag: '🇺🇸', color: '#059669' },
  { id: 'speechmatics', name: 'Speechmatics', flag: '🇬🇧', color: '#8b5cf6' },
  { id: 'azure', name: 'Azure Speech', flag: '🔷', color: '#0078d4' },
];

export default function ArenaView() {
  const [isRecording, setIsRecording] = useState(false);
  const [showKeys, setShowKeys] = useState(false);
  const [keyStatus, setKeyStatus] = useState({});
  const [elapsed, setElapsed] = useState(0);
  const [selected, setSelected] = useState(() => {
    try {
      const saved = localStorage.getItem('arena_selected');
      if (saved) return JSON.parse(saved);
    } catch (_) {}
    return ['deepgram', 'azure']; // sensible default
  });

  const audio = useAudioCapture();

  // Create hooks for all providers — hooks must be called unconditionally
  const deepgram = useSTTWebSocket('deepgram');
  const munsit = useSTTWebSocket('munsit');
  const soniox = useSTTWebSocket('soniox');
  const speechmatics = useSTTWebSocket('speechmatics');
  const azure = useSTTWebSocket('azure');

  const sttMap = { deepgram, munsit, soniox, speechmatics, azure };
  const sttMapRef = useRef(sttMap);
  sttMapRef.current = sttMap;

  const cleanupRef = useRef([]);
  const timerRef = useRef(null);

  // Persist selection
  useEffect(() => {
    localStorage.setItem('arena_selected', JSON.stringify(selected));
  }, [selected]);

  // Fetch key status on mount and when keys modal closes
  useEffect(() => {
    authFetch('/api/keys/status')
      .then((r) => r.json())
      .then(setKeyStatus)
      .catch(() => {});
  }, [showKeys]);

  // Elapsed timer
  useEffect(() => {
    if (isRecording) {
      setElapsed(0);
      timerRef.current = setInterval(() => setElapsed((e) => e + 1), 1000);
    } else {
      clearInterval(timerRef.current);
    }
    return () => clearInterval(timerRef.current);
  }, [isRecording]);

  function toggleProvider(id) {
    if (isRecording) return; // can't change while recording
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]
    );
  }

  async function handleStart() {
    if (selected.length === 0) return;
    try {
      await audio.start();

      // Connect only selected providers
      selected.forEach((p) => sttMapRef.current[p].connect());

      // Wire audio data to selected providers
      const unsub = audio.onAudioData((buffer) => {
        selected.forEach((p) => sttMapRef.current[p].sendAudio(buffer));
      });
      cleanupRef.current.push(unsub);

      setIsRecording(true);
    } catch (err) {
      console.error('Failed to start recording:', err);
    }
  }

  function handleStop() {
    audio.stop();
    selected.forEach((p) => sttMapRef.current[p].disconnect());
    cleanupRef.current.forEach((fn) => fn());
    cleanupRef.current = [];
    setIsRecording(false);
  }

  function handleClear() {
    ALL_PROVIDERS.forEach(({ id }) => sttMapRef.current[id].clearTranscripts());
  }

  const configuredCount = Object.values(keyStatus).filter(Boolean).length;
  const totalProviders = ALL_PROVIDERS.length;
  const mm = String(Math.floor(elapsed / 60)).padStart(2, '0');
  const ss = String(elapsed % 60).padStart(2, '0');

  // Grid columns: adapt to selection count
  const gridCols = selected.length <= 2
    ? `repeat(${selected.length || 1}, 1fr)`
    : selected.length === 3
    ? 'repeat(3, 1fr)'
    : 'repeat(auto-fit, minmax(min(100%, 460px), 1fr))';

  return (
    <>
      {/* ── Header ──────────────────────────────────────────── */}
      <div style={{ padding: '24px 28px 0', maxWidth: 1600, margin: '0 auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 16 }}>
          <div>
            <div
              style={{
                fontSize: 10,
                letterSpacing: '.18em',
                color: '#334155',
                textTransform: 'uppercase',
                fontFamily: 'Space Mono, monospace',
                marginBottom: 8,
              }}
            >
              ⚡ ARABIC STT ARENA · LIVE STREAMING · REAL-TIME COMPARISON
            </div>
            <h1 style={{ fontSize: 26, fontWeight: 700, letterSpacing: '-.02em', lineHeight: 1.1, margin: 0 }}>
              Arabic STT<span style={{ color: '#00C6C6' }}> Arena</span>
              <span style={{ color: '#334155', fontWeight: 300 }}> — Live</span>
            </h1>
            <p style={{ color: '#475569', fontSize: 12, marginTop: 6, maxWidth: 540, lineHeight: 1.6 }}>
              Select the models you want to compare, then press record. Only selected providers stream.
            </p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button
              onClick={() => setShowKeys(true)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '8px 14px',
                borderRadius: 8,
                background: '#131720',
                border: '1px solid #1e2433',
                color: '#7e9ab0',
                fontSize: 12,
                cursor: 'pointer',
                fontFamily: 'Space Mono, monospace',
              }}
            >
              🔑 Keys
              <span
                style={{
                  fontSize: 9,
                  fontWeight: 700,
                  padding: '1px 5px',
                  borderRadius: 3,
                  background: configuredCount === totalProviders ? '#22c55e18' : '#f59e0b18',
                  color: configuredCount === totalProviders ? '#4ade80' : '#fcd34d',
                }}
              >
                {configuredCount}/{totalProviders}
              </span>
            </button>
          </div>
        </div>

        {/* ── Model Selector ─────────────────────────────────── */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            marginTop: 16,
            flexWrap: 'wrap',
          }}
        >
          <span style={{ fontSize: 11, color: '#475569', fontFamily: 'Space Mono, monospace', marginRight: 4 }}>
            Models:
          </span>
          {ALL_PROVIDERS.map((p) => {
            const isSelected = selected.includes(p.id);
            const isConfigured = keyStatus[p.id];
            return (
              <button
                key={p.id}
                onClick={() => toggleProvider(p.id)}
                disabled={isRecording}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '6px 14px',
                  borderRadius: 20,
                  background: isSelected ? p.color + '20' : '#0b0c17',
                  border: `1.5px solid ${isSelected ? p.color : '#1e2433'}`,
                  color: isSelected ? p.color : '#475569',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: isRecording ? 'default' : 'pointer',
                  transition: 'all 0.15s',
                  opacity: isRecording && !isSelected ? 0.3 : 1,
                  fontFamily: 'inherit',
                }}
              >
                <span>{p.flag}</span>
                {p.name}
                {!isConfigured && (
                  <span style={{ fontSize: 9, color: '#f59e0b', marginLeft: 2 }}>⚠</span>
                )}
                {isSelected && (
                  <span style={{ fontSize: 13, marginLeft: 2 }}>✓</span>
                )}
              </button>
            );
          })}
        </div>

        {/* ── Record Bar ─────────────────────────────────────── */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 16,
            marginTop: 16,
            marginBottom: 24,
            padding: '16px 20px',
            background: '#0b0c17',
            borderRadius: 12,
            border: `1px solid ${isRecording ? '#ef444444' : '#0f111c'}`,
          }}
        >
          {/* Record button */}
          <button
            onClick={isRecording ? handleStop : handleStart}
            disabled={selected.length === 0 && !isRecording}
            style={{
              width: 52,
              height: 52,
              borderRadius: '50%',
              background: isRecording ? '#ef4444' : '#131720',
              border: `2px solid ${isRecording ? '#ef4444' : '#1e2433'}`,
              cursor: selected.length === 0 && !isRecording ? 'default' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'all 0.2s',
              flexShrink: 0,
              boxShadow: isRecording ? '0 0 24px #ef444440' : 'none',
              opacity: selected.length === 0 && !isRecording ? 0.3 : 1,
            }}
          >
            {isRecording ? (
              <div style={{ width: 18, height: 18, borderRadius: 3, background: '#fff' }} />
            ) : (
              <div style={{ width: 20, height: 20, borderRadius: '50%', background: '#ef4444' }} />
            )}
          </button>

          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: isRecording ? '#f87171' : '#e2e8f0' }}>
              {isRecording ? (
                <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span
                    className="live-dot"
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      background: '#ef4444',
                      display: 'inline-block',
                    }}
                  />
                  Recording — Speak Arabic
                  <span
                    style={{
                      fontFamily: 'Space Mono, monospace',
                      fontSize: 12,
                      color: '#475569',
                      marginLeft: 8,
                    }}
                  >
                    {mm}:{ss}
                  </span>
                </span>
              ) : selected.length === 0 ? (
                'Select at least one model to start'
              ) : (
                'Press to start recording'
              )}
            </div>
            <div style={{ fontSize: 11, color: '#334155', marginTop: 2, fontFamily: 'Space Mono, monospace' }}>
              {isRecording
                ? `16 kHz PCM · Streaming to ${selected.length} provider${selected.length !== 1 ? 's' : ''}`
                : `${selected.length} of ${totalProviders} models selected`}
            </div>
          </div>

          {/* Provider status badges (while recording) */}
          {isRecording && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', flexShrink: 0 }}>
              {selected.map((p) => {
                const s = sttMap[p];
                const provInfo = ALL_PROVIDERS.find((x) => x.id === p);
                const colors = {
                  connected: '#4ade80',
                  connecting: '#f59e0b',
                  error: '#f87171',
                  idle: '#475569',
                  disconnected: '#475569',
                };
                const c = colors[s.status] || '#475569';
                return (
                  <span
                    key={p}
                    style={{
                      fontSize: 9,
                      fontWeight: 700,
                      fontFamily: 'Space Mono, monospace',
                      padding: '3px 8px',
                      borderRadius: 4,
                      background: c + '18',
                      color: c,
                      border: `1px solid ${c}30`,
                      textTransform: 'uppercase',
                    }}
                  >
                    {p}
                  </span>
                );
              })}
            </div>
          )}

          {/* Clear button */}
          {!isRecording && (
            <button
              onClick={handleClear}
              style={{
                padding: '7px 14px',
                borderRadius: 6,
                background: '#131720',
                border: '1px solid #1e2433',
                color: '#475569',
                fontSize: 11,
                cursor: 'pointer',
                fontFamily: 'Space Mono, monospace',
                flexShrink: 0,
              }}
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {/* ── Transcript Panels ─────────────────────────────────── */}
      <div style={{ padding: '0 28px 40px', maxWidth: 1600, margin: '0 auto' }}>
        {selected.length === 0 ? (
          <div
            style={{
              textAlign: 'center',
              padding: '80px 20px',
              color: '#334155',
              fontSize: 14,
            }}
          >
            Select one or more models above to see transcript panels.
          </div>
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: gridCols,
              gap: 12,
            }}
          >
            {selected.map((p) => (
              <TranscriptPanel
                key={p}
                provider={p}
                status={sttMap[p].status}
                transcripts={sttMap[p].transcripts}
                partial={sttMap[p].partial}
                error={sttMap[p].error}
                avgLatency={sttMap[p].avgLatency}
                isRecording={isRecording}
              />
            ))}
          </div>
        )}
      </div>

      {/* ── API Key Settings Modal ───────────────────────────── */}
      <ApiKeySettings open={showKeys} onClose={() => setShowKeys(false)} />
    </>
  );
}
