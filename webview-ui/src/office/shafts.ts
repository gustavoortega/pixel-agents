/**
 * Window light shafts: the color of the sun by hour, and which floor cells a window's shaft
 * lands on. Pure, so the renderer and the tests ask the same functions.
 */

import {
  LIGHT_DAY_START_MIN,
  LIGHT_FIXTURE_WINDOW,
  LIGHT_NIGHT_START_MIN,
  SHAFT_EVENING,
  SHAFT_LENGTH_TILES,
  SHAFT_MORNING,
  SHAFT_SKEW_TILES,
  SHAFT_WIDTH_TILES,
  WINDOW_FOOTPRINT_H_TILES,
  WINDOW_FOOTPRINT_W_TILES,
} from '../constants.js';
import { getFurnitureTiles } from './layout/layoutSerializer.js';
import type { OfficeLayout } from './types.js';
import { TileType } from './types.js';

export interface ShaftColor {
  r: number;
  g: number;
  b: number;
  alpha: number;
}

/** Sun color for a local time, or null while the shaft is off (20:00-06:59). The morning color
 *  holds until 09:00, then it slides to the evening color at 18:00 and holds. */
function shaftFor(hour: number, minute: number): ShaftColor | null {
  const t = hour * 60 + minute;
  if (t >= LIGHT_NIGHT_START_MIN || t < LIGHT_DAY_START_MIN) return null;
  const { minute: t0, ...a } = SHAFT_MORNING;
  const { minute: t1, ...b } = SHAFT_EVENING;
  const k = Math.min(1, Math.max(0, (t - t0) / (t1 - t0)));
  const mix = (x: number, y: number) => x + (y - x) * k;
  return {
    r: Math.round(mix(a.r, b.r)),
    g: Math.round(mix(a.g, b.g)),
    b: Math.round(mix(a.b, b.b)),
    alpha: mix(a.alpha, b.alpha),
  };
}

export interface Shaft {
  /** Floor cells the light lands on: the only place the renderer may paint. */
  cells: Array<{ col: number; row: number }>;
  /** The skewed parallelogram, in tile coordinates (top-left, top-right, bottom-right, bottom-left). */
  polygon: Array<[number, number]>;
  color: ShaftColor;
}

const isFloor = (t: number): boolean => t !== TileType.WALL && t !== TileType.VOID;

/**
 * One shaft per window. It falls on the cells under the window that are floor, belong to the
 * window's own room (same area label as the first floor cell below it; a window outside every
 * area owns the unassigned cells) and hold no furniture. Nothing is returned at night.
 */
export function shaftRects(layout: OfficeLayout, hour: number, minute = 0): Shaft[] {
  const color = shaftFor(hour, minute);
  if (!color) return [];
  const { cols, rows, tiles } = layout;
  const labelAt = (c: number, r: number): string | null => layout.areaTiles?.[r * cols + c] ?? null;
  const inMap = (c: number, r: number): boolean => c >= 0 && r >= 0 && c < cols && r < rows;
  const floorAt = (c: number, r: number): boolean => inMap(c, r) && isFloor(tiles[r * cols + c]);
  const furniture = getFurnitureTiles(layout.furniture);

  const out: Shaft[] = [];
  for (const win of layout.furniture) {
    if (win.type !== LIGHT_FIXTURE_WINDOW) continue;
    const top = win.row + WINDOW_FOOTPRINT_H_TILES;
    let anchor: number | null = null;
    for (let dc = 0; dc < WINDOW_FOOTPRINT_W_TILES; dc++) {
      if (floorAt(win.col + dc, top)) {
        anchor = win.col + dc;
        break;
      }
    }
    if (anchor === null) continue;
    const room = labelAt(anchor, top);

    const left = win.col;
    const polygon: Array<[number, number]> = [
      [left, top],
      [left + SHAFT_WIDTH_TILES, top],
      [left + SHAFT_WIDTH_TILES + SHAFT_SKEW_TILES, top + SHAFT_LENGTH_TILES],
      [left + SHAFT_SKEW_TILES, top + SHAFT_LENGTH_TILES],
    ];
    const cells: Shaft['cells'] = [];
    for (let r = top; r < top + SHAFT_LENGTH_TILES; r++) {
      // Slide of the parallelogram at the middle of this row.
      const slide = (SHAFT_SKEW_TILES * (r + 0.5 - top)) / SHAFT_LENGTH_TILES;
      for (let c = left; c <= left + SHAFT_WIDTH_TILES; c++) {
        const mid = c + 0.5;
        if (mid < left + slide || mid > left + SHAFT_WIDTH_TILES + slide) continue;
        if (!floorAt(c, r) || labelAt(c, r) !== room) continue;
        if (furniture.has(`${c},${r}`)) continue;
        cells.push({ col: c, row: r });
      }
    }
    if (cells.length > 0) out.push({ cells, polygon, color });
  }
  return out;
}
