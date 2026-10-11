// webview-ui/src/office/engine/agentStatus.ts
//
// What an `agentStatus` message does to a character. Pure over a structural
// view of OfficeState so it is unit-testable without React (mirrors
// existingAgents.ts).

import type { AgentActivityStatus } from '../../../../core/src/messages.js';

export interface AgentStatusOffice {
  setAgentActive: (id: number, active: boolean) => void;
  showWaitingBubble: (id: number, awaitingInput?: boolean) => void;
  clearWaitingBubble: (id: number) => void;
}

/**
 * Apply a status to a character. Returns true when it is the "turn finished"
 * announcement (the caller plays the chime): a waiting status for a character that
 * was working. A session adopted or restored already waiting gets its bubble but
 * no chime, or adopting ten idle sessions would chime ten times.
 *
 * Only `active` works; `waiting` announces a finished turn with a bubble; `idle`
 * and any status this build doesn't know are the safe side: not working, no
 * bubble, and a stale waiting bubble is dropped.
 */
export function applyAgentStatus(
  os: AgentStatusOffice,
  id: number,
  status: AgentActivityStatus | string,
  awaitingInput: boolean,
  wasActive: boolean,
): boolean {
  os.setAgentActive(id, status === 'active');
  if (status === 'waiting') {
    os.showWaitingBubble(id, awaitingInput);
    return wasActive;
  }
  if (status !== 'active') os.clearWaitingBubble(id);
  return false;
}
