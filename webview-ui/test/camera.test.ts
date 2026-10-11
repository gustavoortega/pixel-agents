/**
 * Camera: the pan/zoom rules (zoom about an anchor, centred small maps, void-free big ones), the
 * fit target (the rooms where agents work, never a sprite box), and the auto-fit hysteresis.
 *
 * Run with: npm test
 */

import assert from 'node:assert/strict';

import { test } from 'vitest';

import {
  AutoFit,
  type AutoFitInput,
  clampOffset,
  clampPan,
  fitTarget,
  fitView,
  fitZoomWholeMap,
  panAfterZoom,
  refitView,
  roomsOf,
  type TileBox,
  zoomAbout,
} from '../src/office/camera.js';

const box = (col0: number, row0: number, col1: number, row1: number): TileBox => ({
  col0,
  row0,
  col1,
  row1,
});

// ── C1: pan and zoom rules (K1) ────────────────────────────────

test('clampOffset: a map smaller than the view is centred, a bigger one never shows void', () => {
  assert.equal(clampOffset(1000, 600, 123), 200, 'small map ignores the offset and centres');
  assert.equal(clampOffset(1000, 1500, 50), 0, 'left edge cannot move right of the view edge');
  assert.equal(clampOffset(1000, 1500, -900), -500, 'right edge cannot move left of the view edge');
  assert.equal(clampOffset(1000, 1500, -200), -200, 'a legal offset is untouched');
});

test('clampPan: each axis follows its own rule', () => {
  const view = { width: 1000, height: 600 };
  // 10x5 tiles at zoom 2 = 320x160: small on both axes, so any pan lands centred.
  assert.deepEqual(clampPan({ x: 500, y: -300 }, view, { cols: 10, rows: 5 }, 2), { x: 0, y: 0 });
  // 40x5 tiles at zoom 2 = 1280x160: big across (clamped), small down (centred).
  assert.deepEqual(clampPan({ x: 9999, y: 40 }, view, { cols: 40, rows: 5 }, 2), { x: 140, y: 0 });
});

test('zoomAbout: the world point under the anchor stays under it', () => {
  // world point under (500,300) at offset (-100,-50) and zoom 2 is (300,175); at zoom 4 it must
  // still be under (500,300), so the offset is anchor - world * 4.
  assert.deepEqual(zoomAbout({ x: 500, y: 300 }, { x: -100, y: -50 }, 2, 4), { x: -700, y: -400 });
});

test('panAfterZoom: zooming from the viewport centre keeps the centred world point, then clamps', () => {
  const view = { width: 1000, height: 600 };
  const map = { cols: 40, rows: 20 };
  const centre = { x: 500, y: 300 };
  assert.deepEqual(panAfterZoom(centre, { x: 0, y: 0 }, 2, 3, view, map), { x: 0, y: 0 });
  // Panned 100px: the point under the centre is at world x 270; at zoom 3 the pan becomes 150.
  assert.deepEqual(panAfterZoom(centre, { x: 100, y: 0 }, 2, 3, view, map), { x: 150, y: 0 });
});

// ── C2/F3: the fit target (K2) ─────────────────────────────────

// 12x6 floor: rooms A (cols 0-3), B (4-7), C (8-11); the coffee table sits in C, the lounge.
const FLOOR = 1;
const layout = {
  cols: 12,
  rows: 6,
  tiles: new Array<number>(72).fill(FLOOR),
  areaTiles: Array.from({ length: 72 }, (_, i) => ['A', 'B', 'C'][Math.floor((i % 12) / 4)]),
  furniture: [{ type: 'COFFEE_TABLE', col: 9, row: 2 }],
};
const rooms = roomsOf(layout);
const agent = (room: string, working = true, tileRoom = room) => ({ working, room, tileRoom });

test('roomsOf: one box per Area, and the lounge is the Area holding the coffee table', () => {
  assert.deepEqual(rooms.boxes.get('B'), box(4, 0, 7, 5));
  assert.equal(rooms.lounge, 'C');
});

test('fitTarget: the working room plus its nearest neighbour, so at least two rooms', () => {
  assert.deepEqual(fitTarget(rooms, [agent('A')]), box(0, 0, 7, 5));
});

test('fitTarget: the lounge joins when anyone stands in it', () => {
  // A works; someone idle stands in C. A and C, not the room between them.
  const target = fitTarget(rooms, [agent('A'), agent('B', false, 'C')]);
  assert.deepEqual(target, box(0, 0, 11, 5));
});

test('fitTarget: idle agents hold nothing; nobody working frames the whole map', () => {
  assert.equal(fitTarget(rooms, [agent('A', false), agent('B', false)]), null);
  assert.equal(fitTarget(rooms, []), null);
});

test('fitTarget: a map with fewer rooms than the minimum frames the whole map', () => {
  const single = roomsOf({ ...layout, areaTiles: new Array<string | null>(72).fill('A') });
  assert.equal(fitTarget(single, [agent('A')]), null);
});

