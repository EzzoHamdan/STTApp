# Court Speech-to-Text — Proof of Concept

Real-time multi-speaker court transcription using **Azure Speech Services**.

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                     Court Session                            │
│                COURT-20260226-a3f7b1c2                       │
│                                                              │
│  ┌──────────┐   ┌──────────┐   ┌──────────┐                  │
│  │  Judge   │   │ Lawyer_1 │   │ Lawyer_2 │  ← 3 mics        │
│  │  (mic)   │   │  (mic)   │   │  (mic)   │                  │
│  └────┬─────┘   └────┬─────┘   └────┬─────┘                  │
│       │ sounddevice  │ sounddevice  │ sounddevice            │
│       ▼              ▼              ▼                        │
│  ┌────────────────────────────────────────┐                  │
│  │  PushAudioInputStream (per speaker)    │ ← one mic read,  │
│  │  ┌──────────────┐  ┌───────────────┐   │   two consumers  │
│  │  │ Azure STT    │  │  WAV Writer   │   │                  │
│  │  │  (online)    │  │  (local disk) │   │                  │
│  │  └──────┬───────┘  └──────┬────────┘   │                  │
│  └─────────┼─────────────────┼────────────┘                  │
│            ▼                 ▼                               │
│       <role>.jsonl      <role>_audio.wav  ← safety net       │
│            │                 │                               │
│            └────────┬────────┘                               │
│                     ▼                                        │
│               merge_transcripts.py                           │
│                     │                                        │ 
│                     ▼                                        │
│          unified_transcript.json                             │
│          unified_transcript.txt                              │
└──────────────────────────────────────────────────────────────┘
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
    Judge.jsonl                ← Judge's text transcript (JSONL)
    Judge_audio.wav            ← Judge's raw 16 kHz PCM audio backup  ★ NEW
    Lawyer_1.jsonl             ← Lawyer 1's text transcript (JSONL)
    Lawyer_1_audio.wav         ← Lawyer 1's raw audio backup           ★ NEW
    Lawyer_2.jsonl             ← Lawyer 2's text transcript (JSONL)
    Lawyer_2_audio.wav         ← Lawyer 2's raw audio backup           ★ NEW
    unified_transcript.json    ← merged transcript + overlap windows
    unified_transcript.txt     ← human-readable transcript with ⚡ annotations
```

## Simultaneous Speech Detection

When multiple speakers talk at the same time, the system detects these overlap periods and highlights them both in real-time and after merging.

### How it works

Each utterance has a known end-time (`utc_iso`) and duration (`duration_sec`), so the start time can be estimated:

```
start ≈ utc_iso − duration_sec
end   ≈ utc_iso
```

Two utterances from **different** speakers overlap when their intervals intersect:

```
start_A < end_B  AND  start_B < end_A
```

### Two detection modes

| Mode | When | How |
|---|---|---|
| **Real-time** | During live recording | Server compares each new result against other speakers' most-recent window; tags WS message with `overlap: true` immediately |
| **Post-hoc** | After pressing Merge | Full pairwise scan across all entries; overlapping intervals merged into contiguous windows; more accurate |

### What you see in the UI

- **⚡ badge** on any timeline row where that speaker was talking simultaneously with another
- Badge text shows which speakers overlapped, e.g. `⚡ Judge + Lawyer_1`
- **⚡ Simultaneous Speech Detected** summary panel appears below the timeline after merging, listing every overlap window with exact `start → end` times, duration, and involved speakers

### What you see in the text transcript

```
[Turn 4]  2026-02-26T10:06:52.600987+00:00  ⚡ OVERLAP with Lawyer_1
  Judge  (offset=4.3s  dur=1.8s)
  "لدي مرافعة."

════════════════════════════════════════════════════════════════════════
  SIMULTANEOUS SPEECH SUMMARY
════════════════════════════════════════════════════════════════════════
  [1] 2026-02-26T10:06:50.800987+00:00  →  2026-02-26T10:06:52.927668+00:00  (2.13s)  Speakers: Judge, Lawyer_1
```

## Audio Recording Safety Net

Every speaker session now records a **lossless WAV backup** in parallel with Azure STT.  The recording starts the moment `run_speaker.py` (or the server) launches and is finalised on clean exit or Ctrl+C.

### Why it matters

| Failure scenario | Before | After |
|---|---|---|  
| Azure network outage | Audio lost forever | WAV backup intact |
| Invalid API key / quota exhausted | Audio lost forever | WAV backup intact |
| No-speech / no-match from Azure | Utterance silently dropped | WAV backup intact |
| Process crash mid-session | Audio lost; JSONL may be partial | WAV intact up to crash point |

### How it works

`sounddevice` opens the microphone **once** at 16 kHz / 16-bit mono and feeds two consumers from the same callback:

1. **Azure `PushAudioInputStream`** — continues live STT exactly as before.
2. **WAV writer thread** — drains a thread-safe queue and writes PCM chunks directly into the WAV file, frame by frame, so even a hard kill leaves a valid (though possibly incomplete) file.

### Disabling recording

If you need to turn off WAV files (e.g. storage constraints), instantiate `LiveTranscriber` with `record_audio=False`:

```python
transcriber = LiveTranscriber(
    session_id=session_id,
    speaker=role,
    session_dir=session_dir,
    record_audio=False,   # skip WAV backup
)
```

### Re-transcribing a backup

Any standard tool (Azure Batch Transcription, Whisper, etc.) can consume the WAV files:

```bash
# Example: re-transcribe Judge's audio with Azure CLI batch
az cognitiveservices account ...
# or locally with Whisper:
whisper sessions/COURT-20260226-a3f7b1c2/Judge_audio.wav --language ar
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
| **Audio backup** | `sounddevice` captures 16 kHz PCM simultaneously; WAV is written incrementally so a crash mid-session still leaves a usable file |
| **Single mic read** | `PushAudioInputStream` lets one `sounddevice` callback feed both Azure STT and the WAV writer — no double-open device conflict |
| **Overlap detection** | Each utterance’s `[start, end]` interval (`utc_iso − duration_sec` → `utc_iso`) is compared across speakers; overlapping pairs are merged into windows and annotated in both real-time (server) and post-hoc (merge) |
| **Arabic support** | `ar-JO` (Jordanian Arabic) configured via `.env`, easily switchable |

## Files

| File | Purpose |
|---|---|
| `setup.ps1` | **Windows** one-command setup (venv + deps + .env) |
| `setup.sh` | **macOS/Linux** one-command setup (venv + deps + .env) |
| `.env.example` | Azure credentials template |
| `session_manager.py` | Generates unique session IDs, manages metadata |
| `transcriber.py` | Azure Speech SDK wrapper — real-time continuous recognition **+ parallel WAV recording** |
| `run_speaker.py` | CLI entry-point for a single speaker |
| `merge_transcripts.py` | Merges all speaker files into unified transcript **+ detects simultaneous-speech overlap windows** |
| `server.py` | FastAPI + WebSocket server for the web demo **+ real-time overlap tagging** |
| `static/index.html` | Live transcription demo webpage |
| `test_mic.py` | Microphone + Azure diagnostics |
| `launch_court_session.ps1` | Windows — opens 3 speaker terminals |
| `launch_court_session.bat` | Windows CMD — opens 3 speaker terminals |
| `launch_court_session.sh` | macOS/Linux — opens 3 speaker terminals |
