/**
 * The carpet layer stays inside the map: a rug whose last row is the map's last row paints nothing
 * below the map bottom (nor past its other three edges). Junction sprites are one tile centered on
 * a corner, so the outer corners would otherwise paint half a tile outside.
 *
 * Run with: npm test
 */
import assert from 'node:assert/strict';

import { afterAll, beforeAll, test, vi } from 'vitest';

import { TILE_SIZE } from '../src/constants.js';
import { renderCarpetLayer } from '../src/office/engine/renderer.js';
import { setCarpetSprites } from '../src/office/sprites/carpetTiles.js';
import type { CarpetTile } from '../src/office/types.js';

type Ctx2D = Parameters<typeof renderCarpetLayer>[0];
type Box = [number, number, number, number];
interface Draw {
  box: Box;
  clip: Box[] | null;
}

/** A context that keeps the clip the way a canvas does (save/restore stack, rect path) and records each drawImage. */
function recorder(): { ctx: Ctx2D; draws: Draw[] } {
  const draws: Draw[] = [];
  const state: Record<string, unknown> = {};
  let path: Box[] = [];
  let clip: Box[] | null = null;
  const stack: Array<Box[] | null> = [];
  const ctx = new Proxy(state, {
    get(target, prop: string) {
      if (prop === 'beginPath') return () => (path = []);
      if (prop === 'rect') return (...b: Box) => path.push(b);
      if (prop === 'clip') return () => (clip = [...path]);
      if (prop === 'save') return () => stack.push(clip);
      if (prop === 'restore') return () => (clip = stack.pop() ?? null);
      if (prop === 'drawImage') {
        return (img: { width: number; height: number }, x: number, y: number) =>
          draws.push({ box: [x, y, img.width, img.height], clip });
      }
      if (prop === 'createImageData') {
        return (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4), width: w });
      }
      if (prop in target) return target[prop];
      return () => undefined;
    },
    set(target, prop: string, value) {
      target[prop] = value;
      return true;
    },
  }) as unknown as Ctx2D;
  return { ctx, draws };
}

beforeAll(() => {
  vi.stubGlobal('document', {
    createElement: () => ({ width: 0, height: 0, getContext: () => recorder().ctx }),
  });
  // One variant, 16 junction cases, one 16x16 world-px tile (32x32 art px) each, two colors.
  /* eslint-disable pixel-agents/no-inline-colors -- synthetic sprite pixels, not UI colors */
  const tile = Array.from({ length: 32 }, (_, y) =>
    Array.from({ length: 32 }, (_, x) => ((x + y) % 2 ? '#404040' : '#c0c0c0')),
  );
  /* eslint-enable pixel-agents/no-inline-colors */
  setCarpetSprites([Array.from({ length: 16 }, () => tile)]);
});
afterAll(() => {
  vi.unstubAllGlobals();
});

test('a rug on the map edges paints nothing outside the map', () => {
  const cols = 3;
  const rows = 2;
  const zoom = 4;
  const [offsetX, offsetY] = [10, 20];
  const rug: CarpetTile[] = Array.from({ length: cols * rows }, () => ({ variant: 0 }));
  const { ctx, draws } = recorder();
  renderCarpetLayer(ctx, rug, cols, rows, offsetX, offsetY, zoom);

  const s = TILE_SIZE * zoom;
  const map = { l: offsetX, t: offsetY, r: offsetX + cols * s, b: offsetY + rows * s };
  // Without a clip the outer corners overshoot, so the check below has something to catch.
  assert.ok(draws.some((d) => d.box[1] + d.box[3] > map.b));
  for (const {
    box: [x, y, w, h],
    clip,
  } of draws) {
    const visible = (clip ?? [[-1e9, -1e9, 2e9, 2e9] as Box]).reduce(
      (acc, [cx, cy, cw, ch]) => ({
        l: Math.max(acc.l, cx),
        t: Math.max(acc.t, cy),
        r: Math.min(acc.r, cx + cw),
        b: Math.min(acc.b, cy + ch),
      }),
      { l: x, t: y, r: x + w, b: y + h },
    );
    assert.ok(visible.l >= map.l && visible.t >= map.t, 'paints above or left of the map');
    assert.ok(visible.r <= map.r && visible.b <= map.b, 'paints below or right of the map');
  }
});
