import { createHash } from 'crypto';
import * as fs from 'fs';

import type { AgentHealth, AgentHealthClear } from '../../core/src/messages.js';
import type { SessionLiveness, TurnTraits } from '../../core/src/provider.js';
import type { AgentStateStore } from './agentStateStore.js';
import {
  HEALTH_DEAD_REMOVE_MS,
  HEALTH_LOOP_REPEATS,
  HEALTH_MINUTE_MS,
  HEALTH_STALLED_MS,
  HEALTH_STUCK_RUNS,
  HEALTH_TOOL_MEMORY,
  SHADOW_ID_BASE,
  TURN_LONG_TOOL_STALE_MS,
} from './constants.js';
import { parseTestSummary } from './testSummary.js';
import type { AgentState, HealthTracking, HealthView } from './types.js';

/**
 * Agent health: who is stuck, stalled, looping or dead.
 *
 * - stuck: HEALTH_STUCK_RUNS red test runs with no successful edit between them.
 * - stalled: an open turn with no transcript line and no hook for HEALTH_STALLED_MS
 *   (TURN_LONG_TOOL_STALE_MS while a long-running tool is open).
 * - looping: the same tool call, by name and input hash, HEALTH_LOOP_REPEATS times in a row.
 * - dead: the session's process is gone (healthTick.ts asks the provider).
 *
 * Tool calls and results are counted from the agent's own transcript only, in hooks mode and
 * heuristic mode alike: a hook seen next to its transcript record would count the call twice.
 * Hooks only move the clocks. Shadow agents (sub-agent mirrors) are never tracked.
 *
 * Every mutation recomputes the agent's state and broadcasts only a change, so a mark clears
 * exactly when the counters say it should.
 */

type Traits = TurnTraits | undefined;

/** Per agent, kept here rather than on AgentState.health so that stays plain data: tool
 *  calls by id, to name a later result, and the calls still waiting for one. */
interface ToolMemory {
  calls: Map<string, { name: string; inputHash: string }>;
  open: Map<string, string>;
}

const toolMemory = new Map<number, ToolMemory>();
/** File offset an agent replaying its transcript history must reach before compares resume. */
const catchUpUntil = new Map<number, number>();

function isShadow(agent: AgentState): boolean {
  return agent.id >= SHADOW_ID_BASE;
}

function freshHealth(
  progressAt: number,
  lastSent: HealthView | null = null,
  lastSentSince?: number,
): HealthTracking {
  return {
    redRuns: 0,
    lastCall: null,
    turnOpenAt: null,
    progressAt,
    permissionPendingAt: null,
    deadAt: null,
    lastSent,
    lastSentSince,
  };
}

/** When the agent's transcript was last written, or now when there is none yet. Never 0: a
 *  zero clock reads as decades of silence the moment a turn opens. */
function startClock(agent: AgentState): number {
  try {
    const mtime = agent.jsonlFile ? fs.statSync(agent.jsonlFile).mtimeMs : 0;
    if (mtime > 0) return mtime;
  } catch {
    // No transcript yet.
  }
  return Date.now();
}

function healthOf(agent: AgentState): HealthTracking {
  if (!agent.health) {
    agent.health = freshHealth(startClock(agent));
    // A new tracking object is a new agent: nothing remembered under its id still applies.
    toolMemory.delete(agent.id);
    catchUpUntil.delete(agent.id);
  }
  return agent.health;
}

function memoryOf(agentId: number): ToolMemory {
  let memory = toolMemory.get(agentId);
  if (!memory) {
    memory = { calls: new Map(), open: new Map() };
    toolMemory.set(agentId, memory);
  }
  return memory;
}

/** Object keys sorted at every depth, so two serializations of one input agree. */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object') {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      sorted[key] = canonical((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}

/** Hash of a call's input. The top-level `description` is the model's free-text label for the
 *  call, so the same command under a reworded label is the same call. Only the hash is kept:
 *  the input itself can hold anything. */
function inputHash(input: unknown): string {
  const call =
    input !== null && typeof input === 'object' && !Array.isArray(input)
      ? Object.fromEntries(Object.entries(input).filter(([key]) => key !== 'description'))
      : input;
  return createHash('sha256')
    .update(JSON.stringify(canonical(call ?? null)))
    .digest('hex');
}

