import * as path from 'path';
import { performance } from 'perf_hooks';

import {
  ACTIVE_CANDIDATE_WINDOW_MS,
  ACTIVE_NOW_LIMITS,
  ACTIVE_WINDOW_MS,
  ALL_PROJECTS_LIMITS,
  ASKED_MAX_CHARS,
  DAY_MS,
  ELLIPSIS,
  ENDED_MAX_CHARS,
  EXCERPT_LEAD_CHARS,
  EXCERPT_MAX_CHARS,
  FIND_MAX_EXCERPTS,
  FIND_MAX_RESULTS,
  FIND_PAST_WORK_LIMITS,
  FIND_SINCE_DEFAULT_DAYS,
  FIND_SINCE_MAX_DAYS,
  FIRST_PROMPT_SCAN_MAX_BYTES,
  LADDER_ASKED_MAX_CHARS,
  LADDER_ENDED_MAX_CHARS,
  LADDER_FILES_MAX,
  LAST_UPDATE_BYTES,
  LAST_UPDATE_WALL_MS,
  LAST_UPDATE_WINDOW_DAYS,
  LIMIT_DEFAULT,
  LIMIT_MAX,
  LIMIT_MIN,
  MIN_HUMAN_TURNS_DEFAULT,
  MIN_HUMAN_TURNS_MAX,
  MINUTE_MS,
  NO_TRANSCRIPTS_TEXT,
  PATH_MAX_CHARS,
  QUERY_MAX_CHARS,
  QUERY_MIN_CHARS,
  type ReadLimits,
  RECENT_WORK_LIMITS,
  RECORD_LIST_MAX,
  RESULT_PREAMBLE,
  SHORT_TEXT_MAX_CHARS,
  SINCE_DEFAULT_DAYS,
  SINCE_MAX_DAYS,
  TITLE_MAX_CHARS,
  TOOL_ACTIVE_NOW,
  TOOL_DESCRIPTION_SUFFIX,
  TOOL_FIND_PAST_WORK,
  TOOL_RECENT_WORK,
  TOOL_RECENT_WORK_ALL,
} from './constants.js';
import {
  digestTier1,
  FirstPromptScan,
  type PrOut,
  PrSet,
  scratchPrefixes,
  type Tier1Facts,
  Tier2Scan,
} from './digest.js';
import { findLastUpdate } from './lastUpdate.js';
import {
  Budget,
  type Candidate,
  listProjectDirs,
  listSessionFiles,
  readHeadTail,
  scanLines,
  walkSubagents,
} from './reader.js';
import { cutText, redactField, redactFull, sliceChars } from './redact.js';
import {
  canonicalUnder,
  cwdMatchesUnder,
  dirMatchesUnder,
  isProjectCwd,
  projectsRoot,
  resolveProjectDir,
} from './scope.js';

/**
 * The four memory tools: definitions for tools/list, argument checks, and the read pipeline behind each.
 * Every call reads on the fly under a budget, redacts every output string, caps the text block, and logs one
 * metadata-only line (never arguments, paths or result text).
 */

export interface ToolContext {
  home: string;
  projectPath: string;
  tmpdir: string;
  now: () => number;
  log: (line: string) => void;
}

export interface ToolResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: true;
}

// ── Definitions (tools/list) ──

const ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

const SINCE_PROPERTY = {
  type: 'string',
  description:
    'Start of the window: "YYYY-MM-DD" (local midnight), "<n>d" (n days ago, at most 31d; default 7d) or "last_update" (the last sprint update that was delivered).',
};
const LIMIT_PROPERTY = {
  type: 'integer',
  description: 'Most sessions to return, newest first: 1-50 (default 20).',
};
const MIN_HUMAN_TURNS_PROPERTY = {
  type: 'integer',
  description:
    'Drop sessions with fewer prompts typed by a person: 0-100 (default 1). Use 10 for a sprint update.',
};

