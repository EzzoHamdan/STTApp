"""
court_stt.server — FastAPI backend for the Court STT application.

Can be started programmatically or via the ``court-stt-server`` CLI::

    court-stt-server                        # default host/port from .env
    court-stt-server --host 127.0.0.1 --port 9000

Programmatic usage::

    from court_stt.server import create_app
    app = create_app()
    # use with uvicorn, hypercorn, etc.

Endpoints
---------
GET  /                              → serves index.html
POST /api/session/new               → creates a new court session
POST /api/session/{id}/start/{role} → starts live transcription for a role
POST /api/session/{id}/stop/{role}  → stops transcription for a role
POST /api/session/{id}/merge        → merges all transcripts
GET  /api/session/{id}/status       → returns session metadata
WS   /ws/{session_id}               → WebSocket stream of live events
"""

from __future__ import annotations

import asyncio
import json
import logging
from contextlib import asynccontextmanager
from datetime import datetime, timedelta
from typing import Dict, Set

import uvicorn
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from court_stt.config import Settings, configure_logging, get_settings
from court_stt.merge import TranscriptMerger
from court_stt.session import SessionManager
from court_stt.transcriber import LiveTranscriber

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Application state container (no module-level globals)
# ---------------------------------------------------------------------------

class AppState:
    """Mutable state attached to the running FastAPI instance.

    Encapsulated in a class so the server module has no hidden globals
    and multiple ``create_app()`` calls don't share state.
    """

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.session_mgr = SessionManager(settings=settings)
        self.merger = TranscriptMerger(session_manager=self.session_mgr)

        self.event_loop: asyncio.AbstractEventLoop | None = None
        self.ws_clients: Dict[str, Set[WebSocket]] = {}
        self.active_transcribers: Dict[str, Dict[str, LiveTranscriber]] = {}
        self.last_utterance_windows: Dict[str, Dict[str, tuple]] = {}


# ---------------------------------------------------------------------------
# Factory
# ---------------------------------------------------------------------------

