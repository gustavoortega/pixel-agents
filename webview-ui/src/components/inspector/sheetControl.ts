/**
 * Opening and closing the inspector sheet from the sheet's own controls: its ×, a plate double
 * click and the e2e hooks. The one switch is the keys' `setSheetOpen` (Enter and Esc), so every
 * path sets the same OfficeState flag the canvas overlay and the sheet read.
 */

import { setSheetOpen } from '../../hooks/useMonitorKeys.js';
import type { OfficeState } from '../../office/engine/officeState.js';

/** Open the sheet on the selected agent. Nothing to inspect, nothing opens (as with Enter). */
export function openSheet(os: OfficeState): void {
  if (os.selectedAgentId === null) return;
  setSheetOpen(os, true);
}

export function closeSheet(os: OfficeState): void {
  setSheetOpen(os, false);
}
