import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// fileWatcher.ts imports 'vscode' at load; only its terminal APIs are touched at runtime.
vi.mock('vscode', () => ({ window: { activeTerminal: undefined, terminals: [] } }));

import { AgentStateStore } from '../src/agentStateStore.js';
import { EXTERNAL_SCAN_INTERVAL_MS } from '../src/constants.js';
import { DismissalTracker } from '../src/dismissalTracker.js';
import {
  reassignAgentToFile,
  setDismissalTracker,
  setHookProvider as setWatcherProvider,
  startExternalSessionScanning,
  startFileWatching,
} from '../src/fileWatcher.js';
import { PathSet } from '../src/pathKey.js';
import { claudeProvider } from '../src/providers/hook/claude/claude.js';
import { costFromRecord, costTotal, newCostTrack, seedSessionMeta } from '../src/sessionMeta.js';
import { processTranscriptLine, setHookProvider } from '../src/transcriptParser.js';
import type { AgentState } from '../src/types.js';

function createTestAgent(overrides: Partial<AgentState> = {}): AgentState {
  return {
    id: 1,
    sessionId: '0a1b2c3d-aaaa-bbbb-cccc-111122223333',
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
const HOUR_MS = 3_600_000;

const onBranch = (branch: string, offsetMs = 0) => ({
  type: 'user',
  timestamp: at(offsetMs),
  gitBranch: branch,
  cwd: '/work/my-repo',
  message: { content: 'go' },
});
const costRow = (totalCostUSD: number) => ({ type: 'cost-state', totalCostUSD });

describe('session meta', () => {
  let tmpDir: string;
  let agents: AgentStateStore;
  let agent: AgentState;
  let messages: Array<Record<string, unknown>>;
  const waitingTimers = new Map<number, ReturnType<typeof setTimeout>>();
  const permissionTimers = new Map<number, ReturnType<typeof setTimeout>>();

  beforeEach(() => {
    setHookProvider(claudeProvider);
    setDismissalTracker(new DismissalTracker());
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pixel-agents-meta-'));
    agents = new AgentStateStore();
    agent = createTestAgent();
    agents.set(1, agent);
    messages = [];
    agents.on('broadcast', (msg) => messages.push(msg as Record<string, unknown>));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const feed = (record: unknown) =>
    processTranscriptLine(1, JSON.stringify(record), agents, waitingTimers, permissionTimers);
  const sessionMessages = () => messages.filter((m) => m.type === 'agentSession');
  const lastSession = () => sessionMessages().at(-1);

  function writeTranscript(name: string, records: unknown[]): string {
    const file = path.join(tmpDir, name);
    fs.writeFileSync(file, records.map((r) => JSON.stringify(r)).join('\n') + '\n');
    return file;
  }

  /** An agent adopted mid-session: its offset is at end-of-file, or at `offset`. */
  function adoptedAt(file: string, offset = fs.statSync(file).size): AgentState {
    const adopted = createTestAgent({ jsonlFile: file, fileOffset: offset });
    agents.set(1, adopted);
    return adopted;
  }

  const seed = () => seedSessionMeta(1, agents, claudeProvider);

  /** Start watching the way the runtime does: the seed, then the history scan that reads the
   *  rows before the offset. The cost is shown once the scan has been joined to the live rows. */
  function watch(): void {
    const timers = new Map<number, ReturnType<typeof setInterval>>();
    startFileWatching(1, '', agents, new Map(), timers, waitingTimers, permissionTimers);
    for (const timer of timers.values()) clearInterval(timer);
  }
  const costShown = () => vi.waitFor(() => expect(lastSession()).toHaveProperty('costUsd'));

  describe('start', () => {
    it('C1.1 is the first timestamped record: a metadata row on line 1 does not count', () => {
      const file = writeTranscript('s.jsonl', [
        { type: 'last-prompt', lastPrompt: 'hi' },
        { type: 'attachment', timestamp: at(0), attachment: {} },
        onBranch('main', HOUR_MS),
      ]);
      adoptedAt(file);

      seed();

      expect(lastSession()).toMatchObject({ startedAt: T0, sessionId8: '0a1b2c3d' });
    });

    it('stops looking past the head window: a timestamp beyond it is none', () => {
      const pad = { type: 'last-prompt', lastPrompt: 'x'.repeat(1000) };
      const file = writeTranscript('s.jsonl', [
        ...Array.from({ length: 300 }, () => pad), // > 256 KiB of rows with no timestamp
        onBranch('main'),
      ]);
      adoptedAt(file);

      seed();

      expect(lastSession()).toMatchObject({ branch: 'main' });
      expect(lastSession()).not.toHaveProperty('startedAt');
    });

    it('a file still empty at the start takes its first live record as the start', () => {
      const file = path.join(tmpDir, 'new.jsonl');
      fs.writeFileSync(file, '');
      adoptedAt(file, 0);
      seed();

      feed(onBranch('main', 0));
      feed(onBranch('main', HOUR_MS));

      expect(lastSession()).toMatchObject({ startedAt: T0 });
    });
  });

  describe('branch', () => {
    it('C1.2 is the last record after a checkout mid-file, at adoption', () => {
      const file = writeTranscript('s.jsonl', [
        onBranch('main', 0),
        onBranch('main', 1000),
        onBranch('feat/login', 2000),
      ]);
      adoptedAt(file);

      seed();

      expect(lastSession()).toMatchObject({ branch: 'feat/login' });
    });

    it('follows a checkout live and stays silent while records repeat the branch', () => {
      feed(onBranch('main', 0));
      feed(onBranch('main', 1000));
      feed(onBranch('main', 2000));
      feed(onBranch('feat/login', 3000));
      feed({ type: 'assistant', timestamp: at(4000), message: { content: [] } });

      expect(sessionMessages().map((m) => m.branch)).toEqual(['main', 'feat/login']);
    });

    it('is cut at 120 code points and flattened to one line', () => {
      feed(onBranch(`feat/\n${'😀'.repeat(130)}`));

      const branch = lastSession()?.branch as string;
      expect(Array.from(branch)).toHaveLength(120);
      expect(branch).toBe(`feat/ ${'😀'.repeat(114)}`);
    });
  });

  describe('cost', () => {
    it('C1.3 is absent without a cost-state row, and a row of 0 is a real 0', () => {
      feed(onBranch('main', 0));
      expect(lastSession()).not.toHaveProperty('costUsd');
      expect(lastSession()).not.toHaveProperty('costAt');

      feed(costRow(0));
      expect(lastSession()).toMatchObject({ costUsd: 0, costAt: T0 });
    });

    it('C1.6 sums the last value of every process: a drop starts a new one', () => {
      for (const value of [1.0, 2.0, 0.3, 0.9]) feed(costRow(value));

      expect(lastSession()?.costUsd).toBeCloseTo(2.9, 10);
    });

    it('C1.6 the exported fold gives the same total over a stream, and dates a row by the record before it', () => {
      const stream = [
        onBranch('main', 0),
        costRow(1.0),
        costRow(1.0), // re-appended all session
        onBranch('main', HOUR_MS),
        costRow(0.4), // resume: a new process
      ];
      const track = newCostTrack();
      const moved = stream.map((record) => costFromRecord(track, record, claudeProvider));

      expect(moved).toEqual([false, true, false, false, true]);
      expect(costTotal(track)).toBeCloseTo(1.4, 10);
      expect(track.at).toBe(T0 + HOUR_MS);
    });

    it('an adopted agent counts the rows before its offset once, and those after it once', async () => {
      // Drops make a double read visible: [9] | [5, 3] folded twice reads 22, not 17.
      const file = writeTranscript('s.jsonl', [
        onBranch('main'),
        costRow(9),
        costRow(5),
        costRow(3),
      ]);
      const offset = Buffer.byteLength(
        [onBranch('main'), costRow(9)].map((r) => JSON.stringify(r) + '\n').join(''),
      );
      adoptedAt(file, offset);

      watch();
      await costShown();
      expect(lastSession()?.costUsd).toBe(9);
      feed(costRow(5));
      feed(costRow(3));

      expect(lastSession()?.costUsd).toBe(17);
    });

    it('C1.8 an earlier process whose rows sit before the tail window still counts', async () => {
      // 10 (a process that ended) | 300 KiB of other records | 4 (the process running now).
      const filler = Array.from({ length: 300 }, () => ({
        type: 'user',
        timestamp: at(0),
        message: { content: 'x'.repeat(1024) },
      }));
      const file = writeTranscript('s.jsonl', [costRow(10), ...filler, costRow(4)]);
      adoptedAt(file);

      watch();
      await costShown();

      expect(lastSession()?.costUsd).toBe(14);
    });

    // History is [10, 4]: one process ended at 10, the running one is at 4.
    it.each([
      { live: 3, total: 17, joins: 'a lower counter is a new process: 10 + 4 + 3' },
      { live: 6, total: 16, joins: 'a higher counter continues the running one: 10 + 6' },
    ])(
      'C1.9 a row read live while the scan is out joins history ($joins), never shown alone',
      async ({ live, total }) => {
        const file = writeTranscript('s.jsonl', [onBranch('main'), costRow(10), costRow(4)]);
        adoptedAt(file);

        watch();
        feed(costRow(live));
        expect(sessionMessages().filter((m) => 'costUsd' in m)).toEqual([]);
        await costShown();

        expect(sessionMessages().filter((m) => 'costUsd' in m)).toHaveLength(1);
        expect(lastSession()?.costUsd).toBe(total);
      },
    );

    it(
      'C1.10 a scan the budget cut shows the cost of the window before the offset: a floor',
      { timeout: 20_000 },
      async () => {
        // 10 | a 65 MiB hole the budget ends in | 4. The scan reaches only the 10; the window
        // before the offset holds the 4 of the process running now.
        const file = writeTranscript('s.jsonl', [costRow(10)]);
        fs.truncateSync(file, fs.statSync(file).size + 65 * 1024 * 1024);
        fs.appendFileSync(file, '\n' + JSON.stringify(costRow(4)) + '\n');
        adoptedAt(file);

        watch();
        await vi.waitFor(() => expect(lastSession()).toHaveProperty('costUsd'), {
          timeout: 15_000,
        });

        expect(lastSession()?.costUsd).toBe(4);
      },
    );

    it('a file read from the top is folded by its live replay alone', () => {
      const rows = [onBranch('main'), costRow(5), costRow(3)];
      const file = writeTranscript('s.jsonl', rows);
      adoptedAt(file, 0);

      seed();
      expect(lastSession()).not.toHaveProperty('costUsd');
      for (const row of rows) feed(row);

      expect(lastSession()?.costUsd).toBe(8);
    });
  });

  describe('a new transcript on the same agent', () => {
    it('is read afresh: branch, start, id and cost belong to the new file only', async () => {
      const first = writeTranscript('first.jsonl', [onBranch('main', 0), costRow(5)]);
      adoptedAt(first);
      watch();
      await costShown();
      expect(lastSession()).toMatchObject({ branch: 'main', costUsd: 5, startedAt: T0 });

      const next = writeTranscript('7e8f9a0b-1111-2222-3333-444455556666.jsonl', [
        { type: 'attachment', timestamp: at(2 * HOUR_MS), attachment: {} },
      ]);
      reassignAgentToFile(
        1,
        next,
        agents,
        new Map(),
        new Map(),
        waitingTimers,
        permissionTimers,
        () => {},
      );

      expect(lastSession()).toEqual({
        type: 'agentSession',
        id: 1,
        startedAt: T0 + 2 * HOUR_MS,
        sessionId8: '7e8f9a0b',
      });
    });
  });

  describe('privacy', () => {
    it('C1.4 a branch and a title never reach the log', () => {
      const logged: unknown[][] = [];
      const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) =>
        vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
          logged.push(args);
        }),
      );
      try {
        const file = writeTranscript('s.jsonl', [
          { type: 'ai-title', aiTitle: 'CANARY title 91c2' },
          onBranch('feat/CANARY-branch-7f3a', 0),
        ]);
        adoptedAt(file);
        seed();
        feed({ type: 'custom-title', customTitle: 'CANARY title 91c2 renamed' });
        feed(onBranch('feat/CANARY-branch-live', 1000));
        expect(lastSession()).toMatchObject({ branch: 'feat/CANARY-branch-live' });
      } finally {
        for (const spy of spies) spy.mockRestore();
      }

      expect(JSON.stringify(logged)).not.toContain('CANARY');
    });
  });

  describe('folder of a scan-adopted agent', () => {
    let root: string;

    beforeEach(() => {
      root = path.join(tmpDir, 'projects');
      fs.mkdirSync(root);
      setWatcherProvider({ ...claudeProvider, getAllSessionRoots: () => [root] });
    });

    afterEach(() => {
      setWatcherProvider(claudeProvider);
    });

    /** Run one global scan over `root` and return the folder name each adopted file got. */
    function scanFolders(): Map<string, string | undefined> {
      vi.useFakeTimers();
      const store = new AgentStateStore();
      const pollingTimers = new Map<number, ReturnType<typeof setInterval>>();
      const timer = startExternalSessionScanning(
        path.join(tmpDir, 'workspace'),
        new PathSet(),
        { current: 1 },
        store,
        new Map(),
        pollingTimers,
        waitingTimers,
        permissionTimers,
        new Map(),
        () => {},
        { current: true },
        { current: false },
      );
      vi.advanceTimersByTime(EXTERNAL_SCAN_INTERVAL_MS);
      clearInterval(timer);
      for (const t of pollingTimers.values()) clearInterval(t);
      vi.useRealTimers();
      return new Map([...store.values()].map((a) => [path.basename(a.jsonlFile), a.folderName]));
    }

    function writeSession(dir: string, name: string, cwd: string | undefined): void {
      fs.mkdirSync(path.join(root, dir), { recursive: true });
      const rows = Array.from({ length: 40 }, () => ({
        type: 'user',
        timestamp: new Date().toISOString(),
        ...(cwd ? { cwd } : {}),
        message: { content: 'x'.repeat(100) },
      }));
      fs.writeFileSync(
        path.join(root, dir, name),
        rows.map((r) => JSON.stringify(r)).join('\n') + '\n',
      );
    }

    it('C1.5 takes the folder the transcript was written in, not the last hyphen of the hashed dir', () => {
      writeSession('-work-my-repo', 'with-cwd.jsonl', '/work/my-repo');
      writeSession('-work-other-repo', 'no-cwd.jsonl', undefined);

      const folders = scanFolders();

      // No cwd anywhere in the file: the hashed dir is all there is, as before.
      expect(Object.fromEntries(folders)).toEqual({
        'with-cwd.jsonl': 'my-repo',
        'no-cwd.jsonl': 'repo',
      });
    });
  });
});
