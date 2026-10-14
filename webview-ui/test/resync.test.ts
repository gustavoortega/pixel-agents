/**
 * The resync after a reconnect, on a real office. The existingAgents that answers the
 * reconnect's webviewReady is the server's whole truth and handshakeDone ends its
 * catch-up: what the catch-up does not restate ended while the socket was down and goes,
 * at once and with no effect, while what it restates stays exactly as it was.
 *
 * Messages go through the modules the hook delegates to (agentListMessages, agentMessages,
 * subagentMessages); the hook's React state and refs are plain values here.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { WORKFLOW_MAX_VISIBLE_HELPERS } from '../src/constants.js';
import {
  type AgentListSink,
  applyAgentTeamInfo,
  applyExistingAgents,
  applyHandshakeDone,
} from '../src/hooks/agentListMessages.js';
import {
  applyAgentStatusMessage,
  applyAgentToolStart,
  applyAgentTripwireMessage,
} from '../src/hooks/agentMessages.js';
import { applyMonitorMessage } from '../src/hooks/monitorMessages.js';
import {
  applySubagentMessage,
  applyToolStartHelper,
  type SubagentCharacter,
  type SubagentTools,
} from '../src/hooks/subagentMessages.js';
import { OfficeState } from '../src/office/engine/officeState.js';
import { type AgentToolRows, resync } from '../src/office/engine/resync.js';
import { setProviderCapabilities } from '../src/office/toolUtils.js';
import type { OfficeLayout, PlacedFurniture } from '../src/office/types.js';
import { TileType } from '../src/office/types.js';
import { reconnectState } from '../src/transport/reconnect.js';
import { loadRealAssets } from './realAssets.js';

beforeAll(() => {
  loadRealAssets();
  setProviderCapabilities({ readingTools: [], subagentToolNames: ['Agent'] });
});

beforeEach(() => {
  reconnectState.resyncPending = false;
  resync.abort();
});

const COLS = 12;
const ROWS = 4;

const chair = (uid: string, col: number): PlacedFurniture => ({
  uid,
  type: 'CUSHIONED_CHAIR_FRONT',
  col,
  row: 1,
});

function office(): OfficeState {
  return new OfficeState({
    version: 1,
    cols: COLS,
    rows: ROWS,
    tiles: new Array(COLS * ROWS).fill(TileType.FLOOR_1),
    furniture: [chair('s1', 1), chair('s2', 3), chair('s3', 5), chair('s4', 7), chair('s5', 9)],
  } as OfficeLayout);
}

/** The hook's state and refs as plain values, and the sink it builds over them. */
function hub(os: OfficeState) {
  const state = {
    agents: [] as number[],
    selected: null as number | null,
    agentTools: {} as AgentToolRows,
    agentStatuses: {} as Record<number, string>,
    subagentTools: {} as SubagentTools,
    characters: [] as SubagentCharacter[],
    background: {} as Record<number, Set<string>>,
    teams: {} as Record<number, string | undefined>,
  };
  const sink: AgentListSink = {
    os,
    background: state.background,
    teams: state.teams,
    pending: [],
    layoutReady: true,
    updateAgents: (fn) => {
      state.agents = fn(state.agents);
    },
    updateSelectedAgent: (fn) => {
      state.selected = fn(state.selected);
    },
    updateAgentTools: (fn) => {
      state.agentTools = fn(state.agentTools);
    },
    updateAgentStatuses: (fn) => {
      state.agentStatuses = fn(state.agentStatuses);
    },
    updateTools: (fn) => {
      state.subagentTools = fn(state.subagentTools);
    },
    updateCharacters: (fn) => {
      state.characters = fn(state.characters);
    },
    noteFolderName: () => {},
    saveSeats: () => {},
  };
  return { state, sink };
}

/** What a reopen does before the handshake answers (pinned in webSocketTransport.test.ts). */
function reconnect(): void {
  reconnectState.resyncPending = true;
}

const existingAgents = (agents: number[], extra: Record<string, unknown> = {}) => ({
  type: 'existingAgents',
  agents,
  ...extra,
});

const toolStart = (id: number, toolId: string, status: string, extra = {}) => ({
  type: 'agentToolStart',
  id,
  toolId,
  status,
  ...extra,
});

const CREW = 'wf:5b1fa126-e5b:';

const presence = (lead: number, parentToolId: string) => ({
  type: 'subagentPresent',
  id: lead,
  parentToolId,
});

const backgroundSpawn = (lead: number, toolId: string) =>
  toolStart(lead, toolId, 'Subtask: scan the docs', { toolName: 'Agent', runInBackground: true });

const foregroundSpawn = (lead: number, toolId: string) =>
  toolStart(lead, toolId, 'Subtask: fix the tests', { toolName: 'Agent' });

