"""
court_stt.cli — CLI entry points for all court_stt commands.

Registered in ``pyproject.toml`` under ``[project.scripts]`` so that
after ``pip install -e .`` the following commands are available::

    court-stt-server       Start the FastAPI server
    court-stt-speaker      Record a single speaker's transcription
    court-stt-merge        Merge transcripts for a session
    court-stt-test-mic     Quick microphone + Azure diagnostic
"""

from __future__ import annotations

import argparse
import sys
import time


def run_server() -> None:
    """CLI: ``court-stt-server [--host HOST] [--port PORT]``"""
    parser = argparse.ArgumentParser(description="Court STT — start the web server")
    parser.add_argument("--host", default=None, help="Bind address (default from .env or 0.0.0.0)")
    parser.add_argument("--port", type=int, default=None, help="Port (default from .env or 8000)")
    args = parser.parse_args()

    from court_stt.config import Settings, configure_logging

    overrides = {}
    if args.host is not None:
        overrides["host"] = args.host
    if args.port is not None:
        overrides["port"] = args.port

    cfg = Settings.from_env(**overrides)
    configure_logging(cfg)

    from court_stt.server import create_app

    import uvicorn
    app = create_app(cfg)
    uvicorn.run(app, host=cfg.host, port=cfg.port)


def run_speaker() -> None:
    """CLI: ``court-stt-speaker --role Judge [--session COURT-...]``"""
    parser = argparse.ArgumentParser(description="Court STT — single speaker transcription")
    parser.add_argument(
        "--role", required=True, help="Speaker role: Judge | Lawyer_1 | Lawyer_2"
    )
    parser.add_argument(
        "--session", default=None, help="Existing session ID.  Omit to create a new session."
    )
    args = parser.parse_args()

    from rich.console import Console
    from rich.panel import Panel

    from court_stt.config import Settings, configure_logging
    from court_stt.session import SessionManager
    from court_stt.transcriber import LiveTranscriber

    cfg = Settings.from_env()
    configure_logging(cfg)
    console = Console()
    mgr = SessionManager(settings=cfg)

    role: str = args.role
    session_id: str | None = args.session

    # ── Session handling ──────────────────────────────────────────────
    if session_id is None:
        session_id = SessionManager.generate_id()
        mgr.init_session(session_id, cfg.default_speakers)
        console.print(Panel(
            f"[bold green]NEW session created[/]\n"
            f"Session ID: [bold cyan]{session_id}[/]\n"
            f"Speakers : {', '.join(cfg.default_speakers)}",
            title="Court STT",
        ))
    else:
        try:
            meta = mgr.load_session_meta(session_id)
            console.print(Panel(
                f"[bold yellow]Joining existing session[/]\n"
                f"Session ID: [bold cyan]{session_id}[/]\n"
                f"Speakers : {', '.join(meta['speakers'])}",
                title="Court STT",
            ))
        except FileNotFoundError:
            mgr.init_session(session_id, cfg.default_speakers)
            console.print(Panel(
                f"[bold green]Session initialised[/]\n"
                f"Session ID: [bold cyan]{session_id}[/]",
                title="Court STT",
            ))

    session_dir = mgr.get_session_dir(session_id)

    transcriber = LiveTranscriber(
        session_id=session_id,
        speaker=role,
        session_dir=session_dir,
        settings=cfg,
    )

    try:
        transcriber.start()
        console.print(f"\n[dim]Recording as [bold]{role}[/bold]. Press Ctrl+C to stop.[/dim]\n")
        while True:
            time.sleep(0.25)
    except KeyboardInterrupt:
        console.print("\n[yellow]Stopping …[/yellow]")
    finally:
        transcriber.stop()
        console.print(f"[green]Transcript saved → {transcriber.transcript_path}[/green]")
        if transcriber.audio_path:
            console.print(f"[blue]Audio backup  → {transcriber.audio_path}[/blue]")


