import type { TurnSignal, TurnTraits } from '../../core/src/provider.js';
import {
  TURN_ACTIVE_STALE_MS,
  TURN_LONG_TOOL_STALE_MS,
  TURN_WAITING_STALE_MS,
} from './constants.js';

/** What an adopted or restored agent should look like, read from its transcript. */
export type DerivedTurnState =
  { kind: 'active' } | { kind: 'waiting' } | { kind: 'awaitingInput' } | { kind: 'idle' };

/** Last-write times of the files that prove an agent is alive. */
export interface TurnClocks {
  /** The lead transcript's mtime. */
  leadMtimeMs: number;
  /** mtimes of the agent's sub-agent transcripts: a lead blocked on a sub-agent
   *  writes nothing itself while the sub-agent is busy. */
  subagentMtimesMs?: readonly number[];
}

/**
 * Derive an agent's state from the tail of its transcript, without replaying it.
 *
 * Walks newest-first through `lines`, skipping bookkeeping and CLI-injected
 * records, so the newest meaningful record decides: a finished turn, an answer
 * or an interrupt reads as waiting; a prompt, reasoning or a tool in flight
 * reads as active. Tool calls are paired with their results by id, because a
 * parallel call can have one result back and another still running.
 *
 * "Active" is only believed while the files keep moving (see TurnClocks) and
 * "waiting" only while it is recent, so a transcript abandoned mid-turn or
 * finished days ago reads idle instead of lying either way.
 *
 * Pure: reads records through the provider's `signalOf`, never their shape.
 */
export function deriveTurnState(
  lines: readonly string[],
  now: number,
  clocks: TurnClocks,
  signalOf: (record: unknown) => TurnSignal,
  traits: TurnTraits,
): DerivedTurnState {
  const answered = new Set<string>();
  const pendingNames: string[] = [];
  let decision: 'active' | 'waiting' | undefined;
  let decidedAt: number | undefined;

  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line || !line.trim()) continue;
    let record: unknown;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }
    const sig = signalOf(record);
    if (sig.kind === 'ignore' || sig.kind === 'meta') continue;

    if (sig.kind === 'toolResult') {
      decision ??= 'active';
      decidedAt ??= sig.timestampMs;
      for (const id of sig.toolUseIds ?? []) answered.add(id);
      continue;
    }
    if (sig.kind === 'toolUse') {
      decision ??= 'active';
      decidedAt ??= sig.timestampMs;
      const ids = sig.toolUseIds ?? [];
      const names = sig.toolNames ?? [];
      ids.forEach((id, n) => {
        if (!answered.has(id)) pendingNames.push(names[n] ?? '');
      });
      // A tool_use ends the search for older pending calls only at a turn
      // boundary; keep walking so parallel calls split across records pair up.
      continue;
    }

    // A turn boundary or the turn's opening: nothing older can still be pending.
    if (decision === undefined) {
      decision = sig.kind === 'prompt' || sig.kind === 'thinking' ? 'active' : 'waiting';
      decidedAt = sig.timestampMs;
    }
    break;
  }

  if (decision === undefined) return { kind: 'idle' };

  if (decision === 'waiting') {
    const age = now - (decidedAt ?? clocks.leadMtimeMs);
    return age > TURN_WAITING_STALE_MS ? { kind: 'idle' } : { kind: 'waiting' };
  }

  const askedUser = pendingNames.some((n) => traits.userQuestionTools.has(n));
  if (askedUser) {
    const age = now - (decidedAt ?? clocks.leadMtimeMs);
    return age > TURN_WAITING_STALE_MS ? { kind: 'idle' } : { kind: 'awaitingInput' };
  }
  const clock = Math.max(clocks.leadMtimeMs, ...(clocks.subagentMtimesMs ?? []));
  const longRunner = pendingNames.some((n) => traits.longRunningTools.has(n));
  const limit = longRunner ? TURN_LONG_TOOL_STALE_MS : TURN_ACTIVE_STALE_MS;
  return now - clock > limit ? { kind: 'idle' } : { kind: 'active' };
}
