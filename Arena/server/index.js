import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { config } from 'dotenv';
import { URL } from 'url';
import cors from 'cors';
import { createDeepgramSession } from './providers/deepgram.js';
import { createSonioxSession } from './providers/soniox.js';
import { createSpeechmaticsSession } from './providers/speechmatics.js';
import { createMunsitSession } from './providers/munsit.js';
import { createAzureSession } from './providers/azure.js';
import {
  generateSessionId,
  initSession,
  loadSessionMeta,
  appendEntry,
  DEFAULT_SPEAKERS,
  SPEAKER_COLORS,
} from './court/sessions.js';
import { mergeAndWrite } from './court/merger.js';

config();

const app = express();
app.use(cors());
app.use(express.json());

// ── Court session state (in-memory) ─────────────────────────────────
// Maps sessionId → { wsClients: Set<ws>, transcribers: Map<role, azureSession>, lastUtteranceWindows: Map }
const courtSessions = new Map();

// ── API key status (check which keys are configured) ────────────────
app.get('/api/keys/status', (req, res) => {
  res.json({
    deepgram: !!process.env.DEEPGRAM_API_KEY,
    munsit: !!process.env.MUNSIT_API_KEY,
    soniox: !!process.env.SONIOX_API_KEY,
    speechmatics: !!process.env.SPEECHMATICS_API_KEY,
  });
});

// ── Runtime key update (session-only, does not persist to .env) ─────
app.post('/api/keys', (req, res) => {
  const { deepgram, munsit, soniox, speechmatics } = req.body;
  if (deepgram !== undefined) process.env.DEEPGRAM_API_KEY = deepgram;
  if (munsit !== undefined) process.env.MUNSIT_API_KEY = munsit;
  if (soniox !== undefined) process.env.SONIOX_API_KEY = soniox;
  if (speechmatics !== undefined) process.env.SPEECHMATICS_API_KEY = speechmatics;
  res.json({ ok: true });
});

// ── Court REST API ──────────────────────────────────────────────────

app.post('/api/court/session/new', (req, res) => {
  const sessionId = generateSessionId();
  const meta = initSession(sessionId, DEFAULT_SPEAKERS);
  courtSessions.set(sessionId, {
    wsClients: new Set(),
    transcribers: new Map(),
    lastUtteranceWindows: new Map(),
  });
  res.json({ session_id: sessionId, meta, colors: SPEAKER_COLORS });
});

app.post('/api/court/session/:id/merge', (req, res) => {
  const sessionId = req.params.id;
  try {
    const { entries, overlaps } = mergeAndWrite(sessionId);

    // Broadcast merged result to all WS clients
    const session = courtSessions.get(sessionId);
    if (session) {
      const msg = JSON.stringify({
        type: 'merged',
        session_id: sessionId,
        entries,
        overlaps,
        total: entries.length,
      });
      session.wsClients.forEach((ws) => {
        if (ws.readyState === WebSocket.OPEN) ws.send(msg);
      });
    }

    res.json({ status: 'merged', total: entries.length, overlaps, entries });
  } catch (err) {
    console.error('[Court] Merge failed:', err);
    res.status(500).json({ error: 'Merge failed' });
  }
});

app.get('/api/court/session/:id/status', (req, res) => {
  const sessionId = req.params.id;
  const meta = loadSessionMeta(sessionId);
  if (!meta) return res.status(404).json({ error: 'Session not found' });
  const session = courtSessions.get(sessionId);
  const activeSpeakers = session ? [...session.transcribers.keys()] : [];
  res.json({ meta, active_speakers: activeSpeakers, colors: SPEAKER_COLORS });
});

app.get('/api/court/keys/status', (req, res) => {
  res.json({
    azure: !!process.env.AZURE_SPEECH_KEY,
  });
});

// ── HTTP + WebSocket server ─────────────────────────────────────────
const server = createServer(app);
const wss = new WebSocketServer({ noServer: true });

const providers = {
  deepgram: createDeepgramSession,
  munsit: createMunsitSession,
  soniox: createSonioxSession,
  speechmatics: createSpeechmaticsSession,
};