export const TOOL_DEFINITIONS = [
  {
    name: TOOL_RECENT_WORK,
    description: `Sessions of this project (this working directory's Claude Code transcripts) active since a date, newest first: what each one asked, how it ended, its commits, PRs, files changed, test verdicts and cost. Use it for weekly or sprint updates and to recall recent work. Commits, files and tests describe the main session; work done inside subagents appears only as the subagents count. ${TOOL_DESCRIPTION_SUFFIX}`,
    inputSchema: {
      type: 'object',
      properties: {
        since: SINCE_PROPERTY,
        limit: LIMIT_PROPERTY,
        min_human_turns: MIN_HUMAN_TURNS_PROPERTY,
      },
      additionalProperties: false,
    },
    annotations: ANNOTATIONS,
  },
  {
    name: TOOL_FIND_PAST_WORK,
    description: `Did I already look into X? Sessions of this project whose title, first or last prompt, or final answer contains every word of the query (case-insensitive), newest first, at most 10, each with excerpts around matches the record does not show. ${TOOL_DESCRIPTION_SUFFIX}`,
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: '2-100 characters; every word must appear (case-insensitive).',
        },
        since: {
          type: 'string',
          description:
            'Start of the window: "YYYY-MM-DD" (local midnight) or "<n>d" (n days ago, at most 180d; default 90d).',
        },
      },
      required: ['query'],
      additionalProperties: false,
    },
    annotations: ANNOTATIONS,
  },
  {
    name: TOOL_ACTIVE_NOW,
    description: `Sessions of this project active in the last 10 minutes, this one included: title, minutes since their last activity, their last tool and the last file they edited. Check it before editing files another session may be changing. ${TOOL_DESCRIPTION_SUFFIX}`,
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: ANNOTATIONS,
  },
  {
    name: TOOL_RECENT_WORK_ALL,
    description: `recent_work across every project under a directory, each session labeled with its project. Asks the user on every call. For a sprint update across several repos, set under to the directory that holds the work repos. ${TOOL_DESCRIPTION_SUFFIX}`,
    inputSchema: {
      type: 'object',
      properties: {
        under: {
          type: 'string',
          description:
            'Absolute directory whose projects to include (at most 512 characters). Required: no default, so the scope is always one the user sees in the prompt. "/" means every project.',
        },
        since: SINCE_PROPERTY,
        limit: LIMIT_PROPERTY,
        min_human_turns: MIN_HUMAN_TURNS_PROPERTY,
      },
      required: ['under'],
      additionalProperties: false,
    },
    annotations: ANNOTATIONS,
    _meta: { 'anthropic/requiresUserInteraction': true },
  },
];

const TOOL_NAMES = new Set(TOOL_DEFINITIONS.map((t) => t.name));

export function isToolName(name: string): boolean {
  return TOOL_NAMES.has(name);
}

const ACCEPTED_FORMS: Record<string, string> = {
  [TOOL_RECENT_WORK]:
    'recent_work accepts: since = "YYYY-MM-DD", "<n>d" (at most 31d; default 7d) or "last_update"; limit = an integer, 1-50 (default 20); min_human_turns = an integer, 0-100 (default 1).',
  [TOOL_FIND_PAST_WORK]:
    'find_past_work accepts: query = 2-100 characters, every word must appear (required); since = "YYYY-MM-DD" or "<n>d" (at most 180d; default 90d).',
  [TOOL_ACTIVE_NOW]: 'active_now takes no arguments.',
  [TOOL_RECENT_WORK_ALL]:
    'recent_work_all_projects accepts: under = an absolute path of at most 512 characters (required; "/" means every project); since = "YYYY-MM-DD", "<n>d" (at most 31d; default 7d) or "last_update"; limit = an integer, 1-50 (default 20); min_human_turns = an integer, 0-100 (default 1).',
};

const LAST_UPDATE_MISSING_TEXT = `No delivered sprint update was found in this scope in the last ${LAST_UPDATE_WINDOW_DAYS} days, or the search ran out of time. Pass an explicit since instead: "YYYY-MM-DD" or "<n>d".`;

// ── Arguments ──

type SinceArg =
  | { kind: 'default' }
  | { kind: 'date'; ms: number }
  | { kind: 'days'; days: number }
  | { kind: 'last_update' };

class BadArguments extends Error {}

function parseSince(v: unknown, allowLastUpdate: boolean): SinceArg {
  if (v === undefined) return { kind: 'default' };
  if (typeof v !== 'string') throw new BadArguments();
  if (allowLastUpdate && v === 'last_update') return { kind: 'last_update' };
  const days = /^(\d{1,5})d$/.exec(v);
  if (days) return { kind: 'days', days: Number(days[1]) };
  const date = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (date) {
    const [y, m, d] = [Number(date[1]), Number(date[2]), Number(date[3])];
    const local = new Date(y, m - 1, d);
    if (local.getFullYear() === y && local.getMonth() === m - 1 && local.getDate() === d) {
      return { kind: 'date', ms: local.getTime() };
    }
  }
  throw new BadArguments();
}

