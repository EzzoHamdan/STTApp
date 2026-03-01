"""
Transcriber — real-time Azure Speech-to-Text with precise timestamping
               AND simultaneous raw-audio recording as a WAV safety net.

Audio capture architecture
--------------------------
A single ``sounddevice.InputStream`` opens the microphone once and feeds
two consumers in parallel from its callback:

  1. Azure PushAudioInputStream  → real-time STT (as before)
  2. WAV writer thread           → lossless PCM backup

This means that even if Azure STT fails (network error, bad key, no-match),
every session still produces a complete WAV file that can be re-transcribed
or reviewed later.

WAV files are written incrementally via a thread-safe queue so that a crash
mid-session leaves a valid (though incomplete) WAV file on disk.

File layout per session
-----------------------
    sessions/<session_id>/<speaker_role>.jsonl       ← transcript (unchanged)
    sessions/<session_id>/<speaker_role>_audio.wav   ← raw PCM backup (NEW)

Transcript entry format (unchanged)
------------------------------------
{
    "session_id":   "COURT-20260226-a3f7b1c2",
    "speaker":      "Judge",
    "utc_iso":      "2026-02-26T10:05:32.123456+00:00",
    "offset_ticks": 43250000,          // Azure offset (100-ns ticks)
    "offset_sec":   4.325,             // offset in seconds (float)
    "duration_sec":  2.15,             // duration of the utterance
    "text":         "الجلسة مفتوحة"
}
"""

import json
import os
import queue
import threading
import wave
from datetime import datetime, timezone
from pathlib import Path

import azure.cognitiveservices.speech as speechsdk
import sounddevice as sd
from dotenv import load_dotenv

load_dotenv()

# ── Azure config ──────────────────────────────────────────────────────────
AZURE_SPEECH_KEY = os.getenv("AZURE_SPEECH_KEY")
AZURE_SPEECH_REGION = os.getenv("AZURE_SPEECH_REGION")
AZURE_SPEECH_LANGUAGE = os.getenv("AZURE_SPEECH_LANGUAGE", "ar-JO")

# ── Audio recording config ────────────────────────────────────────────────
_SAMPLE_RATE = 16_000   # Hz — Azure Speech expects 16 kHz for best accuracy
_CHANNELS    = 1        # mono
_DTYPE       = "int16"  # 16-bit signed PCM
_BLOCK_SIZE  = 1_024    # frames per sounddevice callback (~64 ms)
_WAV_SENTINEL = None    # poison-pill to stop the WAV writer thread


