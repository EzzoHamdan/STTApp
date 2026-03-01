"""
court_stt.merge — Merge multi-speaker JSONL transcripts into a unified timeline.

The ``TranscriptMerger`` class is stateless and can be used in any project
that works with the JSONL transcript format, independently of the server.

Standalone usage
----------------
>>> from court_stt.merge import TranscriptMerger
>>> from court_stt.session import SessionManager
>>>
>>> mgr = SessionManager()
>>> merger = TranscriptMerger(session_manager=mgr)
>>> entries, overlaps = merger.merge("COURT-20260226-a3f7b1c2")

Or work with raw entries directly (no disk I/O):

>>> from court_stt.merge import detect_overlaps, sort_and_number
>>> entries = [...]  # list of dicts with utc_iso, duration_sec, speaker, text
>>> entries = sort_and_number(entries)
>>> overlaps = detect_overlaps(entries)
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta
from pathlib import Path
from typing import List, Tuple

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Pure functions — no I/O, fully reusable
# ---------------------------------------------------------------------------

def _utterance_interval(entry: dict) -> Tuple[datetime, datetime]:
    """Return ``(start_dt, end_dt)`` for an entry.

    ``utc_iso`` is when Azure returned the result (≈ end of utterance).
    ``start ≈ end − duration_sec``.
    """
    end_dt = datetime.fromisoformat(entry["utc_iso"])
    dur = float(entry.get("duration_sec") or 0)
    start_dt = end_dt - timedelta(seconds=dur)
    return start_dt, end_dt


def detect_overlaps(entries: list[dict]) -> list[dict]:
    """Annotate entries **in-place** with overlap metadata and return
    merged overlap windows.

    Each entry gains:
        ``overlap``      : bool
        ``overlap_with`` : list[str]

    Returns a list of overlap-window dicts::

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
            s_j, e_j = _utterance_interval(entries[j])
            if s_j >= e_i:
                break
            if entries[i]["speaker"] == entries[j]["speaker"]:
                continue
            if s_i < e_j and s_j < e_i:
                overlap_sets[i].add(entries[j]["speaker"])
                overlap_sets[j].add(entries[i]["speaker"])

    # Annotate entries in-place
    for i, entry in enumerate(entries):
        entry["overlap"] = bool(overlap_sets[i])
        entry["overlap_with"] = sorted(overlap_sets[i])

    # ── Build & merge overlap windows ────────────────────────────────
    raw_intervals: list[tuple] = []
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
            cur_e = max(cur_e, e)
            cur_spk = cur_spk | spk
        else:
            merged_windows.append({
                "start_iso": cur_s.isoformat(),
                "end_iso": cur_e.isoformat(),
                "duration_sec": round((cur_e - cur_s).total_seconds(), 2),
                "speakers": sorted(cur_spk),
            })
            cur_s, cur_e, cur_spk = s, e, spk

    merged_windows.append({
        "start_iso": cur_s.isoformat(),
        "end_iso": cur_e.isoformat(),
        "duration_sec": round((cur_e - cur_s).total_seconds(), 2),
        "speakers": sorted(cur_spk),
    })

    return merged_windows


def sort_and_number(entries: list[dict]) -> list[dict]:
    """Sort entries by ``utc_iso`` and assign sequential ``turn`` numbers."""
    entries.sort(key=lambda e: e["utc_iso"])
    for idx, entry in enumerate(entries, start=1):
        entry["turn"] = idx
    return entries


