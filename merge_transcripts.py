"""
merge_transcripts.py — Merge all speaker JSONL files for a court session
into a single, chronologically-ordered unified transcript.

Usage
-----
    python merge_transcripts.py --session COURT-20260226-a3f7b1c2

Output
------
    sessions/<session_id>/unified_transcript.json   (structured)
    sessions/<session_id>/unified_transcript.txt    (human-readable)
"""

import argparse
import json
from datetime import datetime
from pathlib import Path

from rich.console import Console
from rich.table import Table

from session_manager import get_session_dir, load_session_meta, end_session

console = Console()


def load_speaker_entries(jsonl_path: Path) -> list[dict]:
    """Load all entries from a speaker's JSONL file."""
    entries = []
    if not jsonl_path.exists():
        return entries
    with open(jsonl_path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                entries.append(json.loads(line))
    return entries


def merge(session_id: str) -> list[dict]:
    """
    Merge all speaker transcripts for a session, sorted by UTC timestamp.

    Returns the merged list of entries.
    """
    session_dir = get_session_dir(session_id)
    meta = load_session_meta(session_id)

    all_entries: list[dict] = []
    for speaker in meta["speakers"]:
        jsonl_path = session_dir / f"{speaker}.jsonl"
        entries = load_speaker_entries(jsonl_path)
        all_entries.extend(entries)
        console.print(f"  Loaded [cyan]{len(entries)}[/cyan] entries for [bold]{speaker}[/bold]")

    if not all_entries:
        console.print("[red]No transcript entries found for this session.[/red]")
        return []

    # ── Sort by wall-clock UTC timestamp ──────────────────────────────
    all_entries.sort(key=lambda e: e["utc_iso"])

    # ── Assign a sequential turn number ───────────────────────────────
    for idx, entry in enumerate(all_entries, start=1):
        entry["turn"] = idx

    return all_entries


def write_unified_json(entries: list[dict], session_dir: Path) -> Path:
    """Write the structured unified transcript."""
    out_path = session_dir / "unified_transcript.json"
    out_path.write_text(
        json.dumps(entries, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )
    return out_path


def write_unified_text(entries: list[dict], session_id: str, session_dir: Path) -> Path:
    """Write a human-readable unified transcript."""
    out_path = session_dir / "unified_transcript.txt"
    lines: list[str] = []
    lines.append("=" * 72)
    lines.append(f"  UNIFIED COURT TRANSCRIPT")
    lines.append(f"  Session: {session_id}")
    lines.append(f"  Generated: {datetime.utcnow().isoformat()}Z")
    lines.append("=" * 72)
    lines.append("")

    for entry in entries:
        ts = entry["utc_iso"]
        speaker = entry["speaker"]
        text = entry["text"]
        offset = entry.get("offset_sec", "?")
        duration = entry.get("duration_sec", "?")
        lines.append(f"[Turn {entry['turn']}]  {ts}")
        lines.append(f"  {speaker}  (offset={offset}s  dur={duration}s)")
        lines.append(f"  \"{text}\"")
        lines.append("")

    lines.append("=" * 72)
    lines.append("  END OF TRANSCRIPT")
    lines.append("=" * 72)

    out_path.write_text("\n".join(lines), encoding="utf-8")
    return out_path


def display_table(entries: list[dict]):
    """Print a rich table preview of the unified transcript."""
    table = Table(title="Unified Court Transcript", show_lines=True)
    table.add_column("Turn", style="bold", width=5)
    table.add_column("Timestamp (UTC)", width=28)
    table.add_column("Speaker", style="cyan", width=12)
    table.add_column("Offset (s)", width=10)
    table.add_column("Text", style="white")

    for entry in entries:
        table.add_row(
            str(entry["turn"]),
            entry["utc_iso"],
            entry["speaker"],
            str(entry.get("offset_sec", "")),
            entry["text"],
        )

    console.print(table)


def main():
    parser = argparse.ArgumentParser(description="Merge court session transcripts")
    parser.add_argument("--session", required=True, help="Session ID to merge")
    parser.add_argument("--end", action="store_true", help="Mark session as ended after merge")
    args = parser.parse_args()

    session_id = args.session
    console.print(f"\n[bold]Merging transcripts for session [cyan]{session_id}[/cyan][/bold]\n")

    entries = merge(session_id)
    if not entries:
        return

    session_dir = get_session_dir(session_id)

    json_path = write_unified_json(entries, session_dir)
    txt_path = write_unified_text(entries, session_id, session_dir)

    display_table(entries)

    console.print(f"\n[green]Unified JSON → {json_path}[/green]")
    console.print(f"[green]Unified TXT  → {txt_path}[/green]")
    console.print(f"[green]Total turns   : {len(entries)}[/green]\n")

    if args.end:
        end_session(session_id)
        console.print(f"[yellow]Session marked as ended.[/yellow]\n")


if __name__ == "__main__":
    main()