/** A tool_result's text: the string itself, or its text blocks joined. */
function resultText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const texts: string[] = [];
  for (const block of content) {
    const b = block as { type?: unknown; text?: unknown } | null;
    if (b?.type === 'text' && typeof b.text === 'string') texts.push(b.text);
  }
  return texts.join('\n');
}

/** What decides whether silence is a stall, read off the agent right now. */
interface HealthContext {
  /** The agent stopped and is waiting on the user. */
  isWaiting: boolean;
  /** An open call is a long-running tool (a build, a sub-agent): it may write nothing for minutes. */
  longToolOpen: boolean;
  /** An open call waits on the user's answer. */
  userInputOpen: boolean;
}

function contextOf(agent: AgentState, traits: Traits): HealthContext {
  let longToolOpen = false;
  let userInputOpen = false;
  // Any open call decides, not the newest: parallel calls finish in any order.
  for (const name of toolMemory.get(agent.id)?.open.values() ?? []) {
    if (traits?.longRunningTools.has(name)) longToolOpen = true;
    if (traits?.userInputTools.has(name)) userInputOpen = true;
  }
  return { isWaiting: agent.isWaiting, longToolOpen, userInputOpen };
}

/** What an agent shows, by precedence: dead, stalled, looping, stuck. */
function deriveHealth(h: HealthTracking, now: number, ctx: HealthContext): HealthView | null {
  if (h.deadAt !== null) return { state: 'dead', reason: 'process_gone', count: 0 };
  // Waiting on the user (a stop, a question, a permission prompt) is silence, not a stall.
  const waitingOnUser = ctx.isWaiting || ctx.userInputOpen || h.permissionPendingAt !== null;
  if (h.turnOpenAt !== null && !waitingOnUser) {
    const silentMs = now - h.progressAt;
    const windowMs = ctx.longToolOpen ? TURN_LONG_TOOL_STALE_MS : HEALTH_STALLED_MS;
    if (silentMs >= windowMs) {
      return {
        state: 'stalled',
        reason: 'no_progress',
        count: Math.floor(silentMs / HEALTH_MINUTE_MS),
      };
    }
  }
  if (h.lastCall && h.lastCall.repeats >= HEALTH_LOOP_REPEATS) {
    return { state: 'looping', reason: 'same_call_repeated', count: h.lastCall.repeats };
  }
  if (h.redRuns >= HEALTH_STUCK_RUNS) {
    return { state: 'stuck', reason: 'tests_failing_no_edits', count: h.redRuns };
  }
  return null;
}

function sameView(a: HealthView | null, b: HealthView | null): boolean {
  if (!a || !b) return a === b;
  return a.state === b.state && a.reason === b.reason && a.count === b.count;
}

/** Typed against the generated protocol, so a reason outside the vocabulary cannot compile. */
function healthMessage(
  id: number,
  view: HealthView | null,
  since: number | undefined,
): AgentHealth | AgentHealthClear {
  if (!view) return { type: 'agentHealthClear', id };
  return since === undefined
    ? { type: 'agentHealth', id, ...view }
    : { type: 'agentHealth', id, ...view, since };
}

/** Recompute and broadcast only a change. Held while the agent's transcript history replays,
 *  so history cannot flicker marks on and off. */
function publish(
  agent: AgentState,
  store: AgentStateStore,
  traits: Traits,
  now = Date.now(),
): void {
  const h = agent.health;
  if (!h || catchUpUntil.has(agent.id)) return;
  const next = deriveHealth(h, now, contextOf(agent, traits));
  if (sameView(h.lastSent, next)) return;
  // A new state or reason starts the clock; a count that grows (stalled minutes) keeps it.
  if (!next) h.lastSentSince = undefined;
  else if (h.lastSent?.state !== next.state || h.lastSent.reason !== next.reason) {
    h.lastSentSince = now;
  }
  h.lastSent = next;
  store.broadcast({ ...healthMessage(agent.id, next, h.lastSentSince) });
}

// ── Transcript events (the only source of calls and results) ──

/** Any transcript line is progress, whatever it says. */
export function healthOnLine(agent: AgentState, store: AgentStateStore, traits: Traits): void {
  if (isShadow(agent)) return;
  healthOf(agent).progressAt = Date.now();
  publish(agent, store, traits);
}

