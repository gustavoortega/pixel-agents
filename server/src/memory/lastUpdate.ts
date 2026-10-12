import { DAY_MS, LAST_UPDATE_WINDOW_DAYS } from './constants.js';
import { parseLine, timestampMs, toolResults, toolUses } from './digest.js';
import { type Budget, type Candidate, scanLines } from './reader.js';

/**
 * since "last_update": the newest sprint-update run that was delivered. A run is a successful Skill call to the
 * sprint-update skill (any namespace or suffix) followed later in the same main transcript by a successful
 * clipboard command, which is how that skill hands its entries over. The delivery condition is what keeps the
 * run that is calling this tool right now (still undelivered) from setting since = now.
 */

const SPRINT_UPDATE_SKILL_RE = /^(?:[\w.-]+:)?sprint-update(?:-[\w-]+)?$/i;
const CLIPBOARD_RE = /\b(pbcopy|xclip|xsel|wl-copy|clip\.exe)\b/;
const PREFILTERS = ['"Skill"', 'pbcopy', 'xclip', 'xsel', 'wl-copy', 'clip.exe'].map((s) =>
  Buffer.from(s),
);

export type LastUpdate =
  { kind: 'found'; atMs: number; id8: string } | { kind: 'none' } | { kind: 'exhausted' };

/** The newest delivered run in one transcript, or null; undefined when the budget cut the scan. */
async function deliveredRunIn(
  c: Candidate,
  budget: Budget,
  inScope: (cwd: string | null) => boolean,
): Promise<number | null | undefined> {
  const pending = new Map<
    string,
    { kind: 'skill' | 'clip'; atMs: number | null; needle: Buffer }
  >();
  let lastRunMs: number | null = null;
  let delivered: number | null = null;
  let scopeKnown = false;
  let outOfScope = false;

  const onRecord = (r: Record<string, unknown>): void => {
    for (const use of toolUses(r)) {
      if (use.name === 'Skill' && SPRINT_UPDATE_SKILL_RE.test(String(use.input['skill'] ?? ''))) {
        pending.set(use.id, { kind: 'skill', atMs: timestampMs(r), needle: Buffer.from(use.id) });
      } else if (use.name === 'Bash' && CLIPBOARD_RE.test(String(use.input['command'] ?? ''))) {
        pending.set(use.id, { kind: 'clip', atMs: null, needle: Buffer.from(use.id) });
      }
    }
    for (const result of toolResults(r)) {
      const call = pending.get(result.toolUseId);
      if (!call) continue;
      pending.delete(result.toolUseId);
      if (result.isError) continue;
      if (call.kind === 'skill' && call.atMs !== null) lastRunMs = call.atMs;
      if (call.kind === 'clip' && lastRunMs !== null) delivered = lastRunMs;
    }
  };

  const complete = await scanLines(c.file, budget, (line) => {
    if (outOfScope) return;
    if (!scopeKnown) {
      const r = parseLine(line);
      if (r && (r['type'] === 'user' || r['type'] === 'assistant')) {
        scopeKnown = true;
        const cwd = typeof r['cwd'] === 'string' ? r['cwd'] : null;
        if (!inScope(cwd)) {
          outOfScope = true;
          return;
        }
      }
      if (r) onRecord(r);
      return;
    }
    const wanted =
      PREFILTERS.some((needle) => line.includes(needle)) ||
      [...pending.values()].some((p) => line.includes(p.needle));
    if (!wanted) return;
    const r = parseLine(line);
    if (r) onRecord(r);
  });
  // A file that could not be opened (gone, unreadable) holds no run; only a budget stop is undefined.
  if (complete === null || outOfScope || (!scopeKnown && complete)) return null;
  return complete ? delivered : undefined;
}

/** Scan main transcripts newest first, stopping once a file is older than the best run found. */
export async function findLastUpdate(
  candidates: Candidate[],
  nowMs: number,
  budget: Budget,
  inScope: (cwd: string | null) => boolean,
): Promise<LastUpdate> {
  const windowStart = nowMs - LAST_UPDATE_WINDOW_DAYS * DAY_MS;
  const files = candidates
    .filter((c) => c.mtimeMs >= windowStart)
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  let best: { atMs: number; id8: string } | null = null;
  for (const c of files) {
    if (best && c.mtimeMs < best.atMs) break;
    const atMs = await deliveredRunIn(c, budget, inScope);
    if (atMs === undefined) return { kind: 'exhausted' };
    if (atMs !== null && atMs >= windowStart && (!best || atMs > best.atMs)) {
      best = { atMs, id8: c.sessionId.slice(0, 8) };
    }
  }
  return best ? { kind: 'found', ...best } : { kind: 'none' };
}
