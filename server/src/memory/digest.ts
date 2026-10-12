import * as path from 'path';

/**
 * What one main transcript says about its session. Only these fields ever leave a transcript: prompts the user
 * typed (with harness-injected spans removed), the last assistant text, titles, and structured metadata (git
 * operations, PR links, Edit/Write paths, test summaries, cost). Raw tool results, tool inputs, thinking blocks,
 * isMeta records and skill expansions are read only to pair a result with its call, never returned.
 */

type Rec = Record<string, unknown>;

export function asRec(v: unknown): Rec | null {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Rec) : null;
}

function str(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

/** A non-empty string, else null: absent is null, never "" (C16). */
function nonEmpty(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v : null;
}

export function timestampMs(r: Rec): number | null {
  const ts = str(r['timestamp']);
  if (ts === null) return null;
  const ms = Date.parse(ts);
  return Number.isFinite(ms) ? ms : null;
}

// ── Human prompts (S5, N6) ──

const HUMAN_PROMPT_SOURCES = new Set(['typed', 'queued', 'suggestion_accepted', 'sdk']);

/** Spans the harness injects into a prompt record: they were never typed by the user. */
const INJECTED_SPANS = [
  'system-reminder',
  'ide_selection',
  'ide_opened_file',
  'local-command-stdout',
  'local-command-stderr',
  'task-notification',
];

/**
 * `text` without its `<tag>...</tag>` spans. indexOf keeps it linear: a lazy regex rescans to the end of the
 * text from every opener that has no closer. Such an opener drops everything after it, so injected text that
 * lost its closer is never kept.
 */
function stripSpans(text: string, tag: string): string {
  const open = `<${tag}>`;
  const close = `</${tag}>`;
  let out = '';
  let from = 0;
  for (;;) {
    const start = text.indexOf(open, from);
    if (start === -1) return out + text.slice(from);
    out += text.slice(from, start);
    const end = text.indexOf(close, start + open.length);
    if (end === -1) return out;
    from = end + close.length;
  }
}

/** The text between the first `<tag>` and the first `</tag>` after it, or null. */
function tagged(text: string, tag: string): string | null {
  const open = `<${tag}>`;
  const start = text.indexOf(open);
  if (start === -1) return null;
  const end = text.indexOf(`</${tag}>`, start + open.length);
  return end === -1 ? null : text.slice(start + open.length, end);
}

/**
 * A prompt a person typed (or accepted, queued, or sent through the SDK). Compaction summaries and sidechain
 * records are never prompts: a summary is a user record of median 16.8K chars and would otherwise become the
 * ask, or the turn boundary after a compaction.
 */
export function isHumanPrompt(r: Rec): boolean {
  if (r['type'] !== 'user') return false;
  if (r['isMeta'] === true || r['isCompactSummary'] === true || r['isSidechain'] === true) {
    return false;
  }
  const kind = asRec(r['origin'])?.['kind'];
  if (kind === 'peer' || kind === 'task-notification') return false;
  const source = r['promptSource'];
  return (typeof source === 'string' && HUMAN_PROMPT_SOURCES.has(source)) || kind === 'human';
}

/** Text the user wrote: injected spans removed, a slash-command wrapper unwrapped to "/name args". */
export function cleanPromptText(raw: string): string {
  let text = raw;
  for (const tag of INJECTED_SPANS) text = stripSpans(text, tag);
  const name = tagged(text, 'command-name');
  if (name !== null) {
    const args = tagged(text, 'command-args');
    return `/${name.trim().replace(/^\/+/, '')} ${args === null ? '' : args.trim()}`.trim();
  }
  return text.trim();
}

function messageContent(r: Rec): unknown {
  return asRec(r['message'])?.['content'];
}

/** The prompt's text blocks (image and document blocks dropped), cleaned. */
export function promptText(r: Rec): string {
  const content = messageContent(r);
  let raw = '';
  if (typeof content === 'string') raw = content;
  else if (Array.isArray(content)) {
    raw = content
      .map(asRec)
      .filter((b): b is Rec => b !== null && b['type'] === 'text' && typeof b['text'] === 'string')
      .map((b) => b['text'] as string)
      .join('\n');
  }
  return cleanPromptText(raw);
}

/** The text blocks of a non-error, non-sidechain assistant record; null when it has none. */
export function assistantText(r: Rec): string | null {
  if (r['type'] !== 'assistant' || r['isApiErrorMessage'] === true || r['isSidechain'] === true) {
    return null;
  }
  const content = messageContent(r);
  if (typeof content === 'string') return nonEmpty(content);
  if (!Array.isArray(content)) return null;
  const texts = content
    .map(asRec)
    .filter((b): b is Rec => b !== null && b['type'] === 'text' && typeof b['text'] === 'string')
    .map((b) => b['text'] as string);
  return texts.length > 0 ? nonEmpty(texts.join('\n')) : null;
}

// ── Tool calls and their results ──

interface ToolUse {
  id: string;
  name: string;
  input: Rec;
}

export function toolUses(r: Rec): ToolUse[] {
  if (r['type'] !== 'assistant') return [];
  const content = messageContent(r);
  if (!Array.isArray(content)) return [];
  const out: ToolUse[] = [];
  for (const block of content.map(asRec)) {
    if (block?.['type'] !== 'tool_use') continue;
    const id = str(block['id']);
    const name = str(block['name']);
    if (id && name) out.push({ id, name, input: asRec(block['input']) ?? {} });
  }
  return out;
}

interface ToolResult {
  toolUseId: string;
  isError: boolean;
  /** stdout+stderr of a structured result, the error string, or the block content when the record has no
   *  structured result. Read for test summaries only. */
  outputText: () => string;
  /** The record's structured result when it holds exactly this one result. */
  structured: unknown;
}

function blockText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map(asRec)
    .filter((b): b is Rec => b !== null && b['type'] === 'text' && typeof b['text'] === 'string')
    .map((b) => b['text'] as string)
    .join('\n');
}

