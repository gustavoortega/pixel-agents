import type { AgentArtifacts, AgentLoop, AgentTests } from '../../core/src/messages.js';
import type { HookProvider, LoopEvent } from '../../core/src/provider.js';
import type { AgentStateStore } from './agentStateStore.js';
import {
  MONITOR_ARTIFACT_ITEMS,
  MONITOR_ARTIFACT_TITLE_MAX,
  MONITOR_ARTIFACT_URL_MAX,
  MONITOR_ARTIFACTS_MAX,
  MONITOR_CALL_INPUT_VALUE_MAX,
  MONITOR_CALL_MEMORY,
  SHADOW_ID_BASE,
} from './constants.js';
import { recordTimestampMs } from './contextUsage.js';
import { resultText } from './health.js';
import { parseTestSummary } from './testSummary.js';
import type { AgentState, MonitorView } from './types.js';
import { sanitizeWorkflowText } from './workflowRuns.js';

/**
 * What a transcript says about an agent's artifacts, loop and test runs, as one reducer.
 *
 * The live parser feeds it every record as it is read, and the history scan (historyScan.ts)
 * feeds it the records an agent was adopted past: the same `feedFacts`, two callers, so a
 * record can never mean one thing live and another in history. The scan fills a separate
 * `MonitorFacts` and `absorbHistory` puts it under the live one, because history is older.
 *
 * Privacy: artifact titles are user text and urls are access links. Nothing here logs
 * either, and nothing persists them; they leave only in `agentArtifacts`.
 */

interface ArtifactEntry {
  title?: string;
  /** Epoch ms of the newest publish; absent when no record said. */
  at?: number;
  publishes: number;
}

/** A wake-up loop as a stretch of records says it, so two stretches can be joined. */
interface LoopFacts {
  /** A wake-up was scheduled or fired: the agent runs a loop. */
  active: boolean;
  /** The next wake in epoch ms. Meaningful only while `settled`. */
  nextAt?: number;
  /** Wakes that fired. */
  wakes: number;
  /** A stop is in the stretch: what came before it no longer applies. */
  stopped: boolean;
  /** The stretch decided `nextAt` (a schedule set it, a fire cleared it). */
  settled: boolean;
}

interface PendingCall {
  name: string;
  input: Record<string, unknown>;
}

export interface MonitorFacts {
  /** Oldest publish first, keyed by url. */
  artifacts: Map<string, ArtifactEntry>;
  /** Urls were dropped to stay under the cap: the count is a floor. */
  artifactsDropped: boolean;
  loop: LoopFacts;
  tests?: { passed: number; failed: number; at?: number };
  /** Calls still waiting for their result, by tool_use id. */
  calls: Map<string, PendingCall>;
}

export function newFacts(): MonitorFacts {
  return {
    artifacts: new Map(),
    artifactsDropped: false,
    loop: { active: false, wakes: 0, stopped: false, settled: false },
    calls: new Map(),
  };
}

/** Which of the three views a record moved. */
export interface Dirty {
  artifacts: boolean;
  loop: boolean;
  tests: boolean;
}

type Rec = Record<string, unknown>;

function asRec(value: unknown): Rec | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Rec)
    : undefined;
}

/** A call's input reduced to what pairing needs: short scalars only. */
function slimInput(input: unknown): Record<string, unknown> {
  const slim: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(asRec(input) ?? {})) {
    if (typeof value === 'boolean' || typeof value === 'number') slim[key] = value;
    else if (typeof value === 'string' && value.length <= MONITOR_CALL_INPUT_VALUE_MAX) {
      slim[key] = value;
    } else if (value !== null && value !== undefined) slim[key] = true;
  }
  return slim;
}

function applyLoop(loop: LoopFacts, event: LoopEvent): void {
  switch (event.kind) {
    case 'schedule':
      loop.active = true;
      loop.nextAt = event.nextAt;
      loop.settled = true;
      break;
    case 'fire':
      // The agent is awake: the wake that was pending has happened.
      loop.active = true;
      loop.nextAt = undefined;
      loop.settled = true;
      loop.wakes += 1;
      break;
    case 'stop':
      loop.active = false;
      loop.nextAt = undefined;
      loop.settled = false;
      loop.wakes = 0;
      loop.stopped = true;
      break;
  }
}

