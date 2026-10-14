import type { MonitorSnapshot } from '../hooks/monitorVersion.js';
import type { OfficeState } from '../office/engine/officeState.js';
import type { MonitorLayout } from './monitorLayout.js';

export interface MonitorSheetProps {
  officeState: OfficeState;
  monitor: MonitorSnapshot;
  layout: MonitorLayout;
}

/**
 * The inspector sheet's slot, right of the stage. Empty for now, so it takes no width; the
 * inspector fills it, in the row from 1600 px wide (`layout.sheetMode` inline) and over the
 * stage below that.
 */
export function MonitorSheet({ layout }: MonitorSheetProps) {
  return (
    <div data-testid="monitor-sheet" data-sheet={layout.sheetMode} className="shrink-0 h-full" />
  );
}
