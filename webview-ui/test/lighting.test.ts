/**
 * The warm-light pass: time-of-day phases, where the monitor, lamp and window glows land, and
 * the glow sprite cache.
 *
 * Run with: npm test
 */

import assert from 'node:assert/strict';

import { test } from 'vitest';

import { LIGHT_PHASES } from '../src/constants.js';
import {
  clockLabel,
  createGlowCache,
  type GlowDraw,
  glowDraws,
  type GlowSource,
  isDaytime,
  lightFixtures,
  lightingFor,
  monitorSources,
} from '../src/office/lighting.js';
import { CharacterState, Direction } from '../src/office/types.js';

test('lightingFor: phase boundaries and the tints', () => {
  const cases: Array<[number, number, string]> = [
    [0, 0, 'night'],
    [5, 59, 'night'],
    [6, 0, 'dawn'],
    [6, 59, 'dawn'],
    [7, 0, 'day'],
    [12, 0, 'day'],
    [15, 59, 'day'],
    [16, 0, 'golden'],
    [19, 59, 'golden'],
    [20, 0, 'night'],
    [23, 59, 'night'],
  ];
  for (const [h, m, phase] of cases) {
    assert.equal(lightingFor(h, m).phase, phase, `${h}:${String(m).padStart(2, '0')}`);
  }
  assert.deepEqual(lightingFor(17, 0).tint, LIGHT_PHASES.golden.tint);
  assert.deepEqual(lightingFor(22, 0).tint, LIGHT_PHASES.night.tint);
  assert.deepEqual(lightingFor(6, 30).tint, LIGHT_PHASES.dawn.tint);
  assert.equal(lightingFor(12, 0).tint, null);
  // alphas from the spec: golden 0.28, night 0.24, dawn 0.15
  assert.deepEqual(
    [17, 22, 6].map((h) => lightingFor(h, 30).tint?.alpha),
    [0.28, 0.24, 0.15],
  );
});

test('lightingFor: window light only 07:00-19:59, lamps only when there is a tint', () => {
  const shaft = (h: number, m: number) => lightingFor(h, m).windowShaft > 0;
  assert.equal(shaft(6, 59), false);
  assert.equal(shaft(7, 0), true);
  assert.equal(shaft(19, 59), true);
  assert.equal(shaft(20, 0), false);

  const lamp = (h: number, m: number) => lightingFor(h, m).lampGlow > 0;
  assert.equal(lamp(12, 0), false, 'plain daylight');
  assert.equal(lamp(6, 30), true, 'dawn');
  assert.equal(lamp(17, 0), true, 'golden hour');
  assert.equal(lamp(22, 0), true, 'night');

  // Screens read brightest in the dark and are still lit by day.
  assert.ok(lightingFor(22, 0).monitorGlow > lightingFor(17, 0).monitorGlow);
  assert.ok(lightingFor(17, 0).monitorGlow > lightingFor(12, 0).monitorGlow);
  assert.ok(lightingFor(12, 0).monitorGlow > 0);
});

test('HUD clock: zero-padded local time, sun until the golden hour ends', () => {
  assert.equal(clockLabel(7, 5), '07:05');
  assert.equal(clockLabel(18, 40), '18:40');
  assert.equal(isDaytime(6, 0), true);
  assert.equal(isDaytime(19, 59), true);
  assert.equal(isDaytime(20, 0), false);
  assert.equal(isDaytime(5, 59), false);
});

// zoom 2 -> a tile is 32 device px; the map starts at (10, 20) and is 10 x 8 tiles.
const BASE = {
  zoom: 2,
  offsetX: 10,
  offsetY: 20,
  cols: 10,
  rows: 8,
  fixtures: { lamps: [], windows: [] },
  enabled: true,
  lighting: lightingFor(12, 0),
};
const seat = (col: number, row: number, facing: Direction, active = true): GlowSource => ({
  seatCol: col,
  seatRow: row,
  facing,
  active,
});
const rectOf = (d: GlowDraw) => ({ x: d.x, y: d.y, w: d.w, h: d.h, sx: d.sx, sy: d.sy });

test('glowDraws: a DOWN-facing agent is lit on the seat tile, half a tile low, never above the seat row', () => {
  const [d, ...rest] = glowDraws({ ...BASE, sources: [seat(3, 2, Direction.DOWN)] });
  assert.equal(rest.length, 0);
  assert.equal(d.kind, 'monitor');
  // centre (122, 116), radius 64: the 52..180 square is cut at the seat row's top edge (y 84)
  assert.deepEqual(rectOf(d), { x: 58, y: 84, w: 128, h: 96, sx: 0, sy: 32 });
});

test('glowDraws: an UP-facing agent is lit on the desk it faces, half a tile low', () => {
  const [d] = glowDraws({ ...BASE, sources: [seat(3, 5, Direction.UP)] });
  // desk tile (3,4): centre (122, 180); the square starts at 116 and is cut at the desk row's top (148)
  assert.deepEqual(rectOf(d), { x: 58, y: 148, w: 128, h: 96, sx: 0, sy: 32 });
});