/** One of the agent's own tool calls. */
export function healthOnToolUse(
  agent: AgentState,
  store: AgentStateStore,
  traits: Traits,
  toolUseId: string,
  name: string,
  input: unknown,
): void {
  if (isShadow(agent)) return;
  const h = healthOf(agent);
  const memory = memoryOf(agent.id);
  // A record seen again under the same id is not a new call.
  if (memory.calls.has(toolUseId)) return;
  const hash = inputHash(input);
  memory.calls.set(toolUseId, { name, inputHash: hash });
  if (memory.calls.size > HEALTH_TOOL_MEMORY) {
    const oldest = memory.calls.keys().next();
    if (!oldest.done) memory.calls.delete(oldest.value);
  }
  memory.open.set(toolUseId, name);
  h.lastCall =
    h.lastCall?.name === name && h.lastCall.hash === hash
      ? { name, hash, repeats: h.lastCall.repeats + 1 }
      : { name, hash, repeats: 1 };
  h.turnOpenAt ??= Date.now();
  publish(agent, store, traits);
}

/** A tool_result in the agent's transcript. A shell result with a red runner summary counts
 *  toward stuck; a green one, or a successful edit, starts the count over. A result for a call
 *  the agent never made here (not in its memory) is ignored. */
export function healthOnToolResult(
  agent: AgentState,
  store: AgentStateStore,
  traits: Traits,
  block: { tool_use_id: string; content?: unknown; is_error?: unknown },
): void {
  if (isShadow(agent)) return;
  const h = healthOf(agent);
  const memory = toolMemory.get(agent.id);
  memory?.open.delete(block.tool_use_id);
  // Answered once no call is left open: in a parallel batch, a sibling's result can land while
  // the prompt for another call is still up.
  if (!memory || memory.open.size === 0) h.permissionPendingAt = null;
  const call = memory?.calls.get(block.tool_use_id);
  if (call && traits) {
    if (traits.shellTools.has(call.name)) {
      // The exit code is not evidence: a build or a grep fails too. Only a summary counts.
      const summary = parseTestSummary(resultText(block.content));
      if (summary && summary.failed >= 1) h.redRuns++;
      else if (summary && summary.passed >= 1) h.redRuns = 0;
    } else if (traits.editTools.has(call.name) && block.is_error !== true) {
      h.redRuns = 0;
    }
  }
  publish(agent, store, traits);
}

/** A user prompt opens a turn. The user stepped in, so failed runs and repeats start over. */
export function healthOnPrompt(agent: AgentState, store: AgentStateStore, traits: Traits): void {
  if (isShadow(agent)) return;
  const h = healthOf(agent);
  h.redRuns = 0;
  h.lastCall = null;
  h.turnOpenAt = Date.now();
  h.permissionPendingAt = null;
  toolMemory.get(agent.id)?.open.clear();
  publish(agent, store, traits);
}

/** No turn in flight: nothing it opened is still running, and repeats start over. */
function closeTurn(agentId: number, h: HealthTracking): void {
  h.lastCall = null;
  h.turnOpenAt = null;
  toolMemory.get(agentId)?.open.clear();
}

/** The turn ended: turn_duration, an interrupt, Stop or an idle prompt. */
export function healthOnTurnEnd(agent: AgentState, store: AgentStateStore, traits: Traits): void {
  if (isShadow(agent)) return;
  closeTurn(agent.id, healthOf(agent));
  publish(agent, store, traits);
}

// ── Hook events (clocks only) ──

/** A hook reached the agent, a sub-agent's included: progress, and the answer to any
 *  permission prompt that was up. */
export function healthOnHook(agent: AgentState, store: AgentStateStore, traits: Traits): void {
  if (isShadow(agent)) return;
  const h = healthOf(agent);
  h.progressAt = Date.now();
  h.permissionPendingAt = null;
  publish(agent, store, traits);
}

/** The agent's own PreToolUse: its turn is open before the transcript says so. */
export function healthOnHookToolStart(
  agent: AgentState,
  store: AgentStateStore,
  traits: Traits,
): void {
  if (isShadow(agent)) return;
  healthOf(agent).turnOpenAt ??= Date.now();
  publish(agent, store, traits);
}

/** A permission prompt is up: the silence that follows is the user's, not a stall. Only a
 *  later hook, a prompt, or a tool result that leaves no call open takes it down: the
 *  tool_use record behind the prompt can be read after it, and a parallel call's result
 *  before it is answered. */
