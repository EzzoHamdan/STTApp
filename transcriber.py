"""
Transcriber — real-time Azure Speech-to-Text with precise timestamping.

Each recognised utterance is stored as a JSON-lines (.jsonl) file inside
the session directory, one file per speaker:

    sessions/<session_id>/<speaker_role>.jsonl

Every line is a JSON object:
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
import threading
from datetime import datetime, timezone
from pathlib import Path

import azure.cognitiveservices.speech as speechsdk
from dotenv import load_dotenv

load_dotenv()

# ── Azure config ──────────────────────────────────────────────────────────
AZURE_SPEECH_KEY = os.getenv("AZURE_SPEECH_KEY")
AZURE_SPEECH_REGION = os.getenv("AZURE_SPEECH_REGION")
AZURE_SPEECH_LANGUAGE = os.getenv("AZURE_SPEECH_LANGUAGE", "ar-JO")


class LiveTranscriber:
    """
    Wraps Azure Continuous Recognition for a single speaker/mic.

    Usage
    -----
        t = LiveTranscriber(session_id="COURT-…", speaker="Judge",
                            session_dir=Path("sessions/COURT-…"),
                            on_result=my_callback)
        t.start()      # non-blocking – recognition runs on a background thread
        ...
        t.stop()       # blocks until recognition is fully stopped

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
    ):
        self.session_id = session_id
        self.speaker = speaker
        self.session_dir = Path(session_dir)
        self.language = language or AZURE_SPEECH_LANGUAGE
        self.transcript_path = self.session_dir / f"{speaker}.jsonl"
        self._on_result = on_result
        self._on_status = on_status

        # Tracking
        self._entries: list[dict] = []
        self._lock = threading.Lock()
        self._done_event = threading.Event()

        # ── Speech config ─────────────────────────────────────────────
        speech_config = speechsdk.SpeechConfig(
            subscription=AZURE_SPEECH_KEY,
            region=AZURE_SPEECH_REGION,
        )
        speech_config.speech_recognition_language = self.language
        # Request word-level timing (gives us offset + duration per result)
        speech_config.request_word_level_timestamps()
        # Use the default microphone
        audio_config = speechsdk.audio.AudioConfig(use_default_microphone=True)

        self._recognizer = speechsdk.SpeechRecognizer(
            speech_config=speech_config,
            audio_config=audio_config,
        )

        # ── Wire up events ────────────────────────────────────────────
        self._recognizer.recognized.connect(self._on_recognized)
        self._recognizer.recognizing.connect(self._on_recognizing)
        self._recognizer.canceled.connect(self._on_canceled)
        self._recognizer.session_started.connect(self._on_session_started)
        self._recognizer.session_stopped.connect(self._on_session_stopped)
        self._recognizer.speech_start_detected.connect(self._on_speech_start)
        self._recognizer.speech_end_detected.connect(self._on_speech_end)

    # ── Event handlers ────────────────────────────────────────────────────

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
        """Begin continuous recognition (non-blocking)."""
        print(f"  [{self.speaker}] Config: region={AZURE_SPEECH_REGION}, lang={self.language}, key=…{AZURE_SPEECH_KEY[-6:] if AZURE_SPEECH_KEY else 'MISSING'}")
        print(f"  [{self.speaker}] 🎙️  Listening …  (press Ctrl+C to stop)")
        self._recognizer.start_continuous_recognition()

    def stop(self):
        """Stop recognition and wait for clean shutdown."""
        self._recognizer.stop_continuous_recognition()
        self._done_event.wait(timeout=5)
        print(f"  [{self.speaker}] Stopped. {len(self._entries)} utterances saved → {self.transcript_path}")

    @property
    def entries(self) -> list[dict]:
        with self._lock:
            return list(self._entries)
