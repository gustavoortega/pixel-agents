/**
 * What renderFrame and renderScene put on the canvas for the cozy look: the Area wash only while
 * editing areas, and the shadow, outline and body of a character in that order. Drawn onto a
 * recording context, so the assertions are about pixels requested, not about internals.
 *
 * Run with: npm test
 */

import assert from 'node:assert/strict';

import { afterAll, beforeAll, test, vi } from 'vitest';

import { ART_DENSITY } from '../../core/src/assets/constants.js';
import {
  AREA_SIGN_PLATE_COLOR,
  NIGHT_DARKEN_ALPHA,
  NIGHT_DARKEN_COLOR,
  SHADOW_SIZE_PX,
  SHADOW_SMALL_SIZE_PX,
  TILE_SIZE,
} from '../src/constants.js';
import { createCharacter } from '../src/office/engine/characters.js';
import { renderFrame, renderScene, shouldDrawAreaOverlay } from '../src/office/engine/renderer.js';

type Ctx2D = Parameters<typeof renderScene>[0];
import { lightingFor } from '../src/office/lighting.js';
import { characterLayerZ, shadowSprite } from '../src/office/shadow.js';
import { TileType } from '../src/office/types.js';

interface FillCall {
  x: number;
  y: number;
  w: number;
  h: number;
  fillStyle: string;
}
interface Recorder {
  ctx: Ctx2D;
  fills: FillCall[];
  /** Width of each canvas passed to drawImage, in call order. */
  drawnWidths: number[];
  /** Every fillRect and drawImage in call order, with the blend and alpha it was painted under. */
  ops: Array<{ op: 'fill' | 'image'; comp: unknown; alpha: unknown; style: string; w: number }>;
}

