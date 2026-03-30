import WebSocket from 'ws';
import { createAzureSession } from './azure.js';

export const COURT_PROVIDER_OPTIONS = [
  { id: 'azure', label: 'Azure Speech', envKey: 'AZURE_SPEECH_KEY' },
  { id: 'deepgram', label: 'Deepgram Nova-3', envKey: 'DEEPGRAM_API_KEY' },
  { id: 'speechmatics', label: 'Speechmatics RT', envKey: 'SPEECHMATICS_API_KEY' },
];

export function normalizeCourtProvider(provider) {
  const allowed = new Set(COURT_PROVIDER_OPTIONS.map((p) => p.id));
  const normalized = String(provider || 'azure').toLowerCase();
  return allowed.has(normalized) ? normalized : 'azure';
}

export function hasCourtProviderKey(provider, env) {
  const normalized = normalizeCourtProvider(provider);
  const option = COURT_PROVIDER_OPTIONS.find((p) => p.id === normalized);
  return !!(option && env[option.envKey]);
}

function toSafeNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function createCourtEntry(sessionId, speaker, provider, text, startSec, durationSec) {
  const offsetSec = Math.max(toSafeNumber(startSec, 0), 0);
  const duration = Math.max(toSafeNumber(durationSec, 0), 0);
  return {
    session_id: sessionId,
    speaker,
    provider,
    utc_iso: new Date().toISOString(),
    offset_ticks: Math.round(offsetSec * 1e7),
    offset_sec: Math.round(offsetSec * 10000) / 10000,
    duration_sec: Math.round(duration * 10000) / 10000,
    text,
  };
}

