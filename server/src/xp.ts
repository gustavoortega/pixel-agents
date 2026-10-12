/**
 * XP rules (pure). XP pays for real work only: a commit, a PR created or merged, tests going
 * green after a change. Activity (turns, tools, sub-agents) pays nothing, so a crew of 50 agents
 * levels its lead up no faster than one agent doing the same work. No I/O and no clock, so the
 * whole table is unit-testable.
 */

export const SIGNAL_XP = { commit: 60, pr: 120, merge: 200, tests: 40 } as const;
export type SignalKind = keyof typeof SIGNAL_XP;
/** A turn that commits more than this is splitting work to farm XP, not shipping more of it. */
export const MAX_COMMITS_PER_TURN = 3;
/** Re-running a green suite proves nothing new. */
export const MAX_TESTS_PER_TURN = 1;
export const MOOD_HAPPY_STREAK = 1;
export const MOOD_FRUSTRATED_FAILURES = 3;

/** The member counters the rules read. */
export interface XpMember {
  xp: number;
  streak: number;
  consecutiveFailures: number;
}

/** What a rule changes on the member. `xp` is added, the rest are set. */
export interface MemberChange {
  xp?: number;
  streak?: number;
  consecutiveFailures?: number;
}

export type XpEvent =
  { type: 'signal'; signal: SignalKind } | { type: 'toolEnd'; failed?: boolean };

export interface XpResult {
  xpDelta: number;
  levelUp?: number;
  change: MemberChange;
}

/** XP needed to go from `level` to `level + 1`. */
export function xpForLevel(level: number): number {
  return Math.round(100 * Math.pow(level, 1.5));
}

/** Level (from 1) for a total XP, with the progress inside it. `xpToNext` is the whole span of
 *  the current level, so the bar fraction is xpIntoLevel / xpToNext. */
export function levelForXp(xp: number): { level: number; xpIntoLevel: number; xpToNext: number } {
  let rest = Number.isFinite(xp) && xp > 0 ? Math.floor(xp) : 0;
  let level = 1;
  while (rest >= xpForLevel(level)) {
    rest -= xpForLevel(level);
    level++;
  }
  return { level, xpIntoLevel: rest, xpToNext: xpForLevel(level) };
}

/** The member's mood, derived and never stored: an alarm beats a failure streak beats real work
 *  earned since the last failed tool. */
export function moodFor(state: {
  tripwire: boolean;
  consecutiveFailures: number;
  streak: number;
}): 'alarmed' | 'frustrated' | 'happy' | 'neutral' {
  if (state.tripwire) {
    return 'alarmed';
  }
  if (state.consecutiveFailures >= MOOD_FRUSTRATED_FAILURES) {
    return 'frustrated';
  }
  if (state.streak >= MOOD_HAPPY_STREAK) {
    return 'happy';
  }
  return 'neutral';
}

/**
 * Apply one event and return what the member earned; the caller applies `change` to the roster.
 * Awards come only from the lead's own transcript tool results; hooks feed the mood only;
 * sidechain records, teammates, sub-agents and hooks-only providers never award.
 */
export function applyXpEvent(member: XpMember, event: XpEvent): XpResult {
  const change: MemberChange = {};
  let xpDelta = 0;

  if (event.type === 'signal') {
    xpDelta = SIGNAL_XP[event.signal];
    change.xp = xpDelta;
    // streak counts awards since the last failed tool: it is what makes the member happy.
    change.streak = member.streak + 1;
  } else if (event.failed) {
    change.consecutiveFailures = member.consecutiveFailures + 1;
    if (member.streak !== 0) {
      change.streak = 0;
    }
  } else if (member.consecutiveFailures !== 0) {
    // Only a real change: an empty one skips the roster write and the broadcast on every tool.
    change.consecutiveFailures = 0;
  }

  const result: XpResult = { xpDelta, change };
  if (xpDelta > 0) {
    const before = levelForXp(member.xp).level;
    const after = levelForXp(member.xp + xpDelta).level;
    if (after > before) {
      result.levelUp = after;
    }
  }
  return result;
}
