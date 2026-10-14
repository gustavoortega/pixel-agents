import * as fs from 'fs';

import type { AgentSession } from '../../core/src/messages.js';
import type { HookProvider, SessionMetaFacts } from '../../core/src/provider.js';
import type { AgentStateStore } from './agentStateStore.js';
import {
  CONTEXT_SEED_TAIL_BYTES,
  SESSION_BRANCH_MAX_LENGTH,
  SESSION_META_HEAD_BYTES,
} from './constants.js';
import { readTailLines } from './contextUsage.js';
import { type HistoryConsumer, readsHistory, registerHistoryConsumer } from './historyScan.js';
import type { AgentState, CostTrack, MonitorView, SessionMetaTrack } from './types.js';
import { sanitizeWorkflowText } from './workflowRuns.js';

/**
 * What the monitor shows about a session beyond its status: when the transcript began, the git
 * branch, the short session id and what the CLI says it has cost. Folded from the records the
 * way sessionSignals.ts folds the mode, and sent as `agentSession` only when it changes.
 *
 * The branch is user text (ticket names live in branches): capped like a label, never logged.
 */

// ── Cost ──

export function newCostTrack(): CostTrack {
  return { settled: 0 };
}

/** What the session has cost so far, or undefined while no cost row was seen. */
export function costTotal(track: CostTrack): number | undefined {
  return track.last === undefined ? undefined : track.settled + track.last;
}

/**
 * Fold one record's facts into the cost. The CLI's counter belongs to one process and restarts
 * on resume, so the total is the sum of every process's last value: a value below the previous
 * one starts a new process, an equal one (the row is re-appended all session) changes nothing.
 * Cost rows carry no timestamp, so they take the newest one folded before them. Returns whether
 * the total or its time moved.
 */
export function foldCost(track: CostTrack, facts: SessionMetaFacts | null): boolean {
  if (!facts) return false;
  if (facts.timestampMs !== undefined) track.clock = facts.timestampMs;
  const value = facts.totalCostUsd;
  if (value === undefined) return false;
  const before = { total: costTotal(track), at: track.at };
  if (track.last !== undefined && value < track.last) track.settled += track.last;
  track.first ??= value;
  track.last = value;
  track.at = track.clock;
  return before.total !== costTotal(track) || before.at !== track.at;
}

/**
 * The one cost extractor: the live path, the adoption tail and a history scan all fold records
 * through it, so they cannot disagree about what a cost row means. Call it on every record of
 * the stream in order (it also tracks the timestamps cost rows borrow).
 */
export function costFromRecord(
  track: CostTrack,
  record: unknown,
  provider: HookProvider | null | undefined,
): boolean {
  return foldCost(track, provider?.extractSessionMeta?.(record) ?? null);
}

/**
 * Put the cost of the records before a watch offset (`history`) under the cost of the records
 * after it (`live`, folded from nothing). The first live counter says how they join: below the
 * history's last value it is a new process, so that value is settled; otherwise the process
 * goes on and only the history's earlier processes are added.
 */
export function joinCost(history: CostTrack, live: CostTrack): void {
  if (history.last === undefined) return;
  if (live.last === undefined) {
    live.settled = history.settled;
    live.last = history.last;
    live.first = history.first;
    live.at = history.at;
    return;
  }
  const newProcess = live.first !== undefined && live.first < history.last;
  live.settled += history.settled + (newProcess ? history.last : 0);
  live.first = history.first;
  live.at ??= history.clock;
}

// ── The fold and its view ──

function trackFor(agent: AgentState): SessionMetaTrack {
  if (agent.sessionMetaTrack?.file !== agent.jsonlFile) {
    agent.sessionMetaTrack = { file: agent.jsonlFile, headRead: false, cost: newCostTrack() };
  }
  return agent.sessionMetaTrack;
}

/** Fold one record's facts in. Returns whether the shown view may have changed. */
function foldFacts(track: SessionMetaTrack, facts: SessionMetaFacts, withCost = true): boolean {
  let changed = withCost && foldCost(track.cost, facts);
  if (facts.branch !== undefined) {
    // Last record wins: a checkout mid-file moves the branch.
    const branch = sanitizeWorkflowText(facts.branch, SESSION_BRANCH_MAX_LENGTH);
    if (branch !== undefined && branch !== track.branch) {
      track.branch = branch;
      changed = true;
    }
  }
  // Only a stream that began at the top of the file may take its first record as the start.
  if (!track.headRead && track.startedAt === undefined && facts.timestampMs !== undefined) {
    track.startedAt = facts.timestampMs;
    changed = true;
  }
  return changed;
}

