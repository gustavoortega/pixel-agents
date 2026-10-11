/**
 * Glue between agents and the roster: claiming a member at creation, the wire messages, and
 * the rule that the roster owns an agent's look. All of it is a no-op while the store has no
 * roster, which is how the tests and the shadow store stay out of it.
 */

import type { AgentStateStore } from './agentStateStore.js';
import { assignPaletteIfNeeded } from './paletteAssigner.js';
import type { AgentState } from './types.js';
import { levelForXp, moodFor } from './xp.js';

type SeatMeta = { palette?: number; hueShift?: number; seatId?: string };

/**
 * Give a new or restored agent its roster member and look. Runs before `assignPaletteIfNeeded`,
 * which then finds the palette set and skips. Without a roster, or when the roster file is
 * busy, the agent gets a palette the old way.
 */
export function claimRosterMember(agent: AgentState, store: AgentStateStore): void {
  const roster = store.roster;
  if (!roster) {
    return;
  }
  const member = roster.claim({
    agentId: agent.id,
    sessionId: agent.sessionId,
    rosterId: agent.rosterId,
    folderName: agent.folderName,
  });
  if (!member) {
    agent.rosterId = undefined;
    assignPaletteIfNeeded(agent, store);
    return;
  }
  agent.rosterId = member.id;
  agent.palette = member.palette;
  agent.hueShift = member.hueShift;
  broadcastRoster(agent, store);
}

/** The `agentRoster` message for an agent, or null when it holds no member. */
export function rosterMessage(
  agent: AgentState,
  store: AgentStateStore,
): Record<string, unknown> | null {
  if (!agent.rosterId) {
    return null;
  }
  const member = store.roster?.getMember(agent.rosterId);
  if (!member) {
    return null;
  }
  const { level, xpIntoLevel, xpToNext } = levelForXp(member.xp);
  return {
    type: 'agentRoster',
    id: agent.id,
    memberId: member.id,
    name: member.name,
    level,
    xp: xpIntoLevel,
    xpToNext,
    streak: member.streak,
    mood: moodFor({
      tripwire: agent.tripwire !== undefined,
      consecutiveFailures: member.consecutiveFailures,
      streak: member.streak,
    }),
  };
}

export function broadcastRoster(agent: AgentState, store: AgentStateStore): void {
  const message = rosterMessage(agent, store);
  if (message) {
    store.broadcast(message);
  }
}

/** The roster is authoritative for the look: drop palette and hueShift from seats of rostered agents. */
export function stripRosterLook(
  seats: Record<string, SeatMeta>,
  store: AgentStateStore,
): Record<string, SeatMeta> {
  const out: Record<string, SeatMeta> = {};
  for (const [key, meta] of Object.entries(seats)) {
    const agent = store.get(Number(key));
    if (agent?.rosterId) {
      out[key] = { seatId: meta.seatId };
    } else {
      out[key] = meta;
    }
  }
  return out;
}

/** Seat metadata for a client, with the roster's look laid over saved seats. */
export function withRosterLook(
  seats: Record<string, SeatMeta>,
  store: AgentStateStore,
): Record<string, SeatMeta> {
  const out: Record<string, SeatMeta> = { ...seats };
  for (const [id, agent] of store) {
    if (agent.rosterId) {
      out[String(id)] = {
        ...seats[String(id)],
        palette: agent.palette,
        hueShift: agent.hueShift,
      };
    }
  }
  return out;
}

/**
 * Key a persisted seat by something that survives a restart. Agent ids are handed out afresh
 * each run, so a seat saved under one lands on whoever gets that number next; the session and
 * the roster member are stable. Prefixed so no key can read as another kind's.
 */
export function seatKey(id: number, agent: AgentState | undefined): string {
  if (agent?.sessionId) return `s:${agent.sessionId}`;
  if (agent?.rosterId) return `r:${agent.rosterId}`;
  return `a:${id}`;
}

/** Seats as the webview sends them (by agent id), ready to persist: roster look stripped, keys stable. */
export function seatsToPersist(
  seats: Record<string, SeatMeta>,
  store: AgentStateStore,
): Record<string, SeatMeta> {
  const out: Record<string, SeatMeta> = {};
  for (const [idStr, meta] of Object.entries(stripRosterLook(seats, store))) {
    out[seatKey(Number(idStr), store.get(Number(idStr)))] = meta;
  }
  return out;
}

/** Persisted seats back to the webview's agent-id keys. Entries saved under the old numeric-id
 *  keys match nothing here: such an agent gets a fresh seat instead of someone else's. */
export function seatsForClient(
  persisted: Record<string, SeatMeta>,
  store: AgentStateStore,
): Record<string, SeatMeta> {
  const out: Record<string, SeatMeta> = {};
  for (const [id, agent] of store) {
    const meta = persisted[seatKey(id, agent)];
    if (meta) out[String(id)] = meta;
  }
  return out;
}
