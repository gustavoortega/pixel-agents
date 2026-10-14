import { type ReactNode, useEffect, useState } from 'react';

import type { UsageLimits } from '../../../core/src/messages.js';
import { useMonitorVersion } from '../hooks/useMonitorVersion.js';
import { requestRedraw } from '../office/engine/gameLoop.js';
import type { OfficeState } from '../office/engine/officeState.js';
import { setMonitorFullPlates } from '../office/nameplate.js';
import type { ToolActivity } from '../office/types.js';
import { attentionOf } from './attentionSource.js';
import { monitorLayout } from './monitorLayout.js';
import { MonitorRail } from './MonitorRail.js';
import { MonitorSheet } from './MonitorSheet.js';

function windowLayout() {
  return monitorLayout(window.innerWidth, window.innerHeight);
}

export interface MonitorShellProps {
  officeState: OfficeState;
  /** The hook's React mirrors the rail reads beside OfficeState. */
  agentTools: Record<number, ToolActivity[]>;
  agentStatuses: Record<number, string>;
  limits: UsageLimits | null;
  statuslineInstalled: boolean;
  privacy: boolean;
  onTogglePrivacy: () => void;
  onSelect: (id: number) => void;
  children: ReactNode;
}

/**
 * The window's row: [rail][stage][sheet]. The stage (`children`, the office and everything
 * positioned on it) is the flexible middle column, so a rail or sheet that takes width shrinks
 * it and the canvas re-fits through its own ResizeObserver.
 *
 * The one reader of the monitor version: a store write re-renders this row, and the stage passed
 * in as `children` is the same element, so React skips it. Privacy mode is a class here, so every
 * `.pv` text below it (rail, plates, sheet) masks at once.
 */
export function MonitorShell({
  officeState,
  agentTools,
  agentStatuses,
  limits,
  statuslineInstalled,
  privacy,
  onTogglePrivacy,
  onSelect,
  children,
}: MonitorShellProps) {
  const monitor = useMonitorVersion(officeState);
  const [layout, setLayout] = useState(windowLayout);
  useEffect(() => {
    const onResize = (): void => setLayout(windowLayout());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  // Beside a full rail the plates keep their second line at every zoom (the canvas overlay
  // reads the flag on its next frame).
  useEffect(() => {
    setMonitorFullPlates(layout.fullPlates);
    requestRedraw();
  }, [layout.fullPlates]);
  const attention = attentionOf(officeState, agentTools, agentStatuses);
  return (
    <div
      className={`w-full h-full flex overflow-hidden${privacy ? ' mon-privacy' : ''}`}
      data-privacy={privacy ? 'on' : 'off'}
    >
      <MonitorRail
        officeState={officeState}
        monitor={monitor}
        layout={layout}
        attention={attention}
        limits={limits}
        statuslineInstalled={statuslineInstalled}
        privacy={privacy}
        onTogglePrivacy={onTogglePrivacy}
        onSelect={onSelect}
      />
      {children}
      <MonitorSheet officeState={officeState} monitor={monitor} layout={layout} />
    </div>
  );
}
