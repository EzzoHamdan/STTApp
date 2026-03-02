/**
 * Azure Speech-to-Text — Arena provider adapter.
 *
 * Same interface as deepgram/soniox/speechmatics: { start, sendAudio, stop }
 * Uses PushAudioInputStream for continuous recognition, emits transcript
 * events back to the client WebSocket.
 */
import * as sdk from 'microsoft-cognitiveservices-speech-sdk';

export function createAzureArenaSession(clientWs, env) {
  let recognizer = null;
  let pushStream = null;
  let stopped = false;

  function send(type, data) {
    if (clientWs.readyState === 1 /* WebSocket.OPEN */) {
      clientWs.send(JSON.stringify({ provider: 'azure', type, ...data }));
    }
  }

  return {
    start() {
      const key = env.AZURE_SPEECH_KEY;
      const region = env.AZURE_SPEECH_REGION || 'eastus';
      const language = env.AZURE_SPEECH_LANGUAGE || 'ar-JO';

      if (!key) {
        send('error', { message: 'AZURE_SPEECH_KEY not configured — add it to .env' });
        return;
      }

      stopped = false;

      const format = sdk.AudioStreamFormat.getWaveFormatPCM(16000, 16, 1);
      pushStream = sdk.AudioInputStream.createPushStream(format);
      const audioConfig = sdk.AudioConfig.fromStreamInput(pushStream);

      const speechConfig = sdk.SpeechConfig.fromSubscription(key, region);
      speechConfig.speechRecognitionLanguage = language;

      recognizer = new sdk.SpeechRecognizer(speechConfig, audioConfig);

      recognizer.recognized = (_, e) => {
        if (stopped) return;
        if (e.result.reason === sdk.ResultReason.RecognizedSpeech && e.result.text) {
          send('transcript', {
            text: e.result.text,
            isFinal: true,
            confidence: 0,
            timestamp: Date.now(),
          });
        }
      };

      recognizer.recognizing = (_, e) => {
        if (stopped) return;
        if (e.result.text) {
          send('transcript', {
            text: e.result.text,
            isFinal: false,
            timestamp: Date.now(),
          });
        }
      };

      recognizer.canceled = (_, e) => {
        if (e.reason === sdk.CancellationReason.Error) {
          console.error(`[azure-arena] Error: ${e.errorDetails}`);
          send('error', { message: e.errorDetails });
        }
      };

      recognizer.sessionStarted = () => {
        send('status', { status: 'connected' });
        console.log('[azure-arena] Connected to Azure Speech');
      };

      recognizer.startContinuousRecognitionAsync(
        () => console.log('[azure-arena] Recognition started'),
        (err) => {
          console.error('[azure-arena] Start failed:', err);
          send('error', { message: String(err) });
        }
      );
    },

    sendAudio(buffer) {
      if (!stopped && pushStream) {
        pushStream.write(Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer));
      }
    },

    stop() {
      stopped = true;
      try { pushStream?.close(); } catch (_) {}
      if (recognizer) {
        recognizer.stopContinuousRecognitionAsync(
          () => {
            try { recognizer?.close(); } catch (_) {}
            recognizer = null;
            send('status', { status: 'disconnected' });
            console.log('[azure-arena] Stopped');
          },
          () => {
            try { recognizer?.close(); } catch (_) {}
            recognizer = null;
          }
        );
      }
    },
  };
}
