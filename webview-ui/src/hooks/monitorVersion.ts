/**
 * What the monitor panels re-render on: the monitor stores' version and the selected agent, read
 * off OfficeState after each drawn frame. Pure, so the "re-render only on a change" rule is
 * table-tested without React.
 */

import type { OfficeState } from '../office/engine/officeState.js';

export interface MonitorSnapshot {
  /** OfficeState.monitorVersion when it was read. */
  readonly version: number;
  /** OfficeState.selectedAgentId: a canvas click selects without a React state change. */
  readonly selectedAgentId: number | null;
}

/** The snapshot to render with: `prev` itself when nothing changed (no re-render), else a new one. */
export function nextRenderVersion(
  prev: MonitorSnapshot,
  office: Pick<OfficeState, 'monitorVersion' | 'selectedAgentId'>,
): MonitorSnapshot {
  if (prev.version === office.monitorVersion && prev.selectedAgentId === office.selectedAgentId) {
    return prev;
  }
  return { version: office.monitorVersion, selectedAgentId: office.selectedAgentId };
}
