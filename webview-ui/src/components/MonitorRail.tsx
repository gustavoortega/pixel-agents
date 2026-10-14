import type { MonitorSnapshot } from '../hooks/monitorVersion.js';
import type { OfficeState } from '../office/engine/officeState.js';
import type { MonitorLayout } from './monitorLayout.js';

export interface MonitorRailProps {
  officeState: OfficeState;
  monitor: MonitorSnapshot;
  layout: MonitorLayout;
}

/**
 * The attention rail's slot, left of the stage. Empty for now, so it takes no width and the
 * stage keeps the whole window; the rail fills it and takes `layout.railPx`.
 */
export function MonitorRail({ layout }: MonitorRailProps) {
  return <div data-testid="monitor-rail" data-rail={layout.rail} className="shrink-0 h-full" />;
}
