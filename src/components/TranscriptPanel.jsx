import { useRef, useEffect } from 'react';

const STATUS_CONFIG = {
  idle: { color: 'var(--muted)', label: 'Idle' },
  connecting: { color: 'var(--warning)', label: 'Connecting' },
  connected: { color: 'var(--success)', label: 'Live' },
  error: { color: 'var(--danger)', label: 'Error' },
  disconnected: { color: 'var(--muted)', label: 'Disconnected' },
  ended: { color: 'var(--muted)', label: 'Ended' },
};

const MODEL_INFO = {
  deepgram: { name: 'Deepgram Nova-3', flag: 'DG', color: '#00C6C6', tagline: 'Arabic streaming STT' },
  munsit: { name: 'Munsit', flag: 'MU', color: '#FF6B35', tagline: 'Regional Arabic model' },
  soniox: { name: 'Soniox', flag: 'SX', color: '#059669', tagline: 'Low-latency streaming' },
  speechmatics: { name: 'Speechmatics', flag: 'SM', color: '#8b5cf6', tagline: 'Enterprise real-time STT' },
  azure: { name: 'Azure Speech', flag: 'AZ', color: '#0078d4', tagline: 'Microsoft speech service' },
};

export default function TranscriptPanel({
  provider,
  status,
  transcripts,
  partial,
  error,
  avgLatency,
  isRecording,
}) {
  const scrollRef = useRef(null);
  const info = MODEL_INFO[provider];
  const statusCfg = STATUS_CONFIG[status] || STATUS_CONFIG.idle;

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [transcripts, partial]);

  const fullText = transcripts.map((t) => t.text).join(' ');
  const wordCount = fullText ? fullText.split(/\s+/).filter(Boolean).length : 0;

  return (
    <div
      style={{
        background: 'var(--panel)',
        border: `1px solid ${status === 'connected' ? `${info.color}66` : 'var(--border)'}`,
        borderRadius: 12,
        display: 'flex',
        flexDirection: 'column',
        minHeight: 300,
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          padding: '14px 16px 12px',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          background: 'var(--surface)',
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <span
              style={{
                fontSize: 10,
                fontWeight: 800,
                borderRadius: 6,
                border: `1px solid ${info.color}`,
                color: info.color,
                padding: '2px 6px',
                fontFamily: 'JetBrains Mono, monospace',
              }}
            >
              {info.flag}
            </span>
            <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>{info.name}</span>
          </div>
          <div style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'JetBrains Mono, monospace' }}>
            {info.tagline}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 5 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span
              className={status === 'connected' ? 'live-dot' : ''}
              style={{
                width: 7,
                height: 7,
                borderRadius: '50%',
                background: statusCfg.color,
                display: 'inline-block',
              }}
            />
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                color: statusCfg.color,
                fontFamily: 'JetBrains Mono, monospace',
              }}
            >
              {statusCfg.label}
            </span>
          </div>

          {avgLatency !== null && (
            <span
              style={{
                fontSize: 10,
                color: avgLatency < 500 ? 'var(--success)' : avgLatency < 1000 ? 'var(--warning)' : 'var(--danger)',
                fontFamily: 'JetBrains Mono, monospace',
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                padding: '2px 6px',
                borderRadius: 3,
              }}
            >
              ~{avgLatency}ms
            </span>
          )}
        </div>
      </div>

      <div
        ref={scrollRef}
        style={{
          flex: 1,
          padding: '14px 16px',
          overflowY: 'auto',
          direction: 'rtl',
          textAlign: 'right',
          fontSize: 16,
          lineHeight: 1.9,
        }}
      >
        {error && (
          <div
            style={{
              direction: 'ltr',
              textAlign: 'left',
              background: 'var(--danger-soft)',
              border: '1px solid var(--danger)',
              borderRadius: 6,
              padding: '8px 12px',
              fontSize: 11,
              color: 'var(--danger)',
              marginBottom: 10,
              fontFamily: 'JetBrains Mono, monospace',
            }}
          >
            {error}
          </div>
        )}

        {transcripts.length === 0 && !partial && !error && (
          <div
            style={{
              direction: 'ltr',
              textAlign: 'center',
              color: 'var(--muted)',
              fontSize: 12,
              paddingTop: 60,
              fontFamily: 'JetBrains Mono, monospace',
            }}
          >
            {isRecording ? 'Waiting for speech...' : 'Press record to start'}
          </div>
        )}

        <span style={{ color: 'var(--text)' }}>
          {transcripts.map((t, i) => (
            <span key={i}>
              {i > 0 ? ' ' : ''}
              {t.text}
            </span>
          ))}
        </span>

        {partial && (
          <span style={{ color: `${info.color}99`, fontStyle: 'italic' }}>
            {transcripts.length > 0 ? ' ' : ''}
            {partial}
          </span>
        )}
      </div>

      <div
        style={{
          padding: '8px 16px',
          borderTop: '1px solid var(--border)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          fontSize: 10,
          color: 'var(--muted)',
          fontFamily: 'JetBrains Mono, monospace',
        }}
      >
        <span>{wordCount} words</span>
        <span>{transcripts.length} segments</span>
      </div>
    </div>
  );
}
