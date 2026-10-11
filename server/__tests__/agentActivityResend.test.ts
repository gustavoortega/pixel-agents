import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { describe, expect, it } from 'vitest';

import { resendAgentActivity } from '../src/agentActivityResend.js';
import { AgentStateStore } from '../src/agentStateStore.js';
import { RosterStore } from '../src/roster.js';
import { claimRosterMember } from '../src/rosterAgent.js';
import type { AgentState } from '../src/types.js';

function createTestAgent(overrides: Partial<AgentState> = {}): AgentState {
  return {
    id: 0,
    sessionId: 'test-session',
    isExternal: false,
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

/** Resend minus the title and tripwire messages, which every agent gets, so the tests
 *  below can assert the other messages without restating them each time. */
function resendActivityWithoutTitlesOrAlarms(
  sent: Array<Record<string, unknown>>,
  store: AgentStateStore,
): void {
  resendAgentActivity((msg) => {
    if (msg.type !== 'agentSessionTitle' && !String(msg.type).startsWith('agentTripwire')) {
      sent.push(msg);
    }
  }, store);
}

describe('resendAgentActivity roster', () => {
  it('replays agentRoster for rostered agents only, after the tripwire message', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pxl-resend-roster-'));
    const store = new AgentStateStore();
    const roster = new RosterStore({ filePath: path.join(dir, 'roster.json') });
    roster.attach(store);
    const rostered = createTestAgent({ id: 1, sessionId: 's1' });
    claimRosterMember(rostered, store);
    store.set(1, rostered);
    store.set(2, createTestAgent({ id: 2, sessionId: 's2' }));

    const sent: Array<Record<string, unknown>> = [];
    resendAgentActivity((msg) => sent.push(msg), store);
    roster.dispose();
    fs.rmSync(dir, { recursive: true, force: true });

    const forAgent = (id: number) => sent.filter((m) => m.id === id).map((m) => m.type);
    expect(forAgent(1)).toEqual(['agentSessionTitle', 'agentTripwireClear', 'agentRoster']);
    expect(forAgent(2)).toEqual(['agentSessionTitle', 'agentTripwireClear']);
    expect(sent.find((m) => m.type === 'agentRoster')).toMatchObject({
      id: 1,
      level: 1,
      xp: 0,
      xpToNext: 100,
      mood: 'neutral',
    });
  });
});

describe('resendAgentActivity', () => {
  it('sends messages in order: team info, tools, waiting, context, title, tripwire', () => {
    const store = new AgentStateStore();
    store.set(
      1,
      createTestAgent({
        id: 1,
        teamName: 'test-team',
        activeToolStatuses: new Map([['tool-1', 'Running']]),
        activeToolNames: new Map([['tool-1', 'Bash']]),
        isWaiting: true,
        contextTokens: 50_000,
      }),
    );
    const sent: Array<Record<string, unknown>> = [];
    resendAgentActivity((msg) => sent.push(msg), store);

    expect(sent.map((m) => m.type)).toEqual([
      'agentTeamInfo',
      'agentToolStart',
      'agentStatus',
      'agentContextUsage',
      'agentSessionTitle',
      'agentTripwireClear',
    ]);
  });

  it('includes basic fields for regular tools', () => {
    const store = new AgentStateStore();
    store.set(
      1,
      createTestAgent({
        id: 1,
        activeToolStatuses: new Map([['tool-1', 'Running']]),
        activeToolNames: new Map([['tool-1', 'Bash']]),
      }),
    );
    const sent: Array<Record<string, unknown>> = [];
    resendActivityWithoutTitlesOrAlarms(sent, store);

    expect(sent).toHaveLength(1);
    expect(sent[0]).toEqual({
      type: 'agentToolStart',
      id: 1,
      toolId: 'tool-1',
      status: 'Running',
      toolName: 'Bash',
    });
  });

  it('handles background tools with flags and promoted skip logic', () => {
    const store = new AgentStateStore();
    // Lead with three background tools: unnamed, named spawn, and promoted
    store.set(
      1,
      createTestAgent({
        id: 1,
        // A teamed lead: the webview routes agentToolStart by the parent's
        // teamName, so the team message has to land before the tool replays or
        // a background spawn is routed as if the lead had no team.
        teamName: 'test-team',
        activeToolStatuses: new Map([
          ['bg-unnamed', 'Subtask: Unnamed'],
          ['bg-named', 'Subtask: Named'],
          ['bg-promoted', 'Subtask: Promoted'],
        ]),
        activeToolNames: new Map([
          ['bg-unnamed', 'Agent'],
          ['bg-named', 'Agent'],
          ['bg-promoted', 'Agent'],
        ]),
        backgroundAgentToolIds: new Set(['bg-unnamed', 'bg-named', 'bg-promoted']),
        teammateSpawnToolIds: new Set(['bg-named']),
      }),
    );
    // Promoted teammate (should cause bg-promoted to be skipped)
    store.set(
      2,
      createTestAgent({
        id: 2,
        leadAgentId: 1,
        spawnToolUseId: 'bg-promoted',
        agentName: 'promoted-agent',
      }),
    );
    const sent: Array<Record<string, unknown>> = [];
    resendActivityWithoutTitlesOrAlarms(sent, store);

    const toolStarts = sent.filter((m) => m.type === 'agentToolStart');
    expect(toolStarts).toHaveLength(2); // unnamed + named, NOT promoted

    // Team info first: the webview reads the parent's teamName to decide whether
    // a background agentToolStart becomes a Subtask sub-character, so a replay
    // that arrives before it is routed against stale team state.
    const teamIdx = sent.findIndex((m) => m.type === 'agentTeamInfo' && m.id === 1);
    const firstBgToolIdx = sent.findIndex((m) => m.type === 'agentToolStart' && m.id === 1);
    expect(teamIdx).toBeGreaterThanOrEqual(0);
    expect(teamIdx).toBeLessThan(firstBgToolIdx);

    // Unnamed: runInBackground=true, no isTeammateSpawn. toolName is required —
    // without it the webview cannot recreate the Subtask after agentToolsClear.
    const unnamed = toolStarts.find((t) => t.toolId === 'bg-unnamed');
    expect(unnamed).toMatchObject({ runInBackground: true, toolName: 'Agent' });
    expect(unnamed?.isTeammateSpawn).toBeUndefined();

    // Named: runInBackground=true, isTeammateSpawn=true, toolName present.
    const named = toolStarts.find((t) => t.toolId === 'bg-named');
    expect(named).toMatchObject({
      runInBackground: true,
      isTeammateSpawn: true,
      toolName: 'Agent',
    });
  });

  it('sends team info for any team field trigger, omits when none present', () => {
    // teamName trigger
    let store = new AgentStateStore();
    store.set(1, createTestAgent({ id: 1, teamName: 'my-team' }));
    let sent: Array<Record<string, unknown>> = [];
    resendActivityWithoutTitlesOrAlarms(sent, store);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ type: 'agentTeamInfo', id: 1, teamName: 'my-team' });

    // agentName trigger (derived team)
    store = new AgentStateStore();
    store.set(2, createTestAgent({ id: 2, agentName: 'worker-1', leadAgentId: 1 }));
    sent = [];
    resendActivityWithoutTitlesOrAlarms(sent, store);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ type: 'agentTeamInfo', id: 2, agentName: 'worker-1' });

    // isTeamLead trigger
    store = new AgentStateStore();
    store.set(3, createTestAgent({ id: 3, isTeamLead: true }));
    sent = [];
    resendActivityWithoutTitlesOrAlarms(sent, store);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ type: 'agentTeamInfo', id: 3, isTeamLead: true });

    // No team fields: no message
    store = new AgentStateStore();
    store.set(4, createTestAgent({ id: 4 }));
    sent = [];
    resendActivityWithoutTitlesOrAlarms(sent, store);
    expect(sent.filter((m) => m.type === 'agentTeamInfo')).toHaveLength(0);
  });

  it('sends waiting status only when agent is waiting', () => {
    let store = new AgentStateStore();
    store.set(1, createTestAgent({ id: 1, isWaiting: true }));
    let sent: Array<Record<string, unknown>> = [];
    resendActivityWithoutTitlesOrAlarms(sent, store);
    expect(sent).toEqual([{ type: 'agentStatus', id: 1, status: 'waiting' }]);

    store = new AgentStateStore();
    store.set(2, createTestAgent({ id: 2, isWaiting: false }));
    sent = [];
    resendActivityWithoutTitlesOrAlarms(sent, store);
    expect(sent).toHaveLength(0);
  });

  it('sends context usage only when agent has tokens', () => {
    let store = new AgentStateStore();
    store.set(1, createTestAgent({ id: 1, contextTokens: 50_000, maxContextTokens: 200_000 }));
    let sent: Array<Record<string, unknown>> = [];
    resendActivityWithoutTitlesOrAlarms(sent, store);
    expect(sent).toEqual([
      { type: 'agentContextUsage', id: 1, contextTokens: 50_000, maxContextTokens: 200_000 },
    ]);

    store = new AgentStateStore();
    store.set(2, createTestAgent({ id: 2, contextTokens: 0, maxContextTokens: 200_000 }));
    sent = [];
    resendActivityWithoutTitlesOrAlarms(sent, store);
    expect(sent).toHaveLength(0);
  });

  it('handles edge cases: empty store and multiple agents', () => {
    // Empty store
    let store = new AgentStateStore();
    let sent: Array<Record<string, unknown>> = [];
    resendActivityWithoutTitlesOrAlarms(sent, store);
    expect(sent).toHaveLength(0);

    // Multiple agents with different activity
    store = new AgentStateStore();
    store.set(
      1,
      createTestAgent({
        id: 1,
        activeToolStatuses: new Map([['tool-1', 'Running']]),
        activeToolNames: new Map([['tool-1', 'Bash']]),
      }),
    );
    store.set(2, createTestAgent({ id: 2, isWaiting: true }));
    sent = [];
    resendActivityWithoutTitlesOrAlarms(sent, store);
    expect(sent).toHaveLength(2);
    expect(sent[0]).toMatchObject({ type: 'agentToolStart', id: 1 });
    expect(sent[1]).toMatchObject({ type: 'agentStatus', id: 2, status: 'waiting' });
  });

  it('sends the title of a titled agent and an omitted title for an untitled one', () => {
    const store = new AgentStateStore();
    store.set(1, createTestAgent({ id: 1, customTitle: 'Fix login bug', aiTitle: 'Generated' }));
    store.set(2, createTestAgent({ id: 2 }));
    const sent: Array<Record<string, unknown>> = [];
    resendAgentActivity((msg) => sent.push(msg), store);

    const titles = sent.filter((m) => m.type === 'agentSessionTitle');
    expect(titles).toHaveLength(2);
    expect(titles[0]).toEqual({ type: 'agentSessionTitle', id: 1, title: 'Fix login bug' });
    expect(titles[1]).toEqual({ type: 'agentSessionTitle', id: 2, title: undefined });
  });

  it('sends the alarm of an alarmed agent and a clear for one without', () => {
    const store = new AgentStateStore();
    store.set(
      1,
      createTestAgent({
        id: 1,
        tripwire: {
          ruleId: 'dotenv',
          ruleName: 'Dotenv file access',
          severity: 'medium',
          count: 3,
        },
      }),
    );
    store.set(2, createTestAgent({ id: 2 }));
    const sent: Array<Record<string, unknown>> = [];
    resendAgentActivity((msg) => sent.push(msg), store);

    expect(sent.filter((m) => String(m.type).startsWith('agentTripwire'))).toEqual([
      {
        type: 'agentTripwire',
        id: 1,
        ruleId: 'dotenv',
        ruleName: 'Dotenv file access',
        severity: 'medium',
        count: 3,
      },
      { type: 'agentTripwireClear', id: 2 },
    ]);
  });
});
