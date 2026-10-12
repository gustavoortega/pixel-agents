import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { HookProvider } from '../../core/src/provider.js';
import { AgentStateStore } from '../src/agentStateStore.js';
import { readNewLines } from '../src/fileWatcher.js';
import { HookEventHandler } from '../src/hookEventHandler.js';
import { claudeProvider } from '../src/providers/hook/claude/claude.js';
import { RosterStore } from '../src/roster.js';
import { claimRosterMember } from '../src/rosterAgent.js';
import { SessionRouter } from '../src/sessionRouter.js';
import { processTranscriptLine, setHookProvider } from '../src/transcriptParser.js';
import type { AgentState } from '../src/types.js';

function agentState(overrides: Partial<AgentState>): AgentState {
  return {
    id: 1,
    sessionId: 'sess-1',
    isExternal: true,
    projectDir: '/test',
    jsonlFile: '/test/session.jsonl',
    fileOffset: 0,
    lineBuffer: '',
    activeToolIds: new Set(),
    activeToolStatuses: new Map(),
    activeToolNames: new Map(),
    activeSubagentToolIds: new Map(),
    activeSubagentToolNames: new Map(),
    backgroundAgentToolIds: new Set(),
    isWaiting: false,
    permissionSent: false,
    hadToolsInTurn: false,
    lastDataAt: 0,
    linesProcessed: 0,
    seenUnknownRecordTypes: new Set(),
    hookDelivered: false,
    contextTokens: 0,
    maxContextTokens: 200_000,
    ...overrides,
  } as AgentState;
}

let dir: string;
let rosterFile: string;
let store: AgentStateStore;
let roster: RosterStore;
let sent: Array<Record<string, unknown>>;

function setup(provider: HookProvider = claudeProvider) {
  const handler = new HookEventHandler(store, new Map(), new Map(), provider, new SessionRouter());
  return handler;
}

function addAgent(overrides: Partial<AgentState> = {}): AgentState {
  const agent = agentState(overrides);
  claimRosterMember(agent, store);
  store.set(agent.id, agent);
  return agent;
}

const xpOf = (agent: AgentState) => roster.getMember(agent.rosterId!)!.xp;

const hook = (name: string, extra: Record<string, unknown> = {}, session = 'sess-1') => ({
  hook_event_name: name,
  session_id: session,
  ...extra,
});

const line = (record: Record<string, unknown>, agentId = 1) =>
  processTranscriptLine(agentId, JSON.stringify(record), store, new Map(), new Map());

interface ToolOutcome {
  stdout?: string;
  stderr?: string;
  isError?: boolean;
}

/** A tool_use and its tool_result as Claude Code writes them. A failed Bash call carries an
 *  error string as toolUseResult, a finished one its streams. */
function toolRecords(
  id: string,
  name: string,
  input: Record<string, unknown>,
  outcome: ToolOutcome = {},
  extra: Record<string, unknown> = {},
): Array<Record<string, unknown>> {
  const stdout = outcome.stdout ?? '';
  return [
    { type: 'assistant', ...extra, message: { content: [{ type: 'tool_use', id, name, input }] } },
    {
      type: 'user',
      ...extra,
      message: {
        content: [
          {
            type: 'tool_result',
            tool_use_id: id,
            content: stdout,
            is_error: outcome.isError ?? false,
          },
        ],
      },
      toolUseResult: outcome.isError
        ? `Error: ${stdout}`
        : { stdout, stderr: outcome.stderr ?? '', interrupted: false, isImage: false },
    },
  ];
}

function tool(
  id: string,
  name: string,
  input: Record<string, unknown>,
  outcome: ToolOutcome = {},
  opts: { agentId?: number; extra?: Record<string, unknown> } = {},
): void {
  const { agentId = 1, extra = {} } = opts;
  for (const record of toolRecords(id, name, input, outcome, extra)) line(record, agentId);
}

const bash = (
  id: string,
  command: string,
  outcome: ToolOutcome = {},
  opts: { agentId?: number; extra?: Record<string, unknown> } = {},
) => tool(id, 'Bash', { command }, outcome, opts);

const edit = (id: string) => tool(id, 'Edit', { file_path: '/repo/a.ts' });