describe('resync after a reconnect', () => {
  it('C2 removes at once an agent the server no longer lists, with its helpers and from the hook state; an ordinary handshake only adds', () => {
    const os = office();
    const { state, sink } = hub(os);
    os.addAgent(1, 0, 0, undefined, true);
    os.addAgent(2, 1, 0, undefined, true);
    // 3 is listed with no character yet: its existingAgents came before the layout.
    state.agents = [1, 2, 3];
    applySubagentMessage(sink, presence(2, `${CREW}a`));
    applyToolStartHelper(sink, backgroundSpawn(2, 'toolu_bg'));
    applyAgentToolStart(os, sink.updateAgentTools, toolStart(2, 'toolu_r', 'Reading a.ts'));
    state.agentStatuses = { 2: 'waiting' };
    state.selected = 2;
    const held = [2, os.getSubagentId(2, `${CREW}a`)!, os.getSubagentId(2, 'toolu_bg')!].map(
      (id) => os.characters.get(id)!.seatId,
    );
    expect(held).not.toContain(null);
    os.selectedAgentId = 2;
    os.cameraFollowId = 1;

    applyExistingAgents(sink, existingAgents([1]));
    expect(os.characters.has(2)).toBe(true);
    expect(state.agents).toEqual([1, 2, 3]);

    reconnect();
    applyExistingAgents(sink, existingAgents([1]));

    // Gone, not despawning: a despawning character stays in the map until its effect ends.
    expect([...os.characters.keys()]).toEqual([1]);
    expect([...os.subagentMeta.values()]).toEqual([]);
    for (const seat of held) expect(os.seats.get(seat!)!.assigned).toBe(false);
    expect(os.selectedAgentId).toBeNull();
    expect(os.cameraFollowId).toBe(1);
    // Gone from what the hook renders too.
    expect(state.agents).toEqual([1]);
    expect(state.selected).toBeNull();
    expect(state.agentTools).toEqual({});
    expect(state.agentStatuses).toEqual({});
    expect(state.characters).toEqual([]);
    expect(state.background).toEqual({});
  });

  it('an agent the resync keeps takes the server look, folder and seat; a field it omits keeps its value', () => {
    const os = office();
    const { sink } = hub(os);
    os.addAgent(1, 3, 90, 's1', true);
    const ch = os.characters.get(1)!;

    reconnect();
    applyExistingAgents(
      sink,
      existingAgents([1], {
        agentMeta: { 1: { palette: 5, seatId: 's4' } },
        folderNames: { 1: 'api' },
      }),
    );
    expect([ch.palette, ch.hueShift, ch.seatId, ch.folderName]).toEqual([5, 90, 's4', 'api']);
    expect(os.seats.get('s1')!.assigned).toBe(false);
    expect(ch.matrixEffect).toBeNull();

    reconnect();
    applyExistingAgents(sink, existingAgents([1], { agentMeta: { 1: { hueShift: 0 } } }));
    expect([ch.palette, ch.hueShift, ch.seatId, ch.folderName]).toEqual([5, 0, 's4', 'api']);
  });

  it('C3 a workflow helper the server re-announces keeps its id and seat; one it does not goes at handshakeDone', () => {
    const os = office();
    const { state, sink } = hub(os);
    os.addAgent(1, 0, 0, undefined, true);
    applySubagentMessage(sink, presence(1, `${CREW}live`));
    applySubagentMessage(sink, presence(1, `${CREW}ended`));
    const live = os.getSubagentId(1, `${CREW}live`)!;
    const ended = os.getSubagentId(1, `${CREW}ended`)!;
    const seat = os.characters.get(live)!.seatId;

    reconnect();
    applyExistingAgents(sink, existingAgents([1]));
    applySubagentMessage(sink, presence(1, `${CREW}live`));
    applyHandshakeDone(sink);

    expect(os.getSubagentId(1, `${CREW}live`)).toBe(live);
    expect(os.characters.get(live)!.seatId).toBe(seat);
    expect(os.getSubagentId(1, `${CREW}ended`)).toBeNull();
    expect(os.characters.has(ended)).toBe(false);
    expect(state.characters.map((s) => s.id)).toEqual([live]);
    expect([...state.background[1]]).toEqual([`${CREW}live`]);
  });

  it('a workflow run the catch-up restates stays with its new counts; one it does not goes at handshakeDone; an ordinary handshake drops none', () => {
    const os = office();
    const { sink } = hub(os);
    os.addAgent(1, 0, 0, undefined, true);
    const run = (runId: string, extra: Record<string, unknown> = {}) => ({
      type: 'workflowRun',
      id: 1,
      runId,
      status: 'running',
      started: 2,
      ...extra,
    });
    applyMonitorMessage(os, run('kept'));
    applyMonitorMessage(os, run('ended'));

    applyExistingAgents(sink, existingAgents([1]));
    applyHandshakeDone(sink);
    expect([...os.workflowRuns.get(1)!.keys()]).toEqual(['kept', 'ended']);

    // The run that ended while the socket was down is not in the server's catch-up.
    reconnect();
    applyExistingAgents(sink, existingAgents([1]));
    applyMonitorMessage(os, run('kept', { done: 1 }));
    applyHandshakeDone(sink);
    expect(Object.fromEntries(os.workflowRuns.get(1)!)).toEqual({
      kept: { status: 'running', started: 2, done: 1 },
    });
  });

  it('C3 an undrawn crew helper the server does not re-announce goes too; the one drawn into a freed place shows with no effect', () => {
    const os = office();
    const { sink } = hub(os);
    os.addAgent(1, 0, 0, undefined, true);
    // Two past the lead's cap: the last two wait undrawn.
    const cap = WORKFLOW_MAX_VISIBLE_HELPERS;
    const keys = Array.from({ length: cap + 2 }, (_, i) => `${CREW}k${i + 1}`);
    for (const key of keys) applySubagentMessage(sink, presence(1, key));
    const drawn = () =>
      keys.filter((key) => {
        const id = os.getSubagentId(1, key);
        return id !== null && os.characters.has(id);
      });
    expect(drawn()).toEqual(keys.slice(0, cap));

    // The last drawn one and the last undrawn one ended while the socket was down.
    const [lastDrawn, firstUndrawn, lastUndrawn] = keys.slice(cap - 1);
    reconnect();
    applyExistingAgents(sink, existingAgents([1]));
    for (const key of [...keys.slice(0, cap - 1), firstUndrawn]) {
      applySubagentMessage(sink, presence(1, key));
    }
    applyHandshakeDone(sink);

    expect(os.getSubagentId(1, lastDrawn)).toBeNull();
    expect(os.getSubagentId(1, lastUndrawn)).toBeNull();
    expect(drawn()).toEqual([...keys.slice(0, cap - 1), firstUndrawn]);
    expect(os.characters.get(os.getSubagentId(1, firstUndrawn)!)!.matrixEffect).toBeNull();
  });

  it("keeps the helpers the resend restates, foreground or background; sweeps a teamless lead's other background spawn, never a teamed lead's", () => {
    const os = office();
    const { sink } = hub(os);
    os.addAgent(1, 0, 0, undefined, true);
    os.addAgent(2, 1, 0, undefined, true);
    applyToolStartHelper(sink, backgroundSpawn(1, 'toolu_live'));
    applyToolStartHelper(sink, backgroundSpawn(1, 'toolu_ended'));
    applyToolStartHelper(sink, foregroundSpawn(1, 'toolu_fg'));
    // A teamed lead's background spawn draws no helper from its start; a watched sub-agent's
    // first tool does.
    applyAgentTeamInfo(sink, { type: 'agentTeamInfo', id: 2, teamName: 'crew', isTeamLead: true });
    applySubagentMessage(sink, {
      type: 'subagentToolStart',
      id: 2,
      parentToolId: 'toolu_teamed',
      toolId: 'toolu_r1',
      status: 'Reading x.ts',
    });
    const live = os.getSubagentId(1, 'toolu_live');
    const foreground = os.getSubagentId(1, 'toolu_fg');
    const teamed = os.getSubagentId(2, 'toolu_teamed');
    expect([live, foreground, teamed]).not.toContain(null);

    reconnect();
    applyExistingAgents(sink, existingAgents([1, 2]));
    // The resend restates a foreground tool without runInBackground (agentActivityResend.ts).
    applyToolStartHelper(sink, backgroundSpawn(1, 'toolu_live'));
    applyToolStartHelper(sink, foregroundSpawn(1, 'toolu_fg'));
    applyHandshakeDone(sink);

    expect(os.getSubagentId(1, 'toolu_live')).toBe(live);
    expect(os.getSubagentId(1, 'toolu_fg')).toBe(foreground);
    expect(os.getSubagentId(1, 'toolu_ended')).toBeNull();
    expect(os.getSubagentId(2, 'toolu_teamed')).toBe(teamed);
  });

  it('a presence since the reconnect counts; one from a socket that dropped before its handshake does not', () => {
    const os = office();
    const { sink } = hub(os);
    os.addAgent(1, 0, 0, undefined, true);
    applySubagentMessage(sink, presence(1, `${CREW}a`));
    applySubagentMessage(sink, presence(1, `${CREW}b`));

    // Watched again as the new socket connected, before the handshake's existingAgents.
    reconnect();
    applySubagentMessage(sink, presence(1, `${CREW}a`));
    applyExistingAgents(sink, existingAgents([1]));
    applyHandshakeDone(sink);
    expect(os.getSubagentId(1, `${CREW}a`)).not.toBeNull();
    expect(os.getSubagentId(1, `${CREW}b`)).toBeNull();

    // This socket drops before its handshake, and `a` ends before the next one connects. The
    // abort is what the drop triggers (webSocketTransport.test.ts); here it forgets `a`'s
    // confirmation.
    reconnect();
    applySubagentMessage(sink, presence(1, `${CREW}a`));
    resync.abort();
    reconnect();
    applyExistingAgents(sink, existingAgents([1]));
    applyHandshakeDone(sink);
    expect(os.getSubagentId(1, `${CREW}a`)).toBeNull();
  });

  it('C5 plays no chime and no spawn effect while the catch-up runs', () => {
    const os = office();
    const { sink } = hub(os);
    os.addAgent(1, 0, 0, undefined, true);
    os.setAgentActive(1, true);
    const chime = vi.fn();
    const alarm = vi.fn();
    const waiting = { type: 'agentStatus', id: 1, status: 'waiting' };
    const tripwire = (severity: string) => ({
      type: 'agentTripwire',
      id: 1,
      ruleName: 'dotenv',
      severity,
      count: 1,
    });

    reconnect();
    applyExistingAgents(sink, existingAgents([1]));
    applyAgentStatusMessage(os, waiting, chime);
    applyAgentTripwireMessage(os, tripwire('low'), alarm);
    applySubagentMessage(sink, presence(1, `${CREW}new`));
    applyToolStartHelper(sink, backgroundSpawn(1, 'toolu_new'));
    applyHandshakeDone(sink);

    expect(chime).not.toHaveBeenCalled();
    expect(alarm).not.toHaveBeenCalled();
    for (const key of [`${CREW}new`, 'toolu_new']) {
      expect(os.characters.get(os.getSubagentId(1, key)!)!.matrixEffect).toBeNull();
    }

    // The same news outside a catch-up rings: the window muted it, not the message.
    os.setAgentActive(1, true);
    applyAgentStatusMessage(os, waiting, chime);
    applyAgentTripwireMessage(os, tripwire('high'), alarm);
    expect(chime).toHaveBeenCalledTimes(1);
    expect(alarm).toHaveBeenCalledTimes(1);
  });

  it('a restated tool row takes the resent status, an unrestated one goes at handshakeDone, sub-tool rows go at once; a later repeat changes nothing', () => {
    const os = office();
    const { state, sink } = hub(os);
    os.addAgent(1, 0, 0, undefined, true);
    const row = (toolId: string, status: string) => ({
      toolId,
      status,
      done: false,
      permissionWait: false,
    });
    state.agentTools = { 1: [row('toolu_1', 'Reading a.ts'), row('toolu_2', 'Running: build')] };
    state.subagentTools = { 1: { toolu_x: [row('toolu_s', 'Reading b.ts')] } };

    reconnect();
    applyExistingAgents(sink, existingAgents([1]));
    expect(state.subagentTools).toEqual({});
    applyAgentToolStart(os, sink.updateAgentTools, toolStart(1, 'toolu_1', 'Reading c.ts'));
    applyHandshakeDone(sink);
    expect(state.agentTools).toEqual({ 1: [row('toolu_1', 'Reading c.ts')] });

    // Outside the window a repeated start is a duplicate, not a restatement.
    applyAgentToolStart(os, sink.updateAgentTools, toolStart(1, 'toolu_1', 'Reading d.ts'));
    expect(state.agentTools).toEqual({ 1: [row('toolu_1', 'Reading c.ts')] });
  });

  it("a restated start carries the server's pending permission prompt: the bubble and the row follow it", () => {
    const os = office();
    const { state, sink } = hub(os);
    for (const id of [1, 2, 3]) os.addAgent(id, id, 0, undefined, true);
    const start = (id: number, permissionActive?: boolean) =>
      applyAgentToolStart(
        os,
        sink.updateAgentTools,
        toolStart(id, `toolu_${id}`, 'Running: build', { permissionActive }),
      );
    // 1 and 2 wait on a prompt (agentToolPermission showed the bubble); 3 does not.
    start(1, true);
    start(2, true);
    start(3);
    os.showPermissionBubble(1);
    os.showPermissionBubble(2);

    // While the socket was down 1's prompt stayed pending, 2's was answered and 3 raised one.
    reconnect();
    applyExistingAgents(sink, existingAgents([1, 2, 3]));
    start(1, true);
    start(2);
    start(3, true);
    applyHandshakeDone(sink);

    const shown = (id: number) => [
      os.characters.get(id)!.bubbleType,
      state.agentTools[id][0].permissionWait,
    ];
    expect(shown(1)).toEqual(['permission', true]);
    expect(shown(2)).toEqual([null, false]);
    expect(shown(3)).toEqual(['permission', true]);
  });
});
