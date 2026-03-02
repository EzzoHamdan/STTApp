/**
 * Court session management — Node.js port of court_stt/session.py
 *
 * Handles session ID generation, metadata on disk, and transcript storage.
 */
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

const SESSIONS_DIR = path.resolve(process.cwd(), 'sessions');

// Ensure sessions root exists
if (!fs.existsSync(SESSIONS_DIR)) {
  fs.mkdirSync(SESSIONS_DIR, { recursive: true });
}

export const DEFAULT_SPEAKERS = ['Judge', 'Lawyer_1', 'Lawyer_2'];

export const SPEAKER_COLORS = {
  Judge: '#e0a020',
  Lawyer_1: '#4a9eda',
  Lawyer_2: '#5acc8a',
};

/**
 * Generate a unique, human-readable court session ID.
 * Format: COURT-YYYYMMDD-<8 hex chars>
 */
export function generateSessionId() {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  const d = String(now.getUTCDate()).padStart(2, '0');
  const shortId = uuidv4().replace(/-/g, '').slice(0, 8);
  return `COURT-${y}${m}${d}-${shortId}`;
}

/** Return (and create) the directory for a given session. */
export function getSessionDir(sessionId) {
  const dir = path.join(SESSIONS_DIR, sessionId);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/**
 * Initialise a new court session on disk.
 * @returns {object} session metadata
 */
export function initSession(sessionId, speakers = DEFAULT_SPEAKERS) {
  const sessionDir = getSessionDir(sessionId);
  const meta = {
    session_id: sessionId,
    created_utc: new Date().toISOString(),
    speakers,
    status: 'active',
    ended_utc: null,
  };
  fs.writeFileSync(
    path.join(sessionDir, 'session_meta.json'),
    JSON.stringify(meta, null, 2),
    'utf-8'
  );
  console.log(`[Session] ${sessionId} initialised (${speakers.length} speakers)`);
  return meta;
}

/** Load session metadata from disk. Returns null if not found. */
export function loadSessionMeta(sessionId) {
  const metaPath = path.join(getSessionDir(sessionId), 'session_meta.json');
  if (!fs.existsSync(metaPath)) return null;
  return JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
}

/** Mark a session as ended. */
export function endSession(sessionId) {
  const metaPath = path.join(getSessionDir(sessionId), 'session_meta.json');
  if (!fs.existsSync(metaPath)) return;
  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
  meta.status = 'ended';
  meta.ended_utc = new Date().toISOString();
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf-8');
  console.log(`[Session] ${sessionId} ended`);
}

/** Append a transcript entry to a speaker's JSONL file. */
export function appendEntry(sessionId, speaker, entry) {
  const sessionDir = getSessionDir(sessionId);
  const jsonlPath = path.join(sessionDir, `${speaker}.jsonl`);
  fs.appendFileSync(jsonlPath, JSON.stringify(entry) + '\n', 'utf-8');
}

/** Load all entries from a speaker's JSONL file. */
export function loadSpeakerEntries(sessionId, speaker) {
  const jsonlPath = path.join(getSessionDir(sessionId), `${speaker}.jsonl`);
  if (!fs.existsSync(jsonlPath)) return [];
  return fs
    .readFileSync(jsonlPath, 'utf-8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}