def create_app(settings: Settings | None = None) -> FastAPI:
    """Create and configure a FastAPI application.

    Parameters
    ----------
    settings : Settings | None
        Explicit settings.  Defaults to ``get_settings()``.
    """
    cfg = settings or get_settings()
    state = AppState(cfg)
    cfg.static_dir.mkdir(parents=True, exist_ok=True)

    # ── Lifespan ──────────────────────────────────────────────────────
    @asynccontextmanager
    async def lifespan(app: FastAPI):
        state.event_loop = asyncio.get_running_loop()
        yield

    app = FastAPI(title="Court STT", lifespan=lifespan)
    app.state.ctx = state  # accessible via request.app.state.ctx

    # ── Helpers ───────────────────────────────────────────────────────

    async def ws_broadcast(session_id: str, message: dict) -> None:
        clients = state.ws_clients.get(session_id, set())
        dead: Set[WebSocket] = set()
        payload = json.dumps(message, ensure_ascii=False)
        for ws in list(clients):
            try:
                await ws.send_text(payload)
            except Exception:
                dead.add(ws)
        clients -= dead

    def threadsafe_broadcast(session_id: str, message: dict) -> None:
        if state.event_loop and not state.event_loop.is_closed():
            asyncio.run_coroutine_threadsafe(
                ws_broadcast(session_id, message), state.event_loop
            )

    # ── Transcriber callbacks ─────────────────────────────────────────

    def make_result_callback(session_id: str):
        def on_result(entry: dict):
            speaker = entry["speaker"]
            end_dt = datetime.fromisoformat(entry["utc_iso"])
            dur = float(entry.get("duration_sec") or 0)
            start_dt = end_dt - timedelta(seconds=dur)

            windows = state.last_utterance_windows.setdefault(session_id, {})
            overlap_with = []
            for other_speaker, (o_start, o_end) in windows.items():
                if other_speaker == speaker:
                    continue
                if start_dt < o_end and o_start < end_dt:
                    overlap_with.append(other_speaker)

            windows[speaker] = (start_dt, end_dt)

            msg = {
                **entry,
                "type": "result",
                "overlap": bool(overlap_with),
                "overlap_with": sorted(overlap_with),
            }
            threadsafe_broadcast(session_id, msg)

        return on_result

    def make_status_callback(session_id: str):
        def on_status(speaker: str, event_type: str, text: str):
            msg = {
                "type": "status",
                "session_id": session_id,
                "speaker": speaker,
                "event": event_type,
                "text": text,
            }
            threadsafe_broadcast(session_id, msg)

        return on_status

    # ── REST API ──────────────────────────────────────────────────────

    @app.post("/api/session/new")
    async def new_session():
        session_id = SessionManager.generate_id()
        meta = state.session_mgr.init_session(session_id, cfg.default_speakers)
        state.ws_clients[session_id] = set()
        state.active_transcribers[session_id] = {}
        return {
            "session_id": session_id,
            "meta": meta,
            "colors": cfg.speaker_colors,
        }

    @app.post("/api/session/{session_id}/start/{role}")
    async def start_speaker(session_id: str, role: str):
        try:
            state.session_mgr.load_session_meta(session_id)
        except FileNotFoundError:
            state.session_mgr.init_session(session_id, cfg.default_speakers)

        state.ws_clients.setdefault(session_id, set())
        state.active_transcribers.setdefault(session_id, {})

        if role in state.active_transcribers[session_id]:
            return JSONResponse(
                {"error": f"{role} is already recording"}, status_code=409
            )

        session_dir = state.session_mgr.get_session_dir(session_id)
        t = LiveTranscriber(
            session_id=session_id,
            speaker=role,
            session_dir=session_dir,
            settings=cfg,
            on_result=make_result_callback(session_id),
            on_status=make_status_callback(session_id),
        )
        t.start()
        state.active_transcribers[session_id][role] = t

        await ws_broadcast(session_id, {
            "type": "status",
            "session_id": session_id,
            "speaker": role,
            "event": "started",
            "text": f"{role} microphone is live",
        })
        return {"status": "started", "role": role, "session_id": session_id}

    @app.post("/api/session/{session_id}/stop/{role}")
    async def stop_speaker(session_id: str, role: str):
        transcribers = state.active_transcribers.get(session_id, {})
        t = transcribers.pop(role, None)
        if t is None:
            return JSONResponse(
                {"error": f"{role} is not currently recording"}, status_code=404
            )

        await asyncio.get_event_loop().run_in_executor(None, t.stop)

        await ws_broadcast(session_id, {
            "type": "status",
            "session_id": session_id,
            "speaker": role,
            "event": "stopped",
            "text": f"{role} stopped. {len(t.entries)} utterances saved.",
        })
        return {"status": "stopped", "role": role, "entries": len(t.entries)}

    @app.post("/api/session/{session_id}/merge")
    async def merge_session(session_id: str, mark_ended: bool = False):
        def _do_merge():
            return state.merger.merge_and_write(
                session_id, mark_ended=mark_ended
            )

        entries, overlaps = await asyncio.get_event_loop().run_in_executor(
            None, _do_merge
        )

        await ws_broadcast(session_id, {
            "type": "merged",
            "session_id": session_id,
            "entries": entries,
            "overlaps": overlaps,
            "total": len(entries),
        })
        return {
            "status": "merged",
            "total": len(entries),
            "overlaps": overlaps,
            "entries": entries,
        }

    @app.get("/api/session/{session_id}/status")
    async def session_status(session_id: str):
        try:
            meta = state.session_mgr.load_session_meta(session_id)
        except FileNotFoundError:
            return JSONResponse({"error": "session not found"}, status_code=404)
        active = list(state.active_transcribers.get(session_id, {}).keys())
        return {
            "meta": meta,
            "active_speakers": active,
            "colors": cfg.speaker_colors,
        }

    # ── WebSocket ─────────────────────────────────────────────────────

    @app.websocket("/ws/{session_id}")
    async def websocket_endpoint(websocket: WebSocket, session_id: str):
        await websocket.accept()
        state.ws_clients.setdefault(session_id, set())
        state.ws_clients[session_id].add(websocket)

        try:
            meta = state.session_mgr.load_session_meta(session_id)
            active = list(
                state.active_transcribers.get(session_id, {}).keys()
            )
            await websocket.send_text(json.dumps({
                "type": "hello",
                "session_id": session_id,
                "meta": meta,
                "active_speakers": active,
                "colors": cfg.speaker_colors,
            }))
        except FileNotFoundError:
            pass

        try:
            while True:
                data = await websocket.receive_text()
                if data == "ping":
                    await websocket.send_text(json.dumps({"type": "pong"}))
        except WebSocketDisconnect:
            state.ws_clients.get(session_id, set()).discard(websocket)

    # ── Static files & index ──────────────────────────────────────────

    app.mount(
        "/static",
        StaticFiles(directory=str(cfg.static_dir)),
        name="static",
    )

    @app.get("/")
    async def serve_index():
        return FileResponse(str(cfg.static_dir / "index.html"))

    return app


# ---------------------------------------------------------------------------
# Direct execution convenience
# ---------------------------------------------------------------------------

def run(settings: Settings | None = None) -> None:
    """Start the server with uvicorn (blocking)."""
    cfg = settings or get_settings()
    configure_logging(cfg)
    app = create_app(cfg)
    uvicorn.run(app, host=cfg.host, port=cfg.port)


if __name__ == "__main__":
    run()
