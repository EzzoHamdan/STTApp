import { useRef, useEffect } from 'react';

const STATUS_CONFIG = {
  idle: { color: '#475569', label: 'Idle', dot: '#475569' },
  connecting: { color: '#f59e0b', label: 'Connecting…', dot: '#f59e0b' },
  connected: { color: '#4ade80', label: 'Live', dot: '#4ade80' },
  error: { color: '#f87171', label: 'Error', dot: '#ef4444' },
  disconnected: { color: '#475569', label: 'Disconnected', dot: '#475569' },
  ended: { color: '#475569', label: 'Ended', dot: '#475569' },
};

const MODEL_INFO = {
  deepgram: { name: 'Deepgram Nova-3', flag: '🇺🇸', color: '#00C6C6', tagline: 'Production-grade, dialect-first' },
  munsit: { name: 'Munsit', flag: '🇦🇪', color: '#FF6B35', tagline: 'Sovereign Arabic AI, UAE-built' },
  soniox: { name: 'Soniox', flag: '🇺🇸', color: '#059669', tagline: 'Ultra-low latency, code-switching' },
  speechmatics: { name: 'Speechmatics', flag: '🇬🇧', color: '#8b5cf6', tagline: '55-language enterprise streaming' },
  azure: { name: 'Azure Speech', flag: '🔷', color: '#0078d4', tagline: 'Microsoft Cognitive Services STT' },
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

  // Auto-scroll to bottom on new content
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
        background: '#0b0c17',
        border: `1px solid ${status === 'connected' ? info.color + '44' : '#0f111c'}`,
        borderRadius: 12,
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 300,
        overflow: 'hidden',
        transition: 'border-color 0.3s',
      }}
    >
      {/* ── Header ──────────────────────────────────────────── */}
      <div
        style={{
          padding: '14px 16px 12px',
          borderBottom: '1px solid #0f111c',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <span style={{ fontSize: 16 }}>{info.flag}</span>
            <span style={{ fontSize: 15, fontWeight: 700, color: info.color }}>{info.name}</span>
          </div>
          <div style={{ fontSize: 10, color: '#334155', fontFamily: 'Space Mono, monospace' }}>
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
                background: statusCfg.dot,
                display: 'inline-block',
              }}
            />
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                color: statusCfg.color,
                fontFamily: 'Space Mono, monospace',
              }}
            >
              {statusCfg.label}
            </span>
          </div>
          {avgLatency !== null && (
            <span
              style={{
                fontSize: 10,
                color: avgLatency < 500 ? '#4ade80' : avgLatency < 1000 ? '#fcd34d' : '#f87171',
                fontFamily: 'Space Mono, monospace',
                background: '#131720',
                padding: '2px 6px',
                borderRadius: 3,
              }}
            >
              ~{avgLatency}ms
            </span>
          )}
        </div>
      </div>

      {/* ── Transcript area ─────────────────────────────────── */}
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
              background: '#ef444412',
              border: '1px solid #ef444428',
              borderRadius: 6,
              padding: '8px 12px',
              fontSize: 11,
              color: '#fca5a5',
              marginBottom: 10,
              fontFamily: 'Space Mono, monospace',
            }}
          >
            ⚠ {error}
          </div>
        )}

        {transcripts.length === 0 && !partial && !error && (
          <div
            style={{
              direction: 'ltr',
              textAlign: 'center',
              color: '#1e2433',
              fontSize: 12,
              paddingTop: 60,
              fontFamily: 'Space Mono, monospace',
            }}
          >
            {isRecording ? 'Waiting for speech…' : 'Press record to start'}
          </div>
        )}

        {/* Final transcripts */}
        <span style={{ color: '#e2e8f0' }}>
          {transcripts.map((t, i) => (
            <span key={i}>
              {i > 0 ? ' ' : ''}
              {t.text}
            </span>
          ))}
        </span>

        {/* Partial / interim */}
        {partial && (
          <span style={{ color: info.color + '99', fontStyle: 'italic' }}>
            {transcripts.length > 0 ? ' ' : ''}
            {partial}
          </span>
        )}
      </div>

      {/* ── Footer stats ────────────────────────────────────── */}
      <div
        style={{
          padding: '8px 16px',
          borderTop: '1px solid #0f111c',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          fontSize: 10,
          color: '#1e2433',
          fontFamily: 'Space Mono, monospace',
        }}
      >
        <span>{wordCount} words</span>
        <span>{transcripts.length} segments</span>
      </div>
    </div>
  );
}
