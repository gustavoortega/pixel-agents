import { useRef, useState } from 'react';

import type { OfficeState } from '../office/engine/officeState.js';
import { isE2E } from '../runtime.js';
import { type MonitorSnapshot, nextRenderVersion } from './monitorVersion.js';
import { useFrame } from './useFrame.js';

/**
 * The monitor stores' version and the selected agent, as React state that changes only when
 * OfficeState did: compared after every drawn frame, never polled. A store write wakes the loop
 * (every host message does), so the panel re-renders on the next frame; a quiet frame renders
 * nothing. Call it once, in the component that holds the monitor panels.
 */
export function useMonitorVersion(office: OfficeState): MonitorSnapshot {
  const [snapshot, setSnapshot] = useState<MonitorSnapshot>(() => ({
    version: office.monitorVersion,
    selectedAgentId: office.selectedAgentId,
  }));
  const shown = useRef(snapshot);
  useFrame(() => {
    const next = nextRenderVersion(shown.current, office);
    if (next === shown.current) return;
    shown.current = next;
    if (isE2E) window.__pixelAgentsMonitorRenders = (window.__pixelAgentsMonitorRenders ?? 0) + 1;
    setSnapshot(next);
  });
  return snapshot;
}
