/**
 * The warm-light pass: time-of-day phases, where the monitor, lamp and window glows land, and
 * the glow sprite cache, and the night lights (floor pools and fairy bulbs).
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
  isNightPhase,
  lightFixtures,
  lightingFor,
  monitorSources,
  nightDarkness,
  nightLightDraws,
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
  // Night has no DOM tint: the canvas darkening is the only darkening (no double dark).
  assert.equal(lightingFor(22, 0).tint, null);
  assert.equal(lightingFor(3, 0).tint, null);
  assert.deepEqual(lightingFor(6, 30).tint, LIGHT_PHASES.dawn.tint);
  assert.equal(lightingFor(12, 0).tint, null);
  // alphas from the spec: golden 0.28, dawn 0.15
  assert.deepEqual(
    [17, 6].map((h) => lightingFor(h, 30).tint?.alpha),
    [0.28, 0.15],
  );
});

test('nightDarkness: 0 by day, 0.42 in the night phase, linear over the 60 min on each side', () => {
  const at = (h: number, m: number) => nightDarkness(h, m);
  const near = (a: number, b: number, msg: string) =>
    assert.ok(Math.abs(a - b) < 1e-9, `${msg}: ${a} vs ${b}`);
  near(at(12, 0), 0, 'noon');
  near(at(19, 0), 0, 'dusk ramp starts');
  near(at(19, 30), 0.21, 'dusk midpoint');
  near(at(20, 0), 0.42, 'night phase starts at full darkness');
  near(at(23, 0), 0.42, 'deep night');
  near(at(5, 59), 0.42, 'last minute of the night phase');
  near(at(6, 0), 0.42, 'dawn ramp starts from full darkness');
  near(at(6, 30), 0.21, 'dawn midpoint');
  near(at(7, 0), 0, 'dawn ramp ends');
  // Never snaps: no minute-to-minute step bigger than one ramp minute, around the clock.
  let prev = at(23, 59);
  for (let t = 0; t < 24 * 60; t++) {
    const cur = at(Math.floor(t / 60), t % 60);
    assert.ok(Math.abs(cur - prev) <= 0.42 / 60 + 1e-9, `snap at minute ${t}`);
    prev = cur;
  }
  // Full darkness throughout lightingFor's night phase, none between the ramps.
  for (let t = 0; t < 24 * 60; t++) {
    const [h, m] = [Math.floor(t / 60), t % 60];
    if (isNightPhase(h, m)) assert.equal(at(h, m), 0.42, `${h}:${m}`);
    else if (t >= 7 * 60 && t <= 19 * 60) assert.equal(at(h, m), 0, `${h}:${m}`);
  }
});

test('lightingFor: lamps only when there is a tint', () => {
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
  fixtures: { lamps: [], fairyLights: [] },
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
  const noon = { ...BASE, sources: [], fixtures: { lamps: [{ col: 5, row: 3 }], fairyLights: [] } };
  assert.deepEqual(glowDraws(noon), [], 'lamps are off in plain daylight');
});

test('glowDraws: the lamp glow is anchored on the lamp head', () => {
  const golden = lightingFor(17, 0);
  const draws = glowDraws({
    ...BASE,
    lighting: golden,
    sources: [],
    fixtures: { lamps: [{ col: 5, row: 3 }], fairyLights: [] },
  });
  const lamp = draws.find((d) => d.kind === 'lamp')!;
  // head centre (186, 20 + 96 + 12 = 128), radius 80
  assert.deepEqual(rectOf(lamp), { x: 106, y: 48, w: 160, h: 160, sx: 0, sy: 0 });
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
      fairyLights: [],
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
    isActive: true,
    isSubagent: false,
    ...patch,
  });
  assert.deepEqual(monitorSources([ch({})], seats), [
    { seatCol: 4, seatRow: 2, facing: Direction.UP, active: true },
  ]);
  // Status truth, not pose: an active agent still walking to its desk keeps the screen lit.
  assert.equal(monitorSources([ch({ state: CharacterState.WALK })], seats)[0].active, true);
  assert.equal(monitorSources([ch({ isActive: false })], seats)[0].active, false);
  assert.deepEqual(monitorSources([ch({ isSubagent: true }), ch({ seatId: null })], seats), []);
});

test('lightFixtures: finds floor lamps and fairy lights by furniture id', () => {
  const found = lightFixtures([
    { type: 'WINDOW', col: 2, row: 0 },
    { type: 'FLOOR_LAMP', col: 5, row: 3 },
    { type: 'PLANT', col: 1, row: 1 },
    { type: 'FAIRY_LIGHTS', col: 9, row: 1 },
  ]);
  assert.deepEqual(found, {
    lamps: [{ col: 5, row: 3 }],
    fairyLights: [{ col: 9, row: 1 }],
  });
});

// ── Night lights ────────────────────────────────────────────────

const NIGHT = {
  zoom: 2,
  offsetX: 10,
  offsetY: 20,
  cols: 10,
  rows: 8,
  enabled: true,
  nowMs: 0,
  strength: 1,
  monitors: [],
  fixtures: { lamps: [], fairyLights: [] },
};
const center = (d: GlowDraw) => ({ x: d.x + d.w / 2, y: d.y + d.h / 2, r: d.w / 2 });

test('nightLightDraws: lamp pool r4, a pool r2.5 one tile below each lit monitor, a 1.5-tile band under each fairy strand', () => {
  const input = {
    ...NIGHT,
    cols: 16,
    rows: 16, // roomy enough that no pool is clipped
    fixtures: { lamps: [{ col: 8, row: 6 }], fairyLights: [{ col: 1, row: 1 }] },
    monitors: [{ col: 2, row: 2 }],
  };
  const { pools } = nightLightDraws(input);
  const [lamp, monitor, band] = pools;
  assert.equal(pools.length, 3);
  // zoom 2: a tile is 32 device px. The lamp base is the middle of its second tile.
  assert.equal(lamp.kind, 'lampPool');
  assert.deepEqual(center(lamp), { x: 10 + 8.5 * 32, y: 20 + 7.5 * 32, r: 4 * 32 });
  assert.equal(monitor.kind, 'monitorPool');
  assert.deepEqual(center(monitor), { x: 10 + 2.5 * 32, y: 20 + 3.5 * 32, r: 2.5 * 32 });
  assert.equal(band.kind, 'fairyBand');
  assert.deepEqual({ x: band.x, w: band.w, h: band.h }, { x: 10 + 1 * 32, w: 4 * 32, h: 1.5 * 32 });
  assert.equal(band.y, 20 + 1.5 * 32, 'starts half a tile under the strand top');
  assert.deepEqual(nightLightDraws({ ...input, enabled: false }), { pools: [], fairy: [] });
});

test('nightLightDraws: a monitor that is not lit gets no pool, and the pools fade with the darkening strength', () => {
  const fixtures = { lamps: [{ col: 5, row: 3 }], fairyLights: [] };
  const none = nightLightDraws({ ...NIGHT, fixtures, monitors: [] }).pools;
  assert.deepEqual(
    none.map((d) => d.kind),
    ['lampPool'],
  );
  const half = nightLightDraws({ ...NIGHT, fixtures, strength: 0.5 }).pools;
  assert.equal(half[0].alpha, 0.5);
  assert.deepEqual(nightLightDraws({ ...NIGHT, fixtures, strength: 0 }), { pools: [], fairy: [] });
});

test('nightLightDraws: fairy bulbs glow where the strand hangs, and each twinkles on its own 1.8 s beat', () => {
  const at = (col: number, row: number, nowMs = 0) =>
    nightLightDraws({
      ...NIGHT,
      nowMs,
      fixtures: { lamps: [], fairyLights: [{ col, row }] },
    }).fairy;
  const here = at(1, 1);
  const moved = at(4, 5);
  assert.equal(here.length, 8, 'one glow per bulb');
  // Moving the strand moves every glow by the same tiles (32 device px each).
  here.forEach((d, i) => {
    assert.deepEqual(
      { x: center(moved[i]).x - center(d).x, y: center(moved[i]).y - center(d).y },
      { x: 3 * 32, y: 4 * 32 },
    );
  });
  // Bulbs hang 8 world px apart.
  for (let i = 1; i < here.length; i++) assert.equal(center(here[i]).x - center(here[i - 1]).x, 16);
  // Same strength one period later, different strengths across bulbs at one instant.
  const later = at(1, 1, 1800);
  here.forEach((d, i) => assert.ok(Math.abs(d.alpha - later[i].alpha) < 1e-9));
  for (const t of [0, 450, 900]) {
    const alphas = at(1, 1, t).map((d) => d.alpha);
    assert.ok(new Set(alphas.map((a) => a.toFixed(3))).size > 4, `bulbs out of step at ${t} ms`);
    assert.ok(alphas.every((a) => a >= 0.35 - 1e-9 && a <= 1 + 1e-9));
  }
  const mid = at(1, 1, 900).map((d) => d.alpha);
  assert.ok(
    here.some((d, i) => Math.abs(d.alpha - mid[i]) > 0.1),
    'the bulbs change within a beat',
  );
  assert.deepEqual(
    nightLightDraws({
      ...NIGHT,
      strength: 0,
      fixtures: { lamps: [], fairyLights: [{ col: 1, row: 1 }] },
    }).fairy,
    [],
  );
});
