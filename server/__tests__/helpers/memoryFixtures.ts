import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { normalizeProjectPath } from '../../../core/src/normalizeProjectPath.js';
import type { ToolContext } from '../../src/memory/tools.js';

/**
 * Synthetic Claude Code transcripts in the real record shapes (envelope fields, promptSource/origin, tool_use
 * and tool_result pairing, toolUseResult, metadata rows). Text is invented; no real transcript content.
 */

/** A project path that only names the transcript folder: nothing is created there. */
export const PROJECT = '/Users/dev/acme-api';
const CC_VERSION = '2.1.296';

let uuidSeq = 0;
function nextUuid(): string {
  uuidSeq++;
  return `00000000-0000-4000-8000-${uuidSeq.toString(16).padStart(12, '0')}`;
}

/** A deterministic session id; `n` distinguishes sessions within a test. */
export function sessionId(n: number): string {
  return `5e55${n.toString(16).padStart(4, '0')}-1111-4222-8333-${n.toString(16).padStart(12, '0')}`;
}

export interface Env {
  sessionId: string;
  cwd: string;
  gitBranch: string;
}

export function env(n: number, cwd = PROJECT, gitBranch = 'main'): Env {
  return { sessionId: sessionId(n), cwd, gitBranch };
}

function base(e: Env, type: string, at: number): Record<string, unknown> {
  return {
    parentUuid: null,
    isSidechain: false,
    type,
    uuid: nextUuid(),
    timestamp: new Date(at).toISOString(),
    userType: 'external',
    entrypoint: 'cli',
    cwd: e.cwd,
    sessionId: e.sessionId,
    version: CC_VERSION,
    gitBranch: e.gitBranch,
  };
}

interface PromptOpts {
  /** null omits the field (records the harness writes carry no promptSource). */
  promptSource?: string | null;
  origin?: Record<string, unknown> | null;
  isMeta?: boolean;
  isCompactSummary?: boolean;
  /** A pasted screenshot of this many base64 chars before the text, as content blocks. */
  imageChars?: number;
}

/** A user record: by default a prompt the user typed, with string content. */
export function prompt(e: Env, at: number, text: string, opts: PromptOpts = {}): object {
  const content =
    opts.imageChars === undefined
      ? text
      : [
          {
            type: 'image',
            source: { type: 'base64', media_type: 'image/png', data: 'A'.repeat(opts.imageChars) },
          },
          { type: 'text', text },
        ];
  return {
    ...base(e, 'user', at),
    message: { role: 'user', content },
    promptId: nextUuid(),
    ...(opts.promptSource === null ? {} : { promptSource: opts.promptSource ?? 'typed' }),
    ...(opts.origin === null ? {} : { origin: opts.origin ?? { kind: 'human' } }),
    ...(opts.isMeta ? { isMeta: true } : {}),
    ...(opts.isCompactSummary ? { isCompactSummary: true } : {}),
  };
}

/** One assistant row per content block, as Claude Code writes them. */
function assistantRow(e: Env, at: number, block: object, extra: object = {}): object {
  return {
    ...base(e, 'assistant', at),
    message: {
      id: `msg_${nextUuid().slice(-12)}`,
      type: 'message',
      role: 'assistant',
      model: 'claude-opus-5-5',
      content: [block],
      stop_reason: null,
    },
    requestId: `req_${nextUuid().slice(-12)}`,
    ...extra,
  };
}

export function said(e: Env, at: number, text: string, extra: object = {}): object {
  return assistantRow(e, at, { type: 'text', text }, extra);
}

export function thought(e: Env, at: number, thinking: string): object {
  return assistantRow(e, at, { type: 'thinking', thinking, signature: 'sig' });
}

export function call(e: Env, at: number, id: string, name: string, input: object): object {
  return assistantRow(e, at, { type: 'tool_use', id, name, input });
}

interface ResultOpts {
  isError?: boolean;
  /** tool_result.content: a string or text blocks. */
  content?: unknown;
  /** The record's structured result; omitted when undefined. */
  toolUseResult?: unknown;
}

export function result(e: Env, at: number, id: string, opts: ResultOpts = {}): object {
  return {
    ...base(e, 'user', at),
    message: {
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: id,
          content: opts.content ?? 'ok',
          ...(opts.isError ? { is_error: true } : {}),
        },
      ],
    },
    ...(opts.toolUseResult === undefined ? {} : { toolUseResult: opts.toolUseResult }),
    sourceToolAssistantUUID: nextUuid(),
  };
}

