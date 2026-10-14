/**
 * Where the monitor's rail and inspector sheet go for a window size (CSS px). Pure: the shell
 * lays out what it returns.
 *
 * - Rail: 360 px from 1600 wide, 300 px from 1100, else slim (76 px: face, glyph, minutes). A
 *   window under 420 tall (the VS Code panel) is slim at any width.
 * - Sheet: takes layout space from 1600 wide (the stage re-fits beside it), 420 px; narrower it
 *   overlays the stage, 360 px.
 * - Full plates (line 2 at whole-map fit) only beside a rail that is not slim, on a stage at
 *   least 420 tall; otherwise the compact rule applies.
 */

import {
  MONITOR_MIN_FULL_HEIGHT_PX,
  MONITOR_RAIL_MID_MIN_WIDTH_PX,
  MONITOR_RAIL_MID_PX,
  MONITOR_RAIL_SLIM_PX,
  MONITOR_RAIL_WIDE_PX,
  MONITOR_SHEET_INLINE_PX,
  MONITOR_SHEET_OVERLAY_PX,
  MONITOR_WIDE_MIN_WIDTH_PX,
} from '../constants.js';

export type MonitorRailMode = 'wide' | 'mid' | 'slim';
export type MonitorSheetMode = 'inline' | 'overlay';

export interface MonitorLayout {
  rail: MonitorRailMode;
  railPx: number;
  sheetMode: MonitorSheetMode;
  sheetPx: number;
  fullPlates: boolean;
}

export function monitorLayout(windowW: number, windowH: number): MonitorLayout {
  const short = windowH < MONITOR_MIN_FULL_HEIGHT_PX;
  const rail: MonitorRailMode = short
    ? 'slim'
    : windowW >= MONITOR_WIDE_MIN_WIDTH_PX
      ? 'wide'
      : windowW >= MONITOR_RAIL_MID_MIN_WIDTH_PX
        ? 'mid'
        : 'slim';
  const railPx =
    rail === 'wide'
      ? MONITOR_RAIL_WIDE_PX
      : rail === 'mid'
        ? MONITOR_RAIL_MID_PX
        : MONITOR_RAIL_SLIM_PX;
  const wide = windowW >= MONITOR_WIDE_MIN_WIDTH_PX;
  return {
    rail,
    railPx,
    sheetMode: wide ? 'inline' : 'overlay',
    sheetPx: wide ? MONITOR_SHEET_INLINE_PX : MONITOR_SHEET_OVERLAY_PX,
    // The stage spans the window's height in the row layout.
    fullPlates: rail !== 'slim' && windowH >= MONITOR_MIN_FULL_HEIGHT_PX,
  };
}
