/**
 * Pays a real-work signal to the agent's roster member. The transcript parser is the only
 * caller: awards come from the lead's own tool results, never from hook events.
 */

import type { RosterEvent } from '../../core/src/messages.js';
import type { AgentStateStore } from './agentStateStore.js';
import { broadcastRoster } from './rosterAgent.js';
import { applyXpEvent, type SignalKind } from './xp.js';

export function awardSignal(agents: AgentStateStore, agentId: number, signal: SignalKind): void {
  const agent = agents.get(agentId);
  const roster = agents.roster;
  const member = agent?.rosterId ? roster?.getMember(agent.rosterId) : undefined;
  if (!agent || !roster || !member) return;
  const result = applyXpEvent(member, { type: 'signal', signal });
  roster.award(member.id, result.change);
  broadcastRoster(agent, agents);
  // One event per award, sent whether or not hooks are delivering: no hook carries this.
  agents.broadcast({
    type: 'rosterEvent',
    id: agentId,
    kind: result.levelUp !== undefined ? 'levelUp' : 'xp',
    amount: result.xpDelta,
    // The contract's level starts at 2: an xp event carries none.
    ...(result.levelUp !== undefined ? { level: result.levelUp } : {}),
    signal,
  } satisfies RosterEvent);
}
