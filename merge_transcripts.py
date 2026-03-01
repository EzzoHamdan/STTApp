"""
merge_transcripts.py — Merge all speaker JSONL files for a court session
into a single, chronologically-ordered unified transcript, with automatic
detection of simultaneous-speech (overlap) periods.

Usage
-----
    python merge_transcripts.py --session COURT-20260226-a3f7b1c2

Output
------
    sessions/<session_id>/unified_transcript.json   (structured, includes overlaps)
    sessions/<session_id>/unified_transcript.txt    (human-readable, annotated)

Overlap detection
-----------------
Each utterance has a known end-time (utc_iso, wall-clock when Azure returned
the result) and a duration (duration_sec).  The start time is therefore:

    start ≈ utc_iso − duration_sec

Two utterances from DIFFERENT speakers overlap when their [start, end]
intervals intersect.  All overlapping pairs are merged into contiguous
overlap windows that are stored in the unified JSON and annotated in the
text output.
"""

import argparse
import json
from datetime import datetime, timedelta
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


# ---------------------------------------------------------------------------
# Overlap detection
# ---------------------------------------------------------------------------

def _utterance_interval(entry: dict) -> tuple[datetime, datetime]:
    """Return (start_dt, end_dt) for an entry.

    utc_iso is the wall-clock time Azure returned the result, which
    corresponds to the END of the utterance.  The start is estimated by
    subtracting duration_sec.
    """
    end_dt = datetime.fromisoformat(entry["utc_iso"])
    dur = float(entry.get("duration_sec") or 0)
    start_dt = end_dt - timedelta(seconds=dur)
    return start_dt, end_dt


def detect_overlaps(entries: list[dict]) -> list[dict]:
    """
    Annotate each entry with overlap metadata and return a list of merged
    overlap windows.

    Each entry gains two fields:
        overlap      : bool   — True if this utterance overlapped with another speaker
        overlap_with : list[str] — which other speakers were active at the same time

    Returns
    -------
    list[dict]  — overlap windows, each:
        {
          "start_iso":    "...",
          "end_iso":      "...",
          "duration_sec": 1.23,
          "speakers":     ["Judge", "Lawyer_1"]
        }
    """
    n = len(entries)
    overlap_sets: list[set] = [set() for _ in range(n)]

    for i in range(n):
        s_i, e_i = _utterance_interval(entries[i])
        for j in range(i + 1, n):
            # Entries are sorted by end-time; once start_j > end_i we can skip the rest
            s_j, e_j = _utterance_interval(entries[j])
            if s_j >= e_i:
                break
            if entries[i]["speaker"] == entries[j]["speaker"]:
                continue
            # Intervals [s_i, e_i] and [s_j, e_j] overlap iff s_i < e_j AND s_j < e_i
            if s_i < e_j and s_j < e_i:
                overlap_sets[i].add(entries[j]["speaker"])
                overlap_sets[j].add(entries[i]["speaker"])

    # Annotate entries in-place
    for i, entry in enumerate(entries):
        entry["overlap"]      = bool(overlap_sets[i])
        entry["overlap_with"] = sorted(overlap_sets[i])

    # ── Build & merge overlap windows ────────────────────────────────
    raw_intervals: list[tuple[datetime, datetime, set]] = []
    for i, entry in enumerate(entries):
        if entry["overlap"]:
            s, e = _utterance_interval(entry)
            speakers = {entry["speaker"]} | overlap_sets[i]
            raw_intervals.append((s, e, speakers))

    if not raw_intervals:
        return []

    raw_intervals.sort(key=lambda x: x[0])
    merged_windows: list[dict] = []
    cur_s, cur_e, cur_spk = raw_intervals[0]

    for s, e, spk in raw_intervals[1:]:
        if s <= cur_e:
            cur_e   = max(cur_e, e)
            cur_spk = cur_spk | spk
        else:
            merged_windows.append({
                "start_iso":    cur_s.isoformat(),
                "end_iso":      cur_e.isoformat(),
                "duration_sec": round((cur_e - cur_s).total_seconds(), 2),
                "speakers":     sorted(cur_spk),
            })
            cur_s, cur_e, cur_spk = s, e, spk

    merged_windows.append({
        "start_iso":    cur_s.isoformat(),
        "end_iso":      cur_e.isoformat(),
        "duration_sec": round((cur_e - cur_s).total_seconds(), 2),
        "speakers":     sorted(cur_spk),
    })

    return merged_windows


# ---------------------------------------------------------------------------
# Merge
# ---------------------------------------------------------------------------

