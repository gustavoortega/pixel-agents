/**
 * The lead-agent messages a resync window (office/engine/resync.ts) changes: agentToolStart's
 * lead half (row, pose, permission bubble), agentStatus's chime and agentTripwire's alarm.
 * DOM-free: the hook passes its state setter and sound players, tests pass plain ones.
 *
 * The handshake after a reconnect restates every live tool, status and alarm. A kept row takes
 * the restated status, and neither sound plays: a reconnect is not a finished turn or a new hit.
 */

import { applyAgentStatus } from '../office/engine/agentStatus.js';
import type { OfficeState } from '../office/engine/officeState.js';
import { type AgentToolRows, resync } from '../office/engine/resync.js';
import {
  extractToolName,
  shouldPlayTripwireSound,
  type TripwireSeverity,
} from '../office/toolUtils.js';

interface AgentMessage {
  type: string;
  [key: string]: unknown;
}

/**
 * agentToolStart's lead half; applyToolStartHelper is the helper half. A new tool appends a
 * row, and a repeated start changes nothing outside a resync window. Live, a start without
 * permissionActive means the prompt was answered. A start the resync restates carries the
 * server's pending prompt either way, so it sets the bubble and the row's permissionWait to
 * match: a prompt raised while the socket was down shows, one answered meanwhile goes.
 */
export function applyAgentToolStart(
  os: OfficeState,
  updateAgentTools: (fn: (prev: AgentToolRows) => AgentToolRows) => void,
  msg: AgentMessage,
): void {
  const id = msg.id as number;
  const toolId = msg.toolId as string;
  const status = msg.status as string;
  const permissionActive = msg.permissionActive === true;
  // Read now, not in the updater: React may run that after the window closed.
  const restating = resync.isActive();
  resync.noteTool(id, toolId);
  updateAgentTools((prev) => {
    const list = prev[id] || [];
    const index = list.findIndex((t) => t.toolId === toolId);
    if (index < 0) {
      return {
        ...prev,
        [id]: [...list, { toolId, status, done: false, permissionWait: permissionActive }],
      };
    }
    const row = list[index];
    const unchanged = row.status === status && (row.permissionWait ?? false) === permissionActive;
    if (!restating || unchanged) return prev;
    const restated = list.slice();
    restated[index] = { ...row, status, permissionWait: permissionActive };
    return { ...prev, [id]: restated };
  });
  os.setAgentTool(id, (msg.toolName as string | undefined) ?? extractToolName(status));
  os.setAgentActive(id, true);
  if (!permissionActive) os.clearPermissionBubble(id);
  else if (restating) os.showPermissionBubble(id);
}

export function applyAgentStatusMessage(
  os: OfficeState,
  msg: AgentMessage,
  chime: () => void,
): void {
  const id = msg.id as number;
  const wasActive = os.characters.get(id)?.isActive === true;
  const finishedTurn = applyAgentStatus(
    os,
    id,
    msg.status as string,
    msg.awaitingInput === true,
    wasActive,
  );
  if (finishedTurn && !resync.isActive()) chime();
}

export function applyAgentTripwireMessage(
  os: OfficeState,
  msg: AgentMessage,
  alarm: () => void,
): void {
  const id = msg.id as number;
  const next = {
    ruleName: msg.ruleName as string,
    severity: msg.severity as TripwireSeverity,
    count: msg.count as number,
  };
  if (shouldPlayTripwireSound(os.tripwires.get(id), next) && !resync.isActive()) alarm();
  os.setTripwire(id, next);
}
