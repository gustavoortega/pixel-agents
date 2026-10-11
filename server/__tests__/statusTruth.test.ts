import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { StateAdapter } from '../../core/src/adapter.js';
import { agentStatusMessage, resendAgentActivity } from '../src/agentActivityResend.js';
import { AgentRuntime } from '../src/agentRuntime.js';
import { AgentStateStore } from '../src/agentStateStore.js';
import { DismissalTracker } from '../src/dismissalTracker.js';
import {
  adoptExternalSessionFromHook,
  reassignAgentToFile,
  setDismissalTracker,
} from '../src/fileWatcher.js';
import { claudeProvider } from '../src/providers/hook/claude/claude.js';
import { setHookProvider } from '../src/transcriptParser.js';
import { applyTurnDerivation, deriveAgentTurnState } from '../src/turnStateSeed.js';
import type { AgentState, PersistedAgent } from '../src/types.js';

const NOW = Date.now();
const iso = (offsetMs = 0) => new Date(Date.now() + offsetMs).toISOString();

const prompt = () => ({ type: 'user', timestamp: iso(), message: { content: 'go' } });
const toolUse = (id: string, name: string) => ({
  type: 'assistant',
  timestamp: iso(),
  message: { content: [{ type: 'tool_use', id, name, input: {} }] },
});
const toolResult = (id: string) => ({
  type: 'user',
  timestamp: iso(),
  message: { content: [{ type: 'tool_result', tool_use_id: id, content: 'ok' }] },
});
const turnEnd = () => ({ type: 'system', subtype: 'turn_duration', timestamp: iso() });

const FINISHED = [prompt(), toolUse('a', 'Read'), toolResult('a'), turnEnd()];
const MID_TOOL = [prompt(), toolUse('a', 'Read')];

function writeJsonl(file: string, records: unknown[]): void {
  fs.writeFileSync(file, records.map((r) => JSON.stringify(r)).join('\n') + '\n');
}

function persistedAgent(file: string, dir: string): PersistedAgent {
  return {
    id: 7,
    sessionId: 'sess',
    terminalName: '',
    isExternal: true,
    jsonlFile: file,
    projectDir: dir,
  };
}

function adapterOf(agents: PersistedAgent[]): StateAdapter {
  return {
    loadAgents: () => agents,
    saveAgents: () => {},
    loadSeats: () => ({}),
    saveSeats: () => {},
    getSetting: <T>(_key: string, defaultValue: T): T => defaultValue,
    setSetting: () => {},
  };
}

function statusOf(store: AgentStateStore, id: number): Record<string, unknown> {
  const sent: Array<Record<string, unknown>> = [];
  resendAgentActivity((m) => sent.push(m), store);
  const statuses = sent.filter((m) => m.type === 'agentStatus' && m.id === id);
  expect(statuses).toHaveLength(1);
  return statuses[0];
}

