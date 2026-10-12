/**
 * Hook-drawn sub-agent rows, bound to the agent_id that drew them.
 *
 * SubagentStart draws a row under the lead's open Task/Agent tool before any
 * transcript says which sub-agent it is. Binding the row to the hook's
 * agent_id lets only that sub-agent's SubagentStop end it. It also lets a
 * workflow agent's row (a Start that slipped in before its run journal was
 * read) go away without clearing the Task/Agent helper it was drawn under.
 */

import type { AgentStateStore } from './agentStateStore.js';
import type { AgentState } from './types.js';

export interface HookSubRow {
  parentToolId: string;
  subToolId: string;
}

export function bindHookSubRow(lead: AgentState, agentId: string, row: HookSubRow): void {
  const rows = (lead.hookSubRows ??= new Map());
  // Rows whose parent already ended can never be released by a broadcast:
  // drop them here so the map stays as small as the live sub-agents.
  for (const [id, r] of rows) {
    if (!lead.activeSubagentToolIds.has(r.parentToolId)) rows.delete(id);
  }
  rows.set(agentId, row);
}

/**
 * End the row `agentId` drew, if it drew one (no row: no-op, returns false).
 * With `clearParent` and no other bound row under the same parent, the whole
 * sub-character goes, as SubagentStop always did; otherwise only this row is
 * marked done, so another sub-agent's helper is never cleared.
 */
export function releaseHookSubRow(
  store: AgentStateStore,
  lead: AgentState,
  leadId: number,
  agentId: string,
  clearParent: boolean,
): boolean {
  const rows = lead.hookSubRows;
  const row = rows?.get(agentId);
  if (!rows || !row) return false;
  rows.delete(agentId);
  const { parentToolId, subToolId } = row;
  if (!lead.activeSubagentToolIds.has(parentToolId)) return true;
  const shared = [...rows.values()].some((r) => r.parentToolId === parentToolId);
  if (clearParent && !shared) {
    lead.activeSubagentToolIds.delete(parentToolId);
    lead.activeSubagentToolNames.delete(parentToolId);
    store.broadcast({ type: 'subagentClear', id: leadId, parentToolId });
    return true;
  }
  lead.activeSubagentToolIds.get(parentToolId)?.delete(subToolId);
  lead.activeSubagentToolNames.get(parentToolId)?.delete(subToolId);
  store.broadcast({ type: 'subagentToolDone', id: leadId, parentToolId, toolId: subToolId });
  return true;
}