test('glowDraws: idle agents, a disabled setting and zero-strength kinds draw nothing', () => {
  const sources = [seat(3, 2, Direction.DOWN, false)];
  assert.deepEqual(glowDraws({ ...BASE, sources }), []);
  assert.deepEqual(
    glowDraws({ ...BASE, sources: [seat(3, 2, Direction.DOWN)], enabled: false }),
    [],
  );
  const noon = { ...BASE, sources: [], fixtures: { lamps: [{ col: 5, row: 3 }], windows: [] } };
  assert.deepEqual(glowDraws(noon), [], 'lamps are off in plain daylight');
});

test('glowDraws: window light and lamp glow have their own anchors', () => {
  const golden = lightingFor(17, 0);
  const draws = glowDraws({
    ...BASE,
    lighting: golden,
    sources: [],
    fixtures: { lamps: [{ col: 5, row: 3 }], windows: [{ col: 2, row: 0 }] },
  });
  const lamp = draws.find((d) => d.kind === 'lamp')!;
  // head centre (186, 20 + 96 + 12 = 128), radius 80
  assert.deepEqual(rectOf(lamp), { x: 106, y: 48, w: 160, h: 160, sx: 0, sy: 0 });
  const shaft = draws.find((d) => d.kind === 'shaft')!;
  // under the 2x2 window (bottom edge y 84), 3 tiles wide centred on it, 4 tiles long
  assert.deepEqual(rectOf(shaft), { x: 58, y: 84, w: 96, h: 128, sx: 0, sy: 0 });
});

test('glowDraws: every rect is inside the map and monitor glows stay below their pod top', () => {
  const golden = lightingFor(17, 0);
  const sources: GlowSource[] = [];
  for (let col = 0; col < BASE.cols; col++) {
    for (const row of [0, 1, 4, 7]) {
      sources.push(seat(col, row, Direction.DOWN), seat(col, row, Direction.UP));
    }
  }
  const draws = glowDraws({
    ...BASE,
    lighting: golden,
    sources,
    fixtures: {
      lamps: [
        { col: 0, row: 0 },
        { col: 9, row: 6 },
      ],
      windows: [{ col: 8, row: 5 }],
    },
  });
  assert.ok(draws.length > sources.length);
  const s = 32;
  for (const d of draws) {
    assert.ok(d.x >= BASE.offsetX && d.y >= BASE.offsetY, `${d.kind} starts inside the map`);
    assert.ok(d.x + d.w <= BASE.offsetX + BASE.cols * s, `${d.kind} ends inside (x)`);
    assert.ok(d.y + d.h <= BASE.offsetY + BASE.rows * s, `${d.kind} ends inside (y)`);
    assert.ok(d.sx >= 0 && d.sy >= 0 && d.w > 0 && d.h > 0);
  }
  // A seat on row 4 facing UP looks at row 3: nothing lights row 2 or the wall rows above it.
  const up = glowDraws({ ...BASE, sources: [seat(4, 4, Direction.UP)] });
  assert.ok(up.every((d) => d.y >= BASE.offsetY + 3 * s));
});

test('glow cache: one sprite per (kind, zoom)', () => {
  let built = 0;
  const cache = createGlowCache((kind, zoom) => ({ kind, zoom, id: ++built }));
  const a = cache.get('monitor', 3);
  assert.equal(cache.get('monitor', 3), a, 'same key, same object');
  assert.notEqual(cache.get('monitor', 4), a, 'a zoom change builds a new sprite');
  assert.notEqual(cache.get('lamp', 3), a, 'so does another kind');
  assert.equal(built, 3);
});

test('monitorSources: seated working agents light their screen, sub-agents and the unseated do not', () => {
  const seats = new Map([['s1', { seatCol: 4, seatRow: 2, facingDir: Direction.UP }]]);
  const ch = (patch: Record<string, unknown>) => ({
    seatId: 's1',
    state: CharacterState.TYPE,
    isActive: true,
    isSubagent: false,
    ...patch,
  });
  assert.deepEqual(monitorSources([ch({})], seats), [
    { seatCol: 4, seatRow: 2, facing: Direction.UP, active: true },
  ]);
  assert.equal(monitorSources([ch({ state: CharacterState.IDLE })], seats)[0].active, false);
  assert.equal(monitorSources([ch({ isActive: false })], seats)[0].active, false);
  assert.deepEqual(monitorSources([ch({ isSubagent: true }), ch({ seatId: null })], seats), []);
});

test('lightFixtures: finds windows and floor lamps by furniture id', () => {
  const found = lightFixtures([
    { type: 'WINDOW', col: 2, row: 0 },
    { type: 'FLOOR_LAMP', col: 5, row: 3 },
    { type: 'PLANT', col: 1, row: 1 },
  ]);
  assert.deepEqual(found, {
    lamps: [{ col: 5, row: 3 }],
    windows: [{ col: 2, row: 0 }],
  });
});
