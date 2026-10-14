// webview-ui/src/office/engine/resync.ts
//
// The resync window: from the existingAgents that answers a reconnect's webviewReady
// (transport/reconnect.ts) to the server's handshakeDone. The handshake restates what the
// server holds; whatever this page holds that the restatement does not confirm ended while
// the socket was down. DOM-free, so the rules are unit-tested without React.
//
// Never active in VS Code: only the WebSocket transport reconnects.

import type { ToolActivity } from '../types.js';
import { isCrewParentToolId, type OfficeState } from './officeState.js';

/** Tool rows per agent (the hook's agentTools). */
export type AgentToolRows = Record<number, ToolActivity[]>;
/** Sub-tool rows per agent, per parent tool id (the hook's subagentTools). */
type SubagentToolRows = Record<number, Record<string, ToolActivity[]>>;

/**
 * The hook's refs and state setters. Read through getters at finish(), never captured at
 * begin(): the hook's message handler is bound once at mount, so values taken from its
 * closure would be the mount-time ones.
 */
export interface ResyncSink {
  /** Parent tool ids per lead whose helpers outlive the lead's turn. */
  background: () => Record<number, Set<string>>;
  /** A lead's team, as its latest agentTeamInfo said. */
  teamName: (agentId: number) => string | undefined;
  updateAgentTools: (fn: (prev: AgentToolRows) => AgentToolRows) => void;
  updateSubagentTools: (fn: (prev: SubagentToolRows) => SubagentToolRows) => void;
  /** Drop a removed helper from the hook's lists: otherwise the dedupe there would
   *  swallow a later spawn that reuses its parent tool id. */
  forgetHelper: (agentId: number, parentToolId: string) => void;
}

interface Helper {
  parentAgentId: number;
  parentToolId: string;
}

export class ResyncController {
  private active = false;
  /** Agents the server restated: only their tool rows are swept. */
  private kept = new Set<number>();
  /** Every helper the office held when the window opened, drawn or not. */
  private helpers: Helper[] = [];
  /** Parent tool ids the server re-announced since the reconnect. */
  private confirmed = new Set<string>();
  /** `agentId:toolId` of every agentToolStart handled while the window is open. */
  private noted = new Set<string>();
  /** `leadId:runId` of every workflow run the catch-up restated. */
  private runs = new Set<string>();

  isActive(): boolean {
    return this.active;
  }

  /**
   * Open the window, after the existingAgents was reconciled. Sub-tool rows go now: the
   * resend never carries them, and the helpers' next live starts rebuild them.
   */
  begin(os: OfficeState, msg: { agents: number[] }, sink: ResyncSink): void {
    this.active = true;
    this.kept = new Set(msg.agents);
    this.noted = new Set();
    this.runs = new Set();
    this.helpers = [...os.subagentMeta.values()].map(({ parentAgentId, parentToolId }) => ({
      parentAgentId,
      parentToolId,
    }));
    sink.updateSubagentTools(() => ({}));
  }

  noteTool(agentId: number, toolId: string): void {
    if (this.active) this.noted.add(`${agentId}:${toolId}`);
  }

  /** The catch-up restated this run: it is kept at handshakeDone. */
  noteWorkflowRun(leadId: number, runId: string): void {
    if (this.active) this.runs.add(`${leadId}:${runId}`);
  }

  /** The server says this helper is live. Counts from the reconnect on, so a presence
   *  broadcast before the handshake's existingAgents counts too. */
  confirmHelper(parentToolId: string): void {
    this.confirmed.add(parentToolId);
  }

  /**
   * Close the window on handshakeDone, removing with no effect what the catch-up did not
   * restate: unconfirmed helpers only a resend can vouch for (workflow helpers, a teamless
   * lead's background spawns; a teammate or a teamed lead's spawn ends through its lead),
   * restated agents' tool rows and workflow runs (the handshake restates every run the
   * server still tracks). No-op when the window is not open.
   */
  finish(os: OfficeState, sink: ResyncSink): void {
    if (!this.active) return;
    const { helpers, confirmed, kept, noted, runs } = this;
    this.abort();
    for (const [leadId, leadRuns] of [...os.workflowRuns]) {
      for (const runId of [...leadRuns.keys()]) {
        if (!runs.has(`${leadId}:${runId}`)) os.setWorkflowRun(leadId, runId, undefined);
      }
    }
    const background = sink.background();
    for (const { parentAgentId, parentToolId } of helpers) {
      if (confirmed.has(parentToolId)) continue;
      const sweepable =
        isCrewParentToolId(parentToolId) ||
        (background[parentAgentId]?.has(parentToolId) === true && !sink.teamName(parentAgentId));
      if (!sweepable) continue;
      os.removeSubagentImmediate(parentAgentId, parentToolId);
      sink.forgetHelper(parentAgentId, parentToolId);
    }
    // Decided inside the updater: React may run it later, on the rows as they are then.
    sink.updateAgentTools((prev) => dropUnrestatedRows(prev, kept, noted));
  }

  /** Close the window without sweeping: the socket dropped mid-handshake, or another
   *  resync starts. Confirmations go too, since they came from the abandoned socket. */
  abort(): void {
    this.active = false;
    this.kept = new Set();
    this.helpers = [];
    this.confirmed = new Set();
    this.noted = new Set();
    this.runs = new Set();
  }
}

/** Restated agents keep only the rows the window noted: the others ended while the
 *  socket was down. Every agentToolStart in the window is noted, so rows that started
 *  after the window opened stay. */
function dropUnrestatedRows(
  prev: AgentToolRows,
  kept: ReadonlySet<number>,
  noted: ReadonlySet<string>,
): AgentToolRows {
  let next = prev;
  for (const [key, rows] of Object.entries(prev)) {
    const agentId = Number(key);
    if (!kept.has(agentId)) continue;
    const restated = rows.filter((t) => noted.has(`${agentId}:${t.toolId}`));
    if (restated.length === rows.length) continue;
    if (next === prev) next = { ...prev };
    if (restated.length === 0) delete next[agentId];
    else next[agentId] = restated;
  }
  return next;
}

/** The one window per page. */
export const resync = new ResyncController();
