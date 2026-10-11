/**
 * CRT monitor look: which ON frame an active screen shows, when it dims, and where the
 * scanlines go. Pure, so the renderer, the furniture rebuild and the tests share one answer.
 */

import {
  MONITOR_DIM_ONE_IN,
  MONITOR_FLICKER_TICK_MS,
  MONITOR_ON_FRAME_COUNT,
  MONITOR_SCANLINE_MIN_ZOOM,
  MONITOR_SCREEN_RECT,
} from '../constants.js';

export interface MonitorLook {
  /** Index into the PC's ON frames; always 0 for an idle screen. */
  frame: number;
  /** The screen drops a notch this tick (CRT flicker). */
  dim: boolean;
}

/** Flicker tick for a clock reading in ms. */
export function monitorTick(ms: number): number {
  return Math.floor(ms / MONITOR_FLICKER_TICK_MS);
}

/** Deterministic hash of (tick, seed) so a screen flickers the same way every frame of a tick. */
function hash(tick: number, seed: number): number {
  let h = Math.imul(tick + 1, 374761393) ^ Math.imul(seed + 1, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}

/**
 * An idle screen is a still gray (frame 0, no dim). An active one cycles its ON frames and
 * drops a notch on about 1 tick in MONITOR_DIM_ONE_IN. `seed` (the PC's tile) keeps the
 * screens in an office from dimming in lockstep.
 */
export function monitorLook(active: boolean, tick: number, seed = 0): MonitorLook {
  if (!active) return { frame: 0, dim: false };
  return {
    frame: ((tick % MONITOR_ON_FRAME_COUNT) + MONITOR_ON_FRAME_COUNT) % MONITOR_ON_FRAME_COUNT,
    dim: hash(tick, seed) % MONITOR_DIM_ONE_IN === 0,
  };
}

export interface MonitorOverlayPlan {
  w: number;
  h: number;
  /** Device-px rows (top of a 1 px line) that carry a scanline. */
  scanlineRows: number[];
}

/** Size of the screen overlay in device px at a zoom, and its scanline rows: 1 px every 2 px,
 *  none until the zoom is high enough for them to read as lines. */
export function monitorOverlayPlan(zoom: number): MonitorOverlayPlan {
  const w = MONITOR_SCREEN_RECT.w * zoom;
  const h = MONITOR_SCREEN_RECT.h * zoom;
  const scanlineRows: number[] = [];
  if (zoom >= MONITOR_SCANLINE_MIN_ZOOM) {
    for (let y = 1; y < h; y += 2) scanlineRows.push(y);
  }
  return { w, h, scanlineRows };
}
