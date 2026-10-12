/**
 * Sub-agent messages (subagentToolStart / Done / Clear / Permission) applied to
 * the office and to the helper lists the overlay reads. DOM-free: the React
 * hook supplies its state setters, tests supply plain ones.
 *
 * Only subagentToolStart and subagentPresent may create a helper. Done,
 * permission and clear for a key with no helper do nothing: a batched done that
 * lands after the helper's clear must not bring it back.
 */

import { isCrewParentToolId, type OfficeState } from '../office/engine/officeState.js';
import { extractToolName } from '../office/toolUtils.js';
import type { ToolActivity } from '../office/types.js';

export interface SubagentCharacter {
  id: number;
  parentAgentId: number;
  parentToolId: string;
  /** Task/Agent description from the parent's "Subtask:" status. */
  label: string;
  /** Workflow agent label and phase from SubagentToolStart, for the plate and the full box. */
  plateLabel?: string;
  group?: string;
}

/** Sub-tool rows per agent, per parent tool id. */
export type SubagentTools = Record<number, Record<string, ToolActivity[]>>;

export interface SubagentSink {
  os: OfficeState;
  /** Parent tool ids per agent whose helpers outlive the parent's turn end. */
  background: Record<number, Set<string>>;
  updateTools: (fn: (prev: SubagentTools) => SubagentTools) => void;
  updateCharacters: (fn: (prev: SubagentCharacter[]) => SubagentCharacter[]) => void;
}

interface SubagentMessage {
  type: string;
  [key: string]: unknown;
}

/** Apply one sub-agent message; false (nothing done) for any other type. */
export function applySubagentMessage(sink: SubagentSink, msg: SubagentMessage): boolean {
  switch (msg.type) {
    case 'subagentToolStart':
      onToolStart(sink, msg);
      return true;
    case 'subagentPresent':
      onPresent(sink, msg);
      return true;
    case 'subagentToolDone':
      onToolDone(sink, msg);
      return true;
    case 'subagentClear':
      onClear(sink, msg);
      return true;
    case 'subagentToolPermission': {
      const subId = sink.os.getSubagentId(msg.id as number, msg.parentToolId as string);
      if (subId !== null) sink.os.showPermissionBubble(subId);
      return true;
    }
    default:
      return false;
  }
}

function onToolStart(sink: SubagentSink, msg: SubagentMessage): void {
  const { os } = sink;
  const id = msg.id as number;
  const parentToolId = msg.parentToolId as string;
  const toolId = msg.toolId as string;
  const status = msg.status as string;
  sink.updateTools((prev) => {
    const agentSubs = prev[id] || {};
    const list = agentSubs[parentToolId] || [];
    if (list.some((t) => t.toolId === toolId)) return prev;
    return {
      ...prev,
      [id]: { ...agentSubs, [parentToolId]: [...list, { toolId, status, done: false }] },
    };
  });
  // The helper is usually created by an earlier agentToolStart for the same (real) parent tool.
  // When it is missing (a teamed lead's background spawn, a workflow agent, a reloaded panel)
  // create it here; addSubagent is idempotent.
  let subId = os.getSubagentId(id, parentToolId);
  if (subId === null) {
    subId = createHelper(sink, msg);
  } else if (isCrewParentToolId(parentToolId)) {
    // A workflow agent has no parent tool on its lead: it is background whatever the lead's tools say.
    (sink.background[id] ??= new Set()).add(parentToolId);
  }
  os.setAgentTool(subId, extractToolName(status));
  os.setAgentActive(subId, true);
}

/** A workflow agent is live: its helper shows now, working, before any tool row. An existing
 *  helper keeps its state. With no rows it never idles: it works until its clear. */
function onPresent(sink: SubagentSink, msg: SubagentMessage): void {
  if (sink.os.getSubagentId(msg.id as number, msg.parentToolId as string) !== null) return;
  sink.os.setAgentActive(createHelper(sink, msg), true);
}

/** Create the helper a start or presence message names, with its workflow label and group. */
function createHelper(sink: SubagentSink, msg: SubagentMessage): number {
  const id = msg.id as number;
  const parentToolId = msg.parentToolId as string;
  const subId = sink.os.addSubagent(id, parentToolId);
  const entry: SubagentCharacter = {
    id: subId,
    parentAgentId: id,
    parentToolId,
    label: '',
    ...(typeof msg.label === 'string' && msg.label ? { plateLabel: msg.label } : {}),
    ...(typeof msg.group === 'string' && msg.group ? { group: msg.group } : {}),
  };
  sink.updateCharacters((prev) => (prev.some((s) => s.id === entry.id) ? prev : [...prev, entry]));
  // Only watched background spawns and workflow agents are created here: mark the parent tool as
  // background so agentToolsClear preserves the helper.
  (sink.background[id] ??= new Set()).add(parentToolId);
  return subId;
}

function onToolDone(sink: SubagentSink, msg: SubagentMessage): void {
  const id = msg.id as number;
  const parentToolId = msg.parentToolId as string;
  const toolId = msg.toolId as string;
  sink.updateTools((prev) => {
    const agentSubs = prev[id];
    if (!agentSubs) return prev;
    const list = agentSubs[parentToolId];
    if (!list) return prev;
    return {
      ...prev,
      [id]: {
        ...agentSubs,
        [parentToolId]: list.map((t) => (t.toolId === toolId ? { ...t, done: true } : t)),
      },
    };
  });
}

function onClear(sink: SubagentSink, msg: SubagentMessage): void {
  const id = msg.id as number;
  const parentToolId = msg.parentToolId as string;
  sink.background[id]?.delete(parentToolId);
  sink.updateTools((prev) => {
    const agentSubs = prev[id];
    if (!agentSubs || !(parentToolId in agentSubs)) return prev;
    const next = { ...agentSubs };
    delete next[parentToolId];
    if (Object.keys(next).length === 0) {
      const outer = { ...prev };
      delete outer[id];
      return outer;
    }
    return { ...prev, [id]: next };
  });
  sink.os.removeSubagent(id, parentToolId);
  sink.updateCharacters((prev) =>
    prev.filter((s) => !(s.parentAgentId === id && s.parentToolId === parentToolId)),
  );
}