def load_speaker_entries(jsonl_path: Path) -> list[dict]:
    """Load all entries from a speaker's ``.jsonl`` file."""
    entries: list[dict] = []
    if not jsonl_path.exists():
        return entries
    with open(jsonl_path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                entries.append(json.loads(line))
    return entries


# ---------------------------------------------------------------------------
# Writers — pure output, no console printing
# ---------------------------------------------------------------------------

def write_unified_json(
    entries: list[dict],
    session_dir: Path,
    overlaps: list[dict] | None = None,
    session_id: str = "",
) -> Path:
    """Write the structured unified transcript JSON file.

    Returns the path to the written file.
    """
    out_path = session_dir / "unified_transcript.json"
    payload = {
        "session_id": session_id,
        "generated_utc": datetime.utcnow().isoformat() + "Z",
        "total_turns": len(entries),
        "overlap_periods": len(overlaps or []),
        "overlaps": overlaps or [],
        "entries": entries,
    }
    out_path.write_text(
        json.dumps(payload, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )
    logger.info("Unified JSON → %s", out_path)
    return out_path


def write_unified_text(
    entries: list[dict],
    session_id: str,
    session_dir: Path,
    overlaps: list[dict] | None = None,
) -> Path:
    """Write a human-readable unified transcript text file.

    Returns the path to the written file.
    """
    out_path = session_dir / "unified_transcript.txt"
    lines: list[str] = []
    lines.append("=" * 72)
    lines.append("  UNIFIED COURT TRANSCRIPT")
    lines.append(f"  Session: {session_id}")
    lines.append(f"  Generated: {datetime.utcnow().isoformat()}Z")
    if overlaps:
        lines.append(
            f"  Simultaneous speech detected: {len(overlaps)} period(s)"
        )
    lines.append("=" * 72)
    lines.append("")

    for entry in entries:
        overlap_tag = ""
        if entry.get("overlap"):
            overlap_tag = f"  [OVERLAP with {', '.join(entry['overlap_with'])}]"
        lines.append(f"[Turn {entry['turn']}]  {entry['utc_iso']}{overlap_tag}")
        lines.append(
            f"  {entry['speaker']}  "
            f"(offset={entry.get('offset_sec', '?')}s  "
            f"dur={entry.get('duration_sec', '?')}s)"
        )
        lines.append(f'  "{entry["text"]}"')
        lines.append("")

    if overlaps:
        lines.append("=" * 72)
        lines.append("  SIMULTANEOUS SPEECH SUMMARY")
        lines.append("=" * 72)
        for i, w in enumerate(overlaps, start=1):
            lines.append(
                f"  [{i}] {w['start_iso']}  ->  {w['end_iso']}"
                f"  ({w['duration_sec']}s)  Speakers: {', '.join(w['speakers'])}"
            )
        lines.append("")

    lines.append("=" * 72)
    lines.append("  END OF TRANSCRIPT")
    lines.append("=" * 72)

    out_path.write_text("\n".join(lines), encoding="utf-8")
    logger.info("Unified TXT  → %s", out_path)
    return out_path


# ---------------------------------------------------------------------------
# TranscriptMerger — orchestrates loading + merging + writing
# ---------------------------------------------------------------------------

class TranscriptMerger:
    """High-level merge orchestrator.

    Parameters
    ----------
    session_manager : SessionManager | None
        An existing ``SessionManager`` instance.  If ``None``, a default
        one is created from the current ``Settings``.
    """

    def __init__(self, session_manager=None) -> None:
        if session_manager is None:
            from court_stt.session import SessionManager
            session_manager = SessionManager()
        self._sm = session_manager

    def merge(
        self, session_id: str
    ) -> Tuple[List[dict], List[dict]]:
        """Merge all speaker transcripts for a session.

        Returns ``(entries, overlaps)`` where *entries* are chronologically
        sorted and annotated, and *overlaps* are merged overlap windows.
        """
        session_dir = self._sm.get_session_dir(session_id)
        meta = self._sm.load_session_meta(session_id)

        all_entries: list[dict] = []
        for speaker in meta["speakers"]:
            jsonl_path = session_dir / f"{speaker}.jsonl"
            speaker_entries = load_speaker_entries(jsonl_path)
            all_entries.extend(speaker_entries)
            logger.info(
                "Loaded %d entries for %s", len(speaker_entries), speaker
            )

        if not all_entries:
            logger.warning("No transcript entries found for session %s", session_id)
            return [], []

        sort_and_number(all_entries)
        overlap_windows = detect_overlaps(all_entries)

        if overlap_windows:
            logger.info(
                "%d simultaneous-speech period(s) detected", len(overlap_windows)
            )

        return all_entries, overlap_windows

    def merge_and_write(
        self,
        session_id: str,
        mark_ended: bool = False,
    ) -> Tuple[List[dict], List[dict]]:
        """Merge, write output files, and optionally end the session.

        Returns ``(entries, overlaps)``.
        """
        entries, overlaps = self.merge(session_id)
        if not entries:
            return entries, overlaps

        session_dir = self._sm.get_session_dir(session_id)
        write_unified_json(entries, session_dir, overlaps, session_id)
        write_unified_text(entries, session_id, session_dir, overlaps)

        if mark_ended:
            self._sm.end_session(session_id)

        return entries, overlaps