describe('status truth: adopted and restored agents read their real state', () => {
  let tmp: string;
  let timers: Array<ReturnType<typeof setInterval>>;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pxl-status-truth-'));
    timers = [];
    setHookProvider(claudeProvider);
    setDismissalTracker(new DismissalTracker());
    // Adoption replays files younger than two scan intervals; age the clock past that.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW + 60_000);
  });

  afterEach(() => {
    vi.useRealTimers();
    for (const t of timers) clearInterval(t);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  function adopt(records: unknown[]): { store: AgentStateStore; atAnnounce: unknown } {
    const file = path.join(tmp, 'adopt.jsonl');
    writeJsonl(file, records);
    const store = new AgentStateStore();
    let atAnnounce: unknown;
    // What the transport reads the moment it announces the agent.
    store.on('agentAdded', (id, agent) => {
      atAnnounce = agentStatusMessage(id, agent);
    });
    const pollingTimers = new Map<number, ReturnType<typeof setInterval>>();
    adoptExternalSessionFromHook(
      'adopt',
      file,
      tmp,
      new Set(),
      { current: 1 },
      store,
      new Map(),
      pollingTimers,
      new Map(),
      new Map(),
      () => {},
    );
    timers.push(...pollingTimers.values());
    return { store, atAnnounce };
  }

  it('T2: an adopted finished session is announced waiting, a mid-tool one active', () => {
    const done = adopt(FINISHED);
    expect(done.atAnnounce).toMatchObject({ type: 'agentStatus', status: 'waiting' });
    expect(done.store.get(1)?.isWaiting).toBe(true);

    const busy = adopt(MID_TOOL);
    expect(busy.atAnnounce).toMatchObject({ type: 'agentStatus', status: 'active' });
    expect(busy.store.get(1)?.isWaiting).toBe(false);
  });

  it('T3: restore without a persisted isWaiting derives waiting from the transcript', () => {
    const file = path.join(tmp, 'restore.jsonl');
    writeJsonl(file, FINISHED);
    const store = new AgentStateStore();
    store.setAdapter(adapterOf([persistedAgent(file, tmp)]));
    const runtime = new AgentRuntime(store, claudeProvider);
    try {
      runtime.restoreExternalAgents();
      expect(statusOf(store, 7)).toMatchObject({ status: 'waiting' });
    } finally {
      runtime.dispose();
    }
  });

  it('T3: restore of an abandoned mid-tool transcript reads idle, not working', () => {
    const file = path.join(tmp, 'stale.jsonl');
    writeJsonl(file, MID_TOOL);
    // Quiet for 10 minutes: a pending Read is no longer believable.
    vi.setSystemTime(NOW + 10 * 60_000);
    const store = new AgentStateStore();
    store.setAdapter(adapterOf([persistedAgent(file, tmp)]));
    const runtime = new AgentRuntime(store, claudeProvider);
    try {
      runtime.restoreExternalAgents();
      expect(statusOf(store, 7)).toMatchObject({ status: 'idle' });
    } finally {
      runtime.dispose();
    }
  });

  it('T3b: a hook event that lands while deriving wins over the derived status', () => {
    const file = path.join(tmp, 'race.jsonl');
    writeJsonl(file, FINISHED);
    const agent = { jsonlFile: file, isWaiting: false, hookSeq: 0 } as AgentState;

    const derivation = deriveAgentTurnState(agent, claudeProvider);
    expect(derivation?.state.kind).toBe('waiting');
    agent.hookSeq = 1; // a PreToolUse arrived meanwhile
    expect(applyTurnDerivation(agent, derivation!)).toBe(false);
    expect(agent.isWaiting).toBe(false);
  });

  it('derivation moves the offset to the stat it read, so no later record is lost', () => {
    const file = path.join(tmp, 'offset.jsonl');
    writeJsonl(file, FINISHED);
    const agent = { jsonlFile: file, fileOffset: 0, lineBuffer: '' } as AgentState;
    deriveAgentTurnState(agent, claudeProvider);
    expect(agent.fileOffset).toBe(fs.statSync(file).size);
    expect(agent.lineBuffer).toBe('');
  });

  it('T7: reassigning to a finished file derives waiting and never broadcasts active', () => {
    const oldFile = path.join(tmp, 'old.jsonl');
    const newFile = path.join(tmp, 'new.jsonl');
    writeJsonl(oldFile, MID_TOOL);
    writeJsonl(newFile, FINISHED);
    const store = new AgentStateStore();
    const agent = {
      id: 1,
      sessionId: 'old',
      isExternal: true,
      projectDir: tmp,
      jsonlFile: oldFile,
      fileOffset: 0,
      lineBuffer: '',
      activeToolIds: new Set<string>(),
      activeToolStatuses: new Map(),
      activeToolNames: new Map(),
      activeSubagentToolIds: new Map(),
      activeSubagentToolNames: new Map(),
      backgroundAgentToolIds: new Set<string>(),
      isWaiting: false,
      permissionSent: false,
      hadToolsInTurn: true,
      linesProcessed: 0,
      seenUnknownRecordTypes: new Set<string>(),
      hookDelivered: false,
      contextTokens: 0,
      maxContextTokens: 200_000,
    } as unknown as AgentState;
    store.set(1, agent);
    const broadcasts: Array<Record<string, unknown>> = [];
    store.on('broadcast', (m) => broadcasts.push(m as Record<string, unknown>));
    const pollingTimers = new Map<number, ReturnType<typeof setInterval>>();

    reassignAgentToFile(
      1,
      newFile,
      store,
      new Map(),
      pollingTimers,
      new Map(),
      new Map(),
      () => {},
    );
    timers.push(...pollingTimers.values());

    const statuses = broadcasts.filter((m) => m.type === 'agentStatus');
    expect(statuses).toEqual([
      { type: 'agentStatus', id: 1, status: 'waiting', awaitingInput: false },
    ]);
    expect(agent.isWaiting).toBe(true);
  });
});
