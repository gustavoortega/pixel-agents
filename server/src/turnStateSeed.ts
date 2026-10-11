import * as fs from 'fs';
import * as path from 'path';

import type { HookProvider } from '../../core/src/provider.js';
import { CONTEXT_SEED_TAIL_BYTES } from './constants.js';
import { type DerivedTurnState, deriveTurnState } from './turnState.js';
import type { AgentState } from './types.js';

/** A derivation and the hook count it was computed against. */
export interface TurnDerivation {
  state: DerivedTurnState;
  hookSeq: number;
}

/** mtimes of `<dir of the transcript>/<session>/subagents/*.jsonl`, [] when absent. */
function subagentMtimes(jsonlFile: string): number[] {
  const dir = path.join(path.dirname(jsonlFile), path.basename(jsonlFile, '.jsonl'), 'subagents');
  try {
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.jsonl'))
      .flatMap((f) => {
        try {
          return [fs.statSync(path.join(dir, f)).mtimeMs];
        } catch {
          return [];
        }
      });
  } catch {
    return [];
  }
}

/**
 * Read the transcript tail once and derive the agent's state from it.
 *
 * Stats the file a single time and reads up to that size, then moves
 * `fileOffset` to that size: whatever lands after the stat is parsed live, so no
 * record is both derived and replayed or lost in between. A partial last line
 * goes to `lineBuffer` for the live reader to complete.
 *
 * Returns null (offset untouched) when the provider can't classify turns or the
 * file can't be read; the agent then stays "unknown", which reads as idle.
 */
export function deriveAgentTurnState(
  agent: AgentState,
  provider: HookProvider | null,
  now = Date.now(),
): TurnDerivation | null {
  if (!provider?.turnSignal || !provider.turnTraits || !agent.jsonlFile) return null;
  const hookSeq = agent.hookSeq ?? 0;
  let size: number;
  let mtimeMs: number;
  let text: string;
  try {
    const stat = fs.statSync(agent.jsonlFile);
    size = stat.size;
    mtimeMs = stat.mtimeMs;
    const start = Math.max(0, size - CONTEXT_SEED_TAIL_BYTES);
    const length = size - start;
    const buf = Buffer.alloc(length);
    if (length > 0) {
      const fd = fs.openSync(agent.jsonlFile, 'r');
      try {
        fs.readSync(fd, buf, 0, length, start);
      } finally {
        fs.closeSync(fd);
      }
    }
    text = buf.toString('utf8');
    // A mid-file start lands inside a record: drop that leading fragment.
    if (start > 0) text = text.slice(text.indexOf('\n') + 1);
  } catch {
    return null;
  }

  const lines = text.split('\n');
  const last = lines[lines.length - 1];
  let partial = '';
  if (last) {
    // No trailing newline: a record the CLI is still writing, unless it parses.
    try {
      JSON.parse(last);
    } catch {
      partial = lines.pop() ?? '';
    }
  }

  agent.fileOffset = size;
  agent.lineBuffer = partial;
  const state = deriveTurnState(
    lines,
    now,
    { leadMtimeMs: mtimeMs, subagentMtimesMs: subagentMtimes(agent.jsonlFile) },
    provider.turnSignal.bind(provider),
    provider.turnTraits,
  );
  return { state, hookSeq };
}

/**
 * Put a derived state on the agent, unless a hook event reached it meanwhile.
 * Hooks are exact where this is a guess, so they win. Returns whether it applied.
 */
export function applyTurnDerivation(agent: AgentState, derivation: TurnDerivation): boolean {
  if ((agent.hookSeq ?? 0) !== derivation.hookSeq) return false;
  const { state } = derivation;
  agent.isWaiting = state.kind === 'waiting' || state.kind === 'awaitingInput';
  agent.awaitingInput = state.kind === 'awaitingInput';
  agent.derivedActive = state.kind === 'active';
  return true;
}

/** Derive and apply in one step. Call BEFORE the agent is announced. */
export function seedTurnState(agent: AgentState, provider: HookProvider | null): void {
  const derivation = deriveAgentTurnState(agent, provider);
  if (derivation) applyTurnDerivation(agent, derivation);
}
