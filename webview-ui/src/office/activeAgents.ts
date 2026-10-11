import type { Character } from './types.js';

/** Agents working right now: `isActive` is the server status 'active' (not waiting, not idle). */
export function countActiveAgents(characters: Iterable<Pick<Character, 'isActive' | 'isSubagent'>>) {
  let n = 0;
  for (const ch of characters) if (ch.isActive && !ch.isSubagent) n++;
  return n;
}
