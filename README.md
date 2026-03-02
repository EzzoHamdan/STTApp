# Arabic STT Platform

Unified real-time Arabic speech-to-text platform with two modes:

- **Court Transcription** â€” Multi-speaker court recording with Azure Speech Services, unified timeline, and overlap detection
- **STT Arena** â€” Side-by-side comparison of 4 Arabic STT providers (Deepgram, Munsit, Soniox, Speechmatics)

Built with React + Vite (frontend) and Express + WebSocket (backend).

## Project Structure

```
server/                     â† Express + WebSocket backend
  index.js                  â† Main server (REST + WS endpoints)
  providers/
    azure.js                â† Azure Speech continuous recognition
    deepgram.js             â† Deepgram Nova-3 streaming
    munsit.js               â† Munsit REST batch
    soniox.js               â† Soniox streaming
    speechmatics.js         â† Speechmatics RT streaming
  court/
    sessions.js             â† Session lifecycle & JSONL persistence
    merger.js               â† Multi-speaker transcript merge + overlap detection
src/                        â† React SPA
  App.jsx                   â† Tab navigation (Court / Arena)
  pages/
    CourtView.jsx           â† Court transcription UI
    ArenaView.jsx           â† 4-provider comparison UI
  components/               â† Shared UI components
  hooks/                    â† Audio capture, STT WebSocket, court session hooks
index.html                  â† SPA entry point
vite.config.js              â† Vite config with dev proxy
Dockerfile                  â† Multi-stage production Docker build
.env.example                â† Environment variable template
```

## Quick Start

### Prerequisites

- Node.js 18+
- At least one API key (Azure for Court, any provider for Arena)

### Setup

```bash
git clone <repo-url> && cd court-transcription
npm install
cp .env.example .env       # Edit .env with your API keys
```

### Development

```bash
npm run dev                 # Starts server + Vite dev server
```

Open [http://localhost:5173](http://localhost:5173).

### Production

```bash
npm run build               # Build the React frontend
npm start                   # Serve everything from Express
```

Or with Docker:

```bash
docker build -t arabic-stt .
docker run -p 3001:3001 --env-file .env arabic-stt
```

Open [http://localhost:3001](http://localhost:3001).

## API Keys

| Provider | Purpose | Sign up |
|---|---|---|
| **Azure Speech** | Court transcription (required) | [portal.azure.com](https://portal.azure.com) |
| Deepgram Nova-3 | Arena provider | [console.deepgram.com](https://console.deepgram.com) |
| Munsit | Arena provider | [app.cntxt.tools](https://app.cntxt.tools) |
| Soniox | Arena provider | [soniox.com](https://soniox.com) |
| Speechmatics | Arena provider | [portal.speechmatics.com](https://portal.speechmatics.com) |

Set keys in `.env` (persistent) or via the Arena UI's key settings (session-only).

## API Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/health` | Health check |
| `GET` | `/api/keys/status` | Which arena provider keys are configured |
| `POST` | `/api/keys` | Update arena keys at runtime |
| `GET` | `/api/court/keys/status` | Azure key status |
| `POST` | `/api/court/session/new` | Create a new court session |
| `POST` | `/api/court/session/:id/merge` | Merge & download session transcript |
| `GET` | `/api/court/session/:id/status` | Session metadata |
| `WS` | `/ws/{provider}` | Arena streaming (deepgram, munsit, soniox, speechmatics) |
| `WS` | `/ws/court/{sessionId}` | Court live transcription |

## Environment Variables

See [.env.example](.env.example) for the full list. Key variables:

| Variable | Required | Default | Description |
|---|---|---|---|
| `AZURE_SPEECH_KEY` | For Court mode | â€” | Azure Speech Services key |
| `AZURE_SPEECH_REGION` | For Court mode | `eastus` | Azure region |
| `AZURE_SPEECH_LANGUAGE` | No | `ar-JO` | Recognition language |
| `PORT` | No | `3001` | Server port |
| `NODE_ENV` | No | â€” | Set to `production` for prod builds |
| `CORS_ORIGINS` | No | `*` (all) | Comma-separated allowed origins |

## Session Output

```
sessions/
  COURT-20260302-a3f7b1c2/
    session_meta.json          â† Session metadata (speakers, timestamps)
    Judge.jsonl                â† Judge's transcript (JSONL, one entry per utterance)
    Lawyer_1.jsonl             â† Lawyer 1's transcript
    Lawyer_2.jsonl             â† Lawyer 2's transcript
    unified_transcript.json    â† Merged transcript + overlap windows
    unified_transcript.txt     â† Human-readable transcript
```

## License

Private â€” all rights reserved.
