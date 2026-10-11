/**
 * Cozy light: window shafts (color by hour, where they land) and the CRT monitor look.
 */
import { describe, expect, it } from 'vitest';

import { SHAFT_EVENING, SHAFT_MORNING } from '../src/constants.js';
import { buildDynamicCatalog } from '../src/office/layout/furnitureCatalog.js';
import { monitorLook, monitorOverlayPlan } from '../src/office/monitor.js';
import { shaftRects } from '../src/office/shafts.js';
import type { OfficeLayout } from '../src/office/types.js';
import { TILE_SIZE, TileType } from '../src/office/types.js';

describe('shaftRects', () => {
  const sprite = (w: number, h: number) => Array.from({ length: h }, () => new Array(w).fill(''));
  const entry = (id: string, category: string, w: number, h: number, extra = {}) => ({
    id,
    label: id,
    category,
    width: w * TILE_SIZE,
    height: h * TILE_SIZE,
    footprintW: w,
    footprintH: h,
    isDesk: false,
    orientation: 'front',
    ...extra,
  });

  // Window on the wall rows 0-1 at cols 2-3; the floor starts at row 2. The shaft would cover
  // cols 2-3 of rows 2-4, but (2,4) is a pillar, (3,3) holds a plant and (3,4) is another room.
  function office(): OfficeLayout {
    buildDynamicCatalog({
      catalog: [entry('WINDOW', 'wall', 2, 2), entry('PLANT', 'decor', 1, 1)],
      sprites: { WINDOW: sprite(32, 32), PLANT: sprite(16, 16) },
    });
    const cols = 8;
    const rows = 8;
    const tiles = new Array(cols * rows).fill(TileType.FLOOR_1);
    for (let c = 0; c < cols; c++) tiles[c] = tiles[cols + c] = TileType.WALL;
    tiles[4 * cols + 2] = TileType.WALL;
    const areaTiles = new Array<string | null>(cols * rows).fill('A');
    for (let c = 0; c < cols; c++) areaTiles[c] = areaTiles[cols + c] = null;
    areaTiles[4 * cols + 3] = 'B';
    return {
      version: 1,
      cols,
      rows,
      tiles,
      areaTiles,
      furniture: [
        { uid: 'w', type: 'WINDOW', col: 2, row: 0 },
        { uid: 'p', type: 'PLANT', col: 3, row: 3 },
      ],
    } as OfficeLayout;
  }

  it('lands only on floor cells of the window room that hold no furniture', () => {
    const layout = office();
    const [shaft, ...rest] = shaftRects(layout, 12);
    expect(rest).toHaveLength(0);
    const cells = shaft.cells.map((c) => `${c.col},${c.row}`).sort();
    expect(cells).toEqual(['2,2', '2,3', '3,2']);
    for (const { col, row } of shaft.cells) {
      const i = row * layout.cols + col;
      expect(layout.tiles[i], `${col},${row} is floor`).not.toBe(TileType.WALL);
      expect(layout.areaTiles![i], `${col},${row} is in the window's room`).toBe('A');
      expect(
        layout.furniture.some((f) => f.type === 'PLANT' && f.col === col && f.row === row),
      ).toBe(false);
    }
  });

  it('is empty at night and present at sunrise', () => {
    const layout = office();
    expect(shaftRects(layout, 20)).toEqual([]);
    expect(shaftRects(layout, 6, 59)).toEqual([]);
    expect(shaftRects(layout, 7)).toHaveLength(1);
    expect(shaftRects(layout, 19, 59)).toHaveLength(1);
  });

  it('carries the color of the hour: 0.16 peak at 09:00, warm at 18:00, sliding between', () => {
    const colorAt = (h: number, m = 0) => shaftRects(office(), h, m)[0].color;
    expect(colorAt(9)).toEqual({ r: 255, g: 236, b: 190, alpha: 0.16 });
    expect(colorAt(18)).toEqual({ r: 255, g: 170, b: 110, alpha: SHAFT_EVENING.alpha });
    const mid = colorAt(13, 30);
    expect(mid.g).toBe(203);
    expect(mid.b).toBe(150);
    expect(mid.alpha).toBeCloseTo((SHAFT_MORNING.alpha + SHAFT_EVENING.alpha) / 2, 10);
    // The 07:00 morning holds the 09:00 peak, and no minute of the day is brighter.
    expect(colorAt(7).alpha).toBe(0.16);
    const layout = office();
    let max = 0;
    for (let t = 0; t < 24 * 60; t++) {
      max = Math.max(max, shaftRects(layout, Math.floor(t / 60), t % 60)[0]?.color.alpha ?? 0);
    }
    expect(max).toBe(0.16);
  });
});

describe('monitorLook', () => {
  const ticks = Array.from({ length: 1000 }, (_, i) => i);

  it('keeps an idle screen still: frame 0, never dim', () => {
    for (const t of ticks) {
      expect(monitorLook(false, t, 5)).toEqual({ frame: 0, dim: false });
    }
  });

  it('cycles an active screen through its three ON frames', () => {
    expect([0, 1, 2, 3, 4].map((t) => monitorLook(true, t).frame)).toEqual([0, 1, 2, 0, 1]);
  });

  it('dims an active screen on about one tick in four, and not in lockstep across screens', () => {
    const rate = (seed: number) =>
      ticks.filter((t) => monitorLook(true, t, seed).dim).length / ticks.length;
    for (const seed of [0, 7, 123]) {
      expect(rate(seed), `seed ${seed}`).toBeGreaterThan(0.2);
      expect(rate(seed), `seed ${seed}`).toBeLessThan(0.3);
    }
    expect(ticks.some((t) => monitorLook(true, t, 1).dim !== monitorLook(true, t, 2).dim)).toBe(
      true,
    );
  });
});

describe('monitorOverlayPlan', () => {
  it('draws no scanlines at low zoom', () => {
    for (const zoom of [1, 3, 7]) {
      expect(monitorOverlayPlan(zoom).scanlineRows, `zoom ${zoom}`).toEqual([]);
    }
  });

  it('draws 1 px lines every 2 device px from zoom 8, all inside the screen', () => {
    const plan = monitorOverlayPlan(8);
    expect(plan.h).toBe(48);
    expect(plan.scanlineRows.length).toBe(24);
    expect(plan.scanlineRows.every((y, i) => y === 1 + 2 * i && y < plan.h)).toBe(true);
  });
});
