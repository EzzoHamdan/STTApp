"""
court_stt.transcriber — Real-time Azure Speech-to-Text with WAV backup.

The ``LiveTranscriber`` class is fully self-contained and can be used in
any Python project without the rest of the court_stt server.

Standalone usage
----------------
>>> from pathlib import Path
>>> from court_stt.config import Settings
>>> from court_stt.transcriber import LiveTranscriber
>>>
>>> cfg = Settings.from_env()
>>> t = LiveTranscriber(
...     session_id="MY-SESSION",
...     speaker="Speaker_1",
...     session_dir=Path("./output"),
...     settings=cfg,
... )
>>> t.start()
>>> # ... record ...
>>> t.stop()
>>> print(t.entries)

Audio capture architecture
--------------------------
A single ``sounddevice.InputStream`` opens the microphone once and feeds
two consumers in parallel from its callback:

  1. ``PushAudioInputStream`` — real-time Azure STT
  2. WAV writer thread       — lossless PCM backup

File layout per session::

    sessions/<session_id>/<speaker>.jsonl       ← transcript
    sessions/<session_id>/<speaker>_audio.wav   ← raw PCM backup
"""

from __future__ import annotations

import json
import logging
import queue
import threading
import wave
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, Optional

import azure.cognitiveservices.speech as speechsdk
import sounddevice as sd

from court_stt.config import Settings, get_settings

logger = logging.getLogger(__name__)

# Sentinel value to signal the WAV writer thread to stop
_WAV_SENTINEL = None


