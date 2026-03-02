import WebSocket from 'ws';

/**
 * Deepgram Nova-3 — Arabic real-time streaming
 * Protocol: wss://api.deepgram.com/v1/listen
 * Auth: Token header
 * Audio: raw PCM s16le, 16 kHz, mono
 */
export function createDeepgramSession(clientWs, env) {
  let providerWs = null;

  function send(type, data) {
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(JSON.stringify({ provider: 'deepgram', type, ...data }));
    }
  }

  return {
    start() {
      const apiKey = env.DEEPGRAM_API_KEY;
      if (!apiKey) {
        send('error', { message: 'DEEPGRAM_API_KEY not configured — add it to .env or set via UI' });
        return;
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

      const url = `wss://api.deepgram.com/v1/listen?${params}`;

      providerWs = new WebSocket(url, {
        headers: { Authorization: `Token ${apiKey}` },
      });

      providerWs.on('open', () => {
        send('status', { status: 'connected' });
        console.log('[deepgram] Connected to Deepgram Nova-3');
      });

      providerWs.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString());

          if (msg.type === 'Results') {
            const alt = msg.channel?.alternatives?.[0];
            if (alt && alt.transcript) {
              send('transcript', {
                text: alt.transcript,
                isFinal: !!msg.is_final,
                confidence: alt.confidence || 0,
                timestamp: Date.now(),
              });
            }
          } else if (msg.type === 'UtteranceEnd') {
            send('utterance_end', { timestamp: Date.now() });
          }
        } catch (e) {
          console.error('[deepgram] Parse error:', e.message);
        }
      });

      providerWs.on('error', (err) => {
        console.error('[deepgram] Provider error:', err.message);
        send('error', { message: err.message });
      });

      providerWs.on('close', (code, reason) => {
        console.log(`[deepgram] Closed: ${code} ${reason}`);
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
          providerWs.send(JSON.stringify({ type: 'CloseStream' }));
        } catch (_) {}
        providerWs.close();
      }
      providerWs = null;
    },
  };
}
