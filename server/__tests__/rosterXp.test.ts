import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { HookProvider } from '../../core/src/provider.js';
import { AgentStateStore } from '../src/agentStateStore.js';
import { HookEventHandler } from '../src/hookEventHandler.js';
import { claudeProvider } from '../src/providers/hook/claude/claude.js';
import { RosterStore } from '../src/roster.js';
import { claimRosterMember } from '../src/rosterAgent.js';
import { SessionRouter } from '../src/sessionRouter.js';
import { processTranscriptLine } from '../src/transcriptParser.js';
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

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pxl-roster-xp-'));
  rosterFile = path.join(dir, 'roster.json');
  store = new AgentStateStore();
  roster = new RosterStore({ filePath: rosterFile, paletteCount: () => 6 });
  roster.attach(store);
  sent = [];
  store.on('broadcast', (m) => sent.push(m));
});

afterEach(() => {
  roster.dispose();
  store.dispose();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('XP through the hook handler', () => {
  it('a shipped turn pays the ship on the successful tool end and the turn on Stop (R4)', () => {
    const handler = setup();
    const agent = addAgent();
    handler.registerAgent('sess-1', 1);

    handler.handleEvent(
      'claude',
      hook('PreToolUse', { tool_name: 'Bash', tool_input: { command: 'git commit -m x' } }),
    );
    expect(xpOf(agent)).toBe(0);
    handler.handleEvent('claude', hook('PostToolUse'));
    expect(xpOf(agent)).toBe(100);
    handler.handleEvent('claude', hook('Stop'));
    expect(xpOf(agent)).toBe(100 + 85);

    const events = sent.filter((m) => m.type === 'rosterEvent');
    expect(events.map((e) => `${e.kind}:${e.amount ?? e.level}`)).toEqual([
      'xp:100',
      'levelUp:2',
      'xp:85',
    ]);
    expect(sent.filter((m) => m.type === 'agentRoster').at(-1)).toMatchObject({
      id: 1,
      level: 2,
      streak: 1,
      mood: 'neutral',
    });
  });

  it('a failed ship pays nothing and the turn pays 50 (R4)', () => {
    const handler = setup();
    const agent = addAgent();
    handler.registerAgent('sess-1', 1);

    handler.handleEvent(
      'claude',
      hook('PreToolUse', { tool_name: 'Bash', tool_input: { command: 'git commit -m x' } }),
    );
    handler.handleEvent('claude', hook('PostToolUseFailure'));
    handler.handleEvent('claude', hook('Stop'));
    expect(xpOf(agent)).toBe(50);
    expect(roster.getMember(agent.rosterId!)?.streak).toBe(0);
  });

  it('idle_prompt pays nothing, and a text-only Stop pays 10 (R4, R4b)', () => {
    const handler = setup();
    const agent = addAgent();
    handler.registerAgent('sess-1', 1);

    handler.handleEvent('claude', hook('Notification', { notification_type: 'idle_prompt' }));
    expect(xpOf(agent)).toBe(0);
    handler.handleEvent('claude', hook('Stop'));
    expect(xpOf(agent)).toBe(10);
    expect(roster.getMember(agent.rosterId!)?.streak).toBe(0);
  });

  it('a finished sub-agent pays its parent even without a team provider (R4)', () => {
    const handler = setup({ ...claudeProvider, team: undefined });
    const agent = addAgent();
    handler.registerAgent('sess-1', 1);

    handler.handleEvent('claude', hook('SubagentStop'));
    expect(xpOf(agent)).toBe(15);
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

  it('a lead with inline teammates still earns its tool turns (R4b)', () => {
    const handler = setup();
    const lead = addAgent({ id: 1, sessionId: 'sess-1' });
    addAgent({ id: 2, sessionId: 'mate', leadAgentId: 1, agentName: 'mate' });
    handler.registerAgent('sess-1', 1);

    handler.handleEvent(
      'claude',
      hook('PreToolUse', { tool_name: 'Read', tool_input: { file_path: 'a' } }),
    );
    handler.handleEvent('claude', hook('PostToolUse'));
    handler.handleEvent('claude', hook('Stop'));
    expect(xpOf(lead)).toBe(85);
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
  it('holds counts only: no title, command or transcript path', () => {
    const handler = setup();
    addAgent({
      customTitle: 'Secret Title Alpha',
      jsonlFile: '/secret/transcript-path.jsonl',
      folderName: 'shown-folder',
    });
    handler.registerAgent('sess-1', 1);

    handler.handleEvent(
      'claude',
      hook('PreToolUse', {
        tool_name: 'Bash',
        tool_input: { command: 'git commit -m secret-message-beta' },
      }),
    );
    handler.handleEvent('claude', hook('PostToolUse'));
    handler.handleEvent('claude', hook('Stop'));
    roster.flush();

    const text = fs.readFileSync(rosterFile, 'utf-8');
    expect(text).toContain('shown-folder');
    for (const secret of [
      'Secret Title Alpha',
      'secret-message-beta',
      'transcript-path',
      'git commit',
    ]) {
      expect(text).not.toContain(secret);
    }
  });
});