/** A 2D context that records fillRect and drawImage and swallows everything else. */
function recorder(): Recorder {
  const fills: FillCall[] = [];
  const drawnWidths: number[] = [];
  const ops: Recorder['ops'] = [];
  const state: Record<string, unknown> = {};
  const ctx = new Proxy(state, {
    get(target, prop: string) {
      if (prop === 'fillRect') {
        return (x: number, y: number, w: number, h: number) => {
          fills.push({ x, y, w, h, fillStyle: String(target.fillStyle) });
          ops.push({
            op: 'fill',
            comp: target.globalCompositeOperation,
            alpha: target.globalAlpha,
            style: String(target.fillStyle),
            w,
          });
        };
      }
      if (prop === 'drawImage') {
        return (img: { width: number }) => {
          drawnWidths.push(img.width);
          ops.push({
            op: 'image',
            comp: target.globalCompositeOperation,
            alpha: target.globalAlpha,
            style: '',
            w: img.width,
          });
        };
      }
      if (prop === 'createRadialGradient' || prop === 'createLinearGradient') {
        return () => ({ addColorStop: () => undefined });
      }
      if (prop === 'measureText') return () => ({ width: 10 });
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
  return { ctx, fills, drawnWidths, ops };
}

beforeAll(() => {
  // getCachedSprite builds its canvases through the DOM; a bare object with a width is enough.
  vi.stubGlobal('document', {
    createElement: () => ({ width: 0, height: 0, getContext: () => recorder().ctx }),
  });
});
afterAll(() => {
  vi.unstubAllGlobals();
});

const AREA = { label: 'Eng', color: 'tomato' };
// 4x4 map, the area on two tiles of row 2 (the sign goes on the wall row above it)
const AREA_TILES = [
  null,
  null,
  null,
  null,
  null,
  null,
  null,
  null,
  null,
  'Eng',
  'Eng',
  null,
  null,
  null,
  null,
  null,
];
const VOID_MAP = Array.from({ length: 4 }, () => Array.from({ length: 4 }, () => TileType.VOID));

function frame(rec: Recorder, showAreas: boolean, isEditingAreas: boolean | undefined) {
  renderFrame(
    rec.ctx,
    640,
    480,
    VOID_MAP,
    [],
    [],
    2,
    0,
    0,
    undefined,
    undefined,
    undefined,
    4,
    4,
    undefined,
    [AREA],
    AREA_TILES,
    showAreas,
    null,
    [],
    undefined,
    undefined,
    undefined,
    isEditingAreas,
  );
}
const washTiles = (rec: Recorder) =>
  rec.fills.filter((f) => f.fillStyle === AREA.color && f.w === TILE_SIZE * 2).length;

test('renderFrame: Show Areas draws the room signs but no color wash outside the Areas tool', () => {
  const rec = recorder();
  frame(rec, true, false);
  assert.equal(washTiles(rec), 0);
  // the sign is still there: a plaque in the wall palette, with no area-colored dot
  assert.ok(
    rec.fills.some((f) => f.fillStyle === AREA_SIGN_PLATE_COLOR),
    'sign plaque',
  );
});

test('renderFrame: editing areas washes every tile of the area', () => {
  const rec = recorder();
  frame(rec, true, true);
  assert.equal(washTiles(rec), 2);
});

test('shouldDrawAreaOverlay: only while the Areas tool is active', () => {
  assert.equal(shouldDrawAreaOverlay(true), true);
  assert.equal(shouldDrawAreaOverlay(false), false);
});

test('renderScene: a selected character draws shadow, then outline, then body', () => {
  const ch = createCharacter(1, 0, null, null);
  const rec = recorder();
  renderScene(rec.ctx, [], [ch], 0, 0, 2, ch.id, null);
  const [shadow, outline, body] = rec.drawnWidths;
  assert.equal(shadow, SHADOW_SIZE_PX.w * 2, 'the oval goes down first');
  assert.ok(outline > body, 'the outline is the body grown by a pixel each side');
  assert.equal(rec.drawnWidths.length, 3);
});

test('renderScene: a sub-agent gets the small oval', () => {
  const ch = { ...createCharacter(-1, 0, null, null), isSubagent: true };
  const rec = recorder();
  renderScene(rec.ctx, [], [ch], 0, 0, 2, null, null);
  assert.equal(rec.drawnWidths[0], SHADOW_SMALL_SIZE_PX.w * 2);
});

test('characterLayerZ: shadow sorts under the outline, which sorts under the body', () => {
  const z = characterLayerZ(100.5);
  assert.ok(z.shadow < z.outline && z.outline < z.body);
  assert.equal(z.body, 100.5);
});

test('shadowSprite: an oval, smaller for sub-agents and companions', () => {
  const big = shadowSprite(false);
  const small = shadowSprite(true);
  // Sprites are art px: the oval is its world size times ART_DENSITY.
  const D = ART_DENSITY;
  assert.deepEqual([big[0].length, big.length], [SHADOW_SIZE_PX.w * D, SHADOW_SIZE_PX.h * D]);
  assert.deepEqual(
    [small[0].length, small.length],
    [SHADOW_SMALL_SIZE_PX.w * D, SHADOW_SMALL_SIZE_PX.h * D],
  );
  assert.equal(big[0][0], '', 'corners are clear');
  assert.notEqual(big[D][(SHADOW_SIZE_PX.w / 2) * D], '', 'the middle is filled');
  assert.equal(shadowSprite(false), big, 'built once, so the per-zoom canvas cache can key on it');
});

// ── Night darkening: one multiply over the scene, then the pools light it back up ──

/** A 16x16 map (nothing is clipped) with one floor lamp at (8,6) and one lit monitor at (2,2). */
function nightFrame(rec: Recorder, darkness: number) {
  const map = Array.from({ length: 16 }, () => Array.from({ length: 16 }, () => TileType.VOID));
  renderFrame(
    rec.ctx,
    1024,
    1024,
    map,
    [],
    [],
    2,
    0,
    0,
    undefined,
    undefined,
    undefined,
    16,
    16,
    undefined,
    [],
    [],
    false,
    null,
    [],
    undefined,
    undefined,
    undefined,
    false,
    {
      lighting: lightingFor(22, 0),
      sources: [],
      fixtures: { lamps: [{ col: 8, row: 6 }], fairyLights: [] },
      shafts: [],
      darkness,
      monitors: [{ col: 2, row: 2 }],
      nowMs: 0,
    },
  );
}
// zoom 2 (32 px a tile): a lamp pool is 8 tiles across, a monitor pool 5.
const LAMP_POOL_W = 8 * 32;
const MONITOR_POOL_W = 5 * 32;

test('renderFrame: at night the map is multiplied once, and the pools are screened on after it', () => {
  const rec = recorder();
  nightFrame(rec, NIGHT_DARKEN_ALPHA);
  const multiply = rec.ops.findIndex((o) => o.op === 'fill' && o.comp === 'multiply');
  assert.ok(multiply >= 0, 'a multiply fill is drawn');
  assert.equal(rec.ops.filter((o) => o.comp === 'multiply').length, 1, 'one darkening source');
  assert.equal(rec.ops[multiply].style, NIGHT_DARKEN_COLOR);
  assert.equal(rec.ops[multiply].alpha, NIGHT_DARKEN_ALPHA);
  assert.equal(rec.ops[multiply].w, 16 * 32, 'covers the whole map');
  for (const w of [LAMP_POOL_W, MONITOR_POOL_W]) {
    const pool = rec.ops.findIndex((o) => o.op === 'image' && o.w === w);
    assert.ok(pool > multiply, `pool ${w}px is drawn after the multiply, not under it`);
    assert.equal(rec.ops[pool].comp, 'screen');
  }
});

test('renderFrame: by day there is no darkening and no pool', () => {
  const rec = recorder();
  nightFrame(rec, 0);
  assert.equal(rec.ops.filter((o) => o.comp === 'multiply').length, 0);
  assert.equal(rec.ops.filter((o) => o.op === 'image' && o.w === LAMP_POOL_W).length, 0);
});

test('renderFrame: half way up the dusk ramp the darkening and the pools are half strength', () => {
  const rec = recorder();
  nightFrame(rec, NIGHT_DARKEN_ALPHA / 2);
  const multiply = rec.ops.find((o) => o.comp === 'multiply');
  assert.equal(multiply?.alpha, NIGHT_DARKEN_ALPHA / 2);
  assert.equal(rec.ops.find((o) => o.op === 'image' && o.w === LAMP_POOL_W)?.alpha, 0.5);
});
