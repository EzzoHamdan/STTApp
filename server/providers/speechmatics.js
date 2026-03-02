import WebSocket from 'ws';

/**
 * Speechmatics — Arabic real-time streaming (RT API v2)
 * Protocol: wss://eu2.rt.speechmatics.com/v2
 * Auth: Bearer token header
 * Flow: connect → StartRecognition → binary audio → AddTranscript events
 */
export function createSpeechmaticsSession(clientWs, env) {
  let providerWs = null;

  function send(type, data) {
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(JSON.stringify({ provider: 'speechmatics', type, ...data }));
    }
  }

  return {
    start() {
      const apiKey = env.SPEECHMATICS_API_KEY;
      if (!apiKey) {
        send('error', { message: 'SPEECHMATICS_API_KEY not configured — add it to .env or set via UI' });
        return;
      }

      const url = 'wss://eu2.rt.speechmatics.com/v2';

      providerWs = new WebSocket(url, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      });

      providerWs.on('open', () => {
        // Send StartRecognition message
        const startMsg = {
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
        };

        providerWs.send(JSON.stringify(startMsg));
        console.log('[speechmatics] Connected, sent StartRecognition');
      });

      providerWs.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString());

          if (msg.message === 'RecognitionStarted') {
            send('status', { status: 'connected' });
            console.log('[speechmatics] Recognition started');
          } else if (msg.message === 'AddTranscript') {
            const text = (msg.results || [])
              .map((r) => r.alternatives?.[0]?.content || '')
              .join(' ');
            if (text.trim()) {
              send('transcript', {
                text: text.trim(),
                isFinal: true,
                confidence: msg.results?.[0]?.alternatives?.[0]?.confidence || 0,
                timestamp: Date.now(),
              });
            }
          } else if (msg.message === 'AddPartialTranscript') {
            const text = (msg.results || [])
              .map((r) => r.alternatives?.[0]?.content || '')
              .join(' ');
            if (text.trim()) {
              send('transcript', {
                text: text.trim(),
                isFinal: false,
                timestamp: Date.now(),
              });
            }
          } else if (msg.message === 'EndOfTranscript') {
            send('status', { status: 'ended' });
          } else if (msg.message === 'Error') {
            send('error', { message: msg.reason || 'Speechmatics error' });
          }
        } catch (e) {
          console.error('[speechmatics] Parse error:', e.message);
        }
      });

      providerWs.on('error', (err) => {
        console.error('[speechmatics] Provider error:', err.message);
        send('error', { message: err.message });
      });

      providerWs.on('close', (code, reason) => {
        console.log(`[speechmatics] Closed: ${code} ${reason}`);
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
          providerWs.send(JSON.stringify({ message: 'EndOfStream' }));
        } catch (_) {}
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
