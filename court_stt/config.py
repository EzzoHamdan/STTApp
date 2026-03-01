"""
court_stt.config — Centralised, immutable application settings.

All environment variables are read **once** when `Settings()` is
instantiated.  Every other module receives a `Settings` instance via
its constructor — no hidden global state, no scattered `os.getenv()`.

Quick start
-----------
>>> from court_stt.config import get_settings
>>> cfg = get_settings()           # reads .env on first call, cached after
>>> cfg.azure_speech_key           # '...'
>>> cfg.sessions_dir               # PosixPath('sessions')

For tests or alternative deployments, override any field:

>>> cfg = Settings(azure_speech_region="westus", sessions_dir="/tmp/sessions")
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import Dict, List

from dotenv import load_dotenv

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Package root — used to resolve relative paths (static/, sessions/)
# ---------------------------------------------------------------------------
_PACKAGE_DIR = Path(__file__).resolve().parent
_PROJECT_DIR = _PACKAGE_DIR.parent


@dataclass(frozen=True)
class Settings:
    """Application-wide configuration.

    Parameters are resolved in order:
      1. Explicitly passed constructor arguments
      2. Environment variables (including ``.env`` file)
      3. Sensible defaults

    The class is **frozen** (immutable) — once created, settings cannot
    change, making it safe to share across threads.
    """

    # ── Azure Speech ──────────────────────────────────────────────────
    azure_speech_key: str = ""
    azure_speech_region: str = ""
    azure_speech_language: str = "ar-JO"

    # ── Audio ─────────────────────────────────────────────────────────
    sample_rate: int = 16_000
    channels: int = 1
    dtype: str = "int16"
    block_size: int = 1_024

    # ── Paths ─────────────────────────────────────────────────────────
    sessions_dir: Path = field(default_factory=lambda: _PROJECT_DIR / "sessions")
    static_dir: Path = field(default_factory=lambda: _PACKAGE_DIR / "static")

    # ── Server ────────────────────────────────────────────────────────
    host: str = "0.0.0.0"
    port: int = 8000

    # ── Court defaults ────────────────────────────────────────────────
    default_speakers: List[str] = field(
        default_factory=lambda: ["Judge", "Lawyer_1", "Lawyer_2"]
    )
    speaker_colors: Dict[str, str] = field(
        default_factory=lambda: {
            "Judge": "#e0a020",
            "Lawyer_1": "#4a9eda",
            "Lawyer_2": "#5acc8a",
        }
    )

    # ── Logging ───────────────────────────────────────────────────────
    log_level: str = "INFO"

    def __post_init__(self) -> None:
        # Ensure sessions_dir is a Path
        object.__setattr__(self, "sessions_dir", Path(self.sessions_dir))
        object.__setattr__(self, "static_dir", Path(self.static_dir))

    @classmethod
    def from_env(cls, dotenv_path: str | Path | None = None, **overrides) -> Settings:
        """Create settings by reading the environment / ``.env`` file.

        Any keyword argument in *overrides* takes precedence over the
        environment, which in turn takes precedence over the defaults.

        Parameters
        ----------
        dotenv_path : str | Path | None
            Explicit path to a ``.env`` file.  ``None`` uses python-dotenv's
            default search (current directory → parent directories).
        **overrides
            Explicit values that override everything else.
        """
        load_dotenv(dotenv_path=dotenv_path, override=False)

        env = {
            "azure_speech_key": os.getenv("AZURE_SPEECH_KEY", ""),
            "azure_speech_region": os.getenv("AZURE_SPEECH_REGION", ""),
            "azure_speech_language": os.getenv("AZURE_SPEECH_LANGUAGE", "ar-JO"),
            "sample_rate": int(os.getenv("AUDIO_SAMPLE_RATE", "16000")),
            "channels": int(os.getenv("AUDIO_CHANNELS", "1")),
            "block_size": int(os.getenv("AUDIO_BLOCK_SIZE", "1024")),
            "host": os.getenv("SERVER_HOST", "0.0.0.0"),
            "port": int(os.getenv("SERVER_PORT", "8000")),
            "log_level": os.getenv("LOG_LEVEL", "INFO"),
        }

        sessions_dir = os.getenv("SESSIONS_DIR")
        if sessions_dir:
            env["sessions_dir"] = Path(sessions_dir)

        static_dir = os.getenv("STATIC_DIR")
        if static_dir:
            env["static_dir"] = Path(static_dir)

        speakers = os.getenv("DEFAULT_SPEAKERS")
        if speakers:
            env["default_speakers"] = [s.strip() for s in speakers.split(",")]

        # Overrides win
        env.update({k: v for k, v in overrides.items() if v is not None})

        return cls(**env)


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Return the singleton application settings (lazy, cached).

    Call ``get_settings.cache_clear()`` if you need to reload (e.g. tests).
    """
    return Settings.from_env()


def configure_logging(settings: Settings | None = None) -> None:
    """Apply a consistent logging format across the application."""
    cfg = settings or get_settings()
    logging.basicConfig(
        level=cfg.log_level.upper(),
        format="%(asctime)s | %(levelname)-7s | %(name)s | %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )
