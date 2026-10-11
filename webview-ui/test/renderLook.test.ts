/**
 * What renderFrame and renderScene put on the canvas for the cozy look: the Area wash only while
 * editing areas, and the shadow, outline and body of a character in that order. Drawn onto a
 * recording context, so the assertions are about pixels requested, not about internals.
 *
 * Run with: npm test
 */

import assert from 'node:assert/strict';

import { afterAll, beforeAll, test, vi } from 'vitest';

import { SHADOW_SIZE_PX, SHADOW_SMALL_SIZE_PX, TILE_SIZE } from '../src/constants.js';
import { createCharacter } from '../src/office/engine/characters.js';
import { renderFrame, renderScene, shouldDrawAreaOverlay } from '../src/office/engine/renderer.js';

type Ctx2D = Parameters<typeof renderScene>[0];
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
}

/** A 2D context that records fillRect and drawImage and swallows everything else. */
function recorder(): Recorder {
  const fills: FillCall[] = [];
  const drawnWidths: number[] = [];
  const state: Record<string, unknown> = {};
  const ctx = new Proxy(state, {
    get(target, prop: string) {
      if (prop === 'fillRect') {
        return (x: number, y: number, w: number, h: number) =>
          fills.push({ x, y, w, h, fillStyle: String(target.fillStyle) });
      }
      if (prop === 'drawImage') {
        return (img: { width: number }) => drawnWidths.push(img.width);
      }
      if (prop === 'measureText') return () => ({ width: 10 });
      if (prop in target) return target[prop];
      return () => undefined;
    },
    set(target, prop: string, value) {
      target[prop] = value;
      return true;
    },
  }) as unknown as Ctx2D;
  return { ctx, fills, drawnWidths };
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
  // the sign is still there: its dot carries the area color
  assert.ok(
    rec.fills.some((f) => f.fillStyle === AREA.color),
    'sign dot',
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
  assert.deepEqual([big[0].length, big.length], [SHADOW_SIZE_PX.w, SHADOW_SIZE_PX.h]);
  assert.deepEqual(
    [small[0].length, small.length],
    [SHADOW_SMALL_SIZE_PX.w, SHADOW_SMALL_SIZE_PX.h],
  );
  assert.equal(big[0][0], '', 'corners are clear');
  assert.notEqual(big[1][SHADOW_SIZE_PX.w / 2], '', 'the middle is filled');
  assert.equal(shadowSprite(false), big, 'built once, so the per-zoom canvas cache can key on it');
});