export function toolResults(r: Rec): ToolResult[] {
  if (r['type'] !== 'user') return [];
  const content = messageContent(r);
  if (!Array.isArray(content)) return [];
  const blocks = content.map(asRec).filter((b): b is Rec => b?.['type'] === 'tool_result');
  const structured = blocks.length === 1 ? r['toolUseResult'] : undefined;
  return blocks.flatMap((block) => {
    const toolUseId = str(block['tool_use_id']);
    if (!toolUseId) return [];
    const outputText = (): string => {
      if (typeof structured === 'string') return structured;
      const s = asRec(structured);
      if (s && (typeof s['stdout'] === 'string' || typeof s['stderr'] === 'string')) {
        return `${str(s['stdout']) ?? ''}\n${str(s['stderr']) ?? ''}`;
      }
      return blockText(block['content']);
    };
    return [{ toolUseId, isError: block['is_error'] === true, outputText, structured }];
  });
}

// ── Test verdicts (R2) ──

export const TEST_RUNNER_RE =
  /\b(vitest|jest|pytest|py\.test|unittest|go test|swift test|cargo test|mocha|rspec|phpunit|npm (run )?test|pnpm test|yarn test)\b/;

export type Verdict = 'pass' | 'fail' | 'unknown';

const ANSI = /\x1b\[[0-9;]*[A-Za-z]/g;

/** A runner's own summary line decides; exit codes and is_error never do (most runs pipe into tail/grep). */
export function testVerdict(output: string): Verdict {
  const text = output.replace(ANSI, '');
  let pass = false;
  let fail = false;
  const count = (re: RegExp, onMatch: (m: RegExpMatchArray) => void): void => {
    for (const m of text.matchAll(re)) onMatch(m);
  };
  // vitest "Tests  2 failed | 10 passed", jest "Tests:  1 failed, 5 passed", both "Tests  12 passed".
  count(/Tests:?\s+(\d+) failed/g, (m) => {
    if (Number(m[1]) > 0) fail = true;
  });
  count(/Tests:?\s+(?:\d+ failed(?: \||,) )?(\d+) passed/g, () => {
    pass = true;
  });
  // pytest "2 failed, 10 passed in 1.2s", "10 passed in 0.5s". The lookbehinds keep a long run of digits
  // linear: without them every digit of the run starts a new match attempt over the rest of it.
  count(/(?<!\d)(\d+) failed, (\d+) passed|(?<!\d)(\d+) passed in/g, (m) => {
    if (m[1] !== undefined && Number(m[1]) > 0) fail = true;
    else pass = true;
  });
  count(/^(ok|FAIL)\s/gm, (m) => {
    if (m[1] === 'FAIL') fail = true;
    else pass = true;
  });
  count(/Executed \d+ tests?, with (\d+) failures?/g, (m) => {
    if (Number(m[1]) > 0) fail = true;
    else pass = true;
  });
  count(/test result: (ok|FAILED)/g, (m) => {
    if (m[1] === 'FAILED') fail = true;
    else pass = true;
  });
  count(/OK \(\d+ tests?|FAILURES!/g, (m) => {
    if (m[0] === 'FAILURES!') fail = true;
    else pass = true;
  });
  return fail ? 'fail' : pass ? 'pass' : 'unknown';
}

export interface TestSummary {
  passed: number;
  failed: number;
  unknown: number;
  last: Verdict;
}

// ── Pull requests (R4) ──

export interface PrOut {
  repo: string | null;
  number: number;
  url: string | null;
  action: string | null;
}

const PR_URL_RE = /github\.com\/([^/\s]+\/[^/\s]+)\/pull\/(\d+)/;

function prNumber(v: unknown): number | null {
  return typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : null;
}

/** PRs keyed by repo+number, from pr-link rows and gitOperation.pr. A gitOperation.pr with no url names no repo;
 *  it joins the one known PR with that number, or stands alone with repo null. */
export class PrSet {
  private readonly byKey = new Map<string, PrOut>();
  private readonly repoless = new Map<number, string | null>();

  addLink(r: Rec): void {
    const n = prNumber(r['prNumber']);
    const url = nonEmpty(r['prUrl']);
    const repo = nonEmpty(r['prRepository']) ?? (url ? (PR_URL_RE.exec(url)?.[1] ?? null) : null);
    if (n === null) return;
    if (repo === null) this.addRepoless(n, null);
    else this.upsert(repo, n, url, null);
  }

  addGitOperation(pr: Rec): void {
    const n = prNumber(pr['number']);
    if (n === null) return;
    const url = nonEmpty(pr['url']);
    const action = nonEmpty(pr['action']);
    const repo = url ? (PR_URL_RE.exec(url)?.[1] ?? null) : null;
    if (repo === null) this.addRepoless(n, action);
    else this.upsert(repo, n, url, action);
  }

  merge(other: PrSet): void {
    for (const pr of other.byKey.values()) {
      if (pr.repo !== null) this.upsert(pr.repo, pr.number, pr.url, pr.action);
    }
    for (const [n, action] of other.repoless) this.addRepoless(n, action);
  }

  private addRepoless(n: number, action: string | null): void {
    const before = this.repoless.get(n) ?? null;
    this.repoless.set(n, action ?? before);
  }

  private upsert(repo: string, n: number, url: string | null, action: string | null): void {
    const key = `${repo.toLowerCase()}#${n}`;
    const existing = this.byKey.get(key);
    if (existing) {
      existing.url ??= url;
      if (action !== null) existing.action = action;
      return;
    }
    this.byKey.set(key, { repo, number: n, url, action });
  }

  list(): PrOut[] {
    const out = [...this.byKey.values()].map((pr) => ({ ...pr }));
    for (const [n, action] of this.repoless) {
      const same = out.filter((pr) => pr.number === n && pr.repo !== null);
      if (same.length === 1) {
        if (action !== null) same[0].action = action;
      } else {
        out.push({ repo: null, number: n, url: null, action });
      }
    }
    return out;
  }
}

// ── Tier 1: head and tail of the file ──

export interface Tier1Facts {
  /** Timestamp of the first record, from the head only (FirstPromptScan fills it when the head held none). */
  startedMs: number | null;
  /** cwd of the first user or assistant record (S4 scope check and project label), from the head only: a
   *  session that cd'd has a later cwd in its tail. FirstPromptScan fills it when the head held none. */
  firstCwd: string | null;
  /** First human prompt with text, from the head (the caller reads on with FirstPromptScan when the head held
   *  none). Raw (redaction happens at output). */
  asked: string | null;
  sawHumanPrompt: boolean;
  sawAssistantText: boolean;
  title: string | null;
  lastPrompt: string | null;
  costUsd: number | null;
  continuedIn: string | null;
  branch: string | null;
  prs: PrSet;
  /** Last assistant text after the last human prompt in the tail. */
  ended: string | null;
  lastTool: string | null;
  lastFile: string | null;
  /** The head held the whole file, so every list read from it (PRs included) is complete. */
  whole: boolean;
  badLines: number;
}

const EDIT_TOOLS = new Set(['Edit', 'Write']);

/** The id8 form of another session's id, when it is one. */
function sessionRef(v: unknown): string | null {
  const s = str(v);
  return s && /^[0-9a-f]{8}-[0-9a-f-]{27}$/.test(s) ? s.slice(0, 8) : null;
}

function finiteNumber(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** The structured git operation Claude Code records on a Bash result (a commit, a PR), if any. */
function gitOperation(r: Rec): Rec | null {
  return asRec(asRec(r['toolUseResult'])?.['gitOperation']);
}

/**
 * Records the metadata rows carry, wherever they sit: titles, last prompt, cost, continuation, PR links. Also the
 * PR of a git operation: a session that opened a PR does not always get a pr-link row.
 */
function applyMetadata(
  r: Rec,
  acc: {
    customTitle: string | null;
    aiTitle: string | null;
    lastPrompt: string | null;
    costUsd: number | null;
    continuedIn: string | null;
    prs: PrSet;
  },
): void {
  switch (r['type']) {
    case 'custom-title':
      acc.customTitle = nonEmpty(r['customTitle']) ?? acc.customTitle;
      break;
    case 'ai-title':
      acc.aiTitle = nonEmpty(r['aiTitle']) ?? acc.aiTitle;
      break;
    case 'last-prompt': {
      const text = str(r['lastPrompt']);
      const cleaned = text === null ? null : nonEmpty(cleanPromptText(text));
      acc.lastPrompt = cleaned ?? acc.lastPrompt;
      break;
    }
    case 'cost-state':
      acc.costUsd = finiteNumber(r['totalCostUSD']) ?? acc.costUsd;
      break;
    case 'continued-in':
      acc.continuedIn = sessionRef(r['continuedInSessionId']) ?? acc.continuedIn;
      break;
    case 'pr-link':
      acc.prs.addLink(r);
      break;
  }
  const pr = asRec(gitOperation(r)?.['pr']);
  if (pr) acc.prs.addGitOperation(pr);
}

export function parseLine(line: Buffer): Rec | null | undefined {
  try {
    return asRec(JSON.parse(line.toString('utf8')));
  } catch {
    // Never log this: Node's SyntaxError message quotes the offending input.
    return undefined;
  }
}

export function digestTier1(head: Buffer[], tail: Buffer[], whole: boolean): Tier1Facts {
  let badLines = 0;
  const parse = (lines: Buffer[]): Rec[] =>
    lines.flatMap((line) => {
      const r = parseLine(line);
      if (r === undefined) badLines++;
      return r ? [r] : [];
    });
  const headRecs = parse(head);
  const tailRecs = whole ? headRecs : parse(tail);

  let startedMs: number | null = null;
  let firstCwd: string | null = null;
  let asked: string | null = null;
  let sawHumanPrompt = false;
  let sawAssistantText = false;
  let branch: string | null = null;
  const meta = {
    customTitle: null as string | null,
    aiTitle: null as string | null,
    lastPrompt: null as string | null,
    costUsd: null as number | null,
    continuedIn: null as string | null,
    prs: new PrSet(),
  };
  // Where and when the session started: the head's records only, never the tail's.
  for (const r of headRecs) {
    startedMs ??= timestampMs(r);
    if (firstCwd === null && (r['type'] === 'user' || r['type'] === 'assistant')) {
      firstCwd = nonEmpty(r['cwd']);
    }
  }
  const ordered = whole ? headRecs : [...headRecs, ...tailRecs];
  for (const r of ordered) {
    if (isHumanPrompt(r)) sawHumanPrompt = true;
    if (!sawAssistantText && assistantText(r) !== null) sawAssistantText = true;
    if (typeof r['gitBranch'] === 'string') branch = nonEmpty(r['gitBranch']);
    applyMetadata(r, meta);
  }
  for (const r of headRecs) {
    if (!isHumanPrompt(r)) continue;
    const text = promptText(r);
    if (text !== '') {
      asked = text;
      break;
    }
  }

  let ended: string | null = null;
  let lastTool: string | null = null;
  let lastFile: string | null = null;
  const pendingEdits = new Map<string, string>();
  for (const r of tailRecs) {
    if (isHumanPrompt(r)) ended = null;
    const text = assistantText(r);
    if (text !== null) ended = text;
    for (const use of toolUses(r)) {
      lastTool = use.name;
      const filePath = nonEmpty(use.input['file_path']);
      if (EDIT_TOOLS.has(use.name) && filePath) pendingEdits.set(use.id, filePath);
    }
    for (const result of toolResults(r)) {
      const filePath = pendingEdits.get(result.toolUseId);
      if (filePath === undefined) continue;
      pendingEdits.delete(result.toolUseId);
      if (!result.isError) lastFile = path.basename(filePath);
    }
  }

  return {
    startedMs,
    firstCwd,
    asked,
    sawHumanPrompt,
    sawAssistantText,
    title: meta.customTitle ?? meta.aiTitle,
    lastPrompt: meta.lastPrompt,
    costUsd: meta.costUsd,
    continuedIn: meta.continuedIn,
    branch,
    prs: meta.prs,
    ended,
    lastTool,
    lastFile,
    whole,
    badLines,
  };
}

/** Every human prompt line holds one of these (typed prompts carry promptSource, slash commands only origin). */
const PROMPT_PREFILTERS = ['promptSource', '"origin"'].map((s) => Buffer.from(s));

/**
 * Reads on from the start of a transcript whose head held no typed prompt, up to the first one: its line can
 * cross the head cut (a pasted image makes it hundreds of KiB) or start past the head. It also takes the cwd
 * and timestamp of the first user record it parses, for a head that held no record at all. Only lines that can
 * hold a prompt are parsed; `onLine` returns true at the prompt, which stops the scan.
 */
export class FirstPromptScan {
  asked: string | null = null;
  cwd: string | null = null;
  startedMs: number | null = null;

  onLine = (line: Buffer): boolean => {
    if (!PROMPT_PREFILTERS.some((needle) => line.includes(needle))) return false;
    const r = parseLine(line);
    if (!r || r['type'] !== 'user') return false;
    this.cwd ??= nonEmpty(r['cwd']);
    this.startedMs ??= timestampMs(r);
    if (!isHumanPrompt(r)) return false;
    const text = promptText(r);
    if (text === '') return false;
    this.asked = text;
    return true;
  };
}

// ── Tier 2: the full scan ──

export interface Commit {
  sha7: string;
  branch: string | null;
  kind: string | null;
}

const PREFILTERS = [
  ...PROMPT_PREFILTERS,
  ...['"tool_use"', 'gitOperation', '"pr-link"', '"continued-in"', '"cost-state"'].map((s) =>
    Buffer.from(s),
  ),
];

/** Paths under these prefixes are scratch, plans or memory, not project changes. */
export function scratchPrefixes(home: string, tmpdir: string): string[] {
  return [
    path.join(home, '.claude') + '/',
    '/tmp/',
    '/private/tmp/',
    '/var/folders/',
    '/private/var/folders/',
    tmpdir.replace(/\/+$/, '') + '/',
  ];
}

/**
 * Tier 2 state for one transcript. Lines are parsed only when a substring test says they matter (a tool call,
 * a prompt, a git operation, a PR link, a continuation, a cost row, or the result of a call still pending), so
 * the scan is I/O bound.
 */
export class Tier2Scan {
  humanTurns = 0;
  lastPromptText: string | null = null;
  firstPromptText: string | null = null;
  costUsd: number | null = null;
  continuedIn: string | null = null;
  badLines = 0;
  readonly prs = new PrSet();
  private readonly commits = new Map<string, Commit>();
  private readonly files = new Map<string, true>();
  private readonly runs: Array<Verdict | null> = [];
  private readonly pendingRuns = new Map<string, { index: number; needle: Buffer }>();
  private readonly pendingEdits = new Map<string, { filePath: string; needle: Buffer }>();

  constructor(private readonly scratch: string[]) {}

  onLine = (line: Buffer): void => {
    if (!this.wanted(line)) return;
    const r = parseLine(line);
    if (r === undefined) this.badLines++;
    if (r) this.onRecord(r);
  };

  private wanted(line: Buffer): boolean {
    if (PREFILTERS.some((needle) => line.includes(needle))) return true;
    for (const p of this.pendingRuns.values()) if (line.includes(p.needle)) return true;
    for (const p of this.pendingEdits.values()) if (line.includes(p.needle)) return true;
    return false;
  }

  private onRecord(r: Rec): void {
    if (isHumanPrompt(r)) {
      this.humanTurns++;
      const text = promptText(r);
      if (text !== '') {
        this.firstPromptText ??= text;
        this.lastPromptText = text;
      }
    }
    for (const use of toolUses(r)) {
      if (use.name === 'Bash' && TEST_RUNNER_RE.test(str(use.input['command']) ?? '')) {
        this.runs.push(null);
        this.pendingRuns.set(use.id, { index: this.runs.length - 1, needle: Buffer.from(use.id) });
      }
      const filePath = nonEmpty(use.input['file_path']);
      if (EDIT_TOOLS.has(use.name) && filePath) {
        this.pendingEdits.set(use.id, { filePath, needle: Buffer.from(use.id) });
      }
    }
    for (const result of toolResults(r)) {
      const run = this.pendingRuns.get(result.toolUseId);
      if (run) {
        this.pendingRuns.delete(result.toolUseId);
        this.runs[run.index] = testVerdict(result.outputText());
      }
      const edit = this.pendingEdits.get(result.toolUseId);
      if (edit) {
        this.pendingEdits.delete(result.toolUseId);
        if (!result.isError && !this.scratch.some((p) => edit.filePath.startsWith(p))) {
          this.files.set(edit.filePath, true);
        }
      }
    }
    const git = gitOperation(r);
    if (git) this.onGitOperation(git);
    switch (r['type']) {
      case 'pr-link':
        this.prs.addLink(r);
        break;
      case 'continued-in':
        this.continuedIn = sessionRef(r['continuedInSessionId']) ?? this.continuedIn;
        break;
      case 'cost-state':
        this.costUsd = finiteNumber(r['totalCostUSD']) ?? this.costUsd;
        break;
    }
  }

  private onGitOperation(git: Rec): void {
    const commit = asRec(git['commit']);
    const sha = str(commit?.['sha']);
    if (commit && sha && /^[0-9a-f]{7,40}$/i.test(sha) && !this.commits.has(sha)) {
      this.commits.set(sha, {
        sha7: sha.slice(0, 7),
        branch: nonEmpty(commit['branch']),
        kind: nonEmpty(commit['kind']),
      });
    }
    const pr = asRec(git['pr']);
    if (pr) this.prs.addGitOperation(pr);
  }

  commitList(): Commit[] {
    return [...this.commits.values()];
  }

  /** Changed files in order of first edit: relative to the project path when under it, else absolute. */
  fileList(projectPath: string): string[] {
    const prefix = projectPath.replace(/\/+$/, '') + '/';
    return [...this.files.keys()].map((f) => (f.startsWith(prefix) ? f.slice(prefix.length) : f));
  }

  /** null when no test runner ran. A run whose result never arrived counts as unknown. */
  tests(): TestSummary | null {
    if (this.runs.length === 0) return null;
    const verdicts = this.runs.map((v) => v ?? 'unknown');
    return {
      passed: verdicts.filter((v) => v === 'pass').length,
      failed: verdicts.filter((v) => v === 'fail').length,
      unknown: verdicts.filter((v) => v === 'unknown').length,
      last: verdicts[verdicts.length - 1],
    };
  }
}
