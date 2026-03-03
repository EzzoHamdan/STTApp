import { useState, useRef, useCallback, useEffect } from 'react';
import { getAccessCode, authFetch } from '../components/AccessGate';

/**
 * React hook managing the full court session lifecycle:
 *  - Session creation via REST API
 *  - WebSocket connection for live events
 *  - Speaker start/stop (creates Azure recognizer on the server)
 *  - Audio routing to the active speaker
 *  - Unified timeline accumulation
 *  - Merge trigger
 */
export function useCourtSession() {
  const [sessionId, setSessionId] = useState(null);
  const [wsConnected, setWsConnected] = useState(false);
  const [colors, setColors] = useState({});

  // Per-speaker state: { [role]: { status, transcripts, partial } }
  const [speakerStates, setSpeakerStates] = useState({});

  // Unified timeline
  const [unifiedEntries, setUnifiedEntries] = useState([]);
  const [overlapWindows, setOverlapWindows] = useState([]);
  const [lastMerged, setLastMerged] = useState(null);

  const wsRef = useRef(null);
  const wsRetryRef = useRef(0);
  const sessionIdRef = useRef(null);
  sessionIdRef.current = sessionId;

  // ── Helpers ──────────────────────────────────────────────────────

  function updateSpeaker(role, updates) {
    setSpeakerStates((prev) => ({
      ...prev,
      [role]: { ...(prev[role] || { status: 'idle', transcripts: [], partial: '' }), ...updates },
    }));
  }

  // ── WebSocket ────────────────────────────────────────────────────

  const connectWS = useCallback((sid) => {
    if (wsRef.current) {
      wsRef.current.onclose = null;
      wsRef.current.close();
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const code = getAccessCode();
    const qs = code ? `?code=${encodeURIComponent(code)}` : '';
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws/court/${sid}${qs}`);
    wsRef.current = ws;
    wsRetryRef.current = 0;

    ws.onopen = () => {
      setWsConnected(true);
      // Keep alive
      ws._ping = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) ws.send('ping');
      }, 25000);
    };

    ws.onclose = () => {
      setWsConnected(false);
      clearInterval(ws._ping);
      // Auto-reconnect
      if (sessionIdRef.current === sid) {
        wsRetryRef.current++;
        const delay = Math.min(1000 * wsRetryRef.current, 8000);
        setTimeout(() => {
          if (sessionIdRef.current === sid) connectWS(sid);
        }, delay);
      }
    };

    ws.onerror = () => setWsConnected(false);

    ws.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data);
        handleWSMessage(msg);
      } catch (err) {
        console.error('[Court WS] Message handling error:', err);
      }
    };
  }, []);

  function handleWSMessage(msg) {
    switch (msg.type) {
      case 'hello':
        if (msg.colors) setColors(msg.colors);
        break;

      case 'result': {
        const entry = msg;
        // Add to speaker transcripts
        setSpeakerStates((prev) => {
          const sp = prev[entry.speaker] || { status: 'recording', transcripts: [], partial: '' };
          return {
            ...prev,
            [entry.speaker]: {
              ...sp,
              transcripts: [...(sp.transcripts || []), entry],
              partial: '',
            },
          };
        });
        // Add to unified timeline
        setUnifiedEntries((prev) => {
          const next = [...prev, entry];
          next.sort((a, b) => (a.utc_iso < b.utc_iso ? -1 : 1));
          return next;
        });
        break;
      }

      case 'partial':
        updateSpeaker(msg.speaker, { partial: msg.text });
        break;

      case 'status':
        console.log(`[Court WS] status: speaker=${msg.speaker} event=${msg.event} text=${msg.text}`);
        handleStatusEvent(msg);
        break;

      case 'merged':
        setUnifiedEntries(msg.entries || []);
        setOverlapWindows(msg.overlaps || []);
        setLastMerged(msg);
        break;

      case 'pong':
        break;

      default:
        break;
    }
  }

  function handleStatusEvent(msg) {
    const { speaker, event } = msg;
    switch (event) {
      case 'connected':
        updateSpeaker(speaker, { status: 'connecting' });
        break;
      case 'started':
        updateSpeaker(speaker, { status: 'recording' });
        break;
      case 'stopped':
        updateSpeaker(speaker, { status: 'idle', partial: '' });
        break;
      case 'speech_start':
        // Keep status as recording, just visual hint
        break;
      case 'speech_end':
        break;
      case 'error':
        console.error(`[Court] Azure error for ${speaker}: ${msg.text}`);
        updateSpeaker(speaker, { status: 'error', error: msg.text || 'Unknown error' });
        break;
      case 'partial':
        updateSpeaker(speaker, { partial: msg.text });
        break;
      default:
        break;
    }
  }

  // ── Public methods ───────────────────────────────────────────────

  const createSession = useCallback(async () => {
    try {
      const res = await authFetch('/api/court/session/new', { method: 'POST' });
      const data = await res.json();
      setSessionId(data.session_id);
      setColors(data.colors || {});
      setUnifiedEntries([]);
      setOverlapWindows([]);
      setLastMerged(null);

      // Init speaker states
      const speakers = data.meta?.speakers || ['Judge', 'Lawyer_1', 'Lawyer_2'];
      const initStates = {};
      speakers.forEach((role) => {
        initStates[role] = { status: 'idle', transcripts: [], partial: '' };
      });
      setSpeakerStates(initStates);

      connectWS(data.session_id);
      return data.session_id;
    } catch (err) {
      console.error('Failed to create session:', err);
      return null;
    }
  }, [connectWS]);

  const startSpeaker = useCallback(
    (role) => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        updateSpeaker(role, { status: 'connecting' });
        wsRef.current.send(JSON.stringify({ type: 'start-speaker', role }));
      }
    },
    []
  );

  const stopSpeaker = useCallback(
    (role) => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'stop-speaker', role }));
      }
    },
    []
  );

  /** Send raw PCM audio to the server for the active speaker. */
  const sendAudio = useCallback((buffer) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(buffer);
    }
  }, []);

  /** Tell the server to add a speaker to receive audio from this connection. */
  const addActiveSpeaker = useCallback((role) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'add-active-speaker', role }));
    }
  }, []);

  /** Tell the server to remove a speaker from receiving audio. */
  const removeActiveSpeaker = useCallback((role) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'remove-active-speaker', role }));
    }
  }, []);

  const merge = useCallback(async () => {
    if (!sessionId) return null;
    try {
      const res = await authFetch(`/api/court/session/${sessionId}/merge`, { method: 'POST' });
      const data = await res.json();
      return data;
    } catch (err) {
      console.error('Merge failed:', err);
      return null;
    }
  }, [sessionId]);

  const clearTimeline = useCallback(() => {
    setUnifiedEntries([]);
    setOverlapWindows([]);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
      }
    };
  }, []);

  return {
    sessionId,
    wsConnected,
    colors,
    speakerStates,
    unifiedEntries,
    overlapWindows,
    lastMerged,
    createSession,
    startSpeaker,
    stopSpeaker,
    sendAudio,
    addActiveSpeaker,
    removeActiveSpeaker,
    merge,
    clearTimeline,
  };
}