function viewOf(agent: AgentState, track: SessionMetaTrack): MonitorView<AgentSession> {
  const view: MonitorView<AgentSession> = {};
  if (track.startedAt !== undefined) view.startedAt = track.startedAt;
  if (track.branch !== undefined) view.branch = track.branch;
  const sessionId8 = agent.sessionId.slice(0, 8);
  if (sessionId8) view.sessionId8 = sessionId8;
  // Held while the history scan has not joined the rows before the offset: a total from the
  // rows after it alone would be contradicted the moment the scan ends.
  const cost = track.costHold ? undefined : costTotal(track.cost);
  if (cost !== undefined) {
    view.costUsd = cost;
    if (track.cost.at !== undefined) view.costAt = track.cost.at;
  }
  return view;
}

/** Keep the view and tell the office. Callers publish only after something moved, so every
 *  message is a change. A view that went empty is sent as the clear (the id alone). */
function publish(
  agentId: number,
  agent: AgentState,
  agents: AgentStateStore,
  track: SessionMetaTrack,
): void {
  const next = viewOf(agent, track);
  agent.sessionMeta = Object.keys(next).length > 0 ? next : undefined;
  agents.broadcast({ type: 'agentSession', id: agentId, ...next });
}

/** One live record: fold it into the agent's session meta and broadcast on change. */
export function applySessionMeta(
  agentId: number,
  agent: AgentState,
  agents: AgentStateStore,
  record: unknown,
  provider: HookProvider | null | undefined,
): void {
  const facts = provider?.extractSessionMeta?.(record);
  if (!facts) return;
  const track = trackFor(agent);
  if (foldFacts(track, facts)) publish(agentId, agent, agents, track);
}

// ── Reading the file ──

/** Complete lines of `text`; when the window cut the text, the fragment after the last newline
 *  is not a line. */
function completeLines(text: string, cutAtEnd: boolean): string[] {
  const lines = text.split('\n');
  if (cutAtEnd) lines.pop();
  return lines;
}

/**
 * The first timestamp in the head of a transcript. `read` is false when there was nothing to
 * read yet (a missing or empty file), so the live stream is still at the top of it. A
 * timestamp past the head window, or a first line the window cuts, counts as none.
 */
function readHead(file: string, provider: HookProvider): { read: boolean; startedAt?: number } {
  try {
    const size = fs.statSync(file).size;
    if (size === 0) return { read: false };
    const length = Math.min(size, SESSION_META_HEAD_BYTES);
    const buf = Buffer.alloc(length);
    const fd = fs.openSync(file, 'r');
    try {
      fs.readSync(fd, buf, 0, length, 0);
    } finally {
      fs.closeSync(fd);
    }
    for (const line of completeLines(buf.toString('utf8'), size > length)) {
      if (!line) continue;
      let record: unknown;
      try {
        record = JSON.parse(line);
      } catch {
        continue;
      }
      const startedAt = provider.extractSessionMeta?.(record)?.timestampMs;
      if (startedAt !== undefined) return { read: true, startedAt };
    }
    return { read: true };
  } catch {
    // Missing file: nothing yet. Any other failure: unknown, and not the stream's to guess.
    return { read: fs.existsSync(file) };
  }
}

/** The lines in the `bytes` before `end`, a leading fragment dropped; null when unreadable. */
function readWindowLines(file: string, end: number, bytes: number): string[] | null {
  try {
    const stop = Math.min(end, fs.statSync(file).size);
    const start = Math.max(0, stop - bytes);
    const length = stop - start;
    if (length <= 0) return [];
    const buf = Buffer.alloc(length);
    const fd = fs.openSync(file, 'r');
    try {
      fs.readSync(fd, buf, 0, length, start);
    } finally {
      fs.closeSync(fd);
    }
    const text = buf.toString('utf8');
    return (start > 0 ? text.slice(text.indexOf('\n') + 1) : text).split('\n');
  } catch {
    return null;
  }
}

