import { useRef, useState, useCallback, useEffect } from 'react';
import { getAccessCode } from '../components/AccessGate';

/**
 * Manages a WebSocket connection to a single STT provider on the backend.
 * Receives transcript events and tracks latency.
 */
export function useSTTWebSocket(provider) {
  const [status, setStatus] = useState('idle'); // idle | connecting | connected | error | disconnected
  const [transcripts, setTranscripts] = useState([]); // [{ text, timestamp, confidence }]
  const [partial, setPartial] = useState('');
  const [error, setError] = useState(null);
  const [latencies, setLatencies] = useState([]);

  const wsRef = useRef(null);
  const audioSendTimeRef = useRef(null);

  const connect = useCallback(() => {
    if (wsRef.current) return;

    setStatus('connecting');
    setError(null);
    setTranscripts([]);
    setPartial('');
    setLatencies([]);

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const code = getAccessCode();
    const qs = code ? `?code=${encodeURIComponent(code)}` : '';
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws/${provider}${qs}`);
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'start' }));
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);

        if (msg.type === 'status') {
          setStatus(msg.status === 'connected' ? 'connected' : msg.status);
        } else if (msg.type === 'transcript') {
          const now = Date.now();
          if (audioSendTimeRef.current) {
            const latency = now - audioSendTimeRef.current;
            setLatencies((prev) => [...prev.slice(-29), latency]);
          }

          if (msg.isFinal) {
            if (msg.text.trim()) {
              setTranscripts((prev) => [
                ...prev,
                { text: msg.text, timestamp: msg.timestamp, confidence: msg.confidence },
              ]);
            }
            setPartial('');
          } else {
            setPartial(msg.text);
          }
        } else if (msg.type === 'error') {
          setError(msg.message);
          setStatus('error');
        } else if (msg.type === 'utterance_end') {
          setPartial('');
        }
      } catch (e) {
        console.error(`[${provider}] Message parse error:`, e);
      }
    };

    ws.onerror = () => {
      setError('WebSocket connection failed');
      setStatus('error');
    };

    ws.onclose = () => {
      setStatus('disconnected');
      wsRef.current = null;
    };
  }, [provider]);

  const disconnect = useCallback(() => {
    if (wsRef.current) {
      try {
        wsRef.current.send(JSON.stringify({ type: 'stop' }));
      } catch (_) {}
      wsRef.current.close();
      wsRef.current = null;
    }
    setStatus('idle');
  }, []);

  const sendAudio = useCallback((audioBuffer) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      audioSendTimeRef.current = Date.now();
      wsRef.current.send(audioBuffer);
    }
  }, []);

  const clearTranscripts = useCallback(() => {
    setTranscripts([]);
    setPartial('');
  }, []);

  const avgLatency =
    latencies.length > 0
      ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)
      : null;

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      wsRef.current?.close();
    };
  }, []);

  return {
    status,
    transcripts,
    partial,
    error,
    avgLatency,
    latencies,
    connect,
    disconnect,
    sendAudio,
    clearTranscripts,
  };
}
