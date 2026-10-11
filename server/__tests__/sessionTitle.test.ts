import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AgentStateStore } from '../src/agentStateStore.js';
import { SESSION_TITLE_MAX_LENGTH } from '../src/constants.js';
import { startFileWatching } from '../src/fileWatcher.js';
import { claudeProvider } from '../src/providers/hook/claude/claude.js';
import { seedSessionTitle } from '../src/sessionTitle.js';
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

const custom = (customTitle: unknown) => ({ type: 'custom-title', customTitle });
const ai = (aiTitle: unknown) => ({ type: 'ai-title', aiTitle });

describe('session title', () => {
  let tmpDir: string;
  let agents: AgentStateStore;
  let agent: AgentState;
  let messages: Array<Record<string, unknown>>;
  const waitingTimers = new Map<number, ReturnType<typeof setTimeout>>();
  const permissionTimers = new Map<number, ReturnType<typeof setTimeout>>();

  beforeEach(() => {
    setHookProvider(claudeProvider);
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pixel-agents-title-'));
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
  const titleMessages = () => messages.filter((m) => m.type === 'agentSessionTitle');

  function writeTranscript(name: string, records: unknown[]): string {
    const file = path.join(tmpDir, name);
    fs.writeFileSync(file, records.map((r) => JSON.stringify(r)).join('\n') + '\n');
    return file;
  }

  /** A titled file with enough unrelated lines after the title to be a real tail read. */
  function titledFile(name: string, title = 'Fix login bug'): string {
    const filler = Array.from({ length: 200 }, () => ({ type: 'user', message: { content: 'x' } }));
    return writeTranscript(name, [custom(title), ...filler]);
  }

  /** An agent adopted mid-session: its offset is already at end-of-file. */
  function adoptedAt(file: string, overrides: Partial<AgentState> = {}): AgentState {
    const adopted = createTestAgent({
      jsonlFile: file,
      fileOffset: fs.statSync(file).size,
      ...overrides,
    });
    agents.set(1, adopted);
    return adopted;
  }

  it('broadcasts a custom-title record as the agent title', () => {
    feed(custom('Fix login bug'));

    expect(titleMessages()).toEqual([{ type: 'agentSessionTitle', id: 1, title: 'Fix login bug' }]);
  });

  it('prefers the custom title over the generated one, whatever order they arrive in', () => {
    feed(ai('Generated name'));
    feed(custom('My name'));
    expect(titleMessages().at(-1)?.title).toBe('My name');

    const before = titleMessages().length;
    feed(ai('A later generated name'));
    expect(titleMessages()).toHaveLength(before);
    expect(agent.customTitle).toBe('My name');
  });

  it.each([
    ['empty string', ''],
    ['blank string', '   '],
    ['null', null],
    ['number', 42],
  ])('treats a %s title as absent', (_name, value) => {
    feed(custom(value));
    feed(ai(value));

    expect(titleMessages()).toHaveLength(0);
    expect(agent.customTitle).toBeUndefined();
    expect(agent.aiTitle).toBeUndefined();
  });

  it('trims a title and caps it at the maximum length', () => {
    feed(custom('  padded  '));
    expect(agent.customTitle).toBe('padded');

    feed(custom('a'.repeat(SESSION_TITLE_MAX_LENGTH + 100)));
    expect(agent.customTitle).toHaveLength(SESSION_TITLE_MAX_LENGTH);
  });

  it('stays silent when the same title repeats', () => {
    for (let i = 0; i < 3; i++) feed(ai('Same name'));

    expect(titleMessages()).toHaveLength(1);
  });

  describe('seedSessionTitle', () => {
    it('finds a title far behind the end of the file for an agent adopted at EOF', () => {
      const adopted = adoptedAt(titledFile('titled.jsonl'));

      seedSessionTitle(1, agents, claudeProvider);

      expect(adopted.customTitle).toBe('Fix login bug');
      expect(titleMessages()).toEqual([
        { type: 'agentSessionTitle', id: 1, title: 'Fix login bug' },
      ]);
    });

    it('prefers the newest custom title and keeps looking for it past a generated one', () => {
      const file = writeTranscript('mixed.jsonl', [
        custom('Old name'),
        custom('New name'),
        ai('Generated'),
      ]);
      adoptedAt(file);

      seedSessionTitle(1, agents, claudeProvider);

      expect(titleMessages().at(-1)?.title).toBe('New name');
    });

    it('stays quiet for an untitled transcript and for a missing file', () => {
      adoptedAt(writeTranscript('plain.jsonl', [{ type: 'user', message: { content: 'hi' } }]));
      seedSessionTitle(1, agents, claudeProvider);

      agents.set(
        1,
        createTestAgent({ jsonlFile: path.join(tmpDir, 'gone.jsonl'), fileOffset: 10 }),
      );
      expect(() => seedSessionTitle(1, agents, claudeProvider)).not.toThrow();

      expect(titleMessages()).toHaveLength(0);
    });

    it('clears a known title when the agent moves to a transcript without one', () => {
      const adopted = adoptedAt(titledFile('before.jsonl'));
      seedSessionTitle(1, agents, claudeProvider);
      messages.length = 0;

      const next = writeTranscript('after.jsonl', [{ type: 'user', message: { content: 'hi' } }]);
      adopted.jsonlFile = next;
      adopted.fileOffset = fs.statSync(next).size;
      seedSessionTitle(1, agents, claudeProvider);

      expect(titleMessages()).toEqual([{ type: 'agentSessionTitle', id: 1 }]);
      expect(adopted.customTitle).toBeUndefined();
    });

    it('leaves a file read from the start to the live replay', () => {
      const file = titledFile('fresh.jsonl');
      adoptedAt(file, { fileOffset: 0 });

      seedSessionTitle(1, agents, claudeProvider);

      expect(titleMessages()).toHaveLength(0);
    });

    it('runs from startFileWatching, the seam every watched agent passes through', () => {
      adoptedAt(titledFile('watched.jsonl'));
      const pollingTimers = new Map<number, ReturnType<typeof setInterval>>();

      startFileWatching(1, '', agents, new Map(), pollingTimers, waitingTimers, permissionTimers);
      for (const timer of pollingTimers.values()) clearInterval(timer);

      expect(titleMessages()).toEqual([
        { type: 'agentSessionTitle', id: 1, title: 'Fix login bug' },
      ]);
    });
  });
});
