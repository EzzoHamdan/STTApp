import { useRef, useEffect } from 'react';

const SPEAKER_STYLES = {
  Judge: { color: '#e0a020', icon: '⚖️', label: 'Judge' },
  Lawyer_1: { color: '#4a9eda', icon: '👤', label: 'Lawyer 1' },
  Lawyer_2: { color: '#5acc8a', icon: '👤', label: 'Lawyer 2' },
};

/**
 * A speaker panel for court transcription — shows status, start/stop controls,
 * and a scrolling transcript for one speaker.
 */
export default function CourtSpeakerPanel({
  role,
  status,         // 'idle' | 'connecting' | 'recording' | 'stopped' | 'error'
  transcripts,    // [{ text, utc_iso, duration_sec }]
  partial,        // current interim text
  error,          // error text from Azure
  isSessionActive,
  onStart,
  onStop,
}) {
  const scrollRef = useRef(null);
  const info = SPEAKER_STYLES[role] || { color: '#888', icon: '🎤', label: role };
  const isRecording = status === 'recording';

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
        background: '#0d1117',
        border: `1px solid ${isRecording ? info.color + '60' : '#1e2433'}`,
        borderRadius: 12,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        transition: 'border-color 0.3s, box-shadow 0.3s',
        boxShadow: isRecording ? `0 0 0 2px ${info.color}40` : 'none',
      }}
    >
      {/* ── Header ────────────────────────────────────────── */}
      <div
        style={{
          padding: '14px 16px',
          borderBottom: `1px solid ${info.color}25`,
          background: `${info.color}0C`,
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
            fontSize: 15,
            fontWeight: 700,
            color: info.color,
            flex: 1,
            margin: 0,
          }}
        >
          {info.icon} {info.label}
        </h2>
        <span
          style={{
            fontSize: 11,
            color: isRecording ? info.color : '#7d8590',
            background: isRecording ? `${info.color}20` : '#21262d',
            border: `1px solid ${isRecording ? info.color + '50' : '#30363d'}`,
            borderRadius: 10,
            padding: '2px 9px',
            fontFamily: 'Space Mono, monospace',
            transition: 'all 0.3s',
          }}
        >
          {status === 'recording'
            ? '● REC'
            : status === 'connecting'
            ? 'Connecting…'
            : status === 'error'
            ? '⚠ Error'
            : 'Idle'}
        </span>
      </div>

      {/* ── Controls ──────────────────────────────────────── */}
      <div
        style={{
          padding: '10px 16px',
          borderBottom: '1px solid #1e2433',
          display: 'flex',
          gap: 8,
        }}
      >
        <button
          onClick={onStart}
          disabled={!isSessionActive || isRecording}
          style={{
            padding: '7px 16px',
            borderRadius: 8,
            background: '#238636',
            color: '#fff',
            border: 'none',
            fontSize: 13,
            fontWeight: 600,
            cursor: isSessionActive && !isRecording ? 'pointer' : 'default',
            opacity: isSessionActive && !isRecording ? 1 : 0.35,
            transition: 'opacity 0.15s',
          }}
        >
          ▶ Start
        </button>
        <button
          onClick={onStop}
          disabled={!isRecording}
          style={{
            padding: '7px 16px',
            borderRadius: 8,
            background: '#da3633',
            color: '#fff',
            border: 'none',
            fontSize: 13,
            fontWeight: 600,
            cursor: isRecording ? 'pointer' : 'default',
            opacity: isRecording ? 1 : 0.35,
            transition: 'opacity 0.15s',
          }}
        >
          ■ Stop
        </button>
      </div>

      {/* ── Transcript scroll ─────────────────────────────── */}
      <div
        ref={scrollRef}
        style={{
          flex: 1,
          minHeight: 200,
          maxHeight: 300,
          overflowY: 'auto',
          padding: '12px 16px',
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}
      >
        {error && (
          <div
            style={{
              background: '#ef444418',
              border: '1px solid #ef444440',
              borderRadius: 6,
              padding: '8px 12px',
              fontSize: 11,
              color: '#fca5a5',
              fontFamily: 'Space Mono, monospace',
              direction: 'ltr',
              textAlign: 'left',
              wordBreak: 'break-word',
            }}
          >
            ⚠ {error}
          </div>
        )}
        {transcripts.length === 0 && !partial && !error && (
          <div
            style={{
              textAlign: 'center',
              color: '#7d8590',
              fontSize: 13,
              marginTop: 40,
            }}
          >
            Press <strong>Start</strong> to begin recording.
          </div>
        )}

        {transcripts.map((entry, i) => (
          <div
            key={i}
            style={{
              background: '#21262d',
              borderLeft: `3px solid ${info.color}`,
              borderRadius: '0 6px 6px 0',
              padding: '8px 12px',
              animation: 'slideIn 0.25s ease',
            }}
          >
            <div
              style={{
                fontSize: 10,
                color: '#7d8590',
                fontFamily: 'Consolas, monospace',
                marginBottom: 3,
              }}
            >
              {formatTime(entry.utc_iso)}
              {entry.duration_sec ? ` · ${entry.duration_sec.toFixed(1)}s` : ''}
            </div>
            <div style={{ lineHeight: 1.5, direction: 'rtl', textAlign: 'right' }}>
              {entry.text}
            </div>
          </div>
        ))}

        {partial && (
          <div
            style={{
              color: '#7d8590',
              fontStyle: 'italic',
              fontSize: 13,
              minHeight: 22,
              padding: '4px 0',
              direction: 'rtl',
              textAlign: 'right',
            }}
          >
            <span style={{ color: info.color, marginLeft: 4 }}>…</span>
            {partial}
          </div>
        )}
      </div>

      {/* ── Footer ────────────────────────────────────────── */}
      <div
        style={{
          padding: '8px 16px',
          borderTop: '1px solid #1e2433',
          fontSize: 10,
          color: '#475569',
          fontFamily: 'Space Mono, monospace',
          display: 'flex',
          justifyContent: 'space-between',
        }}
      >
        <span>{transcripts.length} utterances</span>
      </div>
    </div>
  );
}
