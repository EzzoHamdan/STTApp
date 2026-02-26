# Court Speech-to-Text — Proof of Concept

Real-time multi-speaker court transcription using **Azure Speech Services**.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                  Court Session                          │
│              COURT-20260226-a3f7b1c2                    │
│                                                         │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐               │
│  │  Judge   │  │ Lawyer_1 │  │ Lawyer_2 │  ← 3 mics     │
│  │  (mic)   │  │  (mic)   │  │  (mic)   │               │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘               │
│       │              │              │                   │
│       ▼              ▼              ▼                   │
│  Judge.jsonl   Lawyer_1.jsonl  Lawyer_2.jsonl           │
│       │              │              │                   │
│       └──────────────┼──────────────┘                   │
│                      ▼                                  │
│          merge_transcripts.py                           │
│                      │                                  │
│                      ▼                                  │
│         unified_transcript.json                         │
│         unified_transcript.txt                          │
└─────────────────────────────────────────────────────────┘
```

## Quick Start

### 1. One-command setup (Windows or macOS/Linux)

**Windows (PowerShell):**
```powershell
.\setup.ps1
```

**macOS / Linux:**
```bash
chmod +x setup.sh && ./setup.sh
```

The script will:
- Check for Python 3.10+
- Create a `.venv` virtual environment
- Install all dependencies
- Create a `.env` template if one doesn't exist

### 2. Configure `.env`

Fill in your Azure credentials (the script creates `.env` automatically):
```env
AZURE_SPEECH_KEY=your_key_here
AZURE_SPEECH_REGION=uaenorth
AZURE_SPEECH_LANGUAGE=ar-JO
```

### 3. Start the web app

**Windows:**
```powershell
.venv\Scripts\Activate.ps1
python server.py
```

**macOS / Linux:**
```bash
source .venv/bin/activate
python server.py
```

Then open [http://localhost:8000](http://localhost:8000) in your browser.

### 4. Launch a court session (all 3 speakers)

**PowerShell (recommended):**
```powershell
.\launch_court_session.ps1
```

**Or CMD:**
```cmd
launch_court_session.bat
```

This opens **3 terminal windows** — one for Judge, Lawyer_1, and Lawyer_2 — all sharing the same session ID.

### 4. Run a single speaker manually

```bash
# Create a new session as Judge
python run_speaker.py --role Judge

# Join existing session as Lawyer_1
python run_speaker.py --role Lawyer_1 --session COURT-20260226-a3f7b1c2
```

### 5. Merge transcripts

After all speakers stop (Ctrl+C), merge into a unified timeline:

```bash
python merge_transcripts.py --session COURT-20260226-a3f7b1c2 --end
```

## Output Structure

```
sessions/
  COURT-20260226-a3f7b1c2/
    session_meta.json          ← session metadata (speakers, timestamps)
    Judge.jsonl                ← Judge's raw transcript
    Lawyer_1.jsonl             ← Lawyer 1's raw transcript
    Lawyer_2.jsonl             ← Lawyer 2's raw transcript
    unified_transcript.json    ← merged, sorted by timestamp
    unified_transcript.txt     ← human-readable merged transcript
```

## Transcript Entry Format

Each utterance in the JSONL files:

```json
{
    "session_id":    "COURT-20260226-a3f7b1c2",
    "speaker":       "Judge",
    "utc_iso":       "2026-02-26T10:05:32.123456+00:00",
    "offset_ticks":  43250000,
    "offset_sec":    4.325,
    "duration_sec":  2.15,
    "text":          "الجلسة مفتوحة"
}
```

## Key Design Decisions

| Concern | Solution |
|---|---|
| **Unique session ID** | `COURT-<YYYYMMDD>-<8-char UUID>` — date-prefixed, UUID-suffixed, zero collision risk |
| **Speaker isolation** | Each speaker writes to its own `.jsonl` file — no shared state, no locks |
| **Timestamp precision** | Wall-clock UTC ISO-8601 + Azure SDK offset/duration (100ns ticks) |
| **Collision handling** | When speakers talk simultaneously, each utterance keeps its own timestamp; the merger sorts them chronologically |
| **Crash safety** | Each utterance is appended to JSONL immediately — partial data is never lost |
| **Arabic support** | `ar-JO` (Jordanian Arabic) configured via `.env`, easily switchable |

## Files

| File | Purpose |
|---|---|
| `setup.ps1` | **Windows** one-command setup (venv + deps + .env) |
| `setup.sh` | **macOS/Linux** one-command setup (venv + deps + .env) |
| `.env.example` | Azure credentials template |
| `session_manager.py` | Generates unique session IDs, manages metadata |
| `transcriber.py` | Azure Speech SDK wrapper — real-time continuous recognition |
| `run_speaker.py` | CLI entry-point for a single speaker |
| `merge_transcripts.py` | Merges all speaker files into unified transcript |
| `server.py` | FastAPI + WebSocket server for the web demo |
| `static/index.html` | Live transcription demo webpage |
| `test_mic.py` | Microphone + Azure diagnostics |
| `launch_court_session.ps1` | Windows — opens 3 speaker terminals |
| `launch_court_session.bat` | Windows CMD — opens 3 speaker terminals |
| `launch_court_session.sh` | macOS/Linux — opens 3 speaker terminals |
