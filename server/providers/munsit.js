import lamejs from '@breezystack/lamejs';

/**
 * Munsit by CNTXT AI — Arabic speech-to-text
 * Website: https://munsit.com  ·  Docs: https://munsit.com/munsit/api-docs
 * API portal: https://app.cntxt.tools
 *
 * Munsit only exposes a REST batch API (no documented real-time streaming).
 * We simulate near-real-time by accumulating PCM audio and sending chunks
 * every ~5 seconds, encoding them as MP3 (the only documented format) and
 * POSTing to their transcription endpoint.
 *
 * Endpoint: POST https://api.cntxt.tools/audio/transcribe
 * Auth: Bearer token in Authorization header
 * Format: multipart/form-data  ·  file: audio/mpeg (.mp3)  ·  model: munsit-1
 */

const BATCH_INTERVAL_MS = 5000;          // Send a chunk every 5 s
const MIN_AUDIO_BYTES   = 16000 * 2 * 2; // ≥ 2 s of 16 kHz s16le mono
const API_URL           = 'https://api.cntxt.tools/audio/transcribe';

export function createMunsitSession(clientWs, env) {
  let running     = false;
  let timer       = null;
  let audioChunks = [];
  let inflight    = false;   // prevent overlapping batch requests

  function send(type, data) {
    if (clientWs.readyState === 1 /* WebSocket.OPEN */) {
      clientWs.send(JSON.stringify({ provider: 'munsit', type, ...data }));
    }
  }

  /**
   * Encode raw PCM s16le 16 kHz mono → MP3 using lamejs.
   * Returns a Buffer containing a valid MP3 file.
   */
  function pcmToMp3(pcmBuf) {
    const sampleRate = 16000;
    const channels   = 1;
    const kbps       = 64;

    const encoder = new lamejs.Mp3Encoder(channels, sampleRate, kbps);
    // Convert Node Buffer → Int16Array (s16le)
    const samples = new Int16Array(
      pcmBuf.buffer,
      pcmBuf.byteOffset,
      pcmBuf.length / 2,
    );

    const blockSize = 1152; // lamejs processes 1152 samples at a time
    const mp3Parts  = [];

    for (let i = 0; i < samples.length; i += blockSize) {
      const chunk   = samples.subarray(i, i + blockSize);
      const mp3Buf  = encoder.encodeBuffer(chunk);
      if (mp3Buf.length > 0) mp3Parts.push(Buffer.from(mp3Buf));
    }

    const tail = encoder.flush();
    if (tail.length > 0) mp3Parts.push(Buffer.from(tail));

    return Buffer.concat(mp3Parts);
  }

  /** Send accumulated audio to the Munsit REST API */
  async function flush(isFinalFlush = false) {
    if (audioChunks.length === 0 || inflight) return;

    const pcm = Buffer.concat(audioChunks);
    audioChunks = [];

    if (pcm.length < MIN_AUDIO_BYTES && !isFinalFlush) return;  // too short, wait
    if (pcm.length === 0) return;

    const mp3 = pcmToMp3(pcm);
    inflight  = true;

    const durationSec = (pcm.length / 32000).toFixed(1);

    // Show a "processing" interim while the request is in-flight
    send('transcript', { text: '…', isFinal: false, timestamp: Date.now() });

    try {
      const blob = new Blob([mp3], { type: 'audio/mpeg' });
      const form = new globalThis.FormData();
      form.append('file', blob, 'chunk.mp3');
      form.append('model', 'munsit-1');

      const res = await fetch(API_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${env.MUNSIT_API_KEY}`,
        },
        body: form,
      });

      if (!res.ok) {
        const body = await res.text();
        console.error(`[munsit] HTTP ${res.status}: ${body}`);
        send('error', { message: `Munsit API ${res.status}: ${body.slice(0, 200)}` });
        inflight = false;
        return;
      }

      const json = await res.json();
      console.log(`[munsit] API response (${durationSec}s chunk):`, JSON.stringify(json).slice(0, 300));

      // Response shape: { statusCode: 201, data: { transcription: "...", duration, timestamps }, message }
      const text = json.data?.transcription || json.text || json.transcription || json.transcript || '';

      if (text.trim()) {
        send('transcript', {
          text: text.trim(),
          isFinal: true,
          confidence: json.confidence ?? 0,
          timestamp: Date.now(),
        });
      } else {
        // Clear the "…" partial if nothing came back
        send('transcript', { text: '', isFinal: false, timestamp: Date.now() });
      }

      console.log(`[munsit] Chunk transcribed (${durationSec}s, mp3=${mp3.length}B): ${text.trim().slice(0, 80) || '(empty)'}`);
    } catch (err) {
      console.error('[munsit] Fetch error:', err.message);
      send('error', { message: `Munsit request failed: ${err.message}` });
    } finally {
      inflight = false;
    }
  }

  return {
    start(_config) {
      const apiKey = env.MUNSIT_API_KEY;
      if (!apiKey) {
        send('error', {
          message: 'MUNSIT_API_KEY not configured — add it to .env or set via UI. Sign up at app.cntxt.tools',
        });
        return;
      }

      running     = true;
      audioChunks = [];
      inflight    = false;

      // Mark as "connected" immediately – batch mode is always ready
      send('status', { status: 'connected' });
      console.log('[munsit] Session started (REST batch → MP3, chunking every 5 s)');

      timer = setInterval(() => {
        if (running) flush();
      }, BATCH_INTERVAL_MS);
    },

    sendAudio(buffer) {
      if (running) {
        audioChunks.push(Buffer.from(buffer));
      }
    },

    stop() {
      running = false;
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      // Flush any remaining audio
      flush(true).finally(() => {
        send('status', { status: 'disconnected' });
        console.log('[munsit] Session stopped');
      });
    },
  };
}