export function healthOnPermission(
  agent: AgentState,
  store: AgentStateStore,
  traits: Traits,
): void {
  if (isShadow(agent)) return;
  healthOf(agent).permissionPendingAt = Date.now();
  publish(agent, store, traits);
}

// ── Lifecycle ──

/** Start over for a new session: SessionEnd, /clear, a reassigned transcript. What clients
 *  were last shown survives, so the compare clears a mark they still display. */
export function resetHealth(agent: AgentState, store: AgentStateStore, traits: Traits): void {
  if (isShadow(agent)) return;
  agent.health = freshHealth(
    Date.now(),
    agent.health?.lastSent ?? null,
    agent.health?.lastSentSince,
  );
  toolMemory.delete(agent.id);
  catchUpUntil.delete(agent.id);
  publish(agent, store, traits);
}

/** What the transcript tail says at adopt, restore or reassign (turnState.ts). */
export interface HealthSeed {
  /** The tail ends mid-turn. */
  active: boolean;
  /** Epoch ms of the newest meaningful record, when active. */
  atMs?: number;
  /** Newest write to the transcript or its sub-agents' (0 when unknown). */
  clockMs: number;
  /** Calls the tail left without a result. */
  pendingTools: ReadonlyArray<{ id: string; name: string }>;
}

/** Seed from the tail. Called before the agent is announced, or right after a reset that
 *  already told clients, so nothing is broadcast here. */
export function seedHealth(agent: AgentState, seed: HealthSeed): void {
  if (isShadow(agent)) return;
  const h = healthOf(agent);
  h.progressAt = seed.clockMs > 0 ? seed.clockMs : Date.now();
  h.turnOpenAt = seed.active ? (seed.atMs ?? h.progressAt) : null;
  const memory = memoryOf(agent.id);
  memory.open.clear();
  for (const tool of seed.pendingTools) memory.open.set(tool.id, tool.name);
}

/** The watch starts with `fileSize` bytes written before it: they replay as history, with
 *  compares held until the agent's offset reaches them. */
export function beginHealthCatchUp(agent: AgentState, fileSize: number): void {
  if (isShadow(agent) || fileSize <= agent.fileOffset) return;
  healthOf(agent);
  catchUpUntil.set(agent.id, fileSize);
}

/** After a read: once the history is in, one compare says where it left the agent. */
export function endHealthCatchUp(
  agent: AgentState,
  store: AgentStateStore,
  traits: Traits,
  fileSize: number,
): void {
  const until = catchUpUntil.get(agent.id);
  if (until === undefined) return;
  // A file cut shorter than the mark would otherwise hold compares forever.
  if (agent.fileOffset < until && agent.fileOffset < fileSize) return;
  catchUpUntil.delete(agent.id);
  publish(agent, store, traits);
}

/**
 * One health tick for one agent: record liveness, fold the transcript clock in while a turn is
 * open, then compare. A process found dead takes its turn with it, so a resume starts at its
 * prompt. Returns true when a dead external agent has been gray long enough to go.
 */
export function tickHealth(
  agent: AgentState,
  store: AgentStateStore,
  traits: Traits,
  liveness: SessionLiveness,
  transcriptClockMs: () => number,
  now: number,
): boolean {
  if (isShadow(agent)) return false;
  const h = healthOf(agent);
  if (liveness === 'dead' && h.deadAt === null) {
    h.deadAt = now;
    closeTurn(agent.id, h);
  } else if (liveness === 'alive') h.deadAt = null;
  // A lead blocked on a sub-agent writes nothing itself; the sub-agent's transcript does.
  if (h.deadAt === null && h.turnOpenAt !== null) {
    h.progressAt = Math.max(h.progressAt, transcriptClockMs());
  }
  if (h.deadAt !== null && agent.isExternal && now - h.deadAt >= HEALTH_DEAD_REMOVE_MS) {
    return true;
  }
  publish(agent, store, traits, now);
  return false;
}

/** The agent left the store: drop what is kept under its id. */
export function forgetHealth(agentId: number): void {
  toolMemory.delete(agentId);
  catchUpUntil.delete(agentId);
}

/** What a reconnecting client needs for this agent: the mark it should show, or a clear. */
export function healthResendMessage(agent: AgentState): Record<string, unknown> {
  const h = agent.health;
  return { ...healthMessage(agent.id, h?.lastSent ?? null, h?.lastSentSince) };
}
