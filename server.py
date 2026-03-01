"""
server.py — FastAPI backend for the Court STT demo.

Endpoints
---------
GET  /                              → serves index.html
POST /api/session/new               → creates a new court session
POST /api/session/{id}/start/{role} → starts live transcription for a role
POST /api/session/{id}/stop/{role}  → stops transcription for a role
POST /api/session/{id}/merge        → merges all transcripts, returns unified JSON
GET  /api/session/{id}/status       → returns session metadata + active speakers
WS   /ws/{session_id}               → WebSocket stream of live transcription events

WebSocket message format (JSON):
{
  "type": "result" | "partial" | "status" | "merged",
  "session_id": "...",
  "speaker": "Judge",
  "text": "...",
  "utc_iso": "...",
  "offset_sec": 1.23,
  "duration_sec": 0.9,
  "turn": 5          // only on "merged" messages
}
"""

import asyncio
import json
import os
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Dict, Set

import uvicorn
from dotenv import load_dotenv
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from merge_transcripts import merge, write_unified_json, write_unified_text
from session_manager import (
    end_session,
    generate_session_id,
    get_session_dir,
    init_session,
    load_session_meta,
)
from transcriber import LiveTranscriber

load_dotenv()

# ---------------------------------------------------------------------------
# Global state
# ---------------------------------------------------------------------------
_event_loop: asyncio.AbstractEventLoop | None = None

# session_id → set of connected WebSocket clients
_ws_clients: Dict[str, Set[WebSocket]] = {}

# session_id → role → LiveTranscriber instance
_active_transcribers: Dict[str, Dict[str, LiveTranscriber]] = {}

# Real-time overlap tracking: session_id → speaker → (start_dt, end_dt)
# Keeps the most-recently-completed utterance window per speaker.
_last_utterance_windows: Dict[str, Dict[str, tuple]] = {}

STATIC_DIR = Path(__file__).parent / "static"
STATIC_DIR.mkdir(exist_ok=True)

DEFAULT_SPEAKERS = ["Judge", "Lawyer_1", "Lawyer_2"]

# Speaker accent colours (sent to frontend)
SPEAKER_COLORS = {
    "Judge":    "#e0a020",
    "Lawyer_1": "#4a9eda",
    "Lawyer_2": "#5acc8a",
}


# ---------------------------------------------------------------------------
# Lifespan — capture the running event loop once at startup
# ---------------------------------------------------------------------------
@asynccontextmanager
async def lifespan(app: FastAPI):
    global _event_loop
    _event_loop = asyncio.get_running_loop()
    yield


app = FastAPI(title="Court STT Demo", lifespan=lifespan)


# ---------------------------------------------------------------------------
# WebSocket connection manager
# ---------------------------------------------------------------------------
async def _ws_broadcast(session_id: str, message: dict):
    """Send a JSON message to every browser connected to this session."""
    clients = _ws_clients.get(session_id, set())
    dead: Set[WebSocket] = set()
    payload = json.dumps(message, ensure_ascii=False)
    for ws in list(clients):
        try:
            await ws.send_text(payload)
        except Exception:
            dead.add(ws)
    clients -= dead


def _threadsafe_broadcast(session_id: str, message: dict):
    """Schedule a WebSocket broadcast from any thread (Azure SDK threads)."""
    if _event_loop and not _event_loop.is_closed():
        asyncio.run_coroutine_threadsafe(
            _ws_broadcast(session_id, message), _event_loop
        )


# ---------------------------------------------------------------------------
# Transcriber callbacks (called from Azure SDK threads)
# ---------------------------------------------------------------------------
def _make_result_callback(session_id: str):
    def on_result(entry: dict):
        # ── Real-time overlap detection ────────────────────────────────
        # utc_iso is when Azure returned the result ≈ end of utterance.
        # Start ≈ end − duration_sec.
        speaker = entry["speaker"]
        end_dt  = datetime.fromisoformat(entry["utc_iso"])
        dur     = float(entry.get("duration_sec") or 0)
        start_dt = end_dt - timedelta(seconds=dur)

        windows = _last_utterance_windows.setdefault(session_id, {})
        overlap_with = []
        for other_speaker, (o_start, o_end) in windows.items():
            if other_speaker == speaker:
                continue
            # Intervals overlap if start_i < end_j AND start_j < end_i
            if start_dt < o_end and o_start < end_dt:
                overlap_with.append(other_speaker)

        # Update window for this speaker
        windows[speaker] = (start_dt, end_dt)

        msg = {
            **entry,
            "type":         "result",
            "overlap":       bool(overlap_with),
            "overlap_with":  sorted(overlap_with),
        }
        _threadsafe_broadcast(session_id, msg)
    return on_result