/** A Bash result in the structured shape Claude Code records on success. */
export function bashOutput(stdout: string, extra: object = {}): object {
  return {
    stdout,
    stderr: '',
    interrupted: false,
    isImage: false,
    noOutputExpected: false,
    ...extra,
  };
}

export const meta = {
  aiTitle: (e: Env, aiTitle: string) => ({ type: 'ai-title', aiTitle, sessionId: e.sessionId }),
  customTitle: (e: Env, customTitle: string) => ({
    type: 'custom-title',
    customTitle,
    sessionId: e.sessionId,
  }),
  lastPrompt: (e: Env, lastPrompt: string) => ({
    type: 'last-prompt',
    lastPrompt,
    leafUuid: nextUuid(),
    sessionId: e.sessionId,
  }),
  costState: (e: Env, totalCostUSD: number) => ({
    type: 'cost-state',
    sessionId: e.sessionId,
    totalCostUSD,
    totalAPIDuration: 1000,
    totalToolDuration: 500,
    totalLinesAdded: 3,
    totalLinesRemoved: 1,
    totalDuration: 2000,
  }),
  prLink: (e: Env, at: number, repo: string, n: number) => ({
    type: 'pr-link',
    sessionId: e.sessionId,
    prNumber: n,
    prUrl: `https://github.com/${repo}/pull/${n}`,
    prRepository: repo,
    timestamp: new Date(at).toISOString(),
  }),
  continuedIn: (e: Env, at: number, next: string) => ({
    type: 'continued-in',
    timestamp: new Date(at).toISOString(),
    sessionId: e.sessionId,
    continuedInSessionId: next,
  }),
  awaySummary: (e: Env, at: number, content: string) => ({
    ...base(e, 'system', at),
    subtype: 'away_summary',
    content,
  }),
};

export function toJsonl(records: object[]): string {
  return records.map((r) => JSON.stringify(r)).join('\n') + '\n';
}

export interface MemoryHome {
  home: string;
  now: number;
  /** The log lines of every call made through ctx(). */
  logs: string[];
  /** The transcript folder Claude Code would use for `projectPath` (created). */
  projectDir: (projectPath?: string) => string;
  /** Write a main transcript; its mtime defaults to its newest record time. */
  writeSession: (dir: string, e: Env, records: object[], mtimeMs?: number) => string;
  ctx: (projectPath?: string) => ToolContext;
  cleanup: () => void;
}

/**
 * Fixture HOMEs live in the checkout (gitignored), not under os.tmpdir(): every temp dir is a scratch prefix to
 * the tools, so a HOME there would hide whether a path was skipped for being under ~/.claude or for being in a
 * temp dir. A checkout that itself sits in a temp dir fails the tests that tell the two apart.
 */
const TEST_HOMES = path.resolve(__dirname, '../../.test-homes');

export function memoryHome(): MemoryHome {
  fs.mkdirSync(TEST_HOMES, { recursive: true });
  const home = fs.realpathSync(fs.mkdtempSync(path.join(TEST_HOMES, 'pxl-memory-')));
  const now = Date.now();
  const logs: string[] = [];
  const projectDir = (projectPath = PROJECT): string => {
    const dir = path.join(home, '.claude', 'projects', normalizeProjectPath(projectPath));
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  };
  const writeSession = (dir: string, e: Env, records: object[], mtimeMs?: number): string => {
    const file = path.join(dir, `${e.sessionId}.jsonl`);
    fs.writeFileSync(file, toJsonl(records));
    const times = records
      .map((r) => Date.parse(String((r as { timestamp?: unknown }).timestamp)))
      .filter(Number.isFinite);
    const mtime = mtimeMs ?? (times.length > 0 ? Math.max(...times) : now);
    fs.utimesSync(file, mtime / 1000, mtime / 1000);
    return file;
  };
  return {
    home,
    now,
    logs,
    projectDir,
    writeSession,
    ctx: (projectPath = PROJECT) => ({
      home,
      projectPath,
      tmpdir: os.tmpdir(),
      now: () => now,
      log: (line: string) => logs.push(line),
    }),
    cleanup: () => fs.rmSync(home, { recursive: true, force: true }),
  };
}

/** The JSON document of a successful tool result (the line after the preamble). */
export function docOf(res: { content: Array<{ text: string }>; isError?: true }): {
  [key: string]: unknown;
  sessions: Array<Record<string, unknown>>;
} {
  if (res.isError) throw new Error('tool returned isError');
  const text = res.content[0].text;
  return JSON.parse(text.slice(text.indexOf('\n') + 1));
}

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;
