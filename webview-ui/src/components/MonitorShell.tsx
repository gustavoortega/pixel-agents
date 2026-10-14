import { type ReactNode, useEffect, useState } from 'react';

import { useMonitorVersion } from '../hooks/useMonitorVersion.js';
import type { OfficeState } from '../office/engine/officeState.js';
import { monitorLayout } from './monitorLayout.js';
import { MonitorRail } from './MonitorRail.js';
import { MonitorSheet } from './MonitorSheet.js';

function windowLayout() {
  return monitorLayout(window.innerWidth, window.innerHeight);
}

/**
 * The window's row: [rail][stage][sheet]. The stage (`children`, the office and everything
 * positioned on it) is the flexible middle column, so a rail or sheet that takes width shrinks
 * it and the canvas re-fits through its own ResizeObserver.
 *
 * The one reader of the monitor version: a store write re-renders this row, and the stage passed
 * in as `children` is the same element, so React skips it.
 */
export function MonitorShell({
  officeState,
  children,
}: {
  officeState: OfficeState;
  children: ReactNode;
}) {
  const monitor = useMonitorVersion(officeState);
  const [layout, setLayout] = useState(windowLayout);
  useEffect(() => {
    const onResize = (): void => setLayout(windowLayout());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return (
    <div className="w-full h-full flex overflow-hidden">
      <MonitorRail officeState={officeState} monitor={monitor} layout={layout} />
      {children}
      <MonitorSheet officeState={officeState} monitor={monitor} layout={layout} />
    </div>
  );
}
