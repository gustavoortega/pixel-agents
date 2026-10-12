/**
 * The agent list's messages: existingAgents (and the resync window it opens after a
 * reconnect, office/engine/resync.ts), handshakeDone, agentTeamInfo and agentClosed.
 * DOM-free: the hook passes its state setters and refs, tests pass plain ones, so the
 * resync's wiring is tested where it lives.
 */

import type { ExistingAgentMeta, PendingAgent } from '../office/engine/existingAgents.js';
import { reconcileExistingAgents } from '../office/engine/existingAgents.js';
import { type AgentToolRows, resync, type ResyncSink } from '../office/engine/resync.js';
import { isBrowserRuntime } from '../runtime.js';
import { reconnectState } from '../transport/reconnect.js';
import type { SubagentSink } from './subagentMessages.js';

/** The hook's agent-list state and refs, beside the helper lists it shares with subagentMessages. */
export interface AgentListSink extends SubagentSink {
  /** Each agent's team as its latest agentTeamInfo said, read by the resync's helper sweep. */
  teams: Record<number, string | undefined>;
  /** Agents an existingAgents buffered until the next layoutLoaded builds their seats. */
  pending: PendingAgent[];
  layoutReady: boolean;
  updateAgents: (fn: (prev: number[]) => number[]) => void;
  updateSelectedAgent: (fn: (prev: number | null) => number | null) => void;
  updateAgentTools: (fn: (prev: AgentToolRows) => AgentToolRows) => void;
  updateAgentStatuses: (fn: (prev: Record<number, string>) => Record<number, string>) => void;
  noteFolderName: (name: string | undefined) => void;
  saveSeats: () => void;
}

interface AgentListMessage {
  type: string;
  [key: string]: unknown;
}

/**
 * A Headless agent is one the office adopted from outside (`claude -p`, a session
 * picked up by Watch All Sessions) and therefore has no terminal to focus. Its
 * character renders translucent so it reads as untouchable at a glance.
 *
 * Standalone is exempt: that adapter has no terminals at all, so every agent
 * would qualify and the cue would distinguish nothing.
 */
export const isHeadlessAgent = (isExternal: boolean | undefined): boolean =>
  isExternal === true && !isBrowserRuntime;

/**
 * existingAgents. Answering a reconnect's webviewReady it is the server's whole truth:
 * whatever this page holds beyond it ended while the socket was down and goes at once, and
 * the resync window opens. Otherwise it only adds.
 */
export function applyExistingAgents(sink: AgentListSink, msg: AgentListMessage): void {
  const { os } = sink;
  const isResync = reconnectState.resyncPending;
  reconnectState.resyncPending = false;
  if (isResync && resync.isActive()) resync.abort();
  const incoming = msg.agents as number[];
  const meta = (msg.agentMeta || {}) as Record<number, ExistingAgentMeta>;
  const folderNames = (msg.folderNames || {}) as Record<number, string>;
  const externalAgents = (msg.externalAgents || {}) as Record<number, boolean>;
  const headlessAgents: Record<number, boolean> = {};
  for (const id of incoming) {
    sink.noteFolderName(folderNames[id]);
    if (isHeadlessAgent(externalAgents[id])) headlessAgents[id] = true;
  }
  // Order-independent restore: add agents now if the layout (and its seats)
  // is already built, otherwise buffer them for the next layoutLoaded.
  // Depending on layoutLoaded always arriving last stranded restored agents
  // on surfaces that send layout first (issue #334).
  const { added, removed } = reconcileExistingAgents(
    os,
    incoming,
    meta,
    folderNames,
    sink.layoutReady,
    sink.pending,
    headlessAgents,
    { removeMissing: isResync },
  );
  for (const id of removed) forgetAgent(sink, id, { immediate: true });
  if (added.length > 0) sink.saveSeats();
  sink.updateAgents((prev) => {
    // A resync's list is the whole truth, ids this page held without a character too.
    if (isResync) return [...incoming].sort((a, b) => a - b);
    const ids = new Set(prev);
    const merged = [...prev];
    for (const id of incoming) {
      if (!ids.has(id)) {
        merged.push(id);
      }
    }
    return merged.sort((a, b) => a - b);
  });
  if (isResync) resync.begin(os, { agents: incoming }, resyncSink(sink));
}

/** handshakeDone: the catch-up is over, and what it did not restate goes. */
export function applyHandshakeDone(sink: AgentListSink): void {
  resync.finish(sink.os, resyncSink(sink));
}

export function applyAgentTeamInfo(sink: AgentListSink, msg: AgentListMessage): void {
  const id = msg.id as number;
  sink.teams[id] = msg.teamName as string | undefined;
  sink.os.setTeamInfo(
    id,
    msg.teamName as string | undefined,
    msg.agentName as string | undefined,
    msg.isTeamLead as boolean | undefined,
    msg.leadAgentId as number | undefined,
    msg.teamUsesTmux as boolean | undefined,
  );
}

/** agentClosed: the agent's helpers, then the agent, despawn on screen. */
export function applyAgentClosed(sink: AgentListSink, msg: AgentListMessage): void {
  forgetAgent(sink, msg.id as number, { immediate: false });
}

/** Forget an agent everywhere the hook holds it. A resync drops one at once, with no effect. */
function forgetAgent(sink: AgentListSink, id: number, opts: { immediate: boolean }): void {
  const withoutAgent = <T>(prev: Record<number, T>): Record<number, T> => {
    if (!(id in prev)) return prev;
    const next = { ...prev };
    delete next[id];
    return next;
  };
  sink.updateAgents((prev) => prev.filter((a) => a !== id));
  sink.updateSelectedAgent((prev) => (prev === id ? null : prev));
  sink.updateAgentTools(withoutAgent);
  sink.updateAgentStatuses(withoutAgent);
  sink.updateTools(withoutAgent);
  delete sink.background[id];
  delete sink.teams[id];
  sink.updateCharacters((prev) => prev.filter((s) => s.parentAgentId !== id));
  if (opts.immediate) {
    sink.os.removeAgentImmediate(id);
  } else {
    sink.os.removeAllSubagents(id);
    sink.os.removeAgent(id);
  }
}

/** The resync window's view of the hook: a helper it sweeps is dropped from the hook's lists
 *  too, or their dedupe would swallow a later spawn that reuses its parent tool id. */
function resyncSink(sink: AgentListSink): ResyncSink {
  return {
    background: () => sink.background,
    teamName: (agentId) => sink.teams[agentId],
    updateAgentTools: sink.updateAgentTools,
    updateSubagentTools: sink.updateTools,
    forgetHelper: (agentId, parentToolId) => {
      sink.background[agentId]?.delete(parentToolId);
      sink.updateCharacters((prev) =>
        prev.filter((s) => !(s.parentAgentId === agentId && s.parentToolId === parentToolId)),
      );
    },
  };
}