const VITEST_GREEN = ' Test Files  2 passed (2)\n      Tests  12 passed (12)\n';
const VITEST_RED = ' Test Files  1 failed | 1 passed (2)\n      Tests  1 failed | 11 passed (12)\n';
const PR_URL = 'https://github.com/acme/app/pull/42\n';

const rosterEvents = () => sent.filter((m) => m.type === 'rosterEvent');
const lastMood = () => sent.filter((m) => m.type === 'agentRoster').at(-1)?.mood;

beforeEach(() => {
  setHookProvider(claudeProvider);
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pxl-roster-xp-'));
  rosterFile = path.join(dir, 'roster.json');
  store = new AgentStateStore();
  roster = new RosterStore({ filePath: rosterFile, paletteCount: () => 6 });
  roster.attach(store);
  sent = [];
  store.on('broadcast', (m) => sent.push(m));
});

afterEach(() => {
  vi.restoreAllMocks();
  roster.dispose();
  store.dispose();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('XP pays for real work only', () => {
  it('a tool turn with no real work pays nothing, through hooks or the transcript (C1)', () => {
    const handler = setup();
    const agent = addAgent();
    handler.registerAgent('sess-1', 1);

    handler.handleEvent(
      'claude',
      hook('PreToolUse', { tool_name: 'Read', tool_input: { file_path: 'a.ts' } }),
    );
    handler.handleEvent('claude', hook('PostToolUse'));
    handler.handleEvent('claude', hook('SubagentStop'));
    handler.handleEvent('claude', hook('Stop'));
    tool('t1', 'Read', { file_path: 'a.ts' }, { stdout: 'export const a = 1;' });
    bash('t2', 'ls', { stdout: 'a.ts' });
    line({ type: 'system', subtype: 'turn_duration', durationMs: 1000 });

    expect(xpOf(agent)).toBe(0);
    expect(rosterEvents()).toEqual([]);
  });

  it('a commit seen through its hooks and its transcript pays +60 once (C1)', () => {
    const handler = setup();
    const agent = addAgent();
    handler.registerAgent('sess-1', 1);

    handler.handleEvent(
      'claude',
      hook('PreToolUse', { tool_name: 'Bash', tool_input: { command: 'git commit -m x' } }),
    );
    handler.handleEvent('claude', hook('PostToolUse'));
    bash('c1', 'git commit -m x', { stdout: '[main 1234567] x\n' });
    handler.handleEvent('claude', hook('Stop'));

    expect(xpOf(agent)).toBe(60);
  });

  it('a transcript read from its start pays for what was written since, not for its history', () => {
    const agent = addAgent({ jsonlFile: path.join(dir, 'resumed.jsonl') });
    const run = (id: string, command: string, stdout: string, ms: number) =>
      toolRecords(id, 'Bash', { command }, { stdout }, { timestamp: new Date(ms).toISOString() });
    const yesterday = Date.now() - 24 * 60 * 60 * 1000;
    const records = [
      ...run('h1', 'git commit -m old', '[main 1111111] old\n', yesterday),
      ...run('h2', 'gh pr create --fill', PR_URL, yesterday),
      ...run('h3', 'gh pr merge 9 --squash', '', yesterday),
      ...run('n1', 'git commit -m new', '[main 2222222] new\n', Date.now()),
    ];
    fs.writeFileSync(agent.jsonlFile, records.map((r) => `${JSON.stringify(r)}\n`).join(''));

    readNewLines(agent.id, store, new Map(), new Map());

    expect(xpOf(agent)).toBe(60);
  });

  it('a commit pays +60 once however often its record is read, even while hooks deliver (C2)', () => {
    const agent = addAgent({ hookDelivered: true });
    const commit = { stdout: '[main 1a2b3c4] Add retry\n 1 file changed, 2 insertions(+)\n' };

    bash('c1', 'git add . && git commit -m "Add retry"', commit);
    bash('c1', 'git add . && git commit -m "Add retry"', commit);
    expect(xpOf(agent)).toBe(60);

    bash('c2', 'git commit -m "Fix typo"', { stdout: '[main 5d6e7f8] Fix typo\n' });
    expect(xpOf(agent)).toBe(120);
    expect(rosterEvents()).toEqual([
      { type: 'rosterEvent', id: 1, kind: 'xp', amount: 60, signal: 'commit' },
      { type: 'rosterEvent', id: 1, kind: 'levelUp', amount: 60, level: 2, signal: 'commit' },
    ]);
  });

  it('an amended commit pays nothing; the same output from a plain commit pays (C2)', () => {
    const agent = addAgent();
    const out = { stdout: '[main 9f8e7d6] Add retry\n' };

    bash('c1', 'git commit --amend --no-edit', out);
    expect(xpOf(agent)).toBe(0);
    bash('c2', 'git commit --no-edit', out);
    expect(xpOf(agent)).toBe(60);
  });

  it.each([
    ['a typed prompt', 'next task'],
    ['a prompt sent as blocks', [{ type: 'text', text: 'next task' }]],
  ])('a turn pays at most 3 commits, and %s opens a new turn (C2)', (_kind, content) => {
    const agent = addAgent();
    const picks = ['1111111', '2222222', '3333333', '4444444']
      .map((sha) => `[main ${sha}] pick\n`)
      .join('');

    bash('p1', 'git cherry-pick a b c d', { stdout: picks });
    expect(xpOf(agent)).toBe(180);
    line({ type: 'user', message: { role: 'user', content } });
    bash('p2', 'git commit -m next', { stdout: '[main 5555555] next\n' });
    expect(xpOf(agent)).toBe(240);
  });

  it('a PR pays +120 once: a retried create printing the same URL and pr-link rows pay nothing (C3)', () => {
    const agent = addAgent();
    const log = vi.spyOn(console, 'log');

    bash('g1', 'gh pr create --fill', { stdout: PR_URL });
    bash('g2', 'gh pr create --fill', { stdout: PR_URL });
    // Its own PR, and one this session never created.
    for (let i = 0; i < 20; i++) {
      for (const [repo, n] of [
        ['acme/app', 42],
        ['acme/other', 7],
      ] as const) {
        line({
          type: 'pr-link',
          sessionId: 'sess-1',
          prNumber: n,
          prUrl: `https://github.com/${repo}/pull/${n}`,
          prRepository: repo,
        });
      }
    }

    expect(xpOf(agent)).toBe(120);
    expect(rosterEvents()).toEqual([
      { type: 'rosterEvent', id: 1, kind: 'levelUp', amount: 120, level: 2, signal: 'pr' },
    ]);
    expect(log.mock.calls.flat().join('\n')).not.toContain('pr-link');
  });

  it('gh pr merge pays +200 when it succeeds and nothing when it fails (C4)', () => {
    const agent = addAgent();

    bash('m1', 'gh pr merge 42 --squash', {
      isError: true,
      stdout: 'Exit code 1\nPull request acme/app#42 is not mergeable',
    });
    expect(xpOf(agent)).toBe(0);
    bash('m2', 'gh pr merge 42 --squash');
    expect(xpOf(agent)).toBe(200);
  });

  it('green tests pay +40 once per turn after an edit; without one, or red, they pay nothing (C5)', () => {
    const agent = addAgent();

    bash('t1', 'npm test', { stdout: VITEST_GREEN });
    expect(xpOf(agent)).toBe(0);
    edit('e1');
    bash('t2', 'npm test', { stdout: VITEST_RED });
    expect(xpOf(agent)).toBe(0);
    bash('t3', 'npx vitest run', { stdout: VITEST_GREEN });
    expect(xpOf(agent)).toBe(40);
    edit('e2');
    bash('t4', 'npm test', { stdout: VITEST_GREEN });
    expect(xpOf(agent)).toBe(40);
  });

  it('a paid green run spends its edit, even across turns, and each turn has its own cap (C5)', () => {
    const agent = addAgent();

    edit('e1');
    bash('t1', 'npm test', { stdout: VITEST_GREEN });
    expect(xpOf(agent)).toBe(40);
    line({ type: 'user', message: { role: 'user', content: 'next task' } });
    bash('t2', 'npm test', { stdout: VITEST_GREEN });
    expect(xpOf(agent)).toBe(40);
    edit('e2');
    bash('t3', 'npm test', { stdout: VITEST_GREEN });
    expect(xpOf(agent)).toBe(80);
  });

  it('only the lead pays: a sidechain record or a teammate transcript earns nothing', () => {
    const lead = addAgent({ id: 1, sessionId: 'sess-1' });
    const mate = addAgent({ id: 2, sessionId: 'mate', leadAgentId: 1, agentName: 'mate' });
    const commit = (sha: string) => ({ stdout: `[main ${sha}] work\n` });

    bash('s1', 'git commit -m work', commit('aaaaaaa'), { extra: { isSidechain: true } });
    bash('s2', 'git commit -m work', commit('bbbbbbb'), { agentId: 2 });
    expect([xpOf(lead), xpOf(mate)]).toEqual([0, 0]);

    bash('s3', 'git commit -m work', commit('ccccccc'));
    expect([xpOf(lead), xpOf(mate)]).toEqual([60, 0]);
  });

  it('a record carrying two tool_results pays nothing: its streams may belong to the other call', () => {
    const agent = addAgent();
    line({
      type: 'assistant',
      message: {
        content: [
          { type: 'tool_use', id: 'q1', name: 'Bash', input: { command: 'git commit -q -m x' } },
          { type: 'tool_use', id: 'q2', name: 'Bash', input: { command: 'cat commit.log' } },
        ],
      },
    });
    line({
      type: 'user',
      message: {
        content: [
          { type: 'tool_result', tool_use_id: 'q1', content: '', is_error: false },
          { type: 'tool_result', tool_use_id: 'q2', content: '[main 1234567] x', is_error: false },
        ],
      },
      toolUseResult: { stdout: '[main 1234567] x\n', stderr: '' },
    });

    expect(xpOf(agent)).toBe(0);
  });

  it('a transcript turn_duration never pays (R4b)', () => {
    const agent = addAgent();
    processTranscriptLine(
      1,
      JSON.stringify({ type: 'system', subtype: 'turn_duration', durationMs: 1000 }),
      store,
      new Map(),
      new Map(),
    );
    expect(xpOf(agent)).toBe(0);
  });
});

describe('mood from hooks (C6)', () => {
  const failTool = (handler: HookEventHandler) => {
    handler.handleEvent(
      'claude',
      hook('PreToolUse', { tool_name: 'Bash', tool_input: { command: 'make' } }),
    );
    handler.handleEvent('claude', hook('PostToolUseFailure'));
  };
  const passTool = (handler: HookEventHandler) => {
    handler.handleEvent(
      'claude',
      hook('PreToolUse', { tool_name: 'Bash', tool_input: { command: 'make' } }),
    );
    handler.handleEvent('claude', hook('PostToolUse'));
  };

  it('real work makes the member happy, a failed tool ends it, three in a row frustrate it', () => {
    const handler = setup();
    addAgent();
    handler.registerAgent('sess-1', 1);

    bash('c1', 'git commit -m work', { stdout: '[main 1234567] work\n' });
    expect(lastMood()).toBe('happy');
    failTool(handler);
    expect(lastMood()).toBe('neutral');
    failTool(handler);
    failTool(handler);
    expect(lastMood()).toBe('frustrated');
  });

  it('a successful tool clears the failures: fail, fail, success, fail is neutral', () => {
    const handler = setup();
    addAgent();
    handler.registerAgent('sess-1', 1);

    failTool(handler);
    failTool(handler);
    passTool(handler);
    failTool(handler);
    expect(lastMood()).toBe('neutral');
  });

  it('an alarm turns the member alarmed (R6 mood)', () => {
    const handler = setup();
    addAgent();
    handler.registerAgent('sess-1', 1);

    handler.handleEvent(
      'claude',
      hook('PreToolUse', { tool_name: 'Read', tool_input: { file_path: '/x/.env' } }),
    );
    expect(sent.filter((m) => m.type === 'agentRoster').at(-1)).toMatchObject({ mood: 'alarmed' });
  });
});

describe('roster file contents (R6)', () => {
  it('holds counts only: no title, command, commit or transcript path', () => {
    const agent = addAgent({
      customTitle: 'Secret Title Alpha',
      jsonlFile: '/secret/transcript-path.jsonl',
      folderName: 'shown-folder',
    });

    bash('c1', 'git commit -m secret-message-beta', {
      stdout: '[main 7c0ffee] secret-message-beta\n',
    });
    expect(xpOf(agent)).toBe(60);
    roster.flush();

    const text = fs.readFileSync(rosterFile, 'utf-8');
    expect(text).toContain('shown-folder');
    for (const secret of [
      'Secret Title Alpha',
      'secret-message-beta',
      'transcript-path',
      'git commit',
      '7c0ffee',
    ]) {
      expect(text).not.toContain(secret);
    }
  });
});
