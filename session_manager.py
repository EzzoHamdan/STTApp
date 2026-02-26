"""
Session Manager — generates unique court session IDs and manages session metadata.

Each court session gets a deterministic, collision-free ID built from:
    COURT-<date>-<short_uuid>   e.g.  COURT-20260226-a3f7b1c2

Metadata (who participates, when it started/ended) is persisted to
sessions/<session_id>/session_meta.json so the merger can discover everything
it needs from the session_id alone.
"""

import json
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path

SESSIONS_DIR = Path(__file__).parent / "sessions"


def generate_session_id() -> str:
    """Return a unique, human-readable court session ID."""
    date_str = datetime.now(timezone.utc).strftime("%Y%m%d")
    short_uuid = uuid.uuid4().hex[:8]
    return f"COURT-{date_str}-{short_uuid}"


def get_session_dir(session_id: str) -> Path:
    """Return (and create) the directory for a given session."""
    session_dir = SESSIONS_DIR / session_id
    session_dir.mkdir(parents=True, exist_ok=True)
    return session_dir


def init_session(session_id: str, speakers: list[str]) -> dict:
    """
    Initialise a new court session on disk.

    Parameters
    ----------
    session_id : str
        The unique session identifier.
    speakers : list[str]
        List of speaker roles, e.g. ["Judge", "Lawyer_1", "Lawyer_2"].

    Returns
    -------
    dict  – the session metadata that was written.
    """
    session_dir = get_session_dir(session_id)

    meta = {
        "session_id": session_id,
        "created_utc": datetime.now(timezone.utc).isoformat(),
        "speakers": speakers,
        "status": "active",
        "ended_utc": None,
    }

    meta_path = session_dir / "session_meta.json"
    meta_path.write_text(json.dumps(meta, indent=2, ensure_ascii=False), encoding="utf-8")
    return meta


def end_session(session_id: str) -> None:
    """Mark a session as ended."""
    meta_path = get_session_dir(session_id) / "session_meta.json"
    if meta_path.exists():
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
        meta["status"] = "ended"
        meta["ended_utc"] = datetime.now(timezone.utc).isoformat()
        meta_path.write_text(json.dumps(meta, indent=2, ensure_ascii=False), encoding="utf-8")


def load_session_meta(session_id: str) -> dict:
    """Load session metadata from disk."""
    meta_path = get_session_dir(session_id) / "session_meta.json"
    return json.loads(meta_path.read_text(encoding="utf-8"))


# ---------------------------------------------------------------------------
# Quick self-test
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    sid = generate_session_id()
    print(f"Generated session: {sid}")
    meta = init_session(sid, ["Judge", "Lawyer_1", "Lawyer_2"])
    print(json.dumps(meta, indent=2))
    print(f"Session dir: {get_session_dir(sid)}")
