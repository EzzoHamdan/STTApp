import { useRef, useEffect } from 'react';

const SPEAKER_COLORS = {
  Judge: '#e0a020',
  Lawyer_1: '#4a9eda',
  Lawyer_2: '#5acc8a',
};

function formatTime(iso) {
  const d = new Date(iso);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  const ms = String(d.getMilliseconds()).padStart(3, '0');
  return `${hh}:${mm}:${ss}.${ms}`;
}

export default function UnifiedTimeline({ entries, overlapWindows, colors, onClear }) {
  const scrollRef = useRef(null);
  const resolvedColors = { ...SPEAKER_COLORS, ...colors };

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [entries]);

  return (
    <div
      style={{
        background: 'var(--panel)',
        border: '1px solid var(--border)',
        borderRadius: 12,
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          padding: '12px 16px',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
        }}
      >
        <h2 style={{ fontSize: 15, fontWeight: 700, flex: 1, margin: 0, color: 'var(--text)' }}>
          Unified Timeline
        </h2>

        <span
          style={{
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 10,
            padding: '2px 10px',
            fontSize: 12,
            color: 'var(--muted)',
            fontFamily: 'JetBrains Mono, monospace',
          }}
        >
          {entries.length} turns
        </span>

        <button onClick={onClear} className="stt-btn stt-btn-ghost" style={{ fontSize: 11, padding: '4px 10px' }}>
          Clear
        </button>
      </div>

      <div
        ref={scrollRef}
        style={{
          maxHeight: 320,
          overflowY: 'auto',
          padding: '12px 16px',
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
        }}
      >
        {entries.length === 0 && (
          <div
            style={{
              textAlign: 'center',
              color: 'var(--muted)',
              padding: '40px 0',
              fontSize: 13,
            }}
          >
            Start a session and record speakers to build the timeline.
          </div>
        )}

        {entries.map((entry, i) => {
          const color = resolvedColors[entry.speaker] || '#888';
          const hasOverlap = entry.overlap;
          return (
            <div
              key={entry.utc_iso + '-' + i}
              style={{
                display: 'flex',
                gap: 12,
                alignItems: 'baseline',
                padding: '6px 10px',
                borderRadius: 6,
                background: hasOverlap ? 'var(--warning-soft)' : 'transparent',
                borderLeft: hasOverlap ? '2px solid var(--warning)' : '2px solid transparent',
              }}
            >
              <span
                style={{
                  fontSize: 10,
                  color: 'var(--muted)',
                  fontFamily: 'JetBrains Mono, monospace',
                  minWidth: 28,
                }}
              >
                #{entry.turn ?? i + 1}
              </span>

              <span
                style={{
                  fontSize: 10,
                  color: 'var(--muted)',
                  fontFamily: 'JetBrains Mono, monospace',
                  minWidth: 90,
                }}
              >
                {formatTime(entry.utc_iso)}
              </span>

              <span style={{ fontWeight: 700, fontSize: 12, minWidth: 80, color }}>{entry.speaker}</span>

              <span style={{ fontSize: 14, lineHeight: 1.4, flex: 1, direction: 'rtl', textAlign: 'right', color: 'var(--text)' }}>
                {entry.text}
              </span>

              {hasOverlap && (
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 3,
                    fontSize: 10,
                    fontWeight: 600,
                    color: 'var(--warning)',
                    background: 'var(--warning-soft)',
                    border: '1px solid var(--warning)',
                    borderRadius: 8,
                    padding: '1px 6px',
                    whiteSpace: 'nowrap',
                    flexShrink: 0,
                  }}
                >
                  {(entry.overlap_with || []).join(' + ')}
                </span>
              )}
            </div>
          );
        })}
      </div>

      {overlapWindows && overlapWindows.length > 0 && (
        <div
          style={{
            borderTop: '1px solid var(--border)',
            padding: '12px 16px',
            background: 'var(--warning-soft)',
          }}
        >
          <div
            style={{
              fontSize: 12,
              fontWeight: 700,
              color: 'var(--warning)',
              marginBottom: 8,
            }}
          >
            Simultaneous speech detected · {overlapWindows.length} period{overlapWindows.length !== 1 ? 's' : ''}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {overlapWindows.map((w, i) => (
              <div
                key={i}
                style={{
                  display: 'flex',
                  gap: 10,
                  alignItems: 'baseline',
                  fontSize: 12,
                  padding: '4px 8px',
                  background: 'var(--surface)',
                  borderRadius: 6,
                  borderLeft: '2px solid var(--warning)',
                }}
              >
                <span style={{ color: 'var(--muted)', minWidth: 20, fontFamily: 'JetBrains Mono, monospace' }}>{i + 1}</span>
                <span style={{ color: 'var(--muted)', fontFamily: 'JetBrains Mono, monospace', minWidth: 160 }}>
                  {formatTime(w.start_iso)} → {formatTime(w.end_iso)}
                </span>
                <span style={{ color: 'var(--muted)', minWidth: 50 }}>{w.duration_sec}s</span>
                <span style={{ color: 'var(--warning)', fontWeight: 600 }}>{w.speakers.join(' + ')}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
