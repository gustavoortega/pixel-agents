/**
 * XP rules (pure). The hook handler feeds normalized events in; the result says what the
 * roster member earned. No I/O and no clock, so the whole table is unit-testable.
 */

import type { AgentState } from './types.js';

export const XP_TURN_WITH_TOOLS = 50;
export const XP_CLEAN_TURN = 25;
export const XP_TEXT_ONLY_TURN = 10;
export const XP_SUBAGENT = 15;
export const XP_SHIP = 100;
export const XP_STREAK_STEP = 10;
export const XP_STREAK_BONUS_CAP = 50;
export const MOOD_HAPPY_STREAK = 3;
export const MOOD_FRUSTRATED_FAILURES = 3;

/** Per-turn bookkeeping kept on the agent between hook events. */
export type XpTurnState = NonNullable<AgentState['xpTurn']>;

export function newXpTurnState(): XpTurnState {
  return { xpToolsInTurn: false, turnFailed: false, pendingShip: false, shipped: false };
}

/** The member counters the rules read. */
export interface XpMember {
  xp: number;
  streak: number;
  consecutiveFailures: number;
}

/** What a rule changes on the member. xp/turns/cleanTurns/ships are added, the rest are set. */
export interface MemberChange {
  xp?: number;
  turns?: number;
  cleanTurns?: number;
  ships?: number;
  streak?: number;
  bestStreak?: number;
  consecutiveFailures?: number;
}

export type XpEvent =
  | { kind: 'toolStart'; ships?: boolean }
  | { kind: 'toolEnd'; failed?: boolean }
  | { kind: 'turnEnd'; awaitingInput?: boolean }
  | { kind: 'subagentEnd' };

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

/** The member's mood, derived and never stored: an alarm beats a failure streak beats a win streak. */
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

// A segment is one simple command: shell separators cut the line first, so a quoted
// "git commit" inside an echo never starts a segment.
const SEGMENT_SPLIT = /[;&|\n]/;
const LEADING_ASSIGNMENTS = /^(?:[A-Za-z_]\w*=\S*\s+)+/;
const SHIP_COMMAND = /^git\s+((-[cC]\s+\S+|-\S+)\s+){0,4}commit\b|^gh\s+pr\s+create\b/;

/** Does this shell command commit or open a PR? Only the command text is read, never kept. */
export function isShipCommand(command: string): boolean {
  for (const raw of command.split(SEGMENT_SPLIT)) {
    const segment = raw.trim().replace(LEADING_ASSIGNMENTS, '');
    if (SHIP_COMMAND.test(segment)) {
      return true;
    }
  }
  return false;
}

/**
 * Apply one event. Mutates `turn` (the agent's per-turn state) and returns what the member
 * earned; the caller applies `change` to the roster. Awards happen only for hook events.
 */
export function applyXpEvent(member: XpMember, turn: XpTurnState, event: XpEvent): XpResult {
  const change: MemberChange = {};
  let xpDelta = 0;

  switch (event.kind) {
    case 'toolStart':
      turn.xpToolsInTurn = true;
      // One ship per turn: a second commit in the same turn earns nothing.
      if (event.ships && !turn.shipped) {
        turn.pendingShip = true;
      }
      break;

    case 'toolEnd':
      if (event.failed) {
        turn.turnFailed = true;
        turn.pendingShip = false;
        change.consecutiveFailures = member.consecutiveFailures + 1;
      } else {
        if (member.consecutiveFailures !== 0) {
          change.consecutiveFailures = 0;
        }
        if (turn.pendingShip) {
          // The award waits for the tool to succeed: a commit that errored shipped nothing.
          turn.pendingShip = false;
          turn.shipped = true;
          xpDelta += XP_SHIP;
          change.ships = 1;
        }
      }
      break;

    case 'turnEnd': {
      // idle_prompt is the CLI waiting on the user, not a finished turn.
      if (event.awaitingInput) {
        break;
      }
      change.turns = 1;
      if (turn.xpToolsInTurn) {
        xpDelta += XP_TURN_WITH_TOOLS;
        if (!turn.turnFailed) {
          const streak = member.streak + 1;
          xpDelta += XP_CLEAN_TURN + Math.min(XP_STREAK_STEP * streak, XP_STREAK_BONUS_CAP);
          change.streak = streak;
          change.bestStreak = streak;
          change.cleanTurns = 1;
        } else {
          change.streak = 0;
        }
      } else {
        // Chatting earns a little and leaves the streak alone, so talking cannot be farmed.
        xpDelta += XP_TEXT_ONLY_TURN;
      }
      turn.xpToolsInTurn = false;
      turn.turnFailed = false;
      turn.pendingShip = false;
      turn.shipped = false;
      break;
    }

    case 'subagentEnd':
      xpDelta += XP_SUBAGENT;
      break;
  }

  const result: XpResult = { xpDelta, change };
  if (xpDelta > 0) {
    change.xp = xpDelta;
    const before = levelForXp(member.xp).level;
    const after = levelForXp(member.xp + xpDelta).level;
    if (after > before) {
      result.levelUp = after;
    }
  }
  return result;
}