const STANDALONE_PUNCT_RE = /^[,.;:!?\)\]\}"'`\u060C\u061B\u061F]+$/;
const OPEN_BRACKET_RE = /[\(\[\{]$/;

function appendWithSpacing(base, nextChunk) {
  const left = String(base || '').trim();
  const right = String(nextChunk || '').trim();
  if (!left) return right;
  if (!right) return left;
  if (STANDALONE_PUNCT_RE.test(right)) return `${left}${right}`;
  if (OPEN_BRACKET_RE.test(left)) return `${left}${right}`;
  return `${left} ${right}`;
}

function speechmaticsTextFromResults(results) {
  let text = '';
  for (const r of results || []) {
    const token = String(r?.alternatives?.[0]?.content || '').trim();
    if (!token) continue;
    const type = String(r?.type || '').toLowerCase();
    const isPunctuation = type.includes('punct') || STANDALONE_PUNCT_RE.test(token);
    if (!text) {
      if (isPunctuation) continue;
      text = token;
      continue;
    }
    text = isPunctuation ? `${text}${token}` : appendWithSpacing(text, token);
  }
  return text.trim();
}

function stopProviderSocket(providerWs, closeMessage, closeDelayMs = 0) {
  return new Promise((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve();
    };

    const timeout = setTimeout(() => {
      try {
        providerWs?.terminate();
      } catch (_) {
        // ignore
      }
      done();
    }, 3000);

    if (!providerWs) {
      done();
      return;
    }

    providerWs.once('close', done);

    const closeSocket = () => {
      try {
        providerWs.close();
      } catch (_) {
        done();
      }
    };

    try {
      if (providerWs.readyState === WebSocket.OPEN) {
        if (closeMessage) {
          providerWs.send(JSON.stringify(closeMessage));
        }
        if (closeDelayMs > 0) {
          setTimeout(closeSocket, closeDelayMs);
        } else {
          closeSocket();
        }
      } else if (providerWs.readyState === WebSocket.CONNECTING) {
        providerWs.once('open', closeSocket);
      } else {
        done();
      }
    } catch (_) {
      done();
    }
  });
}

function createCourtDeepgramSession(sessionId, speaker, env, callbacks) {
  const apiKey = env.DEEPGRAM_API_KEY;
  if (!apiKey) {
    callbacks.onError('DEEPGRAM_API_KEY is not configured');
    return null;
  }

  const params = new URLSearchParams({
    model: 'nova-3',
    language: 'ar',
    encoding: 'linear16',
    sample_rate: '16000',
    channels: '1',
    interim_results: 'true',
    utterance_end_ms: '1000',
    smart_format: 'true',
    punctuate: 'true',
  });

  const providerWs = new WebSocket(`wss://api.deepgram.com/v1/listen?${params.toString()}`, {
    headers: { Authorization: `Token ${apiKey}` },
  });

  const entries = [];
  let stopped = false;

  providerWs.on('open', () => {
    callbacks.onStatus('connected', 'Connected to Deepgram');
    callbacks.onStatus('started', `${speaker} microphone is live`);
  });

  providerWs.on('message', (data) => {
    if (stopped) return;
    try {
      const msg = JSON.parse(data.toString());
      if (msg.type !== 'Results') return;

      const alt = msg.channel?.alternatives?.[0];
      const text = (alt?.transcript || '').trim();
      if (!text) return;

      if (msg.is_final) {
        const startSec = toSafeNumber(msg.start ?? alt?.words?.[0]?.start, 0);
        const durationSec = toSafeNumber(msg.duration, 0);
        const entry = createCourtEntry(
          sessionId,
          speaker,
          'deepgram',
          text,
          startSec,
          durationSec
        );
        entries.push(entry);
        callbacks.onResult(entry);
      } else {
        callbacks.onPartial(text);
      }
    } catch (err) {
      callbacks.onError(`Deepgram parse error: ${err.message}`);
    }
  });

  providerWs.on('error', (err) => {
    callbacks.onError(`Deepgram error: ${err.message}`);
  });

  providerWs.on('close', () => {
    if (!stopped) {
      callbacks.onStatus('stopped', `${speaker} disconnected`);
    }
  });

  return {
    sendAudio(buffer) {
      if (!stopped && providerWs.readyState === WebSocket.OPEN) {
        providerWs.send(buffer);
      }
    },
    async stop() {
      stopped = true;
      await stopProviderSocket(providerWs, { type: 'CloseStream' });
      return entries;
    },
    getEntries() {
      return [...entries];
    },
  };
}

function createCourtSpeechmaticsSession(sessionId, speaker, env, callbacks) {
  const apiKey = env.SPEECHMATICS_API_KEY;
  if (!apiKey) {
    callbacks.onError('SPEECHMATICS_API_KEY is not configured');
    return null;
  }

  const providerWs = new WebSocket('wss://eu2.rt.speechmatics.com/v2', {
    headers: { Authorization: `Bearer ${apiKey}` },
  });

  const entries = [];
  let stopped = false;
  const SILENCE_GAP_SEC = Math.max(toSafeNumber(env.COURT_SPEECHMATICS_SILENCE_SEC, 1.6), 0.6);
  const IDLE_FLUSH_MS = Math.max(Math.round(toSafeNumber(env.COURT_SPEECHMATICS_IDLE_FLUSH_MS, 1400)), 400);
  let pending = null;
  let flushTimer = null;

  function clearFlushTimer() {
    if (!flushTimer) return;
    clearTimeout(flushTimer);
    flushTimer = null;
  }

  function scheduleFlush() {
    clearFlushTimer();
    flushTimer = setTimeout(() => {
      flushPending();
    }, IDLE_FLUSH_MS);
  }

  function flushPending() {
    clearFlushTimer();
    if (!pending || !pending.text) {
      pending = null;
      return;
    }
    const durationSec = Math.max((pending.endSec || 0) - (pending.startSec || 0), 0);
    const entry = createCourtEntry(
      sessionId,
      speaker,
      'speechmatics',
      pending.text,
      pending.startSec,
      durationSec
    );
    entries.push(entry);
    callbacks.onResult(entry);
    pending = null;
  }

  function pushFinalSegment(text, startSec, endSec) {
    const chunkText = String(text || '').trim();
    if (!chunkText) return;
    const chunkStart = toSafeNumber(startSec, 0);
    const chunkEnd = Math.max(toSafeNumber(endSec, chunkStart), chunkStart);

    if (!pending) {
      pending = { text: chunkText, startSec: chunkStart, endSec: chunkEnd };
    } else {
      const gapSec = chunkStart - pending.endSec;
      const shouldMerge = gapSec <= SILENCE_GAP_SEC && gapSec >= -0.35;
      if (shouldMerge) {
        pending.text = appendWithSpacing(pending.text, chunkText);
        pending.endSec = Math.max(pending.endSec, chunkEnd);
      } else {
        flushPending();
        pending = { text: chunkText, startSec: chunkStart, endSec: chunkEnd };
      }
    }

    // Emit when speech goes idle, which better matches natural pauses.
    scheduleFlush();
  }

  providerWs.on('open', () => {
    providerWs.send(
      JSON.stringify({
        message: 'StartRecognition',
        transcription_config: {
          language: 'ar',
          enable_partials: true,
          max_delay: 2.0,
          operating_point: 'enhanced',
        },
        audio_format: {
          type: 'raw',
          encoding: 'pcm_s16le',
          sample_rate: 16000,
        },
      })
    );
  });

  providerWs.on('message', (data) => {
    if (stopped) return;

    try {
      const msg = JSON.parse(data.toString());

      if (msg.message === 'RecognitionStarted') {
        callbacks.onStatus('connected', 'Connected to Speechmatics');
        callbacks.onStatus('started', `${speaker} microphone is live`);
        return;
      }

      if (msg.message === 'AddPartialTranscript') {
        const partial = speechmaticsTextFromResults(msg.results || []);
        if (partial) callbacks.onPartial(partial);
        return;
      }

      if (msg.message === 'AddTranscript') {
        const text = speechmaticsTextFromResults(msg.results || []);

        if (!text) return;

        const starts = (msg.results || [])
          .map((r) => toSafeNumber(r.start_time, NaN))
          .filter((n) => Number.isFinite(n));
        const ends = (msg.results || [])
          .map((r) => toSafeNumber(r.end_time, NaN))
          .filter((n) => Number.isFinite(n));

        const startSec = starts.length ? Math.min(...starts) : 0;
        const endSec = ends.length ? Math.max(...ends) : startSec;
        pushFinalSegment(text, startSec, endSec);
        return;
      }

      if (
        msg.message === 'EndOfUtterance'
        || msg.message === 'EndOfSegment'
        || msg.message === 'EndOfTranscript'
      ) {
        flushPending();
        return;
      }

      if (msg.message === 'Error') {
        callbacks.onError(`Speechmatics error: ${msg.reason || 'Unknown error'}`);
      }
    } catch (err) {
      callbacks.onError(`Speechmatics parse error: ${err.message}`);
    }
  });

  providerWs.on('error', (err) => {
    callbacks.onError(`Speechmatics error: ${err.message}`);
  });

  providerWs.on('close', () => {
    flushPending();
    if (!stopped) {
      callbacks.onStatus('stopped', `${speaker} disconnected`);
    }
  });

  return {
    sendAudio(buffer) {
      if (!stopped && providerWs.readyState === WebSocket.OPEN) {
        providerWs.send(buffer);
      }
    },
    async stop() {
      stopped = true;
      flushPending();
      await stopProviderSocket(providerWs, { message: 'EndOfStream' }, 900);
      return entries;
    },
    getEntries() {
      return [...entries];
    },
  };
}

export function createCourtTranscriber(provider, sessionId, speaker, env, callbacks) {
  const normalized = normalizeCourtProvider(provider);

  if (normalized === 'azure') {
    return createAzureSession(sessionId, speaker, env, callbacks);
  }
  if (normalized === 'deepgram') {
    return createCourtDeepgramSession(sessionId, speaker, env, callbacks);
  }
  if (normalized === 'speechmatics') {
    return createCourtSpeechmaticsSession(sessionId, speaker, env, callbacks);
  }
  return null;
}