function publishArtifact(
  facts: MonitorFacts,
  published: { url: string; title?: string },
  at: number | undefined,
): boolean {
  const url = published.url;
  // An access link, rendered as a link: anything but http(s) is not one.
  if (url.length > MONITOR_ARTIFACT_URL_MAX || !/^https?:\/\//i.test(url)) return false;
  const title = sanitizeWorkflowText(published.title, MONITOR_ARTIFACT_TITLE_MAX);
  const prev = facts.artifacts.get(url);
  facts.artifacts.delete(url);
  facts.artifacts.set(url, {
    title: title ?? prev?.title,
    at: at ?? prev?.at,
    publishes: (prev?.publishes ?? 0) + 1,
  });
  trimArtifacts(facts);
  return true;
}

function trimArtifacts(facts: MonitorFacts): void {
  while (facts.artifacts.size > MONITOR_ARTIFACTS_MAX) {
    const oldest = facts.artifacts.keys().next();
    if (oldest.done) break;
    facts.artifacts.delete(oldest.value);
    facts.artifactsDropped = true;
  }
}

function rememberCall(facts: MonitorFacts, id: string, name: string, input: unknown): void {
  facts.calls.set(id, { name, input: slimInput(input) });
  if (facts.calls.size > MONITOR_CALL_MEMORY) {
    const oldest = facts.calls.keys().next();
    if (!oldest.done) facts.calls.delete(oldest.value);
  }
}

/**
 * Fold one parsed transcript record into the facts. Returns which views it moved, so the live
 * path rebuilds and compares only those. A sub-agent's records (sidechain) are not the
 * agent's own.
 */
export function feedFacts(facts: MonitorFacts, record: unknown, provider: HookProvider): Dirty {
  const dirty: Dirty = { artifacts: false, loop: false, tests: false };
  const r = asRec(record);
  if (!r || r.isSidechain === true) return dirty;

  const loopEvent = provider.extractLoop?.(record);
  if (loopEvent) {
    applyLoop(facts.loop, loopEvent);
    dirty.loop = true;
  }

  const content = asRec(r.message)?.content ?? r.content;
  if (!Array.isArray(content)) return dirty;
  const blocks = content.map(asRec);
  const resultCount = blocks.filter((b) => b?.type === 'tool_result').length;
  const at = recordTimestampMs(record);
  const shellTools = provider.turnTraits?.shellTools;

  for (const block of blocks) {
    if (!block) continue;
    if (block.type === 'tool_use' && typeof block.id === 'string') {
      if (typeof block.name === 'string') rememberCall(facts, block.id, block.name, block.input);
    } else if (block.type === 'tool_result' && typeof block.tool_use_id === 'string') {
      const call = facts.calls.get(block.tool_use_id);
      facts.calls.delete(block.tool_use_id);
      if (!call) continue;
      if (shellTools?.has(call.name)) {
        // The exit code is not evidence (a failing run exits non-zero): only a summary counts.
        const summary = parseTestSummary(resultText(block.content));
        if (summary) {
          facts.tests = { passed: summary.passed, failed: summary.failed, at };
          dirty.tests = true;
        }
      }
      // The record's toolUseResult describes its result only when there is exactly one.
      if (resultCount === 1) {
        const published = provider.extractArtifact?.(
          { name: call.name, input: call.input },
          { isError: block.is_error === true, record },
        );
        if (published && publishArtifact(facts, published, at)) dirty.artifacts = true;
      }
    }
  }
  return dirty;
}

/**
 * Put `older` (what a history scan read) under `newer` (what the live path has read since):
 * publishes add up per url, the newer title and time win, a stop in `newer` discards the loop
 * `older` saw, and the newer test summary wins.
 */
export function absorbHistory(newer: MonitorFacts, older: MonitorFacts): void {
  const merged = new Map<string, ArtifactEntry>(older.artifacts);
  for (const [url, entry] of newer.artifacts) {
    const prev = merged.get(url);
    merged.delete(url);
    merged.set(url, {
      title: entry.title ?? prev?.title,
      at: entry.at ?? prev?.at,
      publishes: entry.publishes + (prev?.publishes ?? 0),
    });
  }
  newer.artifacts = merged;
  newer.artifactsDropped ||= older.artifactsDropped;
  trimArtifacts(newer);

  const loop = newer.loop;
  if (!loop.stopped) {
    loop.active ||= older.loop.active;
    loop.wakes += older.loop.wakes;
    if (!loop.settled) {
      loop.nextAt = older.loop.nextAt;
      loop.settled = older.loop.settled;
    }
    loop.stopped = older.loop.stopped;
  }

  newer.tests ??= older.tests;

  // A call whose result is still ahead of the watch offset.
  for (const [id, call] of older.calls) {
    if (!newer.calls.has(id)) newer.calls.set(id, call);
  }
  while (newer.calls.size > MONITOR_CALL_MEMORY) {
    const oldest = newer.calls.keys().next();
    if (oldest.done) break;
    newer.calls.delete(oldest.value);
  }
}

// ── Views: what clients are shown ──

/** `undefined` (the clear form) when nothing was published. A scan the budget cut leaves the
 *  count a floor, and then no `publishes` is claimed. */
export function artifactsView(
  facts: MonitorFacts,
  complete: boolean,
): MonitorView<AgentArtifacts> | undefined {
  const count = facts.artifacts.size;
  if (count === 0) return undefined;
  const whole = complete && !facts.artifactsDropped;
  const items = [...facts.artifacts]
    .reverse()
    .slice(0, MONITOR_ARTIFACT_ITEMS)
    .map(([url, entry]) => ({
      ...(entry.title !== undefined && { title: entry.title }),
      url,
      ...(whole && { publishes: entry.publishes }),
      ...(entry.at !== undefined && { at: entry.at }),
    }));
  return { count, complete: whole, items };
}

export function loopView(facts: MonitorFacts): MonitorView<AgentLoop> | undefined {
  const loop = facts.loop;
  if (!loop.active) return undefined;
  const view: MonitorView<AgentLoop> = {
    ...(loop.nextAt !== undefined && { nextAt: loop.nextAt }),
    ...(loop.wakes > 0 && { wakes: loop.wakes }),
  };
  return Object.keys(view).length > 0 ? view : undefined;
}

export function testsView(facts: MonitorFacts): MonitorView<AgentTests> | undefined {
  const tests = facts.tests;
  if (!tests) return undefined;
  return {
    passed: tests.passed,
    failed: tests.failed,
    ...(tests.at !== undefined && { at: tests.at }),
  };
}

// ── Per-agent state and broadcast ──

/** What the monitor keeps for one watched transcript. */
export interface MonitorTracker {
  readonly file: string;
  facts: MonitorFacts;
  /** A history scan is requested for this transcript (or running): hold the broadcast. */
  scanning: boolean;
  /** One scan per transcript. */
  scanRequested: boolean;
  /** The scan read everything before the watch offset (true when none was needed). */
  complete: boolean;
}

const trackers = new WeakMap<AgentState, MonitorTracker>();

export function trackerOf(agent: AgentState): MonitorTracker {
  const existing = trackers.get(agent);
  if (existing && existing.file === agent.jsonlFile) return existing;
  const fresh: MonitorTracker = {
    file: agent.jsonlFile,
    facts: newFacts(),
    scanning: false,
    scanRequested: false,
    complete: true,
  };
  trackers.set(agent, fresh);
  return fresh;
}

/** The tracker, only while it is still the agent's current one. */
export function currentTracker(agent: AgentState): MonitorTracker | undefined {
  const t = trackers.get(agent);
  return t && t.file === agent.jsonlFile ? t : undefined;
}

function sameView(a: object | undefined, b: object | undefined): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/** Broadcast the views that differ from what clients were last told. `only` limits the
 *  comparison to the views a record moved. */
export function publishMonitor(
  agentId: number,
  agent: AgentState,
  agents: AgentStateStore,
  tracker: MonitorTracker | undefined,
  only?: Dirty,
): void {
  const facts = tracker?.facts;
  const complete = tracker?.complete ?? true;
  if (!only || only.artifacts) {
    const view = facts ? artifactsView(facts, complete) : undefined;
    if (!sameView(agent.artifacts, view)) {
      agent.artifacts = view;
      agents.broadcast({ type: 'agentArtifacts', id: agentId, ...view });
    }
  }
  if (!only || only.loop) {
    const view = facts ? loopView(facts) : undefined;
    if (!sameView(agent.loop, view)) {
      agent.loop = view;
      agents.broadcast({ type: 'agentLoop', id: agentId, ...view });
    }
  }
  if (!only || only.tests) {
    const view = facts ? testsView(facts) : undefined;
    if (!sameView(agent.tests, view)) {
      agent.tests = view;
      agents.broadcast({ type: 'agentTests', id: agentId, ...view });
    }
  }
}

/**
 * The live seam: fold one record the parser just read. Never throws, and sends nothing while
 * the agent's history scan is still out (its messages go when it ends, so a client never sees
 * the live part of a count alone).
 */
export function feedMonitorRecord(
  agentId: number,
  agent: AgentState,
  agents: AgentStateStore,
  record: unknown,
  provider: HookProvider | null | undefined,
): void {
  if (!provider || agentId >= SHADOW_ID_BASE) return;
  try {
    const tracker = trackerOf(agent);
    const dirty = feedFacts(tracker.facts, record, provider);
    if (tracker.scanning || !(dirty.artifacts || dirty.loop || dirty.tests)) return;
    publishMonitor(agentId, agent, agents, tracker, dirty);
  } catch {
    // A malformed record must not take the parser's bookkeeping down with it.
  }
}

/** The transcript is gone (`/clear`, resume): forget it and tell clients, as the clear form. */
export function resetMonitorFacts(
  agentId: number,
  agent: AgentState,
  agents: AgentStateStore,
): void {
  trackers.delete(agent);
  publishMonitor(agentId, agent, agents, undefined);
}
