import {
  TOKEN_LEDGER_BLOCK_MS,
  TOKEN_LEDGER_TOP_SESSIONS,
  TOKEN_LEDGER_WEEK_MS,
} from './constants.js';

/**
 * Pure math of the token ledger: weighting, window selection and per-area / per-session totals. No IO and no clock
 * (`now` is always a parameter) so every rule is a table test.
 */

/** [input, cache-creation, cache-read, output] raw token counts. */
export type Usage4 = [number, number, number, number];

/** One deduplicated message. `s` + `x` are every session that carried this message id; the owner is picked at
 *  aggregation time against the final session-first-timestamp map, so it never depends on scan order. */
export interface LedgerRecord {
  ts: number;
  s: string;
  x?: string[];
  /** Folder name derived from the project directory. */
  f: string;
  m: string;
  u: Usage4;
}

export interface QuotaAnchor {
  ts: number;
  resetsAt: number;
}
export interface QuotaState {
  block?: QuotaAnchor;
  week?: QuotaAnchor;
}

export interface WindowSpec {
  source: 'quota' | 'estimated';
  start: number;
  end: number;
}

/** Weights are Anthropic's published price ratios relative to input (cache write 1.25x, cache read 0.1x, output 5x).
 *  No per-model multiplier: those are not known here. */
export function weightedTokens(u: Usage4): number {
  return u[0] + 1.25 * u[1] + 0.1 * u[2] + 5 * u[3];
}

export function rawTokens(u: Usage4): number {
  return u[0] + u[1] + u[2] + u[3];
}

const HOUR_MS = 60 * 60 * 1000;

export interface Block<T> {
  start: number;
  end: number;
  items: T[];
}

/** ccusage-style blocks over timestamp-sorted items: a block starts at its first item's timestamp floored to the
 *  hour and lasts 5 h; an item at or after the end starts the next block. */
export function groupBlocks<T extends { ts: number }>(sorted: readonly T[]): Block<T>[] {
  const blocks: Block<T>[] = [];
  for (const item of sorted) {
    const last = blocks[blocks.length - 1];
    if (last && item.ts < last.end) {
      last.items.push(item);
      continue;
    }
    const start = Math.floor(item.ts / HOUR_MS) * HOUR_MS;
    blocks.push({ start, end: start + TOKEN_LEDGER_BLOCK_MS, items: [item] });
  }
  return blocks;
}

/** The windows to report. `block` is absent (not zero) when `now` falls outside every block and no live quota says
 *  otherwise. A quota anchor in the past is ignored. */
export function resolveWindows(
  sortedTs: readonly number[],
  quota: QuotaState,
  now: number,
): { block?: WindowSpec; week: WindowSpec } {
  let block: WindowSpec | undefined;
  if (quota.block && quota.block.resetsAt > now) {
    block = {
      source: 'quota',
      start: quota.block.resetsAt - TOKEN_LEDGER_BLOCK_MS,
      end: quota.block.resetsAt,
    };
  } else {
    const current = groupBlocks(sortedTs.map((ts) => ({ ts }))).find(
      (b) => b.start <= now && now < b.end,
    );
    if (current) block = { source: 'estimated', start: current.start, end: current.end };
  }
  const week: WindowSpec =
    quota.week && quota.week.resetsAt > now
      ? {
          source: 'quota',
          start: quota.week.resetsAt - TOKEN_LEDGER_WEEK_MS,
          end: quota.week.resetsAt,
        }
      : { source: 'estimated', start: now - TOKEN_LEDGER_WEEK_MS, end: now };
  return { block, week };
}

/** The session a message is attributed to: the candidate whose own first record is earliest; ties go to the
 *  smallest session id. */
export function ownerSession(rec: LedgerRecord, sessionFirst: ReadonlyMap<string, number>): string {
  let best = rec.s;
  let bestTs = sessionFirst.get(best) ?? Infinity;
  for (const candidate of rec.x ?? []) {
    const ts = sessionFirst.get(candidate) ?? Infinity;
    if (ts < bestTs || (ts === bestTs && candidate < best)) {
      best = candidate;
      bestTs = ts;
    }
  }
  return best;
}

/** The area label a folder belongs to: the first label mapped to it, else null (unassigned). */
export function areaOf(
  folder: string,
  mappings: Readonly<Record<string, string[]>>,
): string | null {
  return mappings[folder]?.[0] ?? null;
}

