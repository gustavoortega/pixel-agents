/**
 * Cozy light: window shafts (color by hour, where they land), the night window frame and the CRT
 * monitor look.
 */
import { describe, expect, it } from 'vitest';

import { SHAFT_EVENING, SHAFT_MORNING } from '../src/constants.js';
import { buildDynamicCatalog, getCatalogEntry } from '../src/office/layout/furnitureCatalog.js';
import { layoutToFurnitureInstances } from '../src/office/layout/layoutSerializer.js';
import { monitorLook, monitorOverlayPlan } from '../src/office/monitor.js';
import { furnitureForHour, shaftRects } from '../src/office/shafts.js';
import type { OfficeLayout } from '../src/office/types.js';
import { TILE_SIZE, TileType } from '../src/office/types.js';
import { loadRealAssets } from './realAssets.js';

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

  // Window on the wall rows 0-1 at cols 2-3; the floor starts at row 2. The shaft is 3 tiles wide
  // centered under the window (x 1.5..4.5 at the sill) and leans right 20 deg over its 4 rows. In
  // it, (2,4) is a pillar, (3,3) holds a plant and (4,5) is another room.
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
    areaTiles[5 * cols + 4] = 'B';
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

  it('is a 3-wide, 4-long parallelogram centered under the window, leaning 20 deg', () => {
    const [shaft] = shaftRects(office(), 12);
    const lean = 4 * Math.tan((20 * Math.PI) / 180);
    const expected = [
      [1.5, 2],
      [4.5, 2],
      [4.5 + lean, 6],
      [1.5 + lean, 6],
    ];
    shaft.polygon.forEach(([x, y], i) => {
      expect(x).toBeCloseTo(expected[i][0], 10);
      expect(y).toBe(expected[i][1]);
    });
  });

  it('lands only on floor cells of the window room that hold no furniture, following the lean', () => {
    const layout = office();
    const [shaft, ...rest] = shaftRects(layout, 12);
    expect(rest).toHaveLength(0);
    const cells = shaft.cells.map((c) => `${c.col},${c.row}`).sort();
    // Row 2 already reaches column 4, past the window's right edge; by row 5 it has slid to column 5.
    expect(cells).toEqual(['2,2', '2,3', '3,2', '3,4', '3,5', '4,2', '4,3', '4,4', '5,5']);
  });

  it('is off from 19:00 to 06:59', () => {
    const layout = office();
    expect(shaftRects(layout, 18, 59)).toHaveLength(1);
    expect(shaftRects(layout, 19, 0)).toEqual([]);
    expect(shaftRects(layout, 6, 59)).toEqual([]);
    expect(shaftRects(layout, 7, 0)).toHaveLength(1);
  });

  it('carries the color of the hour: 0.30 peak at 09:00, warm at 18:00, the rim fading with it', () => {
    const at = (h: number, m = 0) => shaftRects(office(), h, m)[0];
    expect(at(9).color).toEqual({ r: 255, g: 236, b: 190, alpha: 0.3 });
    expect(at(9).edgeAlpha).toBeCloseTo(0.18, 10);
    expect(at(18).color).toEqual({ r: 255, g: 170, b: 110, alpha: SHAFT_EVENING.alpha });
    expect(at(18).edgeAlpha).toBeCloseTo((0.18 * SHAFT_EVENING.alpha) / 0.3, 10);
    const mid = at(13, 30).color;
    expect(mid.g).toBe(203);
    expect(mid.b).toBe(150);
    expect(mid.alpha).toBeCloseTo((SHAFT_MORNING.alpha + SHAFT_EVENING.alpha) / 2, 10);
    // The 07:00 morning holds the 09:00 peak, and no minute of the day is brighter.
    expect(at(7).color.alpha).toBe(0.3);
    const layout = office();
    let max = 0;
    for (let t = 0; t < 24 * 60; t++) {
      max = Math.max(max, shaftRects(layout, Math.floor(t / 60), t % 60)[0]?.color.alpha ?? 0);
    }
    expect(max).toBe(0.3);
  });
});

describe('night windows', () => {
  it('show the night frame in the night phase (20:00 to 05:59) and the day frame otherwise, dusk included', () => {
    loadRealAssets();
    const day = getCatalogEntry('WINDOW')!.sprite;
    const night = getCatalogEntry('WINDOW_NIGHT')!.sprite;
    expect(night).not.toEqual(day);
    // Saved either way (the editor's T key can save the night twin), the hour decides the frame.
    const furniture = layoutToFurnitureInstances([
      { uid: 'w1', type: 'WINDOW', col: 1, row: 0 },
      { uid: 'w2', type: 'WINDOW_NIGHT', col: 5, row: 0 },
      { uid: 'lamp', type: 'FLOOR_LAMP', col: 3, row: 2 },
    ]);
    const lampSprite = furniture.find((f) => f.type === 'FLOOR_LAMP')!.sprite;
    for (const [h, m, frame] of [
      [19, 30, day],
      [20, 0, night],
      [5, 59, night],
      [6, 0, day],
    ] as const) {
      const drawn = furnitureForHour(furniture, h, m);
      // The windows hang on row 0; the lamp stands lower and is never swapped.
      const windows = drawn.filter((f) => f.y === 0);
      expect(
        windows.map((f) => f.sprite === frame),
        `${h}:${m}`,
      ).toEqual([true, true]);
      expect(drawn.find((f) => f.y !== 0)!.sprite).toBe(lampSprite);
    }
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
