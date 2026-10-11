/**
 * Camera fit-to-activity: the zoom and centre that frame the seats in use, the hysteresis that
 * keeps the view from jumping, and when auto-fit hands the camera back to the user.
 *
 * Run with: npm test
 */

import assert from 'node:assert/strict';

import { test } from 'vitest';

import {
  AutoFit,
  type AutoFitInput,
  fitView,
  occupiedTileBox,
  refitView,
  type TileBox,
} from '../src/office/camera.js';

const MAP = { cols: 20, rows: 11 };
const CANVAS = { width: 1280, height: 720 };
const box = (col0: number, row0: number, col1: number, row1: number): TileBox => ({
  col0,
  row0,
  col1,
  row1,
});

test('occupiedTileBox: bounding box of the seats, null when nobody sits', () => {
  assert.equal(occupiedTileBox([]), null);
  assert.deepEqual(
    occupiedTileBox([
      { seatCol: 5, seatRow: 3 },
      { seatCol: 2, seatRow: 6 },
    ]),
    box(2, 3, 5, 6),
  );
});

// The frame also reaches 1 tile above the top row, so a nameplate over the top seats is not clipped.
test('fitView: whole map when nobody is seated, the biggest integer zoom that fits', () => {
  assert.deepEqual(fitView(null, MAP, CANVAS, 1), { zoom: 4, center: { x: 160, y: 80 } });
  // dpr doubles the device pixels: 2560 x 1440 fits 20 x 12 tiles at floor(min(8, 7.5)) = 7.
  assert.equal(fitView(null, MAP, CANVAS, 2).zoom, 7);
});

test('fitView: occupied seats plus a 3-tile margin, centred on them', () => {
  // seats (5,3)-(7,5) + margin + 1 tile of top pad = 9x10 tiles; the 720 px height is the limit:
  // floor(720 / 160) = 4
  assert.deepEqual(fitView(box(5, 3, 7, 5), MAP, CANVAS, 1), {
    zoom: 4,
    center: { x: 104, y: 64 },
  });
});

test('fitView: never below zoom 4 unless the whole map needs less', () => {
  // seats nearly wall to wall: box + margin is 24x15 tiles, which alone fits at zoom 3
  const wide = box(1, 1, 18, 9);
  assert.equal(fitView(wide, MAP, CANVAS, 1).zoom, 4);
  // a small canvas: the whole map fits at 2, so 2 is the floor (and the box fits at 1)
  assert.equal(fitView(wide, MAP, { width: 700, height: 400 }, 1).zoom, 2);
});

test('refitView: a seat inside the current view changes nothing', () => {
  const current = { zoom: 4, center: { x: 160, y: 88 } };
  assert.equal(refitView(current, box(5, 5, 6, 6), MAP, CANVAS, 1), null);
  assert.equal(refitView(current, null, MAP, CANVAS, 1), null);
});

test('refitView: a seat outside the view re-centres but never zooms in', () => {
  const current = { zoom: 5, center: { x: 100, y: 70 } };
  // the box alone would fit at zoom 6; the view stays at 5 and only moves
  assert.deepEqual(refitView(current, box(15, 8, 15, 8), MAP, CANVAS, 1), {
    zoom: 5,
    center: { x: 248, y: 128 },
  });
});

test('refitView: seats that no longer fit zoom out', () => {
  const current = { zoom: 5, center: { x: 160, y: 88 } };
  const next = refitView(current, box(0, 0, 19, 10), MAP, CANVAS, 1);
  assert.equal(next?.zoom, 4);
});

const input = (patch: Partial<AutoFitInput> = {}): AutoFitInput => ({
  occupied: null,
  map: MAP,
  canvas: CANVAS,
  dpr: 1,
  zoom: 4,
  pan: { x: 0, y: 0 },
  nowMs: 0,
  editing: false,
  followed: false,
  ...patch,
});

test('AutoFit: fits once on start, then leaves a seat inside the view alone', () => {
  const fit = new AutoFit();
  assert.deepEqual(fit.step(input()), { zoom: 4, pan: { x: 0, y: 32 }, panZoom: 4 });
  assert.deepEqual(fit.step(input({ occupied: box(5, 5, 6, 6), nowMs: 50 })), {});
});

test('AutoFit: a seat outside the view eases the centre over 300 ms and keeps the zoom', () => {
  const fit = new AutoFit();
  fit.step(input());
  const outside = input({ occupied: box(15, 8, 15, 8), nowMs: 1000 });
  const first = fit.step(outside);
  assert.equal(first.zoom, undefined, 'integer zoom is not animated or changed');
  assert.deepEqual(first.pan, { x: 0, y: 0 }, 'starts where the view is');
  const done = fit.step({ ...outside, nowMs: 1300 });
  assert.deepEqual(done.pan, { x: -352, y: -160 }, 'ends centred on the new seat');
});

test('AutoFit: a manual zoom or pan, an open editor or a followed agent stops refits; Fit resumes', () => {
  const states: boolean[] = [];
  const fit = new AutoFit((on) => states.push(on));
  fit.step(input());
  const outside = input({ occupied: box(15, 8, 15, 8) });

  fit.disable(); // manual zoom or pan
  assert.deepEqual(fit.step(outside), {});
  assert.equal(fit.enabled, false);

  fit.enable(); // the Fit button frames the seats right away
  const refit = fit.step(outside);
  assert.equal(typeof refit.zoom, 'number');
  assert.deepEqual(states, [false, true]);

  const editing = new AutoFit();
  editing.step(input());
  assert.deepEqual(editing.step({ ...outside, editing: true }), {});
  assert.equal(editing.enabled, false);

  const following = new AutoFit();
  following.step(input());
  assert.deepEqual(following.step({ ...outside, followed: true }), {});
  assert.equal(following.enabled, false);
});