export interface AreaTotal {
  area: string | null;
  folder: string;
  total: number;
  raw: number;
  share?: number;
  budgetPct?: number;
}

export interface SessionTotal {
  sessionId: string;
  title?: string;
  area: string | null;
  folder: string;
  total: number;
  raw: number;
  models: Record<string, number>;
  rawModels: Record<string, Usage4>;
}

export interface WindowTotals {
  total: number;
  raw: number;
  byArea: AreaTotal[];
  bySession: SessionTotal[];
}

export interface AggregateContext {
  sessionFirst: ReadonlyMap<string, number>;
  titles: ReadonlyMap<string, string>;
  mappings: Readonly<Record<string, string[]>>;
  /** Weighted-token budget for this window; absent adds no percent fields. */
  budget?: number;
}

/** Totals for the records inside [start, end], by area and by session. `records` must be sorted by timestamp. */
export function aggregateWindow(
  records: readonly LedgerRecord[],
  spec: Pick<WindowSpec, 'start' | 'end'>,
  ctx: AggregateContext,
): WindowTotals {
  let total = 0;
  let raw = 0;
  const areas = new Map<string, AreaTotal & { folderTotals: Map<string, number> }>();
  const sessions = new Map<string, SessionTotal>();

  for (const rec of records) {
    if (rec.ts < spec.start || rec.ts > spec.end) continue;
    const w = weightedTokens(rec.u);
    const r = rawTokens(rec.u);
    total += w;
    raw += r;

    const area = areaOf(rec.f, ctx.mappings);
    const areaKey = area === null ? `f:${rec.f}` : `a:${area}`;
    let a = areas.get(areaKey);
    if (!a) {
      a = { area, folder: rec.f, total: 0, raw: 0, folderTotals: new Map() };
      areas.set(areaKey, a);
    }
    a.total += w;
    a.raw += r;
    a.folderTotals.set(rec.f, (a.folderTotals.get(rec.f) ?? 0) + w);

    const sid = ownerSession(rec, ctx.sessionFirst);
    let s = sessions.get(sid);
    if (!s) {
      const title = ctx.titles.get(sid);
      s = {
        sessionId: sid,
        ...(title ? { title } : {}),
        area,
        folder: rec.f,
        total: 0,
        raw: 0,
        models: {},
        rawModels: {},
      };
      sessions.set(sid, s);
    }
    s.total += w;
    s.raw += r;
    s.models[rec.m] = (s.models[rec.m] ?? 0) + w;
    const rm = (s.rawModels[rec.m] ??= [0, 0, 0, 0]);
    for (let i = 0; i < 4; i++) rm[i] += rec.u[i];
  }

  const byArea = [...areas.entries()]
    .sort(([ka, a], [kb, b]) => b.total - a.total || (ka < kb ? -1 : 1))
    .map(([, a]) => {
      // An area spans folders: name the one that contributed most.
      let folder = a.folder;
      let best = -1;
      for (const [f, t] of a.folderTotals) {
        if (t > best || (t === best && f < folder)) {
          best = t;
          folder = f;
        }
      }
      const out: AreaTotal = { area: a.area, folder, total: a.total, raw: a.raw };
      if (total > 0) out.share = a.total / total;
      if (ctx.budget !== undefined) out.budgetPct = a.total / ctx.budget;
      return out;
    });

  const bySession = [...sessions.values()]
    .sort((a, b) => b.total - a.total || (a.sessionId < b.sessionId ? -1 : 1))
    .slice(0, TOKEN_LEDGER_TOP_SESSIONS);

  return { total, raw, byArea, bySession };
}

/** Largest 5 h block total among the records of the last 7 days: a data-derived reference for picking a budget. */
export function biggestBlockTotal(
  sorted: readonly LedgerRecord[],
  now: number,
): number | undefined {
  const recent = sorted.filter((r) => r.ts >= now - TOKEN_LEDGER_WEEK_MS && r.ts <= now);
  let best: number | undefined;
  for (const block of groupBlocks(recent)) {
    const t = block.items.reduce((acc, r) => acc + weightedTokens(r.u), 0);
    if (best === undefined || t > best) best = t;
  }
  return best;
}