function parseInteger(v: unknown, fallback: number, min: number, max: number): number {
  if (v === undefined) return fallback;
  if (typeof v !== 'number' || !Number.isInteger(v)) throw new BadArguments();
  return Math.min(max, Math.max(min, v));
}

function argumentsObject(raw: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new BadArguments();
  const args = raw as Record<string, unknown>;
  if (Object.keys(args).some((k) => !allowed.includes(k))) throw new BadArguments();
  return args;
}

function sinceFrom(arg: SinceArg, defaultDays: number, maxDays: number, now: number): number {
  const floor = now - maxDays * DAY_MS;
  switch (arg.kind) {
    case 'days':
      return now - Math.min(arg.days, maxDays) * DAY_MS;
    case 'date':
      return Math.max(arg.ms, floor);
    default:
      return now - defaultDays * DAY_MS;
  }
}

/** ISO 8601 in local time with its offset, e.g. 2026-10-05T00:00:00+02:00. */
function isoLocal(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number): string => String(n).padStart(2, '0');
  const offset = -d.getTimezoneOffset();
  const abs = Math.abs(offset);
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
    `${offset >= 0 ? '+' : '-'}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  );
}

// ── Output ──

/** A redacted output string, or null when absent or empty (never ""). */
function out(raw: string | null | undefined, max: number): string | null {
  if (raw === null || raw === undefined) return null;
  const s = redactField(raw, max);
  return s === '' ? null : s;
}

type Doc = { partial: boolean; omitted: number; sessions: Array<Record<string, unknown>> };

/** The single text block, under `cap` chars: shorten texts, then file lists, then drop the oldest sessions. */
function renderCapped(doc: Doc, cap: number): string {
  const render = (): string => `${RESULT_PREAMBLE}\n${JSON.stringify(doc)}`;
  let text = render();
  if (text.length <= cap) return text;
  for (const s of doc.sessions) {
    if (typeof s['ended'] === 'string') s['ended'] = cutText(s['ended'], LADDER_ENDED_MAX_CHARS);
    for (const key of ['asked', 'last_asked']) {
      if (typeof s[key] === 'string') s[key] = cutText(s[key] as string, LADDER_ASKED_MAX_CHARS);
    }
  }
  text = render();
  if (text.length <= cap) return text;
  for (const s of doc.sessions) {
    const files = s['files_changed'];
    if (Array.isArray(files) && files.length > LADDER_FILES_MAX) {
      s['files_changed_total'] ??= files.length;
      s['files_changed'] = files.slice(0, LADDER_FILES_MAX);
    }
  }
  text = render();
  while (text.length > cap && doc.sessions.length > 0) {
    doc.sessions.pop();
    doc.omitted++;
    doc.partial = true;
    text = render();
  }
  return text;
}

function textResult(text: string, isError = false): ToolResult {
  return isError
    ? { content: [{ type: 'text', text }], isError: true }
    : { content: [{ type: 'text', text }] };
}

/** At most RECORD_LIST_MAX items (the newest) plus the total when more. */
function capNewest<T>(items: T[]): { list: T[]; total: number | undefined } {
  return items.length > RECORD_LIST_MAX
    ? { list: items.slice(-RECORD_LIST_MAX), total: items.length }
    : { list: items, total: undefined };
}

function prOut(pr: PrOut): Record<string, unknown> {
  return {
    repo: out(pr.repo, SHORT_TEXT_MAX_CHARS),
    number: pr.number,
    url: out(pr.url, PATH_MAX_CHARS),
    action: out(pr.action, SHORT_TEXT_MAX_CHARS),
  };
}

// ── Reading ──

interface CallStats {
  candidates: number;
  badLines: number;
  bytesRead: number;
}

interface Session {
  c: Candidate;
  t1: Tier1Facts;
  scan: Tier2Scan | null;
  complete: boolean;
}

/** R7: a transcript with neither a human prompt nor an assistant text is not a session. */
function isSession(t1: Tier1Facts): boolean {
  return !t1.whole || t1.sawHumanPrompt || t1.sawAssistantText;
}

/**
 * Tier 1 of one transcript: its head and tail, then, when the head held no typed prompt, a read from the start
 * up to the first one (FirstPromptScan), so asked, started and the cwd the scope check needs never depend on
 * where the head cut fell. When the cap stops that read first, the cwd stays null and the scope check fails
 * closed. 'budget' when the budget ran out before the cwd was known, null when the file is not readable.
 */
async function readFacts(
  c: Candidate,
  limits: ReadLimits,
  budget: Budget,
  stats: CallStats,
): Promise<Tier1Facts | 'budget' | null> {
  const ht = await readHeadTail(c, limits.headBytes, limits.tailBytes, budget);
  if (ht === 'budget' || ht === null) return ht;
  const t1 = digestTier1(ht.head, ht.tail, ht.whole);
  stats.badLines += t1.badLines;
  if (ht.whole || t1.asked !== null) return t1;
  const first = new FirstPromptScan();
  const read = await scanLines(c.file, budget, first.onLine, FIRST_PROMPT_SCAN_MAX_BYTES);
  t1.asked = first.asked;
  t1.firstCwd ??= first.cwd;
  t1.startedMs ??= first.startedMs;
  return t1.firstCwd === null && read === false ? 'budget' : t1;
}

/** Tier 1 for every candidate, newest first. Unread candidates (budget) are counted, not returned. */
async function readTier1(
  candidates: Candidate[],
  limits: ReadLimits,
  budget: Budget,
  stats: CallStats,
  keep: (t1: Tier1Facts) => boolean,
): Promise<{ sessions: Session[]; unread: number }> {
  const sessions: Session[] = [];
  let unread = 0;
  for (const c of candidates) {
    const t1 = await readFacts(c, limits, budget, stats);
    if (t1 === 'budget') {
      unread++;
      continue;
    }
    if (t1 === null) continue;
    if (isSession(t1) && keep(t1)) sessions.push({ c, t1, scan: null, complete: false });
  }
  return { sessions, unread };
}

interface RecentArgs {
  since: SinceArg;
  limit: number;
  minHumanTurns: number;
}

function parseRecentArgs(
  raw: unknown,
  extra: readonly string[],
): RecentArgs & { raw: Record<string, unknown> } {
  const args = argumentsObject(raw, ['since', 'limit', 'min_human_turns', ...extra]);
  return {
    raw: args,
    since: parseSince(args['since'], true),
    limit: parseInteger(args['limit'], LIMIT_DEFAULT, LIMIT_MIN, LIMIT_MAX),
    minHumanTurns: parseInteger(
      args['min_human_turns'],
      MIN_HUMAN_TURNS_DEFAULT,
      0,
      MIN_HUMAN_TURNS_MAX,
    ),
  };
}

type SinceResolution =
  | {
      ok: true;
      ms: number;
      source: 'explicit' | 'default' | 'last_update';
      lastUpdate?: Record<string, string>;
    }
  | { ok: false };

async function resolveRecentSince(
  arg: SinceArg,
  pool: Candidate[],
  ctx: ToolContext,
  stats: CallStats,
  inScope: (cwd: string | null) => boolean,
): Promise<SinceResolution> {
  const now = ctx.now();
  if (arg.kind !== 'last_update') {
    return {
      ok: true,
      ms: sinceFrom(arg, SINCE_DEFAULT_DAYS, SINCE_MAX_DAYS, now),
      source: arg.kind === 'default' ? 'default' : 'explicit',
    };
  }
  const budget = new Budget(LAST_UPDATE_WALL_MS, LAST_UPDATE_BYTES);
  const found = await findLastUpdate(pool, now, budget, inScope);
  stats.bytesRead += budget.bytesRead;
  if (found.kind !== 'found') return { ok: false };
  return {
    ok: true,
    ms: Math.max(found.atMs, now - SINCE_MAX_DAYS * DAY_MS),
    source: 'last_update',
    lastUpdate: { at: isoLocal(found.atMs), id8: found.id8 },
  };
}

/** Tier 2 newest first until `limit` sessions pass min_human_turns; unknown human_turns never drops work. */
async function readTier2(
  sessions: Session[],
  limit: number,
  minHumanTurns: number,
  budget: Budget,
  ctx: ToolContext,
  stats: CallStats,
): Promise<{ returned: Session[]; beyondLimit: number; filtered: number }> {
  const scratch = scratchPrefixes(ctx.home, ctx.tmpdir);
  const returned: Session[] = [];
  let beyondLimit = 0;
  let filtered = 0;
  for (const s of sessions) {
    if (returned.length >= limit) {
      beyondLimit++;
      continue;
    }
    if (!budget.exhausted) {
      const scan = new Tier2Scan(scratch);
      s.complete = (await scanLines(s.c.file, budget, scan.onLine)) === true;
      s.scan = scan;
      // Both tiers may parse the same corrupt line: count it once.
      stats.badLines += Math.max(0, scan.badLines - s.t1.badLines);
    }
    if (s.complete && s.scan && s.scan.humanTurns < minHumanTurns) {
      filtered++;
      continue;
    }
    returned.push(s);
  }
  return { returned, beyondLimit, filtered };
}

async function fullRecord(
  s: Session,
  projectPath: string,
  project: string | undefined,
): Promise<Record<string, unknown>> {
  const { c, t1, scan, complete } = s;
  const done = complete && scan !== null ? scan : null;
  const prs = new PrSet();
  if (done) prs.merge(done.prs);
  else {
    prs.merge(t1.prs);
    if (scan) prs.merge(scan.prs);
  }
  const prList = prs.list();
  const prsCapped = capNewest(prList);
  const commits = done ? capNewest(done.commitList()) : null;
  const allFiles = done ? done.fileList(projectPath) : null;
  const files =
    allFiles && allFiles.length > RECORD_LIST_MAX ? allFiles.slice(0, RECORD_LIST_MAX) : allFiles;
  const cost = done ? (done.costUsd ?? t1.costUsd) : (t1.costUsd ?? scan?.costUsd ?? null);
  const subagents = await walkSubagents(c.dir, c.sessionId, false);
  return {
    id8: c.sessionId.slice(0, 8),
    ...(project === undefined ? {} : { project: out(project, PATH_MAX_CHARS) }),
    title: out(t1.title, TITLE_MAX_CHARS),
    started: t1.startedMs === null ? null : isoLocal(t1.startedMs),
    last_active: isoLocal(c.mtimeMs),
    branch: out(t1.branch, SHORT_TEXT_MAX_CHARS),
    asked: out(t1.asked ?? scan?.firstPromptText, ASKED_MAX_CHARS),
    last_asked: out(t1.lastPrompt ?? done?.lastPromptText, ASKED_MAX_CHARS),
    ended: out(t1.ended, ENDED_MAX_CHARS),
    human_turns: done ? done.humanTurns : null,
    commits: commits
      ? commits.list.map((cm) => ({
          sha7: cm.sha7,
          branch: out(cm.branch, SHORT_TEXT_MAX_CHARS),
          kind: out(cm.kind, SHORT_TEXT_MAX_CHARS),
        }))
      : null,
    commits_total: commits?.total,
    prs: prList.length > 0 ? prsCapped.list.map(prOut) : complete || t1.whole ? [] : null,
    prs_total: prsCapped.total,
    files_changed: files ? files.map((f) => redactField(f, PATH_MAX_CHARS)) : null,
    files_changed_total:
      allFiles && allFiles.length > RECORD_LIST_MAX ? allFiles.length : undefined,
    kind: allFiles === null ? null : allFiles.length > 0 ? 'change' : 'investigation',
    tests: done ? done.tests() : null,
    subagents: subagents.count,
    cost_usd: cost === null ? null : Math.round(cost * 100) / 100,
    continued_in: done
      ? (done.continuedIn ?? t1.continuedIn)
      : (t1.continuedIn ?? scan?.continuedIn ?? null),
    partial: !complete,
  };
}

// ── The tools ──

interface Outcome {
  result: ToolResult;
  scope: 'project' | 'all';
  returned: number;
  partial: boolean;
  error?: string;
}

function failure(tool: string, scope: 'project' | 'all', error: string, text?: string): Outcome {
  return {
    result: textResult(text ?? ACCEPTED_FORMS[tool], true),
    scope,
    returned: 0,
    partial: false,
    error,
  };
}

function projectDirOrFailure(tool: string, ctx: ToolContext): string | Outcome {
  return (
    resolveProjectDir(ctx.home, ctx.projectPath) ??
    failure(tool, 'project', 'no_transcripts', NO_TRANSCRIPTS_TEXT)
  );
}

/** The project tools' scope check (S4): the transcript's recorded cwd is this project's path. */
function inProject(ctx: ToolContext): (cwd: string | null) => boolean {
  return (cwd) => isProjectCwd(cwd, ctx.projectPath);
}

async function recentWork(raw: unknown, ctx: ToolContext, stats: CallStats): Promise<Outcome> {
  const args = parseRecentArgs(raw, []);
  const dir = projectDirOrFailure(TOOL_RECENT_WORK, ctx);
  if (typeof dir !== 'string') return dir;
  const pool = await listSessionFiles(dir);
  const inScope = inProject(ctx);
  const since = await resolveRecentSince(args.since, pool, ctx, stats, inScope);
  if (!since.ok)
    return failure(TOOL_RECENT_WORK, 'project', 'no_last_update', LAST_UPDATE_MISSING_TEXT);
  const candidates = pool
    .filter((c) => c.mtimeMs >= since.ms)
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  stats.candidates = candidates.length;
  const budget = new Budget(RECENT_WORK_LIMITS.wallMs, RECENT_WORK_LIMITS.bytes);
  const t1 = await readTier1(candidates, RECENT_WORK_LIMITS, budget, stats, (f) =>
    inScope(f.firstCwd),
  );
  const t2 = await readTier2(t1.sessions, args.limit, args.minHumanTurns, budget, ctx, stats);
  stats.bytesRead += budget.bytesRead;
  const sessions = await Promise.all(
    t2.returned.map((s) => fullRecord(s, ctx.projectPath, undefined)),
  );
  const doc = {
    scope: 'project',
    since: isoLocal(since.ms),
    since_source: since.source,
    ...(since.lastUpdate ? { last_update: since.lastUpdate } : {}),
    min_human_turns: args.minHumanTurns,
    partial: t1.unread > 0 || t2.returned.some((s) => !s.complete),
    omitted: t1.unread + t2.beyondLimit,
    filtered: t2.filtered,
    sessions,
  };
  const text = renderCapped(doc, RECENT_WORK_LIMITS.capChars);
  return {
    result: textResult(text),
    scope: 'project',
    returned: doc.sessions.length,
    partial: doc.partial,
  };
}

async function recentWorkAllProjects(
  raw: unknown,
  ctx: ToolContext,
  stats: CallStats,
): Promise<Outcome> {
  const args = parseRecentArgs(raw, ['under']);
  // Required (S4): a default would widen to both work and personal trees for a session started at a zone root,
  // and the per-call prompt shows only the arguments the model sent.
  const underRaw = args.raw['under'];
  if (typeof underRaw !== 'string') throw new BadArguments();
  const under = canonicalUnder(underRaw);
  if (under === null) throw new BadArguments();
  const dirs = (await listProjectDirs(projectsRoot(ctx.home))).filter((d) =>
    dirMatchesUnder(path.basename(d), under),
  );
  const pool = (await Promise.all(dirs.map((d) => listSessionFiles(d)))).flat();
  const cwdInScope = (cwd: string | null): boolean =>
    cwd === null ? under === '/' : cwdMatchesUnder(cwd, under);
  const since = await resolveRecentSince(args.since, pool, ctx, stats, cwdInScope);
  if (!since.ok)
    return failure(TOOL_RECENT_WORK_ALL, 'all', 'no_last_update', LAST_UPDATE_MISSING_TEXT);
  const candidates = pool
    .filter((c) => c.mtimeMs >= since.ms)
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  stats.candidates = candidates.length;
  const budget = new Budget(ALL_PROJECTS_LIMITS.wallMs, ALL_PROJECTS_LIMITS.bytes);
  const t1 = await readTier1(candidates, ALL_PROJECTS_LIMITS, budget, stats, (f) =>
    cwdInScope(f.firstCwd),
  );
  const t2 = await readTier2(t1.sessions, args.limit, args.minHumanTurns, budget, ctx, stats);
  stats.bytesRead += budget.bytesRead;
  const sessions = await Promise.all(
    t2.returned.map((s) => {
      const project = s.t1.firstCwd ?? path.basename(s.c.dir);
      return fullRecord(s, project, project);
    }),
  );
  const doc = {
    scope: 'all',
    under,
    since: isoLocal(since.ms),
    since_source: since.source,
    ...(since.lastUpdate ? { last_update: since.lastUpdate } : {}),
    min_human_turns: args.minHumanTurns,
    partial: t1.unread > 0 || t2.returned.some((s) => !s.complete),
    omitted: t1.unread + t2.beyondLimit,
    filtered: t2.filtered,
    sessions,
  };
  const text = renderCapped(doc, ALL_PROJECTS_LIMITS.capChars);
  return {
    result: textResult(text),
    scope: 'all',
    returned: doc.sessions.length,
    partial: doc.partial,
  };
}

/**
 * Where `word` first occurs in `full`, found in `lower` (its toLowerCase) and mapped back to offsets in `full`:
 * lowercasing can lengthen a code point (İ becomes i plus a combining dot), so offsets in `lower` drift.
 */
function matchIn(full: string, lower: string, word: string): { at: number; end: number } | null {
  const i = lower.indexOf(word);
  if (i < 0) return null;
  let lowerAt = 0;
  let fullAt = 0;
  let at = -1;
  for (const ch of full) {
    const n = ch.toLowerCase().length;
    if (at < 0 && lowerAt + n > i) at = fullAt;
    lowerAt += n;
    fullAt += ch.length;
    if (lowerAt >= i + word.length) return { at, end: fullAt };
  }
  return null;
}

/** A window of the redacted text around a match the displayed (cut) field does not show, cut on code points. */
function excerpt(full: string, index: number): string {
  let start = Math.max(0, index - EXCERPT_LEAD_CHARS);
  const code = full.charCodeAt(start);
  // Never open on the second half of a surrogate pair.
  if (code >= 0xdc00 && code <= 0xdfff) start++;
  return `${start > 0 ? ELLIPSIS : ''}${cutText(full.slice(start), EXCERPT_MAX_CHARS)}`;
}

async function findPastWork(raw: unknown, ctx: ToolContext, stats: CallStats): Promise<Outcome> {
  const args = argumentsObject(raw, ['query', 'since']);
  const query = args['query'];
  if (typeof query !== 'string') throw new BadArguments();
  const trimmed = query.trim();
  if (trimmed.length < QUERY_MIN_CHARS || trimmed.length > QUERY_MAX_CHARS)
    throw new BadArguments();
  const words = trimmed.normalize('NFKC').toLowerCase().split(/\s+/).filter(Boolean);
  const sinceArg = parseSince(args['since'], false);
  const dir = projectDirOrFailure(TOOL_FIND_PAST_WORK, ctx);
  if (typeof dir !== 'string') return dir;
  const now = ctx.now();
  const sinceMs = sinceFrom(sinceArg, FIND_SINCE_DEFAULT_DAYS, FIND_SINCE_MAX_DAYS, now);
  const candidates = (await listSessionFiles(dir))
    .filter((c) => c.mtimeMs >= sinceMs)
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  stats.candidates = candidates.length;
  const budget = new Budget(FIND_PAST_WORK_LIMITS.wallMs, FIND_PAST_WORK_LIMITS.bytes);
  const inScope = inProject(ctx);
  const t1 = await readTier1(candidates, FIND_PAST_WORK_LIMITS, budget, stats, (f) =>
    inScope(f.firstCwd),
  );
  stats.bytesRead += budget.bytesRead;
  const sessions: Array<Record<string, unknown>> = [];
  let extraMatches = 0;
  for (const { c, t1: f } of t1.sessions) {
    // Search the redacted text, never the raw text: a raw match would confirm secrets through hit counts.
    const fields = [
      { full: redactFull(f.title ?? ''), max: TITLE_MAX_CHARS },
      { full: redactFull(f.asked ?? ''), max: ASKED_MAX_CHARS },
      { full: redactFull(f.lastPrompt ?? ''), max: ASKED_MAX_CHARS },
      { full: redactFull(f.ended ?? ''), max: ENDED_MAX_CHARS },
    ].map((x) => ({ ...x, lower: x.full.toLowerCase() }));
    if (!words.every((w) => fields.some((x) => x.lower.includes(w)))) continue;
    if (sessions.length >= FIND_MAX_RESULTS) {
      extraMatches++;
      continue;
    }
    const excerpts: string[] = [];
    for (const x of fields.slice(1)) {
      if (excerpts.length >= FIND_MAX_EXCERPTS) break;
      const shown = sliceChars(x.full, x.max).length;
      const hidden = words
        .map((w) => matchIn(x.full, x.lower, w))
        .filter((m): m is { at: number; end: number } => m !== null && m.end > shown);
      if (hidden.length > 0) excerpts.push(excerpt(x.full, Math.min(...hidden.map((m) => m.at))));
    }
    const prList = f.prs.list();
    const display = (i: number): string | null =>
      fields[i].full === '' ? null : cutText(fields[i].full, fields[i].max);
    sessions.push({
      id8: c.sessionId.slice(0, 8),
      title: display(0),
      started: f.startedMs === null ? null : isoLocal(f.startedMs),
      last_active: isoLocal(c.mtimeMs),
      branch: out(f.branch, SHORT_TEXT_MAX_CHARS),
      asked: display(1),
      last_asked: display(2),
      ended: display(3),
      prs: prList.length > 0 ? capNewest(prList).list.map(prOut) : f.whole ? [] : null,
      cost_usd: f.costUsd === null ? null : Math.round(f.costUsd * 100) / 100,
      excerpts,
    });
  }
  const doc = {
    scope: 'project',
    since: isoLocal(sinceMs),
    since_source: sinceArg.kind === 'default' ? 'default' : 'explicit',
    partial: t1.unread > 0,
    omitted: t1.unread + extraMatches,
    sessions,
  };
  const text = renderCapped(doc, FIND_PAST_WORK_LIMITS.capChars);
  return {
    result: textResult(text),
    scope: 'project',
    returned: doc.sessions.length,
    partial: doc.partial,
  };
}

async function activeNow(raw: unknown, ctx: ToolContext, stats: CallStats): Promise<Outcome> {
  argumentsObject(raw, []);
  const dir = projectDirOrFailure(TOOL_ACTIVE_NOW, ctx);
  if (typeof dir !== 'string') return dir;
  const now = ctx.now();
  const candidates = (await listSessionFiles(dir)).filter(
    (c) => now - c.mtimeMs <= ACTIVE_CANDIDATE_WINDOW_MS,
  );
  stats.candidates = candidates.length;
  const budget = new Budget(ACTIVE_NOW_LIMITS.wallMs, ACTIVE_NOW_LIMITS.bytes);
  const inScope = inProject(ctx);
  const rows: Array<{ lastMs: number; record: Record<string, unknown> }> = [];
  let unread = 0;
  for (const c of candidates) {
    // A parent waiting on subagents does not touch its own transcript.
    const sub = await walkSubagents(dir, c.sessionId, true);
    const lastMs = Math.max(c.mtimeMs, sub.newestMtimeMs);
    if (now - lastMs > ACTIVE_WINDOW_MS) continue;
    const t1 = await readFacts(c, ACTIVE_NOW_LIMITS, budget, stats);
    if (t1 === 'budget') {
      unread++;
      continue;
    }
    if (t1 === null || !isSession(t1) || !inScope(t1.firstCwd)) continue;
    rows.push({
      lastMs,
      record: {
        id8: c.sessionId.slice(0, 8),
        title: out(t1.title, TITLE_MAX_CHARS),
        minutes_ago: Math.max(0, Math.floor((now - lastMs) / MINUTE_MS)),
        last_tool: out(t1.lastTool, SHORT_TEXT_MAX_CHARS),
        last_file: out(t1.lastFile, SHORT_TEXT_MAX_CHARS),
      },
    });
  }
  stats.bytesRead += budget.bytesRead;
  rows.sort((a, b) => b.lastMs - a.lastMs);
  const doc = {
    scope: 'project',
    partial: unread > 0,
    omitted: unread,
    sessions: rows.map((r) => r.record),
  };
  const text = renderCapped(doc, ACTIVE_NOW_LIMITS.capChars);
  return {
    result: textResult(text),
    scope: 'project',
    returned: doc.sessions.length,
    partial: doc.partial,
  };
}

const HANDLERS: Record<
  string,
  (raw: unknown, ctx: ToolContext, stats: CallStats) => Promise<Outcome>
> = {
  [TOOL_RECENT_WORK]: recentWork,
  [TOOL_FIND_PAST_WORK]: findPastWork,
  [TOOL_ACTIVE_NOW]: activeNow,
  [TOOL_RECENT_WORK_ALL]: recentWorkAllProjects,
};

/** Run one known tool. Bad arguments are an isError result naming the accepted forms, so the model can retry. */
export async function callTool(
  name: string,
  rawArgs: unknown,
  ctx: ToolContext,
): Promise<ToolResult> {
  const started = performance.now();
  const stats: CallStats = { candidates: 0, badLines: 0, bytesRead: 0 };
  const scope = name === TOOL_RECENT_WORK_ALL ? 'all' : 'project';
  let outcome: Outcome;
  try {
    outcome = await HANDLERS[name](rawArgs, ctx, stats);
  } catch (err) {
    if (!(err instanceof BadArguments)) throw err;
    outcome = failure(name, scope, 'bad_arguments');
  }
  const ms = Math.round(performance.now() - started);
  ctx.log(
    `tool=${name} scope=${outcome.scope} candidates=${stats.candidates} returned=${outcome.returned} ms=${ms} bytes_read=${stats.bytesRead} partial=${outcome.partial} bad_lines=${stats.badLines}` +
      (outcome.error ? ` error=${outcome.error}` : ''),
  );
  return outcome.result;
}
