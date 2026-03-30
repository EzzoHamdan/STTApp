import { useState, useRef, useEffect } from 'react';
import { useAudioCapture } from '../hooks/useAudioCapture';
import { useCourtSession } from '../hooks/useCourtSession';
import CourtSpeakerPanel from '../components/CourtSpeakerPanel';
import UnifiedTimeline from '../components/UnifiedTimeline';
import { authFetch } from '../components/AccessGate';

const SPEAKERS = [
  { role: 'Judge', label: 'Judge' },
  { role: 'Lawyer_1', label: 'Lawyer 1' },
  { role: 'Lawyer_2', label: 'Lawyer 2' },
];

const COURT_MODELS = [
  { id: 'azure', label: 'Azure Speech' },
  { id: 'deepgram', label: 'Deepgram Nova-3' },
  { id: 'speechmatics', label: 'Speechmatics RT' },
];

export default function CourtView() {
  const court = useCourtSession();
  const audio = useAudioCapture();
  const cleanupRef = useRef([]);
  const [modelStatus, setModelStatus] = useState({});
  const [selectedModel, setSelectedModel] = useState(() => {
    const saved = localStorage.getItem('court_selected_model');
    return saved || 'azure';
  });

  // Track which speakers are currently streaming audio from this browser
  const [recordingSpeakers, setRecordingSpeakers] = useState(new Set());

  // Toast
  const [toastMsg, setToastMsg] = useState('');
  const toastTimer = useRef(null);
  function toast(msg, dur = 3500) {
    setToastMsg(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastMsg(''), dur);
  }

  const selectedModelLabel = COURT_MODELS.find((m) => m.id === selectedModel)?.label || selectedModel;
  const isSelectedModelConfigured = !!modelStatus[selectedModel];

  useEffect(() => {
    authFetch('/api/court/keys/status')
      .then((r) => r.json())
      .then((data) => setModelStatus(data || {}))
      .catch(() => setModelStatus({}));
  }, []);

  function handleModelChange(nextModel) {
    if (recordingSpeakers.size > 0) return;
    setSelectedModel(nextModel);
    localStorage.setItem('court_selected_model', nextModel);
  }

  // ── New session ────────────────────────────────────────────────
  async function handleNewSession() {
    if (court.sessionId && !window.confirm('Start a new session? Current data is preserved.')) return;

    // Stop any active recordings first
    if (recordingSpeakers.size > 0) {
      for (const role of recordingSpeakers) {
        await handleStopSpeaker(role);
      }
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
    try {
      if (!isSelectedModelConfigured) {
        toast(`Missing API key for ${selectedModelLabel}`);
        return;
      }

      // Start mic if not already capturing
      if (!audio.isCapturing) {
        await audio.start();

        // Wire audio data (only once — shared by all speakers)
        const unsub = audio.onAudioData((buffer) => {
          court.sendAudio(buffer);
        });
        cleanupRef.current.push(unsub);
      }

      // Tell server to start selected STT model for this speaker
      court.startSpeaker(role, selectedModel);
      court.addActiveSpeaker(role);

      setRecordingSpeakers((prev) => new Set([...prev, role]));
    } catch (err) {
      console.error('Failed to start speaker:', err);
      toast(`❌ Could not start ${role}`);
    }
  }

  // ── Stop speaker ──────────────────────────────────────────────
  async function handleStopSpeaker(role) {
    // Tell server to stop this speaker
    court.stopSpeaker(role);
    court.removeActiveSpeaker(role);

    setRecordingSpeakers((prev) => {
      const next = new Set(prev);
      next.delete(role);

      // If no speakers left, stop the mic
      if (next.size === 0) {
        audio.stop();
        cleanupRef.current.forEach((fn) => fn());
        cleanupRef.current = [];
      }
      return next;
    });
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
      clearTimeout(toastTimer.current);
      cleanupRef.current.forEach((fn) => fn());
    };
  }, []);

  return (
    <>
      <div style={{ padding: '20px 24px 0', maxWidth: 1320, margin: '0 auto' }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            flexWrap: 'wrap',
            gap: 14,
          }}
        >
          <div>
            <div
              style={{
                fontSize: 11,
                letterSpacing: '.14em',
                color: 'var(--muted)',
                textTransform: 'uppercase',
                fontFamily: 'JetBrains Mono, monospace',
                marginBottom: 8,
              }}
            >
              Court Transcription
            </div>
            <h1
              style={{
                fontSize: 30,
                fontWeight: 700,
                letterSpacing: '-.03em',
                lineHeight: 1.1,
                margin: 0,
                color: 'var(--text)',
              }}
            >
              Session Room
            </h1>
            <p
              style={{
                color: 'var(--muted)',
                fontSize: 13,
                marginTop: 6,
                maxWidth: 620,
                lineHeight: 1.6,
              }}
            >
              Start a session, choose one STT model, then start each speaker. The timeline merges every speaker in chronological order.
            </p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <span
                className={court.wsConnected ? 'live-dot' : ''}
                style={{
                  width: 9,
                  height: 9,
                  borderRadius: '50%',
                  background: court.wsConnected ? 'var(--success)' : 'var(--muted)',
                  display: 'inline-block',
                }}
              />
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>
                {court.wsConnected ? 'Live' : 'Disconnected'}
              </span>
            </span>

            <span
              style={{
                background: 'var(--surface)',
                border: `1px solid ${court.sessionId ? 'var(--accent-soft)' : 'var(--border)'}`,
                borderRadius: 20,
                padding: '4px 14px',
                fontFamily: 'JetBrains Mono, monospace',
                fontSize: 12,
                color: court.sessionId ? 'var(--text)' : 'var(--muted)',
              }}
            >
              {court.sessionId || 'No active session'}
            </span>
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            marginTop: 18,
            marginBottom: 24,
            padding: '14px 16px',
            background: 'var(--panel)',
            borderRadius: 12,
            border: '1px solid var(--border)',
            flexWrap: 'wrap',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <label
              htmlFor="court-model"
              style={{
                fontSize: 11,
                color: 'var(--muted)',
                fontFamily: 'JetBrains Mono, monospace',
              }}
            >
              Model
            </label>
            <select
              id="court-model"
              value={selectedModel}
              onChange={(e) => handleModelChange(e.target.value)}
              disabled={recordingSpeakers.size > 0}
              style={{
                minWidth: 210,
                padding: '8px 10px',
                borderRadius: 8,
                border: '1px solid var(--border)',
                background: 'var(--surface)',
                color: 'var(--text)',
                fontSize: 13,
              }}
            >
              {COURT_MODELS.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.label}
                  {!modelStatus[model.id] ? ' (missing key)' : ''}
                </option>
              ))}
            </select>
          </div>

          <span
            style={{
              fontSize: 11,
              color: isSelectedModelConfigured ? 'var(--success)' : 'var(--warning)',
              fontFamily: 'JetBrains Mono, monospace',
            }}
          >
            {isSelectedModelConfigured ? `${selectedModelLabel} ready` : `${selectedModelLabel} key missing`}
          </span>

          <button
            onClick={handleNewSession}
            className="stt-btn stt-btn-primary"
            style={{
              padding: '8px 14px',
              fontSize: 13,
            }}
          >
            New Session
          </button>
          <button
            onClick={handleMerge}
            disabled={!court.sessionId}
            className="stt-btn stt-btn-secondary"
            style={{
              padding: '8px 14px',
              fontSize: 13,
              opacity: court.sessionId ? 1 : 0.35,
            }}
          >
            Merge
          </button>
          <button
            onClick={handleDownload}
            disabled={!court.lastMerged}
            className="stt-btn stt-btn-ghost"
            style={{
              padding: '8px 14px',
              fontSize: 13,
              opacity: court.lastMerged ? 1 : 0.35,
            }}
          >
            Download JSON
          </button>

          <div style={{ flex: 1 }} />

          {recordingSpeakers.size > 0 && (
            <span
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 7,
                fontSize: 12,
                color: 'var(--danger)',
              }}
            >
              <span
                className="live-dot"
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: 'var(--danger)',
                  display: 'inline-block',
                }}
              />
              Recording · {[...recordingSpeakers].map((r) => r.replace('_', ' ')).join(', ')}
            </span>
          )}
        </div>
      </div>

      <div style={{ padding: '0 24px', maxWidth: 1320, margin: '0 auto' }}>
        <div
          className="court-speakers-row"
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: 14,
            marginBottom: 16,
          }}
        >
          {SPEAKERS.map(({ role }) => {
            const sp = court.speakerStates[role] || {
              status: 'idle',
              transcripts: [],
              partial: '',
              provider: selectedModel,
            };
            return (
              <CourtSpeakerPanel
                key={role}
                role={role}
                status={sp.status}
                transcripts={sp.transcripts}
                partial={sp.partial}
                error={sp.error}
                isSessionActive={!!court.sessionId}
                provider={sp.provider || selectedModel}
                onStart={() => handleStartSpeaker(role)}
                onStop={() => handleStopSpeaker(role)}
              />
            );
          })}
        </div>

        <div style={{ marginBottom: 40 }}>
          <UnifiedTimeline
            entries={court.unifiedEntries}
            overlapWindows={court.overlapWindows}
            colors={court.colors}
            onClear={court.clearTimeline}
          />
        </div>
      </div>

      {toastMsg && (
        <div
          style={{
            position: 'fixed',
            bottom: 20,
            right: 20,
            background: 'var(--panel)',
            border: '1px solid var(--border)',
            borderRadius: 10,
            padding: '10px 14px',
            fontSize: 13,
            color: 'var(--text)',
            boxShadow: '0 8px 22px rgba(0,0,0,0.18)',
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
