import { useEffect, useRef } from 'react';

import { stepSession } from '../components/attention.js';
import { requestRedraw } from '../office/engine/gameLoop.js';
import type { OfficeState } from '../office/engine/officeState.js';

export interface MonitorKeyActions {
  /** Edit mode, the Intro or a modal is open: the window's keys are theirs. */
  blocked: boolean;
  /** The order ←/→ walk, read at the key press. */
  order: () => number[];
  /** Select and follow an agent (no terminal focus: that would take the keys away). */
  select: (id: number) => void;
  togglePrivacy: () => void;
  /** The sheet just opened (Enter): close what it replaces. */
  onSheetOpen: () => void;
}

function typingInto(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

/** Open or close the inspector sheet: a flag the canvas and the sheet read off OfficeState. */
export function setSheetOpen(os: OfficeState, open: boolean): void {
  if (os.monitorSheetOpen === open) return;
  os.monitorSheetOpen = open;
  // The panels re-render on a version change after a drawn frame.
  os.monitorVersion++;
  requestRedraw();
}

/**
 * The monitor's window keys: ←/→ walk the sessions (attention order, then the rest), Enter
 * opens the inspector on the selected agent, Esc closes it, P toggles privacy. Ignored while
 * typing, with a modifier held, and whenever `blocked`.
 */
export function useMonitorKeys(os: OfficeState, actions: MonitorKeyActions): void {
  const latest = useRef(actions);
  latest.current = actions;
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const a = latest.current;
      if (a.blocked || e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
      if (typingInto(e.target)) return;
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        const next = stepSession(a.order(), os.selectedAgentId, e.key === 'ArrowRight' ? 1 : -1);
        if (next === null) return;
        e.preventDefault();
        a.select(next);
      } else if (e.key === 'Enter') {
        if (e.repeat || os.selectedAgentId === null) return;
        // A focused button answers Enter itself.
        if (e.target instanceof HTMLButtonElement) return;
        e.preventDefault();
        setSheetOpen(os, true);
        a.onSheetOpen();
      } else if (e.key === 'Escape') {
        if (!os.monitorSheetOpen) return;
        setSheetOpen(os, false);
      } else if (e.key === 'p' || e.key === 'P') {
        if (e.repeat) return;
        a.togglePrivacy();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [os]);
}
