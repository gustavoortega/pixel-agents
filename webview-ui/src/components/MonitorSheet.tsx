import './inspector/inspector.css';

import { useEffect, useRef } from 'react';

import {
  INSPECTOR_FACE_PX,
  INSPECTOR_OVERLAY_Z_INDEX,
  MONITOR_CLOCK_TICK_MS,
} from '../constants.js';
import type { MonitorSnapshot } from '../hooks/monitorVersion.js';
import { useNow } from '../hooks/useNow.js';
import { officeNow } from '../office/clock.js';
import type { OfficeState } from '../office/engine/officeState.js';
import { InspectorSheet } from './inspector/InspectorSheet.js';
import { inspectorView } from './inspector/inspectorView.js';
import { closeSheet } from './inspector/sheetControl.js';
import { inspectedAgentId, sheetInput, type SheetToolState } from './inspector/sheetInput.js';
import type { MonitorLayout } from './monitorLayout.js';
import { Face } from './railArt.js';

/** What the sheet needs from the App beyond OfficeState: the tool rows and two actions. */
export interface InspectorWiring extends SheetToolState {
  /** The App's tripwire acknowledgement (the full box's action). */
  onAckTripwire: (id: number, count: number) => void;
  /** Called when the sheet opens: the App closes the Usage panel, which shares its corner. */
  onOpen: () => void;
}

export interface MonitorSheetProps {
  officeState: OfficeState;
  /** The shell's snapshot: a new one re-renders the sheet (it reads OfficeState itself). */
  monitor: MonitorSnapshot;
  layout: MonitorLayout;
  inspector: InspectorWiring;
}

function OpenSheet({
  officeState,
  id,
  inspector,
}: {
  officeState: OfficeState;
  id: number;
  inspector: InspectorWiring;
}) {
  // Only a tick for the minutes: every time shown reads the office clock.
  useNow(MONITOR_CLOCK_TICK_MS);
  const input = sheetInput(officeState, id, inspector, officeNow().getTime());
  if (!input) return null;
  const ch = officeState.characters.get(id);
  return (
    <InspectorSheet
      view={inspectorView(input)}
      portrait={
        // The face reads the device pixel ratio: a server render (the tests) has none.
        ch && typeof window !== 'undefined' ? (
          <Face palette={ch.palette} hueShift={ch.hueShift} boxCss={INSPECTOR_FACE_PX} />
        ) : null
      }
      onClose={() => closeSheet(officeState)}
      onAckTripwire={inspector.onAckTripwire}
    />
  );
}

/**
 * The inspector sheet, right of the stage. It shows the selected agent (a selected sub-agent shows
 * its lead) while `officeState.monitorSheetOpen` is set: in the row from 1600 px wide, where the
 * stage re-fits beside it, and over the stage below that. Closed, it takes no width. A deselection
 * closes it, so the next selection does not reopen it unasked.
 */
export function MonitorSheet({ officeState, layout, inspector }: MonitorSheetProps) {
  // The live selection, not the snapshot's: a render the App starts (Enter closing Usage) can
  // come before the frame that updates the snapshot, and a stale "nothing selected" would close
  // the sheet the same key just opened. The snapshot only schedules the re-render.
  const id = inspectedAgentId(officeState, officeState.selectedAgentId);
  const open = officeState.monitorSheetOpen && id !== null;

  useEffect(() => {
    if (officeState.monitorSheetOpen && id === null) closeSheet(officeState);
  });

  const onOpen = inspector.onOpen;
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open && !wasOpen.current) onOpen();
    wasOpen.current = open;
  }, [open, onOpen]);

  if (!open || id === null) {
    return (
      <div
        data-testid="monitor-sheet"
        data-sheet={layout.sheetMode}
        data-open="false"
        className="shrink-0 h-full"
      />
    );
  }
  const overlay = layout.sheetMode === 'overlay';
  return (
    <aside
      data-testid="monitor-sheet"
      data-sheet={layout.sheetMode}
      data-open="true"
      className={`insp insp-${layout.sheetMode} shrink-0 h-full`}
      style={{
        width: layout.sheetPx,
        ...(overlay ? { zIndex: INSPECTOR_OVERLAY_Z_INDEX } : {}),
      }}
      aria-label="Inspector"
    >
      <div className="insp-board">
        <span className="insp-clip" aria-hidden="true" />
        {/* Keyed by agent: another agent's sheet starts at its top, not at the last scroll. */}
        <OpenSheet key={id} officeState={officeState} id={id} inspector={inspector} />
      </div>
    </aside>
  );
}
