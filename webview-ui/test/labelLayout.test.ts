/**
 * Compact label collision layout, room sign placement, and the idle-wander
 * area restriction.
 *
 * Run with: npm test
 */

import assert from 'node:assert/strict';

import { test } from 'vitest';

import { wanderCandidates } from '../src/office/engine/characters.js';
import {
  areaSignRect,
  type LabelItem,
  layoutLabels,
  type Rect,
} from '../src/office/labelLayout.js';
import { compactLabelMaxWidth } from '../src/office/toolUtils.js';

const L = 18; // COMPACT_LABEL_LINE_HEIGHT_PX
const item = (id: number, x: number, patch: Partial<LabelItem> = {}): LabelItem => ({
  id,
  col: 0,
  row: 0,
  x,
  y: 100,
  w: 184,
  h: L,
  ...patch,
});
const rectOf = (it: LabelItem, dy: number): Rect => ({
  x: it.x - it.w / 2,
  y: it.y + dy,
  w: it.w,
  h: it.h,
});
const overlap = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

test('layoutLabels: five seats 192px apart do not move', () => {
  const items = [0, 1, 2, 3, 4].map((i) => item(i, 100 + i * 192, { col: i * 4 }));
  const out = layoutLabels(items, []);
  for (const it of items) assert.deepEqual(out.get(it.id), { dy: 0, dim: false });
});

test('layoutLabels: labels on one tile stack, and the one pushed past 3 lines dims in place', () => {
  const items = [1, 2, 3, 4].map((id) => item(id, 100));
  const out = layoutLabels(items, []);
  assert.equal(out.get(1)?.dy, 0);
  assert.equal(out.get(2)?.dy, L + 2);
  assert.equal(out.get(3)?.dy, 2 * L + 4);
  assert.deepEqual(out.get(4), { dy: 0, dim: true });
  const shown = items
    .filter((it) => !out.get(it.id)!.dim)
    .map((it) => rectOf(it, out.get(it.id)!.dy));
  for (let i = 0; i < shown.length; i++)
    for (let j = i + 1; j < shown.length; j++) assert.equal(overlap(shown[i]!, shown[j]!), false);
});

test('layoutLabels: plates above the head are pushed up, away from the face', () => {
  const items = [1, 2].map((id) => item(id, 100, { grow: 'up' }));
  const out = layoutLabels(items, []);
  assert.equal(out.get(1)?.dy, 0);
  assert.equal(out.get(2)?.dy, -(L + 2));
});

test('layoutLabels: pods 2.5 tiles apart keep their plates apart at zoom 3 and 4', () => {
  for (const zoom of [3, 4]) {
    const pitch = 2.5 * 16 * zoom;
    const w = compactLabelMaxWidth(zoom, 1);
    const items = [0, 1, 2, 3].map((i) => item(i, 100 + i * pitch, { w, col: i * 2.5 }));
    const out = layoutLabels(items, []);
    for (const it of items) assert.deepEqual(out.get(it.id), { dy: 0, dim: false }, `zoom ${zoom}`);
  }
});

test('layoutLabels: a label over a room sign is moved below it', () => {
  const sign: Rect = { x: 0, y: 95, w: 400, h: 12 };
  const it = item(1, 100);
  const dy = layoutLabels([it], [sign]).get(1)!.dy;
  assert.equal(dy, 95 + 12 - 100 + 2);
  assert.equal(overlap(rectOf(it, dy), sign), false);
});

test('layoutLabels: order follows the tile, not the sub-tile x, so swapping x keeps each id in place', () => {
  const a = layoutLabels([item(1, 100), item(2, 104)], []);
  const b = layoutLabels([item(1, 104), item(2, 100)], []);
  assert.equal(a.get(1)?.dy, 0);
  assert.equal(b.get(1)?.dy, 0);
  assert.equal(a.get(2)?.dy, b.get(2)?.dy);
  assert.ok(b.get(2)!.dy > 0);
});

test('areaSignRect: wall row above the area at its first column, centroid on row 0, null if empty', () => {
  const cols = 6;
  const rows = 14;
  const tiles: Array<string | null> = new Array(cols * rows).fill(null);
  for (let r = 2; r <= 11; r++) for (let c = 1; c <= 3; c++) tiles[r * cols + c] = 'Tiendanube';

  const sign = areaSignRect(tiles, cols, 'Tiendanube', 1)!;
  assert.equal(sign.x, 1.5 * 16);
  assert.equal(sign.y + sign.h / 2, 1.5 * 16, 'centred on wall row 1');

  assert.equal(areaSignRect(tiles, cols, 'Nope', 1), null);
  assert.equal(areaSignRect(undefined, cols, 'Tiendanube', 1), null);

  const top: Array<string | null> = new Array(cols * rows).fill(null);
  for (let r = 0; r <= 3; r++) top[r * cols + 2] = 'Top';
  const c = areaSignRect(top, cols, 'Top', 1)!;
  assert.equal(c.x + c.w / 2, 2.5 * 16);
  assert.equal(c.y + c.h / 2, 2 * 16);
});

test('wanderCandidates: stay in the seat area, else fall back to every walkable tile', () => {
  const cols = 4;
  const areaTiles: Array<string | null> = ['A', 'A', null, 'B', 'A', 'A', null, 'B'];
  const walkable = [
    { col: 0, row: 0 },
    { col: 1, row: 1 },
    { col: 2, row: 0 },
    { col: 3, row: 1 },
  ];
  assert.deepEqual(wanderCandidates(walkable, { seatCol: 0, seatRow: 0 }, areaTiles, cols), [
    { col: 0, row: 0 },
    { col: 1, row: 1 },
  ]);
  assert.deepEqual(
    wanderCandidates(walkable, { seatCol: 2, seatRow: 1 }, areaTiles, cols),
    walkable,
  );
  assert.deepEqual(wanderCandidates(walkable, undefined, areaTiles, cols), walkable);
  assert.deepEqual(
    wanderCandidates(walkable, { seatCol: 0, seatRow: 0 }, undefined, cols),
    walkable,
  );
  // Seat area has no walkable tile (all blocked): do not strand the agent.
  assert.deepEqual(
    wanderCandidates([{ col: 3, row: 1 }], { seatCol: 0, seatRow: 0 }, areaTiles, cols),
    [{ col: 3, row: 1 }],
  );
});
