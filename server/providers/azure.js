/**
 * Azure Speech-to-Text provider for court transcription.
 *
 * Receives PCM audio chunks from the browser via WebSocket,
 * pushes them into Azure's PushAudioInputStream for continuous
 * recognition, and emits results via callbacks.
 */
import * as sdk from 'microsoft-cognitiveservices-speech-sdk';

/**
 * Create an Azure Speech continuous recognition session for one speaker.
 *
 * @param {string} sessionId - Court session ID
 * @param {string} speaker   - Speaker role (e.g. "Judge")
 * @param {object} env       - process.env (needs AZURE_SPEECH_KEY, AZURE_SPEECH_REGION)
 * @param {object} callbacks - { onResult, onPartial, onStatus, onError }
 * @returns {{ sendAudio, stop, getEntries }} | null
 */
export function createAzureSession(sessionId, speaker, env, callbacks) {
  const key = env.AZURE_SPEECH_KEY;
  const region = env.AZURE_SPEECH_REGION || 'eastus';
  const language = env.AZURE_SPEECH_LANGUAGE || 'ar-JO';

  if (!key) {
    callbacks.onError('AZURE_SPEECH_KEY is not configured');
    return null;
  }

  // 16 kHz, 16-bit, mono PCM — matches the browser's output
  const format = sdk.AudioStreamFormat.getWaveFormatPCM(16000, 16, 1);
  const pushStream = sdk.AudioInputStream.createPushStream(format);
  const audioConfig = sdk.AudioConfig.fromStreamInput(pushStream);

  const speechConfig = sdk.SpeechConfig.fromSubscription(key, region);
  speechConfig.speechRecognitionLanguage = language;
  speechConfig.requestWordLevelTimestamps();

  const recognizer = new sdk.SpeechRecognizer(speechConfig, audioConfig);
  const entries = [];
  let stopped = false;

  // ── Azure event handlers ────────────────────────────────────────

  recognizer.recognized = (_, e) => {
    if (stopped) return;
    if (e.result.reason === sdk.ResultReason.RecognizedSpeech && e.result.text) {
      const offsetTicks = Number(e.result.offset);
      const durationTicks = Number(e.result.duration);
      const entry = {
        session_id: sessionId,
        speaker,
        utc_iso: new Date().toISOString(),
        offset_ticks: offsetTicks,
        offset_sec: Math.round((offsetTicks / 1e7) * 10000) / 10000,
        duration_sec: Math.round((durationTicks / 1e7) * 10000) / 10000,
        text: e.result.text,
      };
      entries.push(entry);
      callbacks.onResult(entry);
    }
  };

  recognizer.recognizing = (_, e) => {
    if (stopped) return;
    if (e.result.text) {
      callbacks.onPartial(e.result.text);
    }
  };

  recognizer.canceled = (_, e) => {
    if (e.reason === sdk.CancellationReason.Error) {
      console.error(`[Azure/${speaker}] Error: ${e.errorDetails}`);
      callbacks.onError(e.errorDetails);
    }
  };

  recognizer.sessionStarted = () => {
    console.log(`[Azure/${speaker}] Session started`);
    callbacks.onStatus('connected', 'Connected to Azure Speech');
  };

  recognizer.speechStartDetected = () => {
    callbacks.onStatus('speech_start', 'Speech detected');
  };

  recognizer.speechEndDetected = () => {
    callbacks.onStatus('speech_end', 'Silence');
  };

  // ── Start continuous recognition ────────────────────────────────
  recognizer.startContinuousRecognitionAsync(
    () => {
      console.log(`[Azure/${speaker}] Continuous recognition started`);
      callbacks.onStatus('started', `${speaker} microphone is live`);
    },
    (err) => {
      console.error(`[Azure/${speaker}] Start failed:`, err);
      callbacks.onError(String(err));
    }
  );

  return {
    /**
     * Push a chunk of raw PCM audio into Azure.
     * @param {Buffer|ArrayBuffer} buffer
     */
    sendAudio(buffer) {
      if (!stopped) {
        pushStream.write(Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer));
      }
    },

    /**
     * Gracefully stop recognition and close the stream.
     * @returns {Promise<object[]>} — all recognised entries
     */
    stop() {
      stopped = true;
      return new Promise((resolve) => {
        try {
          pushStream.close();
        } catch (_) {}
        recognizer.stopContinuousRecognitionAsync(
          () => {
            try { recognizer.close(); } catch (_) {}
            resolve(entries);
          },
          () => {
            try { recognizer.close(); } catch (_) {}
            resolve(entries);
          }
        );
      });
    },

    /** Return a snapshot of all entries collected so far. */
    getEntries() {
      return [...entries];
    },
  };
}
