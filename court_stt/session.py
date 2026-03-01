"""
court_stt.session — Court session lifecycle management.

Provides a ``SessionManager`` class that can be used standalone in any
project — no global state, no side-effects on import.

Standalone usage
----------------
>>> from pathlib import Path
>>> from court_stt.session import SessionManager
>>> mgr = SessionManager(sessions_dir=Path("./my_sessions"))
>>> sid = mgr.generate_id()
>>> meta = mgr.init_session(sid, ["Judge", "Lawyer_1"])
>>> print(meta)
>>> mgr.end_session(sid)

When used inside the court_stt server, the ``Settings`` object supplies
``sessions_dir`` automatically.
"""

from __future__ import annotations

import json
import logging
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import List

from court_stt.config import Settings, get_settings

logger = logging.getLogger(__name__)


class SessionManager:
    """Manages court session directories and metadata on disk.

    Parameters
    ----------
    sessions_dir : Path | None
        Root directory where sessions are stored.  Defaults to the value
        from ``Settings``.
    settings : Settings | None
        Explicit ``Settings`` instance.  If *sessions_dir* is also given,
        it takes precedence.
    """

    def __init__(
        self,
        sessions_dir: Path | None = None,
        settings: Settings | None = None,
    ) -> None:
        cfg = settings or get_settings()
        self._sessions_dir = Path(sessions_dir) if sessions_dir else cfg.sessions_dir
        self._sessions_dir.mkdir(parents=True, exist_ok=True)

    # ── Accessors ─────────────────────────────────────────────────────

    @property
    def sessions_dir(self) -> Path:
        return self._sessions_dir

    # ── ID generation ─────────────────────────────────────────────────

    @staticmethod
    def generate_id() -> str:
        """Return a unique, human-readable court session ID.

        Format: ``COURT-YYYYMMDD-<8-hex-chars>``
        """
        date_str = datetime.now(timezone.utc).strftime("%Y%m%d")
        short_uuid = uuid.uuid4().hex[:8]
        return f"COURT-{date_str}-{short_uuid}"

    # ── Directory helpers ─────────────────────────────────────────────

    def get_session_dir(self, session_id: str) -> Path:
        """Return (and create) the directory for the given session."""
        session_dir = self._sessions_dir / session_id
        session_dir.mkdir(parents=True, exist_ok=True)
        return session_dir

    # ── CRUD ──────────────────────────────────────────────────────────

    def init_session(self, session_id: str, speakers: List[str]) -> dict:
        """Initialise a new court session on disk.

        Parameters
        ----------
        session_id : str
            The unique session identifier.
        speakers : list[str]
            List of speaker roles, e.g. ``["Judge", "Lawyer_1"]``.

        Returns
        -------
        dict — the session metadata that was written.
        """
        session_dir = self.get_session_dir(session_id)

        meta = {
            "session_id": session_id,
            "created_utc": datetime.now(timezone.utc).isoformat(),
            "speakers": speakers,
            "status": "active",
            "ended_utc": None,
        }

        meta_path = session_dir / "session_meta.json"
        meta_path.write_text(
            json.dumps(meta, indent=2, ensure_ascii=False),
            encoding="utf-8",
        )

        logger.info("Session %s initialised (%d speakers)", session_id, len(speakers))
        return meta

    def end_session(self, session_id: str) -> None:
        """Mark a session as ended (sets ``status`` and ``ended_utc``)."""
        meta_path = self.get_session_dir(session_id) / "session_meta.json"
        if meta_path.exists():
            meta = json.loads(meta_path.read_text(encoding="utf-8"))
            meta["status"] = "ended"
            meta["ended_utc"] = datetime.now(timezone.utc).isoformat()
            meta_path.write_text(
                json.dumps(meta, indent=2, ensure_ascii=False),
                encoding="utf-8",
            )
            logger.info("Session %s marked as ended", session_id)

    def load_session_meta(self, session_id: str) -> dict:
        """Load session metadata from disk.

        Raises
        ------
        FileNotFoundError
            If the session directory or meta file does not exist.
        """
        meta_path = self.get_session_dir(session_id) / "session_meta.json"
        return json.loads(meta_path.read_text(encoding="utf-8"))


# ---------------------------------------------------------------------------
# Module-level convenience functions (delegate to a default SessionManager)
# ---------------------------------------------------------------------------
# Kept for backward compatibility and lightweight scripts.

def generate_session_id() -> str:
    """Generate a court session ID (convenience wrapper)."""
    return SessionManager.generate_id()


def get_session_dir(session_id: str, sessions_dir: Path | None = None) -> Path:
    """Return the directory for a given session (convenience wrapper)."""
    mgr = SessionManager(sessions_dir=sessions_dir)
    return mgr.get_session_dir(session_id)


def init_session(
    session_id: str,
    speakers: List[str],
    sessions_dir: Path | None = None,
) -> dict:
    """Initialise a session on disk (convenience wrapper)."""
    mgr = SessionManager(sessions_dir=sessions_dir)
    return mgr.init_session(session_id, speakers)


def end_session(session_id: str, sessions_dir: Path | None = None) -> None:
    """Mark a session as ended (convenience wrapper)."""
    mgr = SessionManager(sessions_dir=sessions_dir)
    mgr.end_session(session_id)


def load_session_meta(session_id: str, sessions_dir: Path | None = None) -> dict:
    """Load session metadata from disk (convenience wrapper)."""
    mgr = SessionManager(sessions_dir=sessions_dir)
    return mgr.load_session_meta(session_id)
