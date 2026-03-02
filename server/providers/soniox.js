import WebSocket from 'ws';

/**
 * Soniox — Arabic real-time streaming
 * Docs: https://soniox.com/docs/stt/api-reference/websocket-api
 * Endpoint: wss://stt-rt.soniox.com/transcribe-websocket
 * Auth: api_key in initial JSON config message
 * Audio: raw PCM s16le, 16 kHz, mono (binary frames after config)
 * Response: { tokens: [{ text, is_final, confidence, ... }], final_audio_proc_ms, total_audio_proc_ms }
 */
export function createSonioxSession(clientWs, env) {
  let providerWs = null;
  // Accumulate final text so we can distinguish new finals vs duplicates
  let finalizedText = '';

  function send(type, data) {
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(JSON.stringify({ provider: 'soniox', type, ...data }));
    }
  }

  return {
    start() {
      const apiKey = env.SONIOX_API_KEY;
      if (!apiKey) {
        send('error', { message: 'SONIOX_API_KEY not configured — add it to .env or set via UI' });
        return;
      }

      finalizedText = '';

      const url = 'wss://stt-rt.soniox.com/transcribe-websocket';

      providerWs = new WebSocket(url);

      providerWs.on('open', () => {
        // Send configuration — field names per Soniox docs
        providerWs.send(JSON.stringify({
          api_key: apiKey,
          model: 'stt-rt-preview',
          audio_format: 'pcm_s16le',
          sample_rate: 16000,
          num_channels: 1,
          language_hints: ['ar'],
          language_hints_strict: true,
          enable_endpoint_detection: true,
        }));

        send('status', { status: 'connected' });
        console.log('[soniox] Connected to Soniox (stt-rt-preview)');
      });

      providerWs.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString());

          // Error response
          if (msg.error_code || msg.error_message) {
            send('error', { message: msg.error_message || `Soniox error ${msg.error_code}` });
            return;
          }

          // Finished marker
          if (msg.finished) {
            send('status', { status: 'ended' });
            return;
          }

          // Token-based response (Soniox v2 API)
          if (msg.tokens && msg.tokens.length > 0) {
            // Split tokens into final and non-final
            const finalTokens = msg.tokens.filter((t) => t.is_final);
            const nonFinalTokens = msg.tokens.filter((t) => !t.is_final);

            // Emit finalized text
            if (finalTokens.length > 0) {
              const newFinalText = finalTokens.map((t) => t.text).join('');
              if (newFinalText.trim()) {
                finalizedText += newFinalText;
                send('transcript', {
                  text: newFinalText.trim(),
                  isFinal: true,
                  confidence: finalTokens[0].confidence || 0,
                  timestamp: Date.now(),
                });
              }
            }

            // Emit partial / non-final text
            if (nonFinalTokens.length > 0) {
              const partialText = nonFinalTokens.map((t) => t.text).join('');
              if (partialText.trim()) {
                send('transcript', {
                  text: partialText.trim(),
                  isFinal: false,
                  timestamp: Date.now(),
                });
              }
            }
          }
        } catch (e) {
          console.error('[soniox] Parse error:', e.message);
        }
      });

      providerWs.on('error', (err) => {
        console.error('[soniox] Provider error:', err.message);
        send('error', { message: err.message });
      });

      providerWs.on('close', (code, reason) => {
        console.log(`[soniox] Closed: ${code} ${reason}`);
        send('status', { status: 'disconnected' });
      });
    },

    sendAudio(buffer) {
      if (providerWs?.readyState === WebSocket.OPEN) {
        providerWs.send(buffer);
      }
    },

    stop() {
      if (providerWs?.readyState === WebSocket.OPEN) {
        try {
          // Soniox docs: send empty frame to signal end-of-stream
          providerWs.send(Buffer.alloc(0));
        } catch (_) {}
        // Give time for final response before closing
        setTimeout(() => {
          try { providerWs?.close(); } catch (_) {}
          providerWs = null;
        }, 1000);
      } else {
        providerWs = null;
      }
    },
  };
}
