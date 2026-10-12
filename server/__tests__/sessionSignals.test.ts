import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AgentStateStore } from '../src/agentStateStore.js';
import { DismissalTracker } from '../src/dismissalTracker.js';
import { reassignAgentToFile, setDismissalTracker, startFileWatching } from '../src/fileWatcher.js';
import { claudeProvider } from '../src/providers/hook/claude/claude.js';
import { seedPermissionMode } from '../src/sessionSignals.js';
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
const HOUR_MS = 3_600_000;

const permissionModeRecord = (mode: unknown) => ({
  type: 'permission-mode',
  permissionMode: mode,
  sessionId: 'session',
});
const prompt = (mode: string) => ({
  type: 'user',
  permissionMode: mode,
  timestamp: at(0),
  message: { content: 'go' },
});

describe('session signals', () => {
  let tmpDir: string;
  let agents: AgentStateStore;
  let agent: AgentState;
  let messages: Array<Record<string, unknown>>;
  const waitingTimers = new Map<number, ReturnType<typeof setTimeout>>();
  const permissionTimers = new Map<number, ReturnType<typeof setTimeout>>();

  beforeEach(() => {
    setHookProvider(claudeProvider);
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pixel-agents-signals-'));
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
  const modeMessages = () => messages.filter((m) => m.type === 'agentMode');
  const signalMessages = () =>
    messages.filter((m) => ['agentCache', 'agentMode', 'agentShells'].includes(String(m.type)));

  function writeTranscript(name: string, records: unknown[]): string {
    const file = path.join(tmpDir, name);
    fs.writeFileSync(file, records.map((r) => JSON.stringify(r)).join('\n') + '\n');
    return file;
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

  describe('permission mode', () => {
    it('C2 a mode outside the protocol is dropped and the known one stays', () => {
      feed(permissionModeRecord('auto'));
      feed(permissionModeRecord('yolo'));

      expect(modeMessages()).toEqual([{ type: 'agentMode', id: 1, mode: 'auto' }]);
      expect(agent.permissionMode).toBe('auto');
    });

    it('says the mode once while every prompt repeats it, and again when it changes', () => {
      feed(prompt('auto'));
      feed(prompt('auto'));
      feed(prompt('auto'));
      feed(permissionModeRecord('plan'));

      expect(modeMessages()).toEqual([
        { type: 'agentMode', id: 1, mode: 'auto' },
        { type: 'agentMode', id: 1, mode: 'plan' },
      ]);
    });

    it('C13 a tail that states no mode leaves a known one alone, as after /clear', () => {
      const file = writeTranscript('cleared.jsonl', [{ type: 'user', message: { content: 'hi' } }]);
      const adopted = adoptedAt(file, { permissionMode: 'auto' });

      seedPermissionMode(1, agents, claudeProvider);

      expect(adopted.permissionMode).toBe('auto');
      expect(modeMessages()).toEqual([]);
    });
  });

  it('C13 watching a transcript adopted at its end seeds the cache clock and the newest stated mode, never shells', () => {
    const file = writeTranscript('adopted.jsonl', [
      prompt('plan'),
      // The mode changed after the prompt: this is the newest statement.
      permissionModeRecord('auto'),
      {
        type: 'assistant',
        timestamp: at(1_000),
        message: {
          id: 'msg_1',
          model: 'claude-opus-5',
          content: [
            {
              type: 'tool_use',
              id: 'toolu_1',
              name: 'Bash',
              input: { command: 'npm run dev', run_in_background: true },
            },
          ],
          usage: {
            input_tokens: 2,
            cache_creation_input_tokens: 900,
            cache_read_input_tokens: 50_000,
            output_tokens: 40,
            cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 900 },
          },
        },
      },
      {
        type: 'user',
        timestamp: at(2_000),
        message: {
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'toolu_1',
              content: 'Command running in background with ID: b1',
            },
          ],
        },
        toolUseResult: { stdout: '', stderr: '', backgroundTaskId: 'b1' },
      },
    ]);
    // A mode already known, as after a resume, still gives way to the tail's.
    const adopted = adoptedAt(file, { permissionMode: 'default' });
    const pollingTimers = new Map<number, ReturnType<typeof setInterval>>();

    startFileWatching(1, '', agents, new Map(), pollingTimers, waitingTimers, permissionTimers);
    for (const timer of pollingTimers.values()) clearInterval(timer);

    expect(signalMessages()).toEqual([
      { type: 'agentCache', id: 1, ttlSeconds: 3600, expiresAt: T0 + 1_000 + HOUR_MS },
      { type: 'agentMode', id: 1, mode: 'auto' },
    ]);
    expect(adopted.runningShellIds?.size ?? 0).toBe(0);
  });

  it('C11 moving to another transcript drops the old clock and shells before the new one seeds its own, and keeps the mode without a word', () => {
    setDismissalTracker(new DismissalTracker());
    const oldFile = writeTranscript('old.jsonl', [prompt('auto')]);
    // A resumed session's file already holds a turn that wrote the cache.
    const newFile = writeTranscript('new.jsonl', [
      {
        type: 'assistant',
        timestamp: at(5_000),
        message: {
          id: 'msg_2',
          model: 'claude-opus-5',
          content: [{ type: 'text', text: 'Back where we were.' }],
          usage: {
            input_tokens: 2,
            cache_creation_input_tokens: 900,
            cache_read_input_tokens: 50_000,
            output_tokens: 40,
            cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 900 },
          },
        },
      },
    ]);
    const cleared = adoptedAt(oldFile, {
      cacheTtlSeconds: 3600,
      cacheExpiresAt: T0 + HOUR_MS,
      cacheMessageId: 'msg_1',
      permissionMode: 'auto',
      runningShellIds: new Map([['toolu_1', 'b1']]),
    });
    const pollingTimers = new Map<number, ReturnType<typeof setInterval>>();

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
    for (const timer of pollingTimers.values()) clearInterval(timer);

    expect(signalMessages()).toEqual([
      { type: 'agentCache', id: 1 },
      { type: 'agentShells', id: 1, running: 0 },
      { type: 'agentCache', id: 1, ttlSeconds: 3600, expiresAt: T0 + 5_000 + HOUR_MS },
    ]);
    expect(cleared.runningShellIds?.size ?? 0).toBe(0);
    expect(cleared.permissionMode).toBe('auto');
  });
});