def run_merge() -> None:
    """CLI: ``court-stt-merge --session COURT-... [--end]``"""
    parser = argparse.ArgumentParser(description="Court STT — merge transcripts")
    parser.add_argument("--session", required=True, help="Session ID to merge")
    parser.add_argument("--end", action="store_true", help="Mark session as ended after merge")
    args = parser.parse_args()

    from rich.console import Console
    from rich.table import Table

    from court_stt.config import Settings, configure_logging
    from court_stt.merge import TranscriptMerger
    from court_stt.session import SessionManager

    cfg = Settings.from_env()
    configure_logging(cfg)
    console = Console()
    mgr = SessionManager(settings=cfg)
    merger = TranscriptMerger(session_manager=mgr)

    session_id = args.session
    console.print(f"\n[bold]Merging transcripts for session [cyan]{session_id}[/cyan][/bold]\n")

    entries, overlaps = merger.merge_and_write(session_id, mark_ended=args.end)
    if not entries:
        console.print("[red]No entries found.[/red]")
        return

    # Display table
    table = Table(title="Unified Court Transcript", show_lines=True)
    table.add_column("Turn", style="bold", width=5)
    table.add_column("Timestamp (UTC)", width=28)
    table.add_column("Speaker", style="cyan", width=12)
    table.add_column("Offset (s)", width=10)
    table.add_column("Overlap", width=4)
    table.add_column("Text", style="white")

    for entry in entries:
        overlap_icon = "[yellow]![/yellow]" if entry.get("overlap") else ""
        table.add_row(
            str(entry["turn"]),
            entry["utc_iso"],
            entry["speaker"],
            str(entry.get("offset_sec", "")),
            overlap_icon,
            entry["text"],
        )

    console.print(table)

    session_dir = mgr.get_session_dir(session_id)
    console.print(f"\n[green]Unified JSON → {session_dir / 'unified_transcript.json'}[/green]")
    console.print(f"[green]Unified TXT  → {session_dir / 'unified_transcript.txt'}[/green]")
    console.print(f"[green]Total turns   : {len(entries)}[/green]")
    if overlaps:
        console.print(f"[yellow]Overlap periods: {len(overlaps)}[/yellow]")
    if args.end:
        console.print(f"[yellow]Session marked as ended.[/yellow]")
    console.print("")


def run_test_mic() -> None:
    """CLI: ``court-stt-test-mic``"""
    from court_stt.config import Settings

    cfg = Settings.from_env()

    print("=" * 60)
    print("  Court STT — Microphone & Azure Diagnostic")
    print("=" * 60)
    print()
    key_hint = f"…{cfg.azure_speech_key[-6:]}" if cfg.azure_speech_key else "MISSING"
    print(f"  AZURE_SPEECH_KEY    : {key_hint}")
    print(f"  AZURE_SPEECH_REGION : {cfg.azure_speech_region or 'MISSING'}")
    print(f"  AZURE_SPEECH_LANGUAGE: {cfg.azure_speech_language}")
    print()

    if not cfg.azure_speech_key or not cfg.azure_speech_region:
        print("  Missing Azure credentials in .env — cannot continue.")
        sys.exit(1)

    import azure.cognitiveservices.speech as speechsdk

    print(f"  Azure Speech SDK version: {speechsdk.__version__}")
    print()

    speech_config = speechsdk.SpeechConfig(
        subscription=cfg.azure_speech_key,
        region=cfg.azure_speech_region,
    )
    speech_config.speech_recognition_language = cfg.azure_speech_language
    speech_config.set_property(
        speechsdk.PropertyId.Speech_LogFilename, "speech_sdk_log.txt"
    )
    audio_config = speechsdk.audio.AudioConfig(use_default_microphone=True)
    recognizer = speechsdk.SpeechRecognizer(
        speech_config=speech_config,
        audio_config=audio_config,
    )

    print("  Speak into your microphone now (up to 15 seconds) …")
    print()

    result = recognizer.recognize_once()

    print("  -- Result --")
    print(f"  Reason       : {result.reason}")

    if result.reason == speechsdk.ResultReason.RecognizedSpeech:
        print(f"  Text         : {result.text}")
        print(f"  Offset (ticks): {result.offset}")
        print(f"  Duration      : {result.duration}")
        print()
        print("  Everything works!  Your mic and Azure are both OK.")

    elif result.reason == speechsdk.ResultReason.NoMatch:
        print("  No speech was recognised.")
        print()
        print("  Possible causes:")
        print("    1. No speech detected — try speaking louder / closer to the mic")
        print(f"    2. Language model mismatch (current: {cfg.azure_speech_language})")
        print("    3. Wrong default microphone in OS Sound settings")

    elif result.reason == speechsdk.ResultReason.Canceled:
        cancellation = speechsdk.CancellationDetails(result)
        print(f"  Cancel reason : {cancellation.reason}")
        if cancellation.reason == speechsdk.CancellationReason.Error:
            print(f"  Error code    : {cancellation.error_code}")
            print(f"  Error details : {cancellation.error_details}")
            if "401" in str(cancellation.error_details) or "Unauthorized" in str(cancellation.error_details):
                print("  -> AZURE_SPEECH_KEY appears to be invalid or expired.")
            elif "connection" in str(cancellation.error_details).lower():
                print("  -> Cannot reach Azure. Check internet / firewall / region.")
        elif cancellation.reason == speechsdk.CancellationReason.EndOfStream:
            print("  Audio stream ended unexpectedly — microphone may have disconnected.")
    else:
        print(f"  Unexpected reason: {result.reason}")

    print()
    print("  Log file: speech_sdk_log.txt")
    print("=" * 60)
