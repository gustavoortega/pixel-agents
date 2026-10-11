import { describe, expect, it } from 'vitest';

import { AgentStateStore } from '../src/agentStateStore.js';
import { clearAgentActivity } from '../src/timerManager.js';
import type { AgentState } from '../src/types.js';

describe('clearAgentActivity', () => {
  it('T6: clears tools and bubbles without asserting that the agent is active', () => {
    const store = new AgentStateStore();
    const agent = {
      id: 1,
      activeToolIds: new Set(['t1']),
      activeToolStatuses: new Map([['t1', 'Reading']]),
      activeToolNames: new Map([['t1', 'Read']]),
      activeSubagentToolIds: new Map(),
      activeSubagentToolNames: new Map(),
      backgroundAgentToolIds: new Set<string>(),
      isWaiting: true,
      permissionSent: true,
    } as unknown as AgentState;
    store.set(1, agent);
    const sent: Array<Record<string, unknown>> = [];
    store.on('broadcast', (m) => sent.push(m as Record<string, unknown>));

    clearAgentActivity(agent, 1, store, new Map());

    expect(sent).toEqual([{ type: 'agentToolsClear', id: 1 }]);
    expect(agent.activeToolIds.size).toBe(0);
  });
});
