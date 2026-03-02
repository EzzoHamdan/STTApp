/**
 * Court transcript merger — Node.js port of court_stt/merge.py
 *
 * Merges multi-speaker JSONL transcripts into a unified timeline
 * with overlap detection.
 */
import fs from 'fs';
import path from 'path';
import {
  getSessionDir,
  loadSessionMeta,
  loadSpeakerEntries,
  endSession,
} from './sessions.js';

// ── Pure functions ──────────────────────────────────────────────────

/**
 * Return [startDate, endDate] for an utterance entry.
 * utc_iso ≈ end of utterance; start ≈ end − duration_sec.
 */
function utteranceInterval(entry) {
  const end = new Date(entry.utc_iso);
  const dur = parseFloat(entry.duration_sec) || 0;
  const start = new Date(end.getTime() - dur * 1000);
  return [start, end];
}

/**
 * Annotate entries in-place with overlap metadata and return
 * merged overlap windows.
 */
export function detectOverlaps(entries) {
  const n = entries.length;
  const overlapSets = Array.from({ length: n }, () => new Set());

  for (let i = 0; i < n; i++) {
    const [sI, eI] = utteranceInterval(entries[i]);
    for (let j = i + 1; j < n; j++) {
      const [sJ, eJ] = utteranceInterval(entries[j]);
      if (sJ >= eI) break;
      if (entries[i].speaker === entries[j].speaker) continue;
      if (sI < eJ && sJ < eI) {
        overlapSets[i].add(entries[j].speaker);
        overlapSets[j].add(entries[i].speaker);
      }
    }
  }

  // Annotate entries
  entries.forEach((entry, i) => {
    entry.overlap = overlapSets[i].size > 0;
    entry.overlap_with = [...overlapSets[i]].sort();
  });

  // Build & merge overlap windows
  const rawIntervals = [];
  entries.forEach((entry, i) => {
    if (entry.overlap) {
      const [s, e] = utteranceInterval(entry);
      const speakers = new Set([entry.speaker, ...overlapSets[i]]);
      rawIntervals.push({ start: s, end: e, speakers });
    }
  });

  if (rawIntervals.length === 0) return [];

  rawIntervals.sort((a, b) => a.start - b.start);
  const merged = [];
  let cur = { ...rawIntervals[0], speakers: new Set(rawIntervals[0].speakers) };

  for (let k = 1; k < rawIntervals.length; k++) {
    const ri = rawIntervals[k];
    if (ri.start <= cur.end) {
      cur.end = new Date(Math.max(cur.end.getTime(), ri.end.getTime()));
      ri.speakers.forEach((s) => cur.speakers.add(s));
    } else {
      merged.push({
        start_iso: cur.start.toISOString(),
        end_iso: cur.end.toISOString(),
        duration_sec: Math.round(((cur.end - cur.start) / 1000) * 100) / 100,
        speakers: [...cur.speakers].sort(),
      });
      cur = { ...ri, speakers: new Set(ri.speakers) };
    }
  }
  merged.push({
    start_iso: cur.start.toISOString(),
    end_iso: cur.end.toISOString(),
    duration_sec: Math.round(((cur.end - cur.start) / 1000) * 100) / 100,
    speakers: [...cur.speakers].sort(),
  });

  return merged;
}

/** Sort entries by utc_iso and assign sequential turn numbers. */
export function sortAndNumber(entries) {
  entries.sort((a, b) => (a.utc_iso < b.utc_iso ? -1 : a.utc_iso > b.utc_iso ? 1 : 0));
  entries.forEach((e, i) => {
    e.turn = i + 1;
  });
  return entries;
}

// ── High-level merge ────────────────────────────────────────────────

/**
 * Merge all speaker transcripts for a session.
 * @returns {{ entries: object[], overlaps: object[] }}
 */
export function mergeSession(sessionId) {
  const meta = loadSessionMeta(sessionId);
  if (!meta) {
    console.warn(`[Merger] Session ${sessionId} not found`);
    return { entries: [], overlaps: [] };
  }

  let allEntries = [];
  for (const speaker of meta.speakers) {
    const speakerEntries = loadSpeakerEntries(sessionId, speaker);
    allEntries.push(...speakerEntries);
    console.log(`[Merger] Loaded ${speakerEntries.length} entries for ${speaker}`);
  }

  if (allEntries.length === 0) {
    console.warn(`[Merger] No entries for session ${sessionId}`);
    return { entries: [], overlaps: [] };
  }

  sortAndNumber(allEntries);
  const overlaps = detectOverlaps(allEntries);

  if (overlaps.length > 0) {
    console.log(`[Merger] ${overlaps.length} overlap period(s) detected`);
  }

  return { entries: allEntries, overlaps };
}

/**
 * Merge, write output files, and optionally end the session.
 * @returns {{ entries: object[], overlaps: object[] }}
 */
export function mergeAndWrite(sessionId, markEnded = false) {
  const { entries, overlaps } = mergeSession(sessionId);
  if (entries.length === 0) return { entries, overlaps };

  const sessionDir = getSessionDir(sessionId);

  // Write unified JSON
  const jsonPayload = {
    session_id: sessionId,
    generated_utc: new Date().toISOString(),
    total_turns: entries.length,
    overlap_periods: overlaps.length,
    overlaps,
    entries,
  };
  fs.writeFileSync(
    path.join(sessionDir, 'unified_transcript.json'),
    JSON.stringify(jsonPayload, null, 2),
    'utf-8'
  );

  // Write unified text
  const lines = [];
  lines.push('='.repeat(72));
  lines.push('  UNIFIED COURT TRANSCRIPT');
  lines.push(`  Session: ${sessionId}`);
  lines.push(`  Generated: ${new Date().toISOString()}`);
  if (overlaps.length) {
    lines.push(`  Simultaneous speech detected: ${overlaps.length} period(s)`);
  }
  lines.push('='.repeat(72));
  lines.push('');
  for (const entry of entries) {
    const overlapTag = entry.overlap
      ? `  [OVERLAP with ${entry.overlap_with.join(', ')}]`
      : '';
    lines.push(`[Turn ${entry.turn}]  ${entry.utc_iso}${overlapTag}`);
    lines.push(
      `  ${entry.speaker}  (offset=${entry.offset_sec ?? '?'}s  dur=${entry.duration_sec ?? '?'}s)`
    );
    lines.push(`  "${entry.text}"`);
    lines.push('');
  }
  if (overlaps.length) {
    lines.push('='.repeat(72));
    lines.push('  SIMULTANEOUS SPEECH SUMMARY');
    lines.push('='.repeat(72));
    overlaps.forEach((w, i) => {
      lines.push(
        `  [${i + 1}] ${w.start_iso}  ->  ${w.end_iso}  (${w.duration_sec}s)  Speakers: ${w.speakers.join(', ')}`
      );
    });
    lines.push('');
  }
  lines.push('='.repeat(72));
  lines.push('  END OF TRANSCRIPT');
  lines.push('='.repeat(72));
  fs.writeFileSync(
    path.join(sessionDir, 'unified_transcript.txt'),
    lines.join('\n'),
    'utf-8'
  );

  if (markEnded) {
    endSession(sessionId);
  }

  console.log(`[Merger] Wrote unified files for ${sessionId}`);
  return { entries, overlaps };
}
