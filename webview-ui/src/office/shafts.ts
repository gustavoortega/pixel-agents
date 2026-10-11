/**
 * Window light shafts: the color of the sun by hour, and which floor cells a window's shaft
 * lands on. Pure, so the renderer and the tests ask the same functions.
 */

import {
  LIGHT_DAY_START_MIN,
  LIGHT_FIXTURE_WINDOW,
  SHAFT_COVERAGE_SAMPLES,
  SHAFT_EDGE_ALPHA,
  SHAFT_EVENING,
  SHAFT_LENGTH_TILES,
  SHAFT_MORNING,
  SHAFT_OFF_START_MIN,
  SHAFT_SKEW_DEG,
  SHAFT_WIDTH_TILES,
  WINDOW_FOOTPRINT_H_TILES,
  WINDOW_FOOTPRINT_W_TILES,
} from '../constants.js';
import { getCatalogEntry, getOnStateType, getToggledType } from './layout/furnitureCatalog.js';
import { getFurnitureTiles } from './layout/layoutSerializer.js';
import { isNightPhase } from './lighting.js';
import type { FurnitureInstance, OfficeLayout } from './types.js';
import { TileType } from './types.js';

export interface ShaftColor {
  r: number;
  g: number;
  b: number;
  alpha: number;
}

/** The windows cast no light: SHAFT_OFF_START_MIN to 06:59. */
export function shaftsOff(hour: number, minute: number): boolean {
  const t = hour * 60 + minute;
  return t >= SHAFT_OFF_START_MIN || t < LIGHT_DAY_START_MIN;
}

/** Sun color for a local time, or null while the shaft is off (19:00-06:59). The morning color
 *  holds until 09:00, then it slides to the evening color at 18:00 and holds. */
