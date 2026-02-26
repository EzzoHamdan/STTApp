"""
run_speaker.py — CLI entry-point for ONE speaker's live transcription.

Usage
-----
    # Start a NEW court session and transcribe as the Judge:
    python run_speaker.py --role Judge

    # Join an EXISTING session (pass the session ID):
    python run_speaker.py --role Lawyer_1 --session COURT-20260226-a3f7b1c2

    # Specify all three default roles to auto-create:
    python run_speaker.py --role Lawyer_2 --session COURT-20260226-a3f7b1c2

Keyboard
--------
    Ctrl+C  →  gracefully stops recognition and saves.
"""

import argparse
import sys

from rich.console import Console
from rich.panel import Panel

from session_manager import (
    generate_session_id,
    get_session_dir,
    init_session,
    load_session_meta,
)
from transcriber import LiveTranscriber

console = Console()

DEFAULT_SPEAKERS = ["Judge", "Lawyer_1", "Lawyer_2"]


def main():
    parser = argparse.ArgumentParser(description="Court STT – single speaker transcription")
    parser.add_argument(
        "--role",
        required=True,
        help="Speaker role: Judge | Lawyer_1 | Lawyer_2",
    )
    parser.add_argument(
        "--session",
        default=None,
        help="Existing session ID to join.  Omit to create a new session.",
    )
    args = parser.parse_args()

    role: str = args.role
    session_id: str | None = args.session

    # ── Session handling ──────────────────────────────────────────────
    if session_id is None:
        session_id = generate_session_id()
        init_session(session_id, DEFAULT_SPEAKERS)
        console.print(Panel(
            f"[bold green]NEW session created[/]\n"
            f"Session ID: [bold cyan]{session_id}[/]\n"
            f"Speakers : {', '.join(DEFAULT_SPEAKERS)}",
            title="Court STT",
        ))
    else:
        try:
            meta = load_session_meta(session_id)
            console.print(Panel(
                f"[bold yellow]Joining existing session[/]\n"
                f"Session ID: [bold cyan]{session_id}[/]\n"
                f"Speakers : {', '.join(meta['speakers'])}",
                title="Court STT",
            ))
        except FileNotFoundError:
            # Session dir doesn't exist yet — initialise it
            init_session(session_id, DEFAULT_SPEAKERS)
            console.print(Panel(
                f"[bold green]Session initialised[/]\n"
                f"Session ID: [bold cyan]{session_id}[/]",
                title="Court STT",
            ))

    session_dir = get_session_dir(session_id)

    # ── Launch transcription ──────────────────────────────────────────
    transcriber = LiveTranscriber(
        session_id=session_id,
        speaker=role,
        session_dir=session_dir,
    )

    try:
        transcriber.start()
        console.print(f"\n[dim]Recording as [bold]{role}[/bold]. Press Ctrl+C to stop.[/dim]\n")
        # Block the main thread until user interrupts
        import time
        while True:
            time.sleep(0.25)
    except KeyboardInterrupt:
        console.print("\n[yellow]Stopping …[/yellow]")
    finally:
        transcriber.stop()
        console.print(f"[green]Transcript saved → {transcriber.transcript_path}[/green]")


if __name__ == "__main__":
    main()
