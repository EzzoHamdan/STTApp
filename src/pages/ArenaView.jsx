import { useState, useEffect, useRef } from 'react';
import { useAudioCapture } from '../hooks/useAudioCapture';
import { useSTTWebSocket } from '../hooks/useSTTWebSocket';
import TranscriptPanel from '../components/TranscriptPanel';
import ApiKeySettings from '../components/ApiKeySettings';
import { authFetch } from '../components/AccessGate';

const ALL_PROVIDERS = [
  { id: 'deepgram', name: 'Deepgram Nova-3', badge: 'DG', color: '#00C6C6' },
  { id: 'munsit', name: 'Munsit', badge: 'MU', color: '#FF6B35' },
  { id: 'soniox', name: 'Soniox', badge: 'SX', color: '#059669' },
  { id: 'speechmatics', name: 'Speechmatics', badge: 'SM', color: '#8b5cf6' },
  { id: 'azure', name: 'Azure Speech', badge: 'AZ', color: '#0078d4' },
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
    return ['deepgram', 'azure'];
  });

  const audio = useAudioCapture();

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

  useEffect(() => {
    localStorage.setItem('arena_selected', JSON.stringify(selected));
  }, [selected]);

  useEffect(() => {
    authFetch('/api/keys/status')
      .then((r) => r.json())
      .then(setKeyStatus)
      .catch(() => {});
  }, [showKeys]);

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
    if (isRecording) return;
    setSelected((prev) => (prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]));
  }

  async function handleStart() {
    if (selected.length === 0) return;

    try {
      await audio.start();
      selected.forEach((p) => sttMapRef.current[p].connect());

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
  const mm = String(Math.floor(elapsed / 60)).padStart(2, '0');
  const ss = String(elapsed % 60).padStart(2, '0');

  const gridCols =
    selected.length <= 2
      ? `repeat(${selected.length || 1}, 1fr)`
      : selected.length === 3
      ? 'repeat(3, 1fr)'
      : 'repeat(auto-fit, minmax(min(100%, 460px), 1fr))';

  return (
    <>
      <div style={{ padding: '24px 24px 0', maxWidth: 1320, margin: '0 auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 16 }}>
          <div>
            <div
              style={{
                fontSize: 10,
                letterSpacing: '.16em',
                color: 'var(--muted)',
                textTransform: 'uppercase',
                fontFamily: 'JetBrains Mono, monospace',
                marginBottom: 8,
              }}
            >
              Arabic STT Arena
            </div>
            <h1 style={{ fontSize: 28, fontWeight: 700, letterSpacing: '-.03em', lineHeight: 1.1, margin: 0, color: 'var(--text)' }}>
              Model Comparison
            </h1>
            <p style={{ color: 'var(--muted)', fontSize: 12, marginTop: 6, maxWidth: 540, lineHeight: 1.6 }}>
              Select one or more providers, then start recording to compare outputs side by side.
            </p>
          </div>

          <button
            className="stt-btn stt-btn-ghost"
            onClick={() => setShowKeys(true)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              fontFamily: 'JetBrains Mono, monospace',
              fontSize: 12,
            }}
          >
            Keys
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                padding: '1px 6px',
                borderRadius: 4,
                background: configuredCount === ALL_PROVIDERS.length ? 'var(--success-soft)' : 'var(--warning-soft)',
                color: configuredCount === ALL_PROVIDERS.length ? 'var(--success)' : 'var(--warning)',
              }}
            >
              {configuredCount}/{ALL_PROVIDERS.length}
            </span>
          </button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'JetBrains Mono, monospace', marginRight: 4 }}>
            Models
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
                  padding: '6px 12px',
                  borderRadius: 20,
                  background: isSelected ? `${p.color}1f` : 'var(--surface)',
                  border: `1.5px solid ${isSelected ? p.color : 'var(--border)'}`,
                  color: isSelected ? p.color : 'var(--muted)',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: isRecording ? 'default' : 'pointer',
                  opacity: isRecording && !isSelected ? 0.35 : 1,
                }}
              >
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 800,
                    borderRadius: 5,
                    border: `1px solid ${isSelected ? p.color : 'var(--border)'}`,
                    padding: '1px 5px',
                    fontFamily: 'JetBrains Mono, monospace',
                  }}
                >
                  {p.badge}
                </span>
                {p.name}
                {!isConfigured && <span style={{ fontSize: 10, color: 'var(--warning)' }}>key?</span>}
              </button>
            );
          })}
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 16,
            marginTop: 16,
            marginBottom: 24,
            padding: '16px 18px',
            background: 'var(--panel)',
            borderRadius: 12,
            border: `1px solid ${isRecording ? 'var(--danger)' : 'var(--border)'}`,
          }}
        >
          <button
            onClick={isRecording ? handleStop : handleStart}
            disabled={selected.length === 0 && !isRecording}
            style={{
              width: 50,
              height: 50,
              borderRadius: '50%',
              background: isRecording ? 'var(--danger)' : 'var(--surface)',
              border: `2px solid ${isRecording ? 'var(--danger)' : 'var(--border)'}`,
              cursor: selected.length === 0 && !isRecording ? 'default' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              opacity: selected.length === 0 && !isRecording ? 0.35 : 1,
            }}
          >
            {isRecording ? (
              <div style={{ width: 16, height: 16, borderRadius: 3, background: '#fff' }} />
            ) : (
              <div style={{ width: 18, height: 18, borderRadius: '50%', background: 'var(--danger)' }} />
            )}
          </button>

          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: isRecording ? 'var(--danger)' : 'var(--text)' }}>
              {isRecording ? `Recording ${mm}:${ss}` : selected.length === 0 ? 'Select at least one model' : 'Press to start'}
            </div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2, fontFamily: 'JetBrains Mono, monospace' }}>
              {isRecording
                ? `Streaming to ${selected.length} provider${selected.length !== 1 ? 's' : ''}`
                : `${selected.length} model${selected.length !== 1 ? 's' : ''} selected`}
            </div>
          </div>

          {!isRecording && (
            <button className="stt-btn stt-btn-ghost" onClick={handleClear} style={{ fontSize: 11 }}>
              Clear
            </button>
          )}
        </div>
      </div>

      <div style={{ padding: '0 24px 40px', maxWidth: 1320, margin: '0 auto' }}>
        {selected.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '72px 20px', color: 'var(--muted)', fontSize: 14 }}>
            Select one or more models to open transcript panels.
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: gridCols, gap: 12 }}>
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

      <ApiKeySettings open={showKeys} onClose={() => setShowKeys(false)} />
    </>
  );
}