function shaftFor(hour: number, minute: number): ShaftColor | null {
  if (shaftsOff(hour, minute)) return null;
  const t = hour * 60 + minute;
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

/** How far the far end of a shaft slides sideways, in tiles. */
const SKEW_TILES = SHAFT_LENGTH_TILES * Math.tan((SHAFT_SKEW_DEG * Math.PI) / 180);

export interface Shaft {
  /** Floor cells the light lands on: the only place the renderer may paint. */
  cells: Array<{ col: number; row: number }>;
  /** The skewed parallelogram, in tile coordinates (top-left, top-right, bottom-right, bottom-left). */
  polygon: Array<[number, number]>;
  color: ShaftColor;
  /** Alpha of the left rim: SHAFT_EDGE_ALPHA at the morning peak, fading with the shaft. */
  edgeAlpha: number;
}

const isFloor = (t: number): boolean => t !== TileType.WALL && t !== TileType.VOID;

/** A window in either frame: the day id, or its night twin (the editor's T key can save that one). */
function isWindow(type: string): boolean {
  return type === LIGHT_FIXTURE_WINDOW || getToggledType(type) === LIGHT_FIXTURE_WINDOW;
}

/**
 * One shaft per window, centered under it. It falls on the cells under the window that are
 * floor, belong to the window's own room (same area label as the first floor cell below it; a
 * window outside every area owns the unassigned cells) and hold no furniture. A cell is lit when
 * the middle of its row puts its center inside the parallelogram. Nothing is returned at night.
 */
export function shaftRects(layout: OfficeLayout, hour: number, minute = 0): Shaft[] {
  const color = shaftFor(hour, minute);
  if (!color) return [];
  const { cols, rows, tiles } = layout;
  const labelAt = (c: number, r: number): string | null => layout.areaTiles?.[r * cols + c] ?? null;
  const inMap = (c: number, r: number): boolean => c >= 0 && r >= 0 && c < cols && r < rows;
  const floorAt = (c: number, r: number): boolean => inMap(c, r) && isFloor(tiles[r * cols + c]);
  const furniture = getFurnitureTiles(layout.furniture);
  const edgeAlpha = (SHAFT_EDGE_ALPHA * color.alpha) / SHAFT_MORNING.alpha;

  const out: Shaft[] = [];
  for (const win of layout.furniture) {
    if (!isWindow(win.type)) continue;
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

    const left = win.col + (WINDOW_FOOTPRINT_W_TILES - SHAFT_WIDTH_TILES) / 2;
    const polygon: Array<[number, number]> = [
      [left, top],
      [left + SHAFT_WIDTH_TILES, top],
      [left + SHAFT_WIDTH_TILES + SKEW_TILES, top + SHAFT_LENGTH_TILES],
      [left + SKEW_TILES, top + SHAFT_LENGTH_TILES],
    ];
    const cells: Shaft['cells'] = [];
    const firstCol = Math.floor(left);
    const lastCol = Math.ceil(left + SHAFT_WIDTH_TILES + SKEW_TILES);
    for (let r = top; r < top + SHAFT_LENGTH_TILES; r++) {
      // Slide of the parallelogram at the middle of this row.
      const slide = (SKEW_TILES * (r + 0.5 - top)) / SHAFT_LENGTH_TILES;
      for (let c = firstCol; c <= lastCol; c++) {
        const mid = c + 0.5;
        if (mid < left + slide || mid > left + SHAFT_WIDTH_TILES + slide) continue;
        if (!floorAt(c, r) || labelAt(c, r) !== room) continue;
        if (furniture.has(`${c},${r}`)) continue;
        cells.push({ col: c, row: r });
      }
    }
    if (cells.length > 0) out.push({ cells, polygon, color, edgeAlpha });
  }
  return out;
}

/** Share of a cell the parallelogram covers, by sampling a grid of points inside the cell. */
function coverage(polygon: Shaft['polygon'], col: number, row: number): number {
  const [[left, top], [right], , [, bottom]] = polygon;
  const width = right - left;
  const n = SHAFT_COVERAGE_SAMPLES;
  let inside = 0;
  for (let i = 0; i < n; i++) {
    const y = row + (i + 0.5) / n;
    if (y < top || y > bottom) continue;
    const x0 = left + (SKEW_TILES * (y - top)) / (bottom - top);
    for (let j = 0; j < n; j++) {
      const x = col + (j + 0.5) / n;
      if (x >= x0 && x <= x0 + width) inside++;
    }
  }
  return inside / (n * n);
}

/**
 * The sunniest lit cell that `include` accepts: each shaft adds its alpha times the share of the
 * cell it covers, so where two shafts cross beats a cell one shaft only grazes. Ties go to the
 * top row, then the left column. Null at night or when no lit cell is accepted.
 */
export function brightestShaftCell(
  shafts: readonly Shaft[],
  include: (col: number, row: number) => boolean,
): { col: number; row: number } | null {
  const light = new Map<string, { col: number; row: number; v: number }>();
  for (const shaft of shafts) {
    for (const { col, row } of shaft.cells) {
      if (!include(col, row)) continue;
      const key = `${col},${row}`;
      const v = shaft.color.alpha * coverage(shaft.polygon, col, row);
      const hit = light.get(key);
      if (hit) hit.v += v;
      else light.set(key, { col, row, v });
    }
  }
  let best: { col: number; row: number; v: number } | null = null;
  for (const cell of light.values()) {
    if (
      !best ||
      cell.v > best.v ||
      (cell.v === best.v && (cell.row < best.row || (cell.row === best.row && cell.col < best.col)))
    ) {
      best = cell;
    }
  }
  return best ? { col: best.col, row: best.row } : null;
}

/** Shafts only change with the layout or the minute, so they are rebuilt then, not every frame. */
let shaftMemo: { layout: OfficeLayout; minute: number; shafts: Shaft[] } | null = null;
export function shaftsAt(layout: OfficeLayout, now: Date): Shaft[] {
  const minute = now.getHours() * 60 + now.getMinutes();
  if (!shaftMemo || shaftMemo.layout !== layout || shaftMemo.minute !== minute) {
    shaftMemo = { layout, minute, shafts: shaftRects(layout, now.getHours(), now.getMinutes()) };
  }
  return shaftMemo.shafts;
}

const hourMemo = {
  day: new WeakMap<object, FurnitureInstance[]>(),
  night: new WeakMap<object, FurnitureInstance[]>(),
};

/**
 * The furniture as drawn at this hour: in the night phase (the tint's, see isNightPhase) every
 * window shows its night frame (the "on" member of its state group), and by day its day frame, whichever one the
 * layout saved. Memoized per input array and frame, so an unchanged frame costs a lookup.
 */
export function furnitureForHour(
  furniture: FurnitureInstance[],
  hour: number,
  minute: number,
): FurnitureInstance[] {
  const night = isNightPhase(hour, minute);
  const memo = night ? hourMemo.night : hourMemo.day;
  let out = memo.get(furniture);
  if (!out) {
    const frame = night ? getOnStateType(LIGHT_FIXTURE_WINDOW) : LIGHT_FIXTURE_WINDOW;
    const entry = getCatalogEntry(frame);
    out = furniture.map((f) =>
      entry && f.type && f.type !== frame && isWindow(f.type)
        ? { ...f, type: entry.type, sprite: entry.sprite }
        : f,
    );
    memo.set(furniture, out);
  }
  return out;
}
