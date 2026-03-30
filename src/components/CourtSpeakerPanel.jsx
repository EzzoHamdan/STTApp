import { useRef, useEffect } from 'react';

const SPEAKER_STYLES = {
  Judge: { color: '#e0a020', label: 'Judge' },
  Lawyer_1: { color: '#4a9eda', label: 'Lawyer 1' },
  Lawyer_2: { color: '#5acc8a', label: 'Lawyer 2' },
};

export default function CourtSpeakerPanel({
  role,
  status,
  transcripts,
  partial,
  error,
  provider,
  isSessionActive,
  onStart,
  onStop,
}) {
  const scrollRef = useRef(null);
  const info = SPEAKER_STYLES[role] || { color: '#888', label: role };
  const isRecording = status === 'recording';
  const providerLabel = String(provider || 'azure').replace(/_/g, ' ');

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [transcripts, partial]);

  function formatTime(iso) {
    const d = new Date(iso);
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    const ss = String(d.getSeconds()).padStart(2, '0');
    const ms = String(d.getMilliseconds()).padStart(3, '0');
    return `${hh}:${mm}:${ss}.${ms}`;
  }

  return (
    <div
      style={{
        background: 'var(--panel)',
        border: `1px solid ${isRecording ? `${info.color}66` : 'var(--border)'}`,
        borderRadius: 12,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        transition: 'border-color 0.2s, box-shadow 0.2s',
        boxShadow: isRecording ? `0 0 0 1px ${info.color}50` : 'none',
      }}
    >
      <div
        style={{
          padding: '12px 14px',
          borderBottom: `1px solid ${isRecording ? `${info.color}2F` : 'var(--border)'}`,
          background: 'var(--surface)',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
        }}
      >
        <span
          className={isRecording ? 'live-dot' : ''}
          style={{
            width: 10,
            height: 10,
            borderRadius: '50%',
            background: info.color,
            flexShrink: 0,
          }}
        />

        <h2
          style={{
            fontSize: 14,
            fontWeight: 700,
            color: info.color,
            flex: 1,
            margin: 0,
          }}
        >
          {info.label}
        </h2>

        <span
          style={{
            fontSize: 10,
            color: 'var(--muted)',
            border: '1px solid var(--border)',
            borderRadius: 999,
            padding: '2px 8px',
            textTransform: 'uppercase',
            letterSpacing: '.06em',
            fontFamily: 'JetBrains Mono, monospace',
          }}
        >
          {providerLabel}
        </span>

        <span
          style={{
            fontSize: 11,
            color: isRecording ? info.color : 'var(--muted)',
            background: isRecording ? `${info.color}22` : 'var(--surface)',
            border: `1px solid ${isRecording ? `${info.color}55` : 'var(--border)'}`,
            borderRadius: 10,
            padding: '2px 9px',
            fontFamily: 'JetBrains Mono, monospace',
            transition: 'all 0.3s',
          }}
        >
          {status === 'recording'
            ? 'REC'
            : status === 'connecting'
            ? 'Connecting'
            : status === 'error'
            ? 'Error'
            : 'Idle'}
        </span>
      </div>

      <div
        style={{
          padding: '10px 14px',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          gap: 8,
        }}
      >
        <button
          onClick={onStart}
          disabled={!isSessionActive || isRecording}
          className="stt-btn stt-btn-primary"
          style={{
            padding: '7px 12px',
            fontSize: 13,
            cursor: isSessionActive && !isRecording ? 'pointer' : 'default',
            opacity: isSessionActive && !isRecording ? 1 : 0.35,
          }}
        >
          Start
        </button>
        <button
          onClick={onStop}
          disabled={!isRecording}
          className="stt-btn"
          style={{
            padding: '7px 12px',
            border: '1px solid var(--danger)',
            background: 'var(--danger-soft)',
            color: 'var(--danger)',
            fontSize: 13,
            cursor: isRecording ? 'pointer' : 'default',
            opacity: isRecording ? 1 : 0.35,
          }}
        >
          Stop
        </button>
      </div>

      <div
        ref={scrollRef}
        style={{
          flex: 1,
          minHeight: 200,
          maxHeight: 300,
          overflowY: 'auto',
          padding: '12px 14px',
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}
      >
        {error && (
          <div
            style={{
              background: 'var(--danger-soft)',
              border: '1px solid var(--danger)',
              borderRadius: 6,
              padding: '8px 12px',
              fontSize: 11,
              color: 'var(--danger)',
              fontFamily: 'JetBrains Mono, monospace',
              direction: 'ltr',
              textAlign: 'left',
              wordBreak: 'break-word',
            }}
          >
            {error}
          </div>
        )}

        {transcripts.length === 0 && !partial && !error && (
          <div
            style={{
              textAlign: 'center',
              color: 'var(--muted)',
              fontSize: 13,
              marginTop: 40,
            }}
          >
            Press Start to begin.
          </div>
        )}

        {transcripts.map((entry, i) => (
          <div
            key={i}
            style={{
              background: 'var(--surface)',
              borderLeft: `3px solid ${info.color}`,
              borderRadius: '0 6px 6px 0',
              padding: '8px 12px',
              animation: 'slideIn 0.25s ease',
            }}
          >
            <div
              style={{
                fontSize: 10,
                color: 'var(--muted)',
                fontFamily: 'JetBrains Mono, monospace',
                marginBottom: 3,
              }}
            >
              {formatTime(entry.utc_iso)}
              {entry.duration_sec ? ` · ${entry.duration_sec.toFixed(1)}s` : ''}
            </div>
            <div style={{ lineHeight: 1.5, direction: 'rtl', textAlign: 'right', color: 'var(--text)' }}>
              {entry.text}
            </div>
          </div>
        ))}

        {partial && (
          <div
            style={{
              color: 'var(--muted)',
              fontStyle: 'italic',
              fontSize: 13,
              minHeight: 22,
              padding: '4px 0',
              direction: 'rtl',
              textAlign: 'right',
            }}
          >
            <span style={{ color: info.color, marginLeft: 4 }}>...</span>
            {partial}
          </div>
        )}
      </div>

      <div
        style={{
          padding: '8px 14px',
          borderTop: '1px solid var(--border)',
          fontSize: 10,
          color: 'var(--muted)',
          fontFamily: 'JetBrains Mono, monospace',
          display: 'flex',
          justifyContent: 'space-between',
        }}
      >
        <span>{transcripts.length} utterances</span>
      </div>
    </div>
  );
}