/**
 * Seed the session meta when watching starts, once per transcript. A new `jsonlFile` (an
 * adoption, a restore, `/clear`, resume) starts over: the head gives the start, and an agent
 * that begins mid-file gets its branch and cost from the records before its offset (a file read
 * from the top reaches them through the live replay, and folding them twice would read a repeat
 * as a new process).
 */
export function seedSessionMeta(
  agentId: number,
  agents: AgentStateStore,
  provider?: HookProvider | null,
): void {
  const agent = agents.get(agentId);
  if (!agent || !agent.jsonlFile || !provider?.extractSessionMeta) return;
  if (agent.sessionMetaTrack?.file === agent.jsonlFile) return;

  const track: SessionMetaTrack = { file: agent.jsonlFile, headRead: false, cost: newCostTrack() };
  agent.sessionMetaTrack = track;

  const head = readHead(agent.jsonlFile, provider);
  // A file with nothing in it yet is still read from the top by the live stream, but only if
  // this agent will start there.
  track.headRead = head.read || agent.fileOffset > 0;
  track.startedAt = head.startedAt;

  // The window ends at the offset, so a file read from the top (offset 0) has none: its live
  // replay folds everything, and folding it here too would read a repeat as a new process.
  const lines = readWindowLines(agent.jsonlFile, agent.fileOffset, CONTEXT_SEED_TAIL_BYTES);
  // The cost is not folded from this window: the history scan reads every row before the
  // offset (a process that ended before the window counts too), and folding both would count
  // the window twice.
  const costFromScan = readsHistory(agentId, agent, provider);
  for (const line of lines ?? []) {
    if (!line) continue;
    let record: unknown;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }
    const facts = provider.extractSessionMeta(record);
    if (facts) foldFacts(track, facts, !costFromScan);
  }
  publish(agentId, agent, agents, track);
}

// ── Cost from the history scan ──

/** The cost of the window before `offset`, for a scan that could not read it all. */
function costOfWindow(file: string, offset: number, provider: HookProvider): CostTrack {
  const cost = newCostTrack();
  for (const line of readWindowLines(file, offset, CONTEXT_SEED_TAIL_BYTES) ?? []) {
    if (!line) continue;
    try {
      costFromRecord(cost, JSON.parse(line), provider);
    } catch {
      // A cut or malformed line carries no row.
    }
  }
  return cost;
}

/**
 * Every row before the watch offset goes through `costFromRecord`, in order, in the one pass
 * the history scan makes. The total is shown once that pass is joined to the rows read live,
 * and a scan the budget cut falls back to the window before the offset: the recent processes
 * are in it, and an older one is missing from a floor rather than guessed.
 */
const costHistory: HistoryConsumer = {
  begin(_agentId, { agent }) {
    const track = agent.sessionMetaTrack;
    if (!track || track.file !== agent.jsonlFile || track.costMerged) return;
    track.costHold = newCostTrack();
  },
  record(_agentId, record, { agent, provider, file }) {
    const track = agent.sessionMetaTrack;
    if (track?.costHold && track.file === file) costFromRecord(track.costHold, record, provider);
  },
  done(agentId, complete, { agents, agent, provider, file, offset }) {
    const track = agent.sessionMetaTrack;
    const hold = track?.costHold;
    if (!track || !hold || track.file !== file) return;
    track.costHold = undefined;
    track.costMerged = true;
    joinCost(complete ? hold : costOfWindow(track.file, offset, provider), track.cost);
    if (!agents.has(agentId)) return;
    const next = viewOf(agent, track);
    if (JSON.stringify(next) !== JSON.stringify(agent.sessionMeta ?? {})) {
      publish(agentId, agent, agents, track);
    }
  },
};
registerHistoryConsumer(costHistory);

/** The folder a transcript was written in: the last path segment of the newest `cwd` in its
 *  tail. The hashed project dir cannot say (`my-repo` and `my/repo` hash alike). */
export function folderNameFromTranscript(
  file: string,
  provider: HookProvider | null | undefined,
): string | undefined {
  if (!provider?.extractSessionMeta) return undefined;
  const lines = readTailLines(file, CONTEXT_SEED_TAIL_BYTES);
  if (!lines) return undefined;
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line) continue;
    let record: unknown;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }
    const cwd = provider.extractSessionMeta(record)?.cwd;
    if (cwd === undefined) continue;
    return cwd
      .split(/[\\/]+/)
      .filter(Boolean)
      .pop();
  }
  return undefined;
}