class LiveTranscriber:
    """Wraps Azure Continuous Recognition for a single speaker/mic.

    Parameters
    ----------
    session_id : str
        The court session this transcription belongs to.
    speaker : str
        Speaker role label (e.g. ``"Judge"``).
    session_dir : Path
        Directory where transcript ``.jsonl`` and audio ``.wav`` are written.
    settings : Settings | None
        Application settings.  Uses ``get_settings()`` if omitted.
    language : str | None
        Override the Azure speech recognition language.
    on_result : callable | None
        ``(entry: dict) -> None`` — called on every final recognition result.
        Invoked from the Azure SDK thread — keep it fast.
    on_status : callable | None
        ``(speaker: str, event_type: str, text: str) -> None``
    record_audio : bool
        Write a WAV backup alongside the transcript (default ``True``).
    """

    def __init__(
        self,
        session_id: str,
        speaker: str,
        session_dir: Path,
        settings: Settings | None = None,
        language: str | None = None,
        on_result: Optional[Callable[[dict], None]] = None,
        on_status: Optional[Callable[[str, str, str], None]] = None,
        record_audio: bool = True,
    ) -> None:
        cfg = settings or get_settings()

        self.session_id = session_id
        self.speaker = speaker
        self.session_dir = Path(session_dir)
        self.language = language or cfg.azure_speech_language
        self.transcript_path = self.session_dir / f"{speaker}.jsonl"
        self.audio_path: Path | None = (
            self.session_dir / f"{speaker}_audio.wav" if record_audio else None
        )

        self._cfg = cfg
        self._record_audio = record_audio
        self._on_result = on_result
        self._on_status = on_status

        # Tracking
        self._entries: list[dict] = []
        self._lock = threading.Lock()
        self._done_event = threading.Event()

        # ── WAV writer ────────────────────────────────────────────────
        self._wav_queue: queue.Queue = queue.Queue()
        self._wav_thread: threading.Thread | None = None

        # ── Azure PushAudioInputStream ────────────────────────────────
        _audio_fmt = speechsdk.audio.AudioStreamFormat(
            samples_per_second=cfg.sample_rate,
            bits_per_sample=16,
            channels=cfg.channels,
        )
        self._push_stream = speechsdk.audio.PushAudioInputStream(
            stream_format=_audio_fmt,
        )
        audio_config = speechsdk.audio.AudioConfig(stream=self._push_stream)

        # ── Speech recognizer ─────────────────────────────────────────
        if not cfg.azure_speech_key:
            raise ValueError(
                "AZURE_SPEECH_KEY is not set. "
                "Pass it via Settings or set the environment variable."
            )

        speech_config = speechsdk.SpeechConfig(
            subscription=cfg.azure_speech_key,
            region=cfg.azure_speech_region,
        )
        speech_config.speech_recognition_language = self.language
        speech_config.request_word_level_timestamps()

        self._recognizer = speechsdk.SpeechRecognizer(
            speech_config=speech_config,
            audio_config=audio_config,
        )

        # ── sounddevice InputStream ───────────────────────────────────
        self._sd_stream = sd.InputStream(
            samplerate=cfg.sample_rate,
            channels=cfg.channels,
            dtype=cfg.dtype,
            blocksize=cfg.block_size,
            callback=self._audio_callback,
        )

        # ── Wire up Azure events ─────────────────────────────────────
        self._recognizer.recognized.connect(self._on_recognized)
        self._recognizer.recognizing.connect(self._on_recognizing)
        self._recognizer.canceled.connect(self._on_canceled)
        self._recognizer.session_started.connect(self._on_session_started)
        self._recognizer.session_stopped.connect(self._on_session_stopped)
        self._recognizer.speech_start_detected.connect(self._on_speech_start)
        self._recognizer.speech_end_detected.connect(self._on_speech_end)

    # ── sounddevice audio callback ────────────────────────────────────

    def _audio_callback(self, indata, frames: int, time_info, status) -> None:
        """Called on every audio block from PortAudio.  Must be fast."""
        if status:
            logger.warning("[%s] Audio device status: %s", self.speaker, status)

        pcm_bytes = bytes(indata)

        # Feed Azure STT
        self._push_stream.write(pcm_bytes)

        # Enqueue for WAV writer
        if self._record_audio:
            self._wav_queue.put(indata.copy())

    # ── WAV writer thread ─────────────────────────────────────────────

    def _wav_writer_thread(self) -> None:
        """Background thread: drains ``_wav_queue`` and writes PCM to WAV."""
        with wave.open(str(self.audio_path), "wb") as wf:
            wf.setnchannels(self._cfg.channels)
            wf.setsampwidth(2)  # int16 → 2 bytes
            wf.setframerate(self._cfg.sample_rate)
            while True:
                chunk = self._wav_queue.get()
                if chunk is _WAV_SENTINEL:
                    break
                wf.writeframes(chunk.tobytes())

    # ── Azure event handlers ──────────────────────────────────────────

    def _on_session_started(self, evt) -> None:
        logger.info("[%s] Connected to Azure Speech service", self.speaker)
        if self._on_status:
            self._on_status(self.speaker, "connected", "Connected to Azure")

    def _on_speech_start(self, evt) -> None:
        logger.debug("[%s] Speech detected — listening", self.speaker)
        if self._on_status:
            self._on_status(self.speaker, "speech_start", "Speech detected")

    def _on_speech_end(self, evt) -> None:
        logger.debug("[%s] Silence detected", self.speaker)
        if self._on_status:
            self._on_status(self.speaker, "speech_end", "Silence")

    def _on_recognizing(self, evt: speechsdk.SpeechRecognitionEventArgs) -> None:
        """Interim/partial result — not persisted."""
        if evt.result.text:
            logger.debug("[%s] (partial) %s", self.speaker, evt.result.text)
            if self._on_status:
                self._on_status(self.speaker, "partial", evt.result.text)

    def _on_recognized(self, evt: speechsdk.SpeechRecognitionEventArgs) -> None:
        """Final result — persisted with full timestamps."""
        result = evt.result
        if result.reason == speechsdk.ResultReason.NoMatch:
            logger.warning("[%s] No match — speech not recognised", self.speaker)
            return
        if result.reason == speechsdk.ResultReason.RecognizedSpeech and result.text:
            offset_ticks = result.offset
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
                with open(self.transcript_path, "a", encoding="utf-8") as f:
                    f.write(json.dumps(entry, ensure_ascii=False) + "\n")

            logger.info("[%s] %s", self.speaker, result.text)
            if self._on_result:
                self._on_result(entry)

    def _on_canceled(self, evt: speechsdk.SpeechRecognitionCanceledEventArgs) -> None:
        cancellation = evt.result.cancellation_details
        logger.error("[%s] CANCELED: %s", self.speaker, cancellation.reason)
        if cancellation.reason == speechsdk.CancellationReason.Error:
            logger.error(
                "[%s] Error %s: %s",
                self.speaker,
                cancellation.error_code,
                cancellation.error_details,
            )
            if self._on_status:
                self._on_status(self.speaker, "error", str(cancellation.error_details))
        elif cancellation.reason == speechsdk.CancellationReason.EndOfStream:
            logger.info("[%s] Audio stream ended", self.speaker)
        self._done_event.set()

    def _on_session_stopped(self, evt) -> None:
        logger.info("[%s] Session stopped", self.speaker)
        self._done_event.set()

    # ── Public API ────────────────────────────────────────────────────

    def start(self) -> None:
        """Begin continuous recognition and (optionally) WAV recording.

        Non-blocking — Azure recognition and audio capture run on
        background threads.
        """
        key_hint = (
            f"…{self._cfg.azure_speech_key[-6:]}"
            if self._cfg.azure_speech_key
            else "MISSING"
        )
        logger.info(
            "[%s] Config: region=%s, lang=%s, key=%s",
            self.speaker,
            self._cfg.azure_speech_region,
            self.language,
            key_hint,
        )

        # Start WAV writer first so no frames are dropped
        if self._record_audio:
            self._wav_thread = threading.Thread(
                target=self._wav_writer_thread,
                daemon=True,
                name=f"wav-{self.speaker}",
            )
            self._wav_thread.start()
            logger.info("[%s] Recording audio → %s", self.speaker, self.audio_path)

        self._recognizer.start_continuous_recognition()
        self._sd_stream.start()
        logger.info("[%s] Listening …", self.speaker)

    def stop(self) -> None:
        """Gracefully stop capture + recognition, finalise WAV."""
        # 1. Stop sounddevice
        self._sd_stream.stop()
        self._sd_stream.close()

        # 2. Close Azure push stream
        self._push_stream.close()

        # 3. Wait for Azure to finish buffered audio
        self._recognizer.stop_continuous_recognition()
        self._done_event.wait(timeout=10)

        # 4. Finalise WAV
        if self._record_audio:
            self._wav_queue.put(_WAV_SENTINEL)
            if self._wav_thread:
                self._wav_thread.join(timeout=10)
            logger.info("[%s] Audio saved → %s", self.speaker, self.audio_path)

        logger.info(
            "[%s] Stopped. %d utterances saved → %s",
            self.speaker,
            len(self._entries),
            self.transcript_path,
        )

    @property
    def entries(self) -> list[dict]:
        """Return a copy of all recognised entries so far."""
        with self._lock:
            return list(self._entries)