def merge(session_id: str) -> tuple[list[dict], list[dict]]:
    """
    Merge all speaker transcripts for a session, sorted by UTC timestamp,
    and detect simultaneous-speech overlap periods.

    Returns
    -------
    (entries, overlaps)
        entries  — chronologically sorted list of annotated utterance dicts
        overlaps — list of merged overlap window dicts
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
        return [], []

    # ── Sort by wall-clock UTC timestamp (= utterance end-time) ───────
    all_entries.sort(key=lambda e: e["utc_iso"])

    # ── Assign sequential turn numbers ────────────────────────────────
    for idx, entry in enumerate(all_entries, start=1):
        entry["turn"] = idx

    # ── Detect overlaps ───────────────────────────────────────────────
    overlap_windows = detect_overlaps(all_entries)

    if overlap_windows:
        console.print(
            f"  [bold yellow]⚡ {len(overlap_windows)} simultaneous-speech period(s) detected[/bold yellow]"
        )

    return all_entries, overlap_windows


# ---------------------------------------------------------------------------
# Writers
# ---------------------------------------------------------------------------

def write_unified_json(
    entries: list[dict],
    session_dir: Path,
    overlaps: list[dict] | None = None,
    session_id: str = "",
) -> Path:
    """Write the structured unified transcript (entries + overlap windows)."""
    out_path = session_dir / "unified_transcript.json"
    payload = {
        "session_id":      session_id,
        "generated_utc":   datetime.utcnow().isoformat() + "Z",
        "total_turns":     len(entries),
        "overlap_periods": len(overlaps or []),
        "overlaps":        overlaps or [],
        "entries":         entries,
    }
    out_path.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
    return out_path


def write_unified_text(
    entries: list[dict],
    session_id: str,
    session_dir: Path,
    overlaps: list[dict] | None = None,
) -> Path:
    """Write a human-readable unified transcript with overlap annotations."""
    out_path = session_dir / "unified_transcript.txt"
    lines: list[str] = []
    lines.append("=" * 72)
    lines.append("  UNIFIED COURT TRANSCRIPT")
    lines.append(f"  Session: {session_id}")
    lines.append(f"  Generated: {datetime.utcnow().isoformat()}Z")
    if overlaps:
        lines.append(f"  ⚡ Simultaneous speech detected: {len(overlaps)} period(s)")
    lines.append("=" * 72)
    lines.append("")

    for entry in entries:
        overlap_tag = ""
        if entry.get("overlap"):
            overlap_tag = f"  ⚡ OVERLAP with {', '.join(entry['overlap_with'])}"
        lines.append(f"[Turn {entry['turn']}]  {entry['utc_iso']}{overlap_tag}")
        lines.append(f"  {entry['speaker']}  (offset={entry.get('offset_sec','?')}s  dur={entry.get('duration_sec','?')}s)")
        lines.append(f"  \"{entry['text']}\"")
        lines.append("")

    # ── Overlap summary ────────────────────────────────────────────────
    if overlaps:
        lines.append("=" * 72)
        lines.append("  SIMULTANEOUS SPEECH SUMMARY")
        lines.append("=" * 72)
        for i, w in enumerate(overlaps, start=1):
            lines.append(
                f"  [{i}] {w['start_iso']}  →  {w['end_iso']}"
                f"  ({w['duration_sec']}s)  Speakers: {', '.join(w['speakers'])}"
            )
        lines.append("")

    lines.append("=" * 72)
    lines.append("  END OF TRANSCRIPT")
    lines.append("=" * 72)

    out_path.write_text("\n".join(lines), encoding="utf-8")
    return out_path


def display_table(entries: list[dict]):
    """Print a rich table preview of the unified transcript."""
    table = Table(title="Unified Court Transcript", show_lines=True)
    table.add_column("Turn",    style="bold",   width=5)
    table.add_column("Timestamp (UTC)",         width=28)
    table.add_column("Speaker", style="cyan",   width=12)
    table.add_column("Offset (s)",              width=10)
    table.add_column("⚡",                       width=4)
    table.add_column("Text",    style="white")

    for entry in entries:
        overlap_icon = "[yellow]⚡[/yellow]" if entry.get("overlap") else ""
        table.add_row(
            str(entry["turn"]),
            entry["utc_iso"],
            entry["speaker"],
            str(entry.get("offset_sec", "")),
            overlap_icon,
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

    entries, overlaps = merge(session_id)
    if not entries:
        return

    session_dir = get_session_dir(session_id)

    json_path = write_unified_json(entries, session_dir, overlaps, session_id)
    txt_path  = write_unified_text(entries, session_id, session_dir, overlaps)

    display_table(entries)

    console.print(f"\n[green]Unified JSON → {json_path}[/green]")
    console.print(f"[green]Unified TXT  → {txt_path}[/green]")
    console.print(f"[green]Total turns   : {len(entries)}[/green]")
    if overlaps:
        console.print(f"[yellow]⚡ Overlap periods: {len(overlaps)}[/yellow]")
    console.print("")

    if args.end:
        end_session(session_id)
        console.print(f"[yellow]Session marked as ended.[/yellow]\n")


if __name__ == "__main__":
    main()
