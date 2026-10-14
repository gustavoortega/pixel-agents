import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentStateStore } from '../src/agentStateStore.js';
import { DismissalTracker } from '../src/dismissalTracker.js';
import { reassignAgentToFile, setDismissalTracker, startFileWatching } from '../src/fileWatcher.js';
import { registerHistoryConsumer } from '../src/historyScan.js';
import { claudeProvider } from '../src/providers/hook/claude/claude.js';
import { processTranscriptLine, setHookProvider } from '../src/transcriptParser.js';
import type { AgentState } from '../src/types.js';

function createTestAgent(overrides: Partial<AgentState> = {}): AgentState {
  return {
    id: 1,
    sessionId: 'session',
    terminalRef: undefined,
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

const T0 = Date.parse('2026-10-12T10:00:00.000Z');
const at = (offsetMs: number) => new Date(T0 + offsetMs).toISOString();
const MIB = 1024 * 1024;
/** A scan that reads past 64 MiB takes a moment; the default wait is one second. */
const SCAN_WAIT = { timeout: 15_000 };

type Rec = Record<string, unknown>;

function toolUse(id: string, name: string, input: unknown, t: number): Rec {
  return {
    type: 'assistant',
    timestamp: at(t),
    message: { content: [{ type: 'tool_use', id, name, input }] },
  };
}

function toolResult(
  id: string,
  toolUseResult: unknown,
  t: number,
  opts: { content?: unknown; isError?: boolean } = {},
): Rec {
  return {
    type: 'user',
    timestamp: at(t),
    message: {
      content: [
        {
          type: 'tool_result',
          tool_use_id: id,
          content: opts.content ?? 'ok',
          ...(opts.isError && { is_error: true }),
        },
      ],
    },
    toolUseResult,
  };
}

const urlOf = (name: string) => `https://claude.ai/artifact/${name}`;

/** A page publish as the transcript holds it: the call, then its result with the page's url. */
function publish(
  id: string,
  name: string,
  title: string,
  t: number,
  input: Rec = { file_path: '/tmp/page.html', icon: 'chart' },
): Rec[] {
  return [
    toolUse(id, 'Artifact', input, t),
    toolResult(
      id,
      { url: urlOf(name), artifact_id: name, title, updated: false, audience: 'owner' },
      t + 1,
    ),
  ];
}

const fireRecord = (t: number, extra: Rec = { taskKind: 'loop', cronKind: 'loop' }): Rec => ({
  type: 'system',
  subtype: 'scheduled_task_fire',
  timestamp: at(t),
  ...extra,
});

/** ScheduleWakeup's call and its result, which names the wake in epoch ms. */
const wakeup = (id: string, scheduledFor: number, t: number): Rec[] => [
  toolUse(id, 'ScheduleWakeup', { delaySeconds: 1800, reason: 'check', prompt: 'p' }, t),
  toolResult(id, { scheduledFor, clampedDelaySeconds: 1800, wasClamped: false }, t + 1),
];

describe('artifacts, loop and tests', () => {
  let tmpDir: string;
  let agents: AgentStateStore;
  let agent: AgentState;
  let messages: Array<Record<string, unknown>>;
  const waitingTimers = new Map<number, ReturnType<typeof setTimeout>>();
  const permissionTimers = new Map<number, ReturnType<typeof setTimeout>>();
  const pollingTimers = new Map<number, ReturnType<typeof setInterval>>();

  beforeEach(() => {
    setHookProvider(claudeProvider);
    setDismissalTracker(new DismissalTracker());
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pixel-agents-history-'));
    agents = new AgentStateStore();
    agent = createTestAgent();
    agents.set(1, agent);
    messages = [];
    agents.on('broadcast', (msg) => messages.push(msg as Rec));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    for (const timer of pollingTimers.values()) clearInterval(timer);
    pollingTimers.clear();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const feed = (...records: Rec[]) => {
    for (const record of records) {
      processTranscriptLine(1, JSON.stringify(record), agents, waitingTimers, permissionTimers);
    }
  };
  const sent = (type: string) => messages.filter((m) => m.type === type);
  const lastSent = (type: string) => sent(type).at(-1);

  function writeTranscript(name: string, records: Rec[]): string {
    const file = path.join(tmpDir, name);
    fs.writeFileSync(file, records.map((r) => JSON.stringify(r)).join('\n') + '\n');
    return file;
  }

  /** Adopt a transcript at its end, as a restart or a scan does, and start watching it. */
  function adopt(file: string): void {
    agent = createTestAgent({ jsonlFile: file, fileOffset: fs.statSync(file).size });
    agents.set(1, agent);
    startFileWatching(1, '', agents, new Map(), pollingTimers, waitingTimers, permissionTimers);
  }

  /** Resolves when the next history scan ends, so a test leaves no scan running into the next. */
  function nextScanEnd(): Promise<void> {
    return new Promise((resolve) => {
      const leave = registerHistoryConsumer({
        record: () => {},
        done: () => {
          leave();
          resolve();
        },
      });
    });
  }

  describe('artifacts', () => {
    it('C3.1 a publish and its redeploy are one entry: counted per url, with the newer title', () => {
      feed(
        ...publish('t1', 'plan', 'Plan v1', 0),
        // A redeploy names the page by its file, not its url: only the result's url keys it.
        ...publish('t2', 'plan', 'Plan v2', 10_000, { file_path: '/tmp/page.html', label: 'fix' }),
      );

      expect(lastSent('agentArtifacts')).toEqual({
        type: 'agentArtifacts',
        id: 1,
        count: 1,
        complete: true,
        items: [{ title: 'Plan v2', url: urlOf('plan'), publishes: 2, at: T0 + 10_001 }],
      });
    });

    // A11: only a page publish counts. Each row is the whole record pair the transcript holds.
    const rows: Array<{
      name: string;
      call: Rec;
      result: unknown;
      isError?: boolean;
      count: 0 | 1;
    }> = [
      {
        name: 'publish',
        call: { file_path: '/tmp/a.html' },
        result: { url: urlOf('a'), artifact_id: 'a', title: 'A' },
        count: 1,
      },
      {
        name: 'redeploy by url',
        call: { action: 'publish', url: urlOf('a'), file_path: '/tmp/a.html' },
        result: { url: urlOf('a'), artifact_id: 'a', title: 'A', updated: true },
        count: 1,
      },
      {
        name: 'read',
        call: { action: 'read', url: urlOf('a') },
        result: { file_read: { url: urlOf('a'), path: '/tmp/a.html', size_bytes: 3 } },
        count: 0,
      },
      { name: 'list', call: { action: 'list' }, result: 'ok', count: 0 },
      {
        name: 'open',
        call: { action: 'open', url: urlOf('a') },
        result: 'Opened the Artifact',
        count: 0,
      },
      {
        name: 'quickstart',
        call: { action: 'quickstart', intent: 'slides' },
        result: { quickstart: { intent: 'slides', types: [] } },
        count: 0,
      },
      {
        name: 'asset upload',
        call: { action: 'publish', url: urlOf('a'), asset: true, file_path: '/tmp/i.png' },
        result: { written: { url: urlOf('a') + '/i.png' }, asset_upload: { id: 'x' } },
        count: 0,
      },
      {
        name: 'create from type',
        call: { type_url: 'https://claude.ai/type/deck', title: 'Deck' },
        result: { created_from_type: true, url: urlOf('deck'), title: 'Deck' },
        count: 0,
      },
      {
        name: 'failed publish that still echoes a url',
        call: { file_path: '/tmp/a.html' },
        result: { url: urlOf('a'), title: 'A' },
        isError: true,
        count: 0,
      },
    ];

    it.each(rows)('C3.2 $name counts $count', ({ call, result, isError, count }) => {
      feed(
        toolUse('t1', 'Artifact', call, 0),
        toolResult('t1', result, 1, {
          isError,
          content: typeof result === 'string' ? result : 'ok',
        }),
      );

      const view = lastSent('agentArtifacts');
      if (count === 0) expect(view).toBeUndefined();
      else expect(view).toMatchObject({ count: 1 });
    });

    it('a sub-agent record in the file is not the agent’s own publish', () => {
      feed(...publish('t1', 'a', 'A', 0).map((r) => ({ ...r, isSidechain: true })));

      expect(sent('agentArtifacts')).toEqual([]);
    });

    it('caps and flattens a title and drops a url that is not http(s)', () => {
      const long = 'x'.repeat(200);
      feed(
        ...publish('t1', 'a', `Q3\n‮plan\t${long}`, 0),
        toolUse('t2', 'Artifact', { file_path: '/tmp/b.html' }, 5),
        toolResult('t2', { url: 'javascript:alert(1)', title: 'B' }, 6),
      );

      const view = lastSent('agentArtifacts') as { count: number; items: Array<{ title: string }> };
      expect(view.count).toBe(1);
      expect(view.items[0].title.startsWith('Q3 plan xxx')).toBe(true);
      expect(Array.from(view.items[0].title)).toHaveLength(120);
    });

    it('C3.3 an agent adopted mid-file shows what it published before, merged with what it publishes next', async () => {
      const file = writeTranscript('adopted.jsonl', [
        ...publish('t1', 'a', 'A v1', 0),
        ...publish('t2', 'a', 'A v2', 100),
        ...publish('t3', 'b', 'B', 200),
        ...wakeup('w1', T0 + 3_600_000, 300),
        toolUse('s1', 'Bash', { command: 'npm test' }, 400),
        toolResult('s1', { stdout: '', stderr: '' }, 401, {
          isError: true,
          content: 'Tests  4 passed | 2 failed (6)',
        }),
      ]);
      adopt(file);
      // The live path reads past the offset while the scan is still out: held, then merged.
      feed(
        ...publish('t4', 'a', 'A v3', 1_000),
        ...publish('t5', 'c', 'C', 1_100),
        fireRecord(1_200),
      );

      await vi.waitFor(() => expect(sent('agentArtifacts')).toHaveLength(1));

      expect(lastSent('agentArtifacts')).toEqual({
        type: 'agentArtifacts',
        id: 1,
        count: 3,
        complete: true,
        items: [
          { title: 'C', url: urlOf('c'), publishes: 1, at: T0 + 1_101 },
          { title: 'A v3', url: urlOf('a'), publishes: 3, at: T0 + 1_001 },
          { title: 'B', url: urlOf('b'), publishes: 1, at: T0 + 201 },
        ],
      });
      // The fire after the offset cleared the wake the history scheduled and is the first wake.
      expect(lastSent('agentLoop')).toEqual({ type: 'agentLoop', id: 1, wakes: 1 });
      expect(lastSent('agentTests')).toEqual({
        type: 'agentTests',
        id: 1,
        passed: 4,
        failed: 2,
        at: T0 + 401,
      });
    });

    it(
      'C3.4 a scan the budget cuts says so: a floor, no per-url publishes',
      { timeout: 20_000 },
      async () => {
        const file = writeTranscript('big.jsonl', publish('t1', 'a', 'A', 0));
        // A hole the scan must read through (sparse where the filesystem allows): the budget ends in it.
        fs.truncateSync(file, fs.statSync(file).size + 65 * MIB);
        adopt(file);

        await vi.waitFor(() => expect(sent('agentArtifacts')).toHaveLength(1), SCAN_WAIT);

        expect(lastSent('agentArtifacts')).toEqual({
          type: 'agentArtifacts',
          id: 1,
          count: 1,
          complete: false,
          items: [{ title: 'A', url: urlOf('a'), at: T0 + 1 }],
        });
      },
    );

    it(
      'C3.4 a cut scan that found nothing sends nothing, never a 0+',
      { timeout: 20_000 },
      async () => {
        const file = writeTranscript('empty.jsonl', [
          toolUse('t1', 'Read', { file_path: '/x' }, 0),
        ]);
        fs.truncateSync(file, fs.statSync(file).size + 65 * MIB);
        const seen: unknown[] = [];
        const leave = registerHistoryConsumer({
          record: () => {},
          done: (_id, ok) => seen.push(ok),
        });

        adopt(file);
        await vi.waitFor(() => expect(seen).toEqual([false]), SCAN_WAIT);
        leave();

        expect(sent('agentArtifacts')).toEqual([]);
        expect(agent.artifacts).toBeUndefined();
      },
    );

    it('C3.6 a title and a url reach the wire and never the log', async () => {
      const logged: string[] = [];
      for (const level of ['log', 'info', 'warn', 'error', 'debug'] as const) {
        vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
          logged.push(args.map(String).join(' '));
        });
      }
      // The call carries them too (a redeploy by url, a title): the parser logs a line per call.
      const named = (name: string): Rec => ({
        file_path: '/tmp/page.html',
        url: urlOf(name),
        title: name.replace('url', 'title'),
      });
      const file = writeTranscript(
        'private.jsonl',
        publish('t1', 'canary-url-old', 'canary-title-old', 0, named('canary-url-old')),
      );
      adopt(file);
      feed(...publish('t2', 'canary-url-new', 'canary-title-new', 1_000, named('canary-url-new')));
      await vi.waitFor(() => expect(sent('agentArtifacts')).toHaveLength(1));

      expect(JSON.stringify(sent('agentArtifacts'))).toContain('canary-title-old');
      expect(JSON.stringify(sent('agentArtifacts'))).toContain('canary-url-new');
      expect(logged.join('\n')).not.toMatch(/canary-(title|url)/);
    });

    it('a new transcript on the same character clears what the old one published', async () => {
      const oldFile = writeTranscript('old.jsonl', [toolUse('t0', 'Read', {}, 0)]);
      const newFile = writeTranscript('new.jsonl', [toolUse('t0', 'Read', {}, 0)]);
      agent = createTestAgent({ jsonlFile: oldFile });
      agents.set(1, agent);
      feed(...publish('t1', 'a', 'A', 0), ...wakeup('w1', T0 + 60_000, 10));
      expect(agent.artifacts?.count).toBe(1);
      const scanned = nextScanEnd();

      reassignAgentToFile(
        1,
        newFile,
        agents,
        new Map(),
        pollingTimers,
        waitingTimers,
        permissionTimers,
        () => {},
      );

      expect(lastSent('agentArtifacts')).toEqual({ type: 'agentArtifacts', id: 1 });
      expect(lastSent('agentLoop')).toEqual({ type: 'agentLoop', id: 1 });
      expect(agent.artifacts).toBeUndefined();
      await scanned;
    });
  });

  describe('loop', () => {
    it('C3.5 a wake schedules, a fire clears it and counts, a stop clears the loop', () => {
      feed(...wakeup('w1', T0 + 1_800_000, 0));
      expect(lastSent('agentLoop')).toStrictEqual({
        type: 'agentLoop',
        id: 1,
        nextAt: T0 + 1_800_000,
      });

      feed(fireRecord(1_800_500));
      // Awake: no nextAt, and the one wake it took.
      expect(lastSent('agentLoop')).toStrictEqual({ type: 'agentLoop', id: 1, wakes: 1 });
      expect(agent.loop).toStrictEqual({ wakes: 1 });

      feed(...wakeup('w2', T0 + 3_600_000, 1_801_000));
      expect(lastSent('agentLoop')).toStrictEqual({
        type: 'agentLoop',
        id: 1,
        nextAt: T0 + 3_600_000,
        wakes: 1,
      });

      feed(
        toolUse('w3', 'ScheduleWakeup', { stop: true }, 2_000_000),
        toolResult(
          'w3',
          { scheduledFor: 0, clampedDelaySeconds: 0, wasClamped: false, stopped: true },
          2_000_001,
        ),
      );
      expect(lastSent('agentLoop')).toStrictEqual({ type: 'agentLoop', id: 1 });
      expect(agent.loop).toBeUndefined();
    });

    it('C3.5 a stop call clears the loop before its result is written', () => {
      feed(...wakeup('w1', T0 + 1_800_000, 0));

      feed(toolUse('w2', 'ScheduleWakeup', { stop: true }, 5_000));

      expect(lastSent('agentLoop')).toStrictEqual({ type: 'agentLoop', id: 1 });
    });

    it('C3.5 a stop result with a time of 0 and no stop call before it still clears the loop', () => {
      feed(...wakeup('w1', T0 + 1_800_000, 0));

      feed(toolResult('w2', { scheduledFor: 0, clampedDelaySeconds: 0, stopped: true }, 5_000));

      expect(lastSent('agentLoop')).toStrictEqual({ type: 'agentLoop', id: 1 });
    });

    it('C3.5 a cron job’s fire is not a wake of the loop', () => {
      feed(fireRecord(0, { cron: '*/5 * * * *' }));

      expect(sent('agentLoop')).toEqual([]);
    });
  });

  describe('tests', () => {
    it('a shell result’s summary is the last run, failures included; other tools’ text is not', () => {
      feed(
        toolUse('s1', 'Bash', { command: 'npx vitest run' }, 0),
        toolResult('s1', { stdout: '', stderr: '' }, 1, {
          isError: true,
          content: 'FAIL  a.test.ts\nTests  3 passed | 1 failed (4)',
        }),
        // A file that merely contains a summary line is not a run.
        toolUse('r1', 'Read', { file_path: '/log.txt' }, 10),
        toolResult('r1', undefined, 11, { content: 'Tests  99 passed (99)' }),
      );

      expect(sent('agentTests')).toEqual([
        { type: 'agentTests', id: 1, passed: 3, failed: 1, at: T0 + 1 },
      ]);
    });
  });

  describe('history consumers', () => {
    it('see the records before the watch offset in file order, and none after it', async () => {
      const before = [
        toolUse('t1', 'Read', {}, 0),
        toolResult('t1', undefined, 1),
        toolUse('t2', 'Read', {}, 2),
      ];
      const file = writeTranscript('consumed.jsonl', before);
      const seen: unknown[] = [];
      const ended: boolean[] = [];
      const leave = registerHistoryConsumer({
        record: (id, record) => seen.push([id, record]),
        done: (_id, complete) => ended.push(complete),
      });

      adopt(file);
      // Written after the offset was taken: the live reader's, never the scan's.
      fs.appendFileSync(file, JSON.stringify(toolUse('t3', 'Read', {}, 3)) + '\n');
      await vi.waitFor(() => expect(ended).toEqual([true]));
      leave();

      expect(seen).toEqual(before.map((record) => [1, record]));
    });
  });
});