test('fitView: the frame is EXACTLY the room union plus one tile of margin', () => {
  // 1280x720 canvas. Rooms A+B = cols 0-7, rows 0-5; with the margin cols -1..8, rows -1..6.
  const target = fitTarget(rooms, [agent('A')]);
  const fit = fitView(target, { cols: 12, rows: 6 }, { width: 1280, height: 720 }, 1);
  assert.deepEqual(fit.box, box(-1, -1, 8, 6));
  // 10x8 tiles: floor(min(1280/160, 720/128)) = 5
  assert.equal(fit.zoom, 5);
  assert.deepEqual(fit.center, { x: 64, y: 48 });
});

test('fitView: no target is the whole map at the biggest integer zoom', () => {
  const fit = fitView(null, { cols: 20, rows: 11 }, { width: 1280, height: 720 }, 1);
  assert.equal(fit.zoom, 4);
  assert.deepEqual(fit.center, { x: 160, y: 88 });
  // dpr doubles the device pixels: 2560 x 1440 fits 20 x 11 tiles at floor(min(8, 8.18)) = 8.
  assert.equal(fitView(null, { cols: 20, rows: 11 }, { width: 1280, height: 720 }, 2).zoom, 8);
});

test('fitZoomWholeMap: the 27x21 layout on a 2560x1300 device-px canvas fits at 3', () => {
  assert.equal(fitZoomWholeMap({ cols: 27, rows: 21 }, { width: 1280, height: 650 }, 2), 3);
});

// ── Hysteresis ─────────────────────────────────────────────────

const WIDE = { cols: 40, rows: 11 };
const CANVAS = { width: 1280, height: 720 };

test('refitView: a target inside the current view changes nothing', () => {
  const current = { zoom: 4, center: { x: 160, y: 88 } };
  assert.equal(refitView(current, box(5, 5, 6, 6), WIDE, CANVAS, 1), null);
  assert.equal(refitView(current, null, WIDE, CANVAS, 1), null);
});

test('refitView: a target outside the view re-centres but never zooms in', () => {
  const current = { zoom: 3, center: { x: 48, y: 88 } };
  // the box alone would fit at zoom 11; the view stays at 3 and only moves
  assert.deepEqual(refitView(current, box(30, 5, 32, 6), WIDE, CANVAS, 1), {
    zoom: 3,
    center: { x: 504, y: 96 },
  });
});

test('refitView: a target that no longer fits zooms out', () => {
  const current = { zoom: 5, center: { x: 160, y: 88 } };
  // the 22x13 tiles with margin fit at floor(min(3.6, 3.46)) = 3
  assert.equal(refitView(current, box(0, 0, 19, 10), { cols: 20, rows: 11 }, CANVAS, 1)?.zoom, 3);
});

const input = (patch: Partial<AutoFitInput> = {}): AutoFitInput => ({
  target: null,
  map: WIDE,
  canvas: CANVAS,
  dpr: 1,
  zoom: 3,
  pan: { x: 0, y: 0 },
  nowMs: 0,
  editing: false,
  followed: false,
  ...patch,
});

test('AutoFit: fits once on start, then leaves a target inside the view alone', () => {
  const fit = new AutoFit();
  // whole 40x11 map: floor(min(2, 4.09)) = 2; the 1280 px map fills the width, the height is centred
  assert.deepEqual(fit.step(input()), { zoom: 2, pan: { x: 0, y: 0 }, panZoom: 2 });
  assert.deepEqual(fit.step(input({ target: box(5, 5, 6, 6), zoom: 2, nowMs: 50 })), {});
});

test('AutoFit: a target outside the view eases the centre over 300 ms, keeps the zoom, and stays void-free', () => {
  const fit = new AutoFit();
  fit.step(input({ target: box(0, 0, 5, 10) }));
  const far = input({ target: box(30, 5, 32, 6), nowMs: 1000 });
  const first = fit.step(far);
  assert.equal(first.zoom, undefined, 'integer zoom is not animated or changed');
  assert.deepEqual(first.pan, { x: 0, y: 0 }, 'starts where the view is');
  const done = fit.step({ ...far, nowMs: 1300 });
  // The centre would pan -552, past the right edge of the 40-tile map: clamped to -320.
  assert.deepEqual(done.pan, { x: -320, y: 0 }, 'ends on the new rooms, without void');
});

test('AutoFit: a manual zoom or pan, an open editor or a followed agent stops refits; Fit resumes', () => {
  const states: boolean[] = [];
  const fit = new AutoFit((on) => states.push(on));
  fit.step(input({ target: box(0, 0, 5, 10) }));
  const far = input({ target: box(30, 5, 32, 6) });

  fit.disable(); // manual zoom or pan
  assert.deepEqual(fit.step(far), {});
  assert.equal(fit.enabled, false);

  fit.enable(); // the Fit button frames the rooms right away
  const refit = fit.step(far);
  assert.equal(typeof refit.zoom, 'number');
  assert.deepEqual(states, [false, true]);

  const editing = new AutoFit();
  editing.step(input());
  assert.deepEqual(editing.step({ ...far, editing: true }), {});
  assert.equal(editing.enabled, false);

  const following = new AutoFit();
  following.step(input());
  assert.deepEqual(following.step({ ...far, followed: true }), {});
  assert.equal(following.enabled, false);
});