def _make_status_callback(session_id: str):
    def on_status(speaker: str, event_type: str, text: str):
        msg = {
            "type": "status",
            "session_id": session_id,
            "speaker": speaker,
            "event": event_type,
            "text": text,
        }
        _threadsafe_broadcast(session_id, msg)
    return on_status


# ---------------------------------------------------------------------------
# REST API
# ---------------------------------------------------------------------------
@app.post("/api/session/new")
async def new_session():
    session_id = generate_session_id()
    meta = init_session(session_id, DEFAULT_SPEAKERS)
    _ws_clients[session_id] = set()
    _active_transcribers[session_id] = {}
    return {"session_id": session_id, "meta": meta, "colors": SPEAKER_COLORS}


@app.post("/api/session/{session_id}/start/{role}")
async def start_speaker(session_id: str, role: str):
    # Ensure session exists
    try:
        load_session_meta(session_id)
    except FileNotFoundError:
        init_session(session_id, DEFAULT_SPEAKERS)

    _ws_clients.setdefault(session_id, set())
    _active_transcribers.setdefault(session_id, {})

    if role in _active_transcribers[session_id]:
        return JSONResponse({"error": f"{role} is already recording"}, status_code=409)

    session_dir = get_session_dir(session_id)
    t = LiveTranscriber(
        session_id=session_id,
        speaker=role,
        session_dir=session_dir,
        on_result=_make_result_callback(session_id),
        on_status=_make_status_callback(session_id),
    )
    t.start()
    _active_transcribers[session_id][role] = t

    await _ws_broadcast(session_id, {
        "type": "status",
        "session_id": session_id,
        "speaker": role,
        "event": "started",
        "text": f"{role} microphone is live",
    })
    return {"status": "started", "role": role, "session_id": session_id}


@app.post("/api/session/{session_id}/stop/{role}")
async def stop_speaker(session_id: str, role: str):
    transcribers = _active_transcribers.get(session_id, {})
    t = transcribers.pop(role, None)
    if t is None:
        return JSONResponse({"error": f"{role} is not currently recording"}, status_code=404)

    # Stop in a thread pool so we don't block the event loop
    await asyncio.get_event_loop().run_in_executor(None, t.stop)

    await _ws_broadcast(session_id, {
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
        entries, overlaps = merge(session_id)
        if not entries:
            return [], []
        session_dir = get_session_dir(session_id)
        write_unified_json(entries, session_dir, overlaps, session_id)
        write_unified_text(entries, session_id, session_dir, overlaps)
        if mark_ended:
            end_session(session_id)
        return entries, overlaps

    entries, overlaps = await asyncio.get_event_loop().run_in_executor(None, _do_merge)

    # Broadcast the full merged timeline (+ overlaps) to all clients
    await _ws_broadcast(session_id, {
        "type":     "merged",
        "session_id": session_id,
        "entries":  entries,
        "overlaps": overlaps,
        "total":    len(entries),
    })
    return {
        "status":   "merged",
        "total":    len(entries),
        "overlaps": overlaps,
        "entries":  entries,
    }


@app.get("/api/session/{session_id}/status")
async def session_status(session_id: str):
    try:
        meta = load_session_meta(session_id)
    except FileNotFoundError:
        return JSONResponse({"error": "session not found"}, status_code=404)
    active = list(_active_transcribers.get(session_id, {}).keys())
    return {"meta": meta, "active_speakers": active, "colors": SPEAKER_COLORS}


# ---------------------------------------------------------------------------
# WebSocket endpoint
# ---------------------------------------------------------------------------
@app.websocket("/ws/{session_id}")
async def websocket_endpoint(websocket: WebSocket, session_id: str):
    await websocket.accept()
    _ws_clients.setdefault(session_id, set())
    _ws_clients[session_id].add(websocket)

    # Send immediate hello with current session state
    try:
        meta = load_session_meta(session_id)
        active = list(_active_transcribers.get(session_id, {}).keys())
        await websocket.send_text(json.dumps({
            "type": "hello",
            "session_id": session_id,
            "meta": meta,
            "active_speakers": active,
            "colors": SPEAKER_COLORS,
        }))
    except FileNotFoundError:
        pass

    try:
        while True:
            # Keep connection alive; client pings us with "ping"
            data = await websocket.receive_text()
            if data == "ping":
                await websocket.send_text(json.dumps({"type": "pong"}))
    except WebSocketDisconnect:
        _ws_clients.get(session_id, set()).discard(websocket)


# ---------------------------------------------------------------------------
# Static files & index
# ---------------------------------------------------------------------------
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


@app.get("/")
async def serve_index():
    return FileResponse(str(STATIC_DIR / "index.html"))


# ---------------------------------------------------------------------------
# Entry-point
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    uvicorn.run("server:app", host="0.0.0.0", port=8000, reload=False)
