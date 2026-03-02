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

/**
 * Unified timeline component — shows all speakers' utterances in chronological order
 * with overlap detection badges.
 */
export default function UnifiedTimeline({
  entries,
  overlapWindows,
  colors,
  onClear,
}) {
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
        background: '#0d1117',
        border: '1px solid #1e2433',
        borderRadius: 12,
        overflow: 'hidden',
      }}
    >
      {/* ── Header ────────────────────────────────────────── */}
      <div
        style={{
          padding: '14px 18px',
          borderBottom: '1px solid #1e2433',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
        }}
      >
        <h2 style={{ fontSize: 15, fontWeight: 700, flex: 1, margin: 0 }}>
          📜 Unified Timeline
        </h2>
        <span
          style={{
            background: '#21262d',
            border: '1px solid #30363d',
            borderRadius: 10,
            padding: '2px 10px',
            fontSize: 12,
            color: '#7d8590',
            fontFamily: 'Consolas, monospace',
          }}
        >
          {entries.length} turns
        </span>
        <button
          onClick={onClear}
          style={{
            fontSize: 11,
            padding: '4px 10px',
            borderRadius: 6,
            background: '#21262d',
            color: '#e6edf3',
            border: '1px solid #30363d',
            cursor: 'pointer',
          }}
        >
          Clear
        </button>
      </div>

      {/* ── Entries ───────────────────────────────────────── */}
      <div
        ref={scrollRef}
        style={{
          maxHeight: 300,
          overflowY: 'auto',
          padding: '12px 18px',
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
        }}
      >
        {entries.length === 0 && (
          <div
            style={{
              textAlign: 'center',
              color: '#7d8590',
              padding: '40px 0',
              fontSize: 13,
            }}
          >
            Start a session and begin recording to see the unified transcript here.
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
                background: hasOverlap ? '#f0883e0F' : 'transparent',
                borderLeft: hasOverlap ? '2px solid #f0883e' : '2px solid transparent',
                transition: 'background 0.15s',
              }}
            >
              <span
                style={{
                  fontSize: 10,
                  color: '#7d8590',
                  fontFamily: 'Consolas, monospace',
                  minWidth: 28,
                }}
              >
                #{entry.turn ?? i + 1}
              </span>
              <span
                style={{
                  fontSize: 10,
                  color: '#7d8590',
                  fontFamily: 'Consolas, monospace',
                  minWidth: 90,
                }}
              >
                {formatTime(entry.utc_iso)}
              </span>
              <span
                style={{
                  fontWeight: 700,
                  fontSize: 12,
                  minWidth: 80,
                  color,
                }}
              >
                {entry.speaker}
              </span>
              <span
                style={{
                  fontSize: 14,
                  lineHeight: 1.4,
                  flex: 1,
                  direction: 'rtl',
                  textAlign: 'right',
                }}
              >
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
                    color: '#f0883e',
                    background: '#f0883e26',
                    border: '1px solid #f0883e66',
                    borderRadius: 8,
                    padding: '1px 6px',
                    whiteSpace: 'nowrap',
                    flexShrink: 0,
                  }}
                >
                  ⚡ {(entry.overlap_with || []).join(' + ')}
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* ── Overlap summary ──────────────────────────────── */}
      {overlapWindows && overlapWindows.length > 0 && (
        <div
          style={{
            borderTop: '1px solid #1e2433',
            padding: '12px 18px',
            background: '#f0883e08',
          }}
        >
          <div
            style={{
              fontSize: 12,
              fontWeight: 700,
              color: '#f0883e',
              marginBottom: 8,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            ⚡ Simultaneous Speech Detected — {overlapWindows.length} period
            {overlapWindows.length !== 1 ? 's' : ''}
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
                  background: '#21262d',
                  borderRadius: 6,
                  borderLeft: '2px solid #f0883e',
                }}
              >
                <span
                  style={{
                    color: '#7d8590',
                    minWidth: 20,
                    fontFamily: 'Consolas, monospace',
                  }}
                >
                  {i + 1}
                </span>
                <span
                  style={{
                    color: '#7d8590',
                    fontFamily: 'Consolas, monospace',
                    minWidth: 160,
                  }}
                >
                  {formatTime(w.start_iso)} → {formatTime(w.end_iso)}
                </span>
                <span style={{ color: '#7d8590', minWidth: 50 }}>
                  {w.duration_sec}s
                </span>
                <span style={{ color: '#f0883e', fontWeight: 600 }}>
                  {w.speakers.join(' + ')}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