server.on('upgrade', (request, socket, head) => {
  const url = new URL(request.url, `http://${request.headers.host}`);

  // ── Arena provider WebSocket: /ws/<provider> ──────────────────────
  const arenaMatch = url.pathname.match(/^\/ws\/(\w+)$/);
  if (arenaMatch && providers[arenaMatch[1]]) {
    wss.handleUpgrade(request, socket, head, (ws) => {
      const provider = arenaMatch[1];
      console.log(`[${provider}] Client connected`);

      const session = providers[provider](ws, process.env);

      ws.on('message', (data, isBinary) => {
        if (isBinary) {
          session.sendAudio(data);
        } else {
          try {
            const msg = JSON.parse(data.toString());
            if (msg.type === 'start') {
              session.start(msg.config || {});
            } else if (msg.type === 'stop') {
              session.stop();
            }
          } catch (e) {
            console.error(`[${provider}] Invalid message:`, e.message);
          }
        }
      });

      ws.on('close', () => {
        console.log(`[${provider}] Client disconnected`);
        session.stop();
      });

      ws.on('error', (err) => {
        console.error(`[${provider}] WS error:`, err.message);
        session.stop();
      });
    });
    return;
  }

  // ── Court session WebSocket: /ws/court/<sessionId> ────────────────
  const courtMatch = url.pathname.match(/^\/ws\/court\/([A-Za-z0-9_-]+)$/);
  if (courtMatch) {
    wss.handleUpgrade(request, socket, head, (ws) => {
      const sessionId = courtMatch[1];
      console.log(`[Court] WS client connected for session ${sessionId}`);

      // Ensure session state exists
      if (!courtSessions.has(sessionId)) {
        courtSessions.set(sessionId, {
          wsClients: new Set(),
          transcribers: new Map(),
          lastUtteranceWindows: new Map(),
        });
      }
      const session = courtSessions.get(sessionId);
      session.wsClients.add(ws);

      // Track which speaker this connection is actively streaming for
      let activeSpeaker = null;

      // Send hello with session info
      const meta = loadSessionMeta(sessionId);
      const activeSpeakers = [...session.transcribers.keys()];
      ws.send(
        JSON.stringify({
          type: 'hello',
          session_id: sessionId,
          meta,
          active_speakers: activeSpeakers,
          colors: SPEAKER_COLORS,
        })
      );

      // Helper: broadcast to all clients in this session
      function broadcast(msg) {
        const payload = typeof msg === 'string' ? msg : JSON.stringify(msg);
        session.wsClients.forEach((client) => {
          if (client.readyState === WebSocket.OPEN) client.send(payload);
        });
      }

      ws.on('message', (data, isBinary) => {
        if (isBinary) {
          // Route binary audio to the active speaker's Azure recognizer
          if (activeSpeaker && session.transcribers.has(activeSpeaker)) {
            session.transcribers.get(activeSpeaker).sendAudio(data);
          }
          return;
        }

        // Text messages: control commands
        const raw = data.toString();
        if (raw === 'ping') {
          ws.send(JSON.stringify({ type: 'pong' }));
          return;
        }

        try {
          const msg = JSON.parse(raw);

          if (msg.type === 'start-speaker') {
            const role = msg.role;
            if (session.transcribers.has(role)) {
              ws.send(JSON.stringify({ type: 'error', message: `${role} is already recording` }));
              return;
            }

            const azureSession = createAzureSession(sessionId, role, process.env, {
              onResult(entry) {
                // Persist to JSONL
                appendEntry(sessionId, role, entry);

                // Compute real-time overlap
                const endDt = new Date(entry.utc_iso);
                const dur = parseFloat(entry.duration_sec) || 0;
                const startDt = new Date(endDt.getTime() - dur * 1000);

                const windows = session.lastUtteranceWindows;
                const overlapWith = [];
                for (const [otherSpeaker, [oStart, oEnd]] of windows.entries()) {
                  if (otherSpeaker === role) continue;
                  if (startDt < oEnd && oStart < endDt) {
                    overlapWith.push(otherSpeaker);
                  }
                }
                windows.set(role, [startDt, endDt]);

                broadcast({
                  ...entry,
                  type: 'result',
                  overlap: overlapWith.length > 0,
                  overlap_with: overlapWith.sort(),
                });
              },
              onPartial(text) {
                broadcast({ type: 'partial', speaker: role, text });
              },
              onStatus(event, text) {
                broadcast({
                  type: 'status',
                  session_id: sessionId,
                  speaker: role,
                  event,
                  text,
                });
              },
              onError(errorText) {
                broadcast({
                  type: 'status',
                  session_id: sessionId,
                  speaker: role,
                  event: 'error',
                  text: String(errorText),
                });
              },
            });

            if (azureSession) {
              session.transcribers.set(role, azureSession);
              activeSpeaker = role;
            }
          } else if (msg.type === 'stop-speaker') {
            const role = msg.role;
            const transcriber = session.transcribers.get(role);
            if (transcriber) {
              transcriber.stop().then((entries) => {
                session.transcribers.delete(role);
                if (activeSpeaker === role) activeSpeaker = null;
                broadcast({
                  type: 'status',
                  session_id: sessionId,
                  speaker: role,
                  event: 'stopped',
                  text: `${role} stopped. ${entries.length} utterances saved.`,
                });
              });
            }
          } else if (msg.type === 'set-active-speaker') {
            // Switch which speaker receives audio from this connection
            activeSpeaker = msg.role;
          }
        } catch (e) {
          console.error('[Court] Invalid WS message:', e.message);
        }
      });

      ws.on('close', () => {
        console.log(`[Court] WS client disconnected from session ${sessionId}`);
        session.wsClients.delete(ws);
      });

      ws.on('error', (err) => {
        console.error(`[Court] WS error:`, err.message);
        session.wsClients.delete(ws);
      });
    });
    return;
  }

  // No match — destroy
  socket.destroy();
});

// ── Start ───────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`\n⚡ Arabic STT Court & Arena on port ${PORT}`);
  console.log(`  Arena WebSocket endpoints:`);
  console.log(`    /ws/deepgram`);
  console.log(`    /ws/munsit`);
  console.log(`    /ws/soniox`);
  console.log(`    /ws/speechmatics`);
  console.log(`  Court WebSocket:`);
  console.log(`    /ws/court/<sessionId>\n`);

  const keys = [
    'DEEPGRAM_API_KEY',
    'MUNSIT_API_KEY',
    'SONIOX_API_KEY',
    'SPEECHMATICS_API_KEY',
    'AZURE_SPEECH_KEY',
    'AZURE_SPEECH_REGION',
  ];
  keys.forEach((k) => {
    const status = process.env[k] ? '✓ configured' : '✗ missing';
    console.log(`  ${k}: ${status}`);
  });
  console.log('');
});
