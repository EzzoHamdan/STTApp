import { useState, useRef, useCallback, useEffect } from 'react';
import { useAudioCapture } from '../hooks/useAudioCapture';
import { useCourtSession } from '../hooks/useCourtSession';
import CourtSpeakerPanel from '../components/CourtSpeakerPanel';
import UnifiedTimeline from '../components/UnifiedTimeline';

const SPEAKERS = [
  { role: 'Judge', label: '⚖️ Judge' },
  { role: 'Lawyer_1', label: '👤 Lawyer 1' },
  { role: 'Lawyer_2', label: '👤 Lawyer 2' },
];

export default function CourtView() {
  const court = useCourtSession();
  const audio = useAudioCapture();
  const cleanupRef = useRef([]);

  // Track which speaker is currently streaming audio from this browser
  const [recordingSpeaker, setRecordingSpeaker] = useState(null);

  // Toast
  const [toastMsg, setToastMsg] = useState('');
  const toastTimer = useRef(null);
  function toast(msg, dur = 3500) {
    setToastMsg(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastMsg(''), dur);
  }

  // ── New session ────────────────────────────────────────────────
  async function handleNewSession() {
    if (court.sessionId && !window.confirm('Start a new session? Current data is preserved.')) return;

    // Stop any active recording first
    if (recordingSpeaker) {
      await handleStopSpeaker(recordingSpeaker);
    }

    const sid = await court.createSession();
    if (sid) {
      toast(`Session created: ${sid}`);
    } else {
      toast('❌ Cannot reach server — is it running?');
    }
  }

  // ── Start speaker ──────────────────────────────────────────────
  async function handleStartSpeaker(role) {
    // If another speaker is currently recording, stop them first
    if (recordingSpeaker && recordingSpeaker !== role) {
      await handleStopSpeaker(recordingSpeaker);
    }

    try {
      // Start mic if not already capturing
      if (!audio.isCapturing) {
        await audio.start();
      }

      // Tell server to start Azure for this speaker
      court.startSpeaker(role);
      court.setActiveSpeaker(role);

      // Wire audio data
      const unsub = audio.onAudioData((buffer) => {
        court.sendAudio(buffer);
      });
      cleanupRef.current.push(unsub);

      setRecordingSpeaker(role);
    } catch (err) {
      console.error('Failed to start speaker:', err);
      toast(`❌ Could not start ${role}`);
    }
  }

  // ── Stop speaker ──────────────────────────────────────────────
  async function handleStopSpeaker(role) {
    // Stop mic
    audio.stop();

    // Clean up audio listeners
    cleanupRef.current.forEach((fn) => fn());
    cleanupRef.current = [];

    // Tell server
    court.stopSpeaker(role);
    setRecordingSpeaker(null);
  }

  // ── Merge ──────────────────────────────────────────────────────
  async function handleMerge() {
    toast('Merging transcripts…', 7000);
    const result = await court.merge();
    if (result) {
      toast(`✅ Merged ${result.total} turns`);
    } else {
      toast('❌ Merge failed');
    }
  }

  // ── Download ───────────────────────────────────────────────────
  function handleDownload() {
    if (!court.lastMerged) return;
    const blob = new Blob(
      [JSON.stringify(court.lastMerged.entries, null, 2)],
      { type: 'application/json' }
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${court.sessionId}_unified.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cleanupRef.current.forEach((fn) => fn());
    };
  }, []);

  return (
    <>
      {/* ── Header ───────────────────────────────────────────── */}
      <div style={{ padding: '24px 28px 0', maxWidth: 1600, margin: '0 auto' }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            flexWrap: 'wrap',
            gap: 16,
          }}
        >
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
              ⚖️ COURT STT · LIVE TRANSCRIPTION · MULTI-SPEAKER
            </div>
            <h1
              style={{
                fontSize: 26,
                fontWeight: 700,
                letterSpacing: '-.02em',
                lineHeight: 1.1,
                margin: 0,
              }}
            >
              Court<span style={{ color: '#e0a020' }}> STT</span>
              <span style={{ color: '#334155', fontWeight: 300 }}> — Live</span>
            </h1>
            <p
              style={{
                color: '#475569',
                fontSize: 12,
                marginTop: 6,
                maxWidth: 540,
                lineHeight: 1.6,
              }}
            >
              Real-time court transcription with Azure Speech-to-Text.
              Start each speaker individually and see the unified timeline below.
            </p>
          </div>

          {/* Session info + controls */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            {/* Connection dot */}
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span
                className={court.wsConnected ? 'live-dot' : ''}
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: court.wsConnected ? '#56d364' : '#555',
                  display: 'inline-block',
                }}
              />
              <span style={{ fontSize: 12, color: '#7d8590' }}>
                {court.wsConnected ? 'Live' : 'Disconnected'}
              </span>
            </span>

            {/* Session badge */}
            <span
              style={{
                background: '#21262d',
                border: `1px solid ${court.sessionId ? '#4a9eda55' : '#30363d'}`,
                borderRadius: 20,
                padding: '4px 14px',
                fontFamily: 'Consolas, monospace',
                fontSize: 12,
                color: court.sessionId ? '#e6edf3' : '#7d8590',
              }}
            >
              {court.sessionId || 'No active session'}
            </span>
          </div>
        </div>

        {/* ── Controls bar ─────────────────────────────────── */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            marginTop: 20,
            marginBottom: 24,
            padding: '12px 20px',
            background: '#0b0c17',
            borderRadius: 12,
            border: '1px solid #0f111c',
            flexWrap: 'wrap',
          }}
        >
          <button
            onClick={handleNewSession}
            style={{
              padding: '8px 18px',
              borderRadius: 8,
              background: '#238636',
              color: '#fff',
              border: 'none',
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            ＋ New Session
          </button>
          <button
            onClick={handleMerge}
            disabled={!court.sessionId}
            style={{
              padding: '8px 18px',
              borderRadius: 8,
              background: '#6e40c9',
              color: '#fff',
              border: 'none',
              fontSize: 13,
              fontWeight: 600,
              cursor: court.sessionId ? 'pointer' : 'default',
              opacity: court.sessionId ? 1 : 0.35,
            }}
          >
            ⟳ Merge
          </button>
          <button
            onClick={handleDownload}
            disabled={!court.lastMerged}
            style={{
              padding: '8px 18px',
              borderRadius: 8,
              background: '#21262d',
              color: '#e6edf3',
              border: '1px solid #30363d',
              fontSize: 13,
              fontWeight: 600,
              cursor: court.lastMerged ? 'pointer' : 'default',
              opacity: court.lastMerged ? 1 : 0.35,
            }}
          >
            ↓ Download
          </button>

          <div style={{ flex: 1 }} />

          {/* Recording indicator */}
          {recordingSpeaker && (
            <span
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                fontSize: 12,
                color: '#f87171',
              }}
            >
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
              Recording: {recordingSpeaker.replace('_', ' ')}
            </span>
          )}
        </div>
      </div>

      {/* ── Speaker Panels ─────────────────────────────────── */}
      <div style={{ padding: '0 28px', maxWidth: 1600, margin: '0 auto' }}>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: 16,
            marginBottom: 20,
          }}
        >
          {SPEAKERS.map(({ role }) => {
            const sp = court.speakerStates[role] || {
              status: 'idle',
              transcripts: [],
              partial: '',
            };
            return (
              <CourtSpeakerPanel
                key={role}
                role={role}
                status={sp.status}
                transcripts={sp.transcripts}
                partial={sp.partial}
                isSessionActive={!!court.sessionId}
                onStart={() => handleStartSpeaker(role)}
                onStop={() => handleStopSpeaker(role)}
              />
            );
          })}
        </div>

        {/* ── Unified Timeline ──────────────────────────────── */}
        <div style={{ marginBottom: 40 }}>
          <UnifiedTimeline
            entries={court.unifiedEntries}
            overlapWindows={court.overlapWindows}
            colors={court.colors}
            onClear={court.clearTimeline}
          />
        </div>
      </div>

      {/* ── Toast ──────────────────────────────────────────── */}
      {toastMsg && (
        <div
          style={{
            position: 'fixed',
            bottom: 28,
            right: 28,
            background: '#161b22',
            border: '1px solid #30363d',
            borderRadius: 10,
            padding: '12px 18px',
            fontSize: 13,
            color: '#e6edf3',
            boxShadow: '0 8px 24px rgba(0,0,0,.4)',
            zIndex: 1000,
            maxWidth: 340,
          }}
        >
          {toastMsg}
        </div>
      )}
    </>
  );
}