class LiveTranscriber:
    """
    Wraps Azure Continuous Recognition for a single speaker/mic.

    A ``sounddevice.InputStream`` captures PCM at 16 kHz from the default
    microphone.  Each audio block is:
      • Pushed into Azure's ``PushAudioInputStream`` for real-time STT.
      • Queued for the background WAV-writer thread to flush to disk.

    Parameters
    ----------
    record_audio : bool
        When True (default) a ``<speaker>_audio.wav`` file is written to the
        session directory alongside the JSONL transcript.  Set False only if
        you want to skip the recording (e.g. in automated tests).

    on_result callback
    ------------------
    Called on every final recognised entry with the full dict:
        {session_id, speaker, utc_iso, offset_sec, duration_sec, text}
    The callback is invoked from the Azure SDK thread — keep it fast.
    """

    def __init__(
        self,
        session_id: str,
        speaker: str,
        session_dir: Path,
        language: str | None = None,
        on_result=None,           # callable(entry: dict) | None
        on_status=None,           # callable(speaker, event_type, msg) | None
        record_audio: bool = True,
    ):
        self.session_id = session_id
        self.speaker = speaker
        self.session_dir = Path(session_dir)
        self.language = language or AZURE_SPEECH_LANGUAGE
        self.transcript_path = self.session_dir / f"{speaker}.jsonl"
        self.audio_path: Path | None = (
            self.session_dir / f"{speaker}_audio.wav" if record_audio else None
        )
        self._record_audio = record_audio
        self._on_result = on_result
        self._on_status = on_status

        # Tracking
        self._entries: list[dict] = []
        self._lock = threading.Lock()
        self._done_event = threading.Event()

        # ── WAV writer (runs on its own thread) ───────────────────────
        self._wav_queue: queue.Queue = queue.Queue()
        self._wav_thread: threading.Thread | None = None

        # ── Azure PushAudioInputStream (receives PCM from sounddevice) ─
        _audio_fmt = speechsdk.audio.AudioStreamFormat(
            samples_per_second=_SAMPLE_RATE,
            bits_per_sample=16,
            channels=_CHANNELS,
        )
        self._push_stream = speechsdk.audio.PushAudioInputStream(
            stream_format=_audio_fmt
        )
        audio_config = speechsdk.audio.AudioConfig(stream=self._push_stream)

        # ── Speech recognizer ─────────────────────────────────────────
        speech_config = speechsdk.SpeechConfig(
            subscription=AZURE_SPEECH_KEY,
            region=AZURE_SPEECH_REGION,
        )
        speech_config.speech_recognition_language = self.language
        speech_config.request_word_level_timestamps()

        self._recognizer = speechsdk.SpeechRecognizer(
            speech_config=speech_config,
            audio_config=audio_config,
        )

        # ── sounddevice InputStream (single mic reader) ───────────────
        self._sd_stream = sd.InputStream(
            samplerate=_SAMPLE_RATE,
            channels=_CHANNELS,
            dtype=_DTYPE,
            blocksize=_BLOCK_SIZE,
            callback=self._audio_callback,
        )

        # ── Wire up Azure events ──────────────────────────────────────
        self._recognizer.recognized.connect(self._on_recognized)
        self._recognizer.recognizing.connect(self._on_recognizing)
        self._recognizer.canceled.connect(self._on_canceled)
        self._recognizer.session_started.connect(self._on_session_started)
        self._recognizer.session_stopped.connect(self._on_session_stopped)
        self._recognizer.speech_start_detected.connect(self._on_speech_start)
        self._recognizer.speech_end_detected.connect(self._on_speech_end)

    # ── sounddevice audio callback (called on a PortAudio thread) ─────────

    def _audio_callback(
        self,
        indata,       # numpy ndarray shape (blocksize, channels), dtype int16
        frames: int,
        time_info,
        status,
    ):
        """Runs on every audio block.  Must be as fast as possible."""
        if status:
            print(f"  [{self.speaker}] ⚠️  Audio device status: {status}")

        pcm_bytes = bytes(indata)

        # Feed Azure STT
        self._push_stream.write(pcm_bytes)

        # Enqueue for WAV writer
        if self._record_audio:
            self._wav_queue.put(indata.copy())

    # ── WAV writer thread ─────────────────────────────────────────────────

    def _wav_writer_thread(self):
        """
        Runs on a dedicated background thread.
        Drains _wav_queue and writes PCM chunks directly into a WAV file.
        Writing is incremental: each chunk is flushed before the next dequeue,
        so a hard crash still leaves a usable (if incomplete) WAV on disk.
        """
        with wave.open(str(self.audio_path), "wb") as wf:
            wf.setnchannels(_CHANNELS)
            wf.setsampwidth(2)         # int16 → 2 bytes per sample
            wf.setframerate(_SAMPLE_RATE)
            while True:
                chunk = self._wav_queue.get()
                if chunk is _WAV_SENTINEL:
                    break
                wf.writeframes(chunk.tobytes())

    # ── Azure event handlers ──────────────────────────────────────────────

    def _on_session_started(self, evt):
        """Fires when the WebSocket to Azure is established."""
        print(f"  [{self.speaker}] ✅ Connected to Azure Speech service")
        if self._on_status:
            self._on_status(self.speaker, "connected", "Connected to Azure")

    def _on_speech_start(self, evt):
        """Fires the moment Azure detects voice activity in the audio."""
        print(f"  [{self.speaker}] 🔊 Speech detected — listening …")
        if self._on_status:
            self._on_status(self.speaker, "speech_start", "Speech detected")

    def _on_speech_end(self, evt):
        """Fires when Azure detects the end of a speech segment."""
        print(f"  [{self.speaker}] 🔇 Silence detected")
        if self._on_status:
            self._on_status(self.speaker, "speech_end", "Silence")

    def _on_recognizing(self, evt: speechsdk.SpeechRecognitionEventArgs):
        """Interim/partial result – printed live but NOT persisted."""
        if evt.result.text:
            print(f"  [{self.speaker}] (partial) {evt.result.text}")
            if self._on_status:
                self._on_status(self.speaker, "partial", evt.result.text)

    def _on_recognized(self, evt: speechsdk.SpeechRecognitionEventArgs):
        """Final result – persisted with full timestamps."""
        result = evt.result
        if result.reason == speechsdk.ResultReason.NoMatch:
            print(f"  [{self.speaker}] ⚠️  No match — speech not recognised")
            return
        if result.reason == speechsdk.ResultReason.RecognizedSpeech and result.text:
            offset_ticks = result.offset  # 100-nanosecond units
            duration_ticks = result.duration
            offset_sec = offset_ticks / 1e7
            duration_sec = duration_ticks / 1e7

            entry = {
                "session_id": self.session_id,
                "speaker": self.speaker,
                "utc_iso": datetime.now(timezone.utc).isoformat(),
                "offset_ticks": offset_ticks,
                "offset_sec": round(offset_sec, 4),
                "duration_sec": round(duration_sec, 4),
                "text": result.text,
            }

            with self._lock:
                self._entries.append(entry)
                # Append to JSONL file immediately (crash-safe)
                with open(self.transcript_path, "a", encoding="utf-8") as f:
                    f.write(json.dumps(entry, ensure_ascii=False) + "\n")

            print(f"  [{self.speaker}] [{entry['utc_iso']}] {result.text}")
            if self._on_result:
                self._on_result(entry)

    def _on_canceled(self, evt: speechsdk.SpeechRecognitionCanceledEventArgs):
        cancellation = evt.result.cancellation_details
        print(f"  [{self.speaker}] ❌ CANCELED: {cancellation.reason}")
        if cancellation.reason == speechsdk.CancellationReason.Error:
            print(f"  [{self.speaker}] ❌ ERROR CODE : {cancellation.error_code}")
            print(f"  [{self.speaker}] ❌ ERROR DETAIL: {cancellation.error_details}")
            print(f"  [{self.speaker}] 💡 Check your AZURE_SPEECH_KEY and AZURE_SPEECH_REGION in .env")
            if self._on_status:
                self._on_status(self.speaker, "error", str(cancellation.error_details))
        elif cancellation.reason == speechsdk.CancellationReason.EndOfStream:
            print(f"  [{self.speaker}] Audio stream ended.")
        self._done_event.set()

    def _on_session_stopped(self, evt):
        print(f"  [{self.speaker}] Session stopped.")
        self._done_event.set()

    # ── Public API ────────────────────────────────────────────────────────

    def start(self):
        """
        Begin continuous recognition and (optionally) WAV recording.
        Non-blocking — Azure recognition and audio capture run on background
        threads managed by the SDK and sounddevice respectively.
        """
        print(
            f"  [{self.speaker}] Config: region={AZURE_SPEECH_REGION}, "
            f"lang={self.language}, "
            f"key=…{AZURE_SPEECH_KEY[-6:] if AZURE_SPEECH_KEY else 'MISSING'}"
        )

        # Start WAV writer thread first so no frames are dropped
        if self._record_audio:
            self._wav_thread = threading.Thread(
                target=self._wav_writer_thread, daemon=True, name=f"wav-{self.speaker}"
            )
            self._wav_thread.start()
            print(f"  [{self.speaker}] 🔴 Recording audio → {self.audio_path}")

        # Start Azure recognizer (opens connection, waits for audio)
        self._recognizer.start_continuous_recognition()

        # Start sounddevice capture (feeds Azure + WAV writer)
        self._sd_stream.start()

        print(f"  [{self.speaker}] 🎙️  Listening …  (press Ctrl+C to stop)")

    def stop(self):
        """
        Gracefully stop both audio capture and recognition, then
        finalise the WAV file.  Blocks until everything has flushed.
        """
        # 1. Stop sounddevice — no more audio blocks after this returns
        self._sd_stream.stop()
        self._sd_stream.close()

        # 2. Signal end-of-stream to Azure so it can flush remaining audio
        self._push_stream.close()

        # 3. Wait for Azure to finish processing buffered audio
        self._recognizer.stop_continuous_recognition()
        self._done_event.wait(timeout=10)

        # 4. Signal WAV writer to finalise and flush
        if self._record_audio:
            self._wav_queue.put(_WAV_SENTINEL)
            if self._wav_thread:
                self._wav_thread.join(timeout=10)
            print(f"  [{self.speaker}] 💾 Audio saved → {self.audio_path}")

        print(
            f"  [{self.speaker}] Stopped. "
            f"{len(self._entries)} utterances saved → {self.transcript_path}"
        )

    @property
    def entries(self) -> list[dict]:
        with self._lock:
            return list(self._entries)
