/**
 * One companion per room: only the room's "hero" keeps its follower, so a pod of agents is not
 * a zoo. Pure ranking, no state.
 */

export interface HeroCandidate {
  id: number;
  /** Area label of the room the agent sits in; null for agents outside every area (one shared room). */
  room: string | null;
  /** Roster level; 0 when the agent has no roster member yet. */
  level: number;
  /** Time of the agent's newest roster event; 0 when it has none. */
  activeAt: number;
}

/** Highest level wins; a tie goes to the most recent activity, then to the lowest id. */
function outranks(a: HeroCandidate, b: HeroCandidate): boolean {
  if (a.level !== b.level) return a.level > b.level;
  if (a.activeAt !== b.activeAt) return a.activeAt > b.activeAt;
  return a.id < b.id;
}

/** Ids of the hero of each room. */
export function heroPerRoom(candidates: readonly HeroCandidate[]): Set<number> {
  const best = new Map<string | null, HeroCandidate>();
  for (const c of candidates) {
    const cur = best.get(c.room);
    if (!cur || outranks(c, cur)) best.set(c.room, c);
  }
  return new Set([...best.values()].map((c) => c.id));
}
