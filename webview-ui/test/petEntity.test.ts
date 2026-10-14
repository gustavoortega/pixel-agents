/**
 * Unit tests for the Pet FSM.
 *
 * Covers:
 *   - createPet initial state
 *   - IDLE → WALK transition (wanderTimer expiry + findPath succeeds)
 *   - IDLE → FOLLOW transition (when character nearby and roll succeeds)
 *   - WALK → IDLE on path exhaustion (resets frameTimer)
 *   - FOLLOW → IDLE when target despawns
 *   - FOLLOW → IDLE when duration limit reached
 *   - FOLLOW → IDLE when target reached (Manhattan distance ≤ 1)
 *   - Animation timer increments
 *   - Defensive: empty walkableTiles, etc.
 *   - In an office: the sunniest cell by day, a sofa cushion at night when nobody works
 *
 * Run with: npm test
 */

import assert from 'node:assert/strict';

import { afterEach, beforeEach, test, vi } from 'vitest';

import {
  PET_FOLLOW_DURATION_MAX_SEC,
  PET_WALK_FRAME_DURATION_SEC,
  PET_WANDER_PAUSE_MAX_SEC,
} from '../src/constants.js';
import { OfficeState } from '../src/office/engine/officeState.js';
import { createPet, updatePet } from '../src/office/engine/petEntity.js';
import type { Character, OfficeLayout, Pet, TileType as TileTypeVal } from '../src/office/types.js';
import {
  CharacterState,
  Direction,
  IdlePose,
  PetState,
  TileType,
  WorkStatus,
} from '../src/office/types.js';
import { loadRealAssets } from './realAssets.js';

// ── Helpers ────────────────────────────────────────────────────

/** Build an all-FLOOR tile map of given dimensions. */
function buildOpenTileMap(cols: number, rows: number): TileTypeVal[][] {
  const map: TileTypeVal[][] = [];
  for (let r = 0; r < rows; r++) {
    const row: TileTypeVal[] = [];
    for (let c = 0; c < cols; c++) {
      row.push(TileType.FLOOR_1 as TileTypeVal);
    }
    map.push(row);
  }
  return map;
}

/** Build the walkableTiles index for a fully-open tileMap. */
function buildWalkableTiles(cols: number, rows: number): Array<{ col: number; row: number }> {
  const tiles: Array<{ col: number; row: number }> = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      tiles.push({ col: c, row: r });
    }
  }
  return tiles;
}

/** Create a minimal Character stub (only fields the FSM reads). */
function makeChar(id: number, col: number, row: number): Character {
  return {
    id,
    state: CharacterState.IDLE,
    dir: Direction.DOWN,
    x: col * 16 + 8,
    y: row * 16 + 8,
    tileCol: col,
    tileRow: row,
    path: [],
    moveProgress: 0,
    currentTool: null,
    palette: 0,
    hueShift: 0,
    frame: 0,
    frameTimer: 0,
    wanderTimer: 0,
    wanderCount: 0,
    wanderLimit: 5,
    isActive: false,
    agentStatus: WorkStatus.IDLE,
    pose: IdlePose.READING,
    poseStatus: WorkStatus.IDLE,
    idleSec: 0,
    poseSettleSec: 0,
    poseTickSec: 0,
    poseClockSec: 0,
    coffeeCooldownSec: 0,
    drawSink: 0,
    trip: null,
    seatId: null,
    bubbleType: null,
    bubbleTimer: 0,
    seatTimer: 0,
    isSubagent: false,
    parentAgentId: null,
    matrixEffect: null,
    matrixEffectTimer: 0,
    matrixEffectSeeds: [],
    contextTokens: 0,
    maxContextTokens: 200_000,
  };
}

// Math.random stubbing — single shared mock so we can drive deterministic decisions.
let randomQueue: number[] = [];
const realRandom = Math.random;

beforeEach(() => {
  randomQueue = [];
  Math.random = () => (randomQueue.length > 0 ? randomQueue.shift()! : 0.5);
});

afterEach(() => {
  Math.random = realRandom;
  vi.useRealTimers();
});

// ── createPet ──────────────────────────────────────────────────

test('createPet returns an IDLE pet at the tile center', () => {
  const pet = createPet('p1', 0, 3, 4);
  assert.equal(pet.id, 'p1');
  assert.equal(pet.petType, 0);
  assert.equal(pet.state, PetState.IDLE);
  assert.equal(pet.dir, Direction.DOWN);
  assert.equal(pet.x, 3 * 16 + 8);
  assert.equal(pet.y, 4 * 16 + 8);
  assert.equal(pet.tileCol, 3);
  assert.equal(pet.tileRow, 4);
  assert.deepEqual(pet.path, []);
  assert.equal(pet.moveProgress, 0);
  assert.equal(pet.followTargetId, null);
  assert.equal(pet.bubbleType, null);
  assert.equal(pet.bubbleTimer, 0);
  // wanderTimer is randomized within [PET_WANDER_PAUSE_MIN_SEC, MAX]
  assert.ok(pet.wanderTimer > 0);
  assert.ok(pet.wanderTimer <= PET_WANDER_PAUSE_MAX_SEC);
});

// ── IDLE → WALK ───────────────────────────────────────────────

test('IDLE → WALK after wanderTimer expires (follow roll fails)', () => {
  const tileMap = buildOpenTileMap(5, 5);
  const walkable = buildWalkableTiles(5, 5);
  const pet = createPet('p1', 0, 2, 2);
  pet.wanderTimer = 0.0001;
  // Roll 1: follow check (0.99 > PET_FOLLOW_CHANCE=0.3 → skip follow)
  // Roll 2: pick a random walkable target (Math.floor(0.0 * candidates.length) = first)
  randomQueue = [0.99, 0.0];
  updatePet(pet, 0.1, walkable, new Map(), tileMap, new Set());
  assert.equal(pet.state, PetState.WALK);
  assert.ok(pet.path.length > 0, 'expected non-empty path after IDLE→WALK');
  assert.equal(pet.moveProgress, 0);
  assert.equal(pet.frame, 0);
  assert.equal(pet.frameTimer, 0);
});

test('IDLE stays IDLE when wanderTimer > 0', () => {
  const tileMap = buildOpenTileMap(5, 5);
  const walkable = buildWalkableTiles(5, 5);
  const pet = createPet('p1', 0, 0, 0);
  pet.wanderTimer = 10;
  updatePet(pet, 0.05, walkable, new Map(), tileMap, new Set());
  assert.equal(pet.state, PetState.IDLE);
  assert.ok(pet.wanderTimer < 10, 'wanderTimer should decrement by dt');
});

test('IDLE stays IDLE when walkableTiles is empty', () => {
  const tileMap = buildOpenTileMap(3, 3);
  const pet = createPet('p1', 0, 1, 1);
  pet.wanderTimer = 0;
  randomQueue = [0.99]; // skip follow
  updatePet(pet, 0.1, [], new Map(), tileMap, new Set());
  assert.equal(pet.state, PetState.IDLE);
});

// ── IDLE → FOLLOW ─────────────────────────────────────────────

test('IDLE → FOLLOW when character is nearby and follow roll succeeds', () => {
  const tileMap = buildOpenTileMap(5, 5);
  const walkable = buildWalkableTiles(5, 5);
  const pet = createPet('p1', 0, 2, 2);
  pet.wanderTimer = 0;
  const character = makeChar(42, 3, 3); // distance 2 (≤ PET_FOLLOW_RADIUS_TILES=3)
  const characters = new Map<number, Character>([[character.id, character]]);
  // Roll 1: follow chance (0.0 < 0.3 → enter follow)
  // Roll 2: followDurationLimit randomRange (0.5 → middle)
  randomQueue = [0.0, 0.5];
  updatePet(pet, 0.1, walkable, characters, tileMap, new Set());
  assert.equal(pet.state, PetState.FOLLOW);
  assert.equal(pet.followTargetId, 42);
  assert.equal(pet.followDuration, 0);
  assert.equal(pet.followRecalcTimer, 0);
  assert.ok(
    pet.followDurationLimit > 0 && pet.followDurationLimit <= PET_FOLLOW_DURATION_MAX_SEC,
    'expected followDurationLimit within bounds',
  );
});

test('IDLE does NOT enter FOLLOW when no character is in range', () => {
  const tileMap = buildOpenTileMap(10, 10);
  const walkable = buildWalkableTiles(10, 10);
  const pet = createPet('p1', 0, 0, 0);
  pet.wanderTimer = 0;
  const farChar = makeChar(1, 9, 9); // distance 18, beyond radius 3
  const characters = new Map<number, Character>([[1, farChar]]);
  // Roll 1: 0.0 < 0.3 → check for follow target; none found → falls through to WALK
  randomQueue = [0.0, 0.0];
  updatePet(pet, 0.1, walkable, characters, tileMap, new Set());
  assert.notEqual(pet.state, PetState.FOLLOW);
});

test('IDLE skips despawning characters as follow targets', () => {
  const tileMap = buildOpenTileMap(5, 5);
  const walkable = buildWalkableTiles(5, 5);
  const pet = createPet('p1', 0, 2, 2);
  pet.wanderTimer = 0;
  const character = makeChar(1, 3, 3);
  character.matrixEffect = 'despawn';
  const characters = new Map<number, Character>([[1, character]]);
  randomQueue = [0.0, 0.0]; // would enter follow if target found
  updatePet(pet, 0.1, walkable, characters, tileMap, new Set());
  assert.notEqual(pet.state, PetState.FOLLOW);
});

// ── WALK → IDLE ───────────────────────────────────────────────

test('WALK → IDLE when path exhausted (resets frameTimer)', () => {
  const tileMap = buildOpenTileMap(5, 5);
  const walkable = buildWalkableTiles(5, 5);
  const pet = createPet('p1', 0, 0, 0);
  pet.state = PetState.WALK;
  pet.path = []; // already empty → arrival branch
  pet.moveProgress = 0;
  pet.frameTimer = 0.123;
  updatePet(pet, 0.01, walkable, new Map(), tileMap, new Set());
  assert.equal(pet.state, PetState.IDLE);
  assert.equal(pet.frameTimer, 0, 'frameTimer must reset to 0 on WALK→IDLE');
  assert.equal(pet.frame, 0);
  assert.ok(pet.wanderTimer > 0);
});

test('at bedtime a pet mid-wander finishes only the step under way, then sleeps there', () => {
  const tileMap = buildOpenTileMap(8, 3);
  const walkable = buildWalkableTiles(8, 3);
  const pet = createPet('p1', 0, 1, 1);
  pet.state = PetState.WALK;
  pet.path = [
    { col: 2, row: 1 },
    { col: 3, row: 1 },
    { col: 4, row: 1 },
    { col: 5, row: 1 },
  ];
  // A quarter of the way into its first step when the office goes to sleep (no sofa: no bed).
  updatePet(pet, 0.125, walkable, new Map(), tileMap, new Set());
  assert.ok(pet.moveProgress > 0 && pet.moveProgress < 1);
  for (let tick = 0; tick < 40; tick++) {
    updatePet(pet, 0.1, walkable, new Map(), tileMap, new Set(), undefined, {
      kind: 'bed',
      bed: null,
    });
  }
  assert.equal(pet.state, PetState.SLEEP);
  assert.deepEqual([pet.tileCol, pet.tileRow], [2, 1]);
});

// ── FOLLOW exits ──────────────────────────────────────────────

test('FOLLOW → IDLE when target despawns (no longer in characters map)', () => {
  const tileMap = buildOpenTileMap(5, 5);
  const walkable = buildWalkableTiles(5, 5);
  const pet = createPet('p1', 0, 0, 0);
  pet.state = PetState.FOLLOW;
  pet.followTargetId = 99; // not in map
  pet.followDuration = 0;
  pet.followDurationLimit = 10;
  pet.frameTimer = 0.5;
  updatePet(pet, 0.05, walkable, new Map(), tileMap, new Set());
  assert.equal(pet.state, PetState.IDLE);
  assert.equal(pet.followTargetId, null);
  assert.deepEqual(pet.path, []);
  assert.equal(pet.frameTimer, 0, 'frameTimer reset on FOLLOW→IDLE');
});

test('FOLLOW → IDLE when followDuration >= followDurationLimit', () => {
  const tileMap = buildOpenTileMap(5, 5);
  const walkable = buildWalkableTiles(5, 5);
  const pet = createPet('p1', 0, 0, 0);
  pet.state = PetState.FOLLOW;
  pet.followTargetId = 1;
  pet.followDuration = 10;
  pet.followDurationLimit = 5;
  pet.frameTimer = 0.7;
  const char = makeChar(1, 4, 4);
  const characters = new Map<number, Character>([[1, char]]);
  updatePet(pet, 0.05, walkable, characters, tileMap, new Set());
  assert.equal(pet.state, PetState.IDLE);
  assert.equal(pet.followTargetId, null);
  assert.equal(pet.frameTimer, 0);
});

test('FOLLOW → IDLE when within Manhattan distance 1 of target (faces target)', () => {
  const tileMap = buildOpenTileMap(5, 5);
  const walkable = buildWalkableTiles(5, 5);
  const pet = createPet('p1', 0, 2, 2);
  pet.state = PetState.FOLLOW;
  pet.followTargetId = 7;
  pet.followDuration = 0;
  pet.followDurationLimit = 10;
  pet.frameTimer = 0.4;
  // Target is 1 tile to the right → pet faces RIGHT before settling.
  const char = makeChar(7, 3, 2);
  const characters = new Map<number, Character>([[7, char]]);
  updatePet(pet, 0.05, walkable, characters, tileMap, new Set());
  assert.equal(pet.state, PetState.IDLE);
  assert.equal(pet.dir, Direction.RIGHT, 'should face target before settling');
  assert.equal(pet.frameTimer, 0);
});

// ── Animation timers ─────────────────────────────────────────

test('WALK animation: frameTimer wraps to 0 and frame increments after PET_WALK_FRAME_DURATION_SEC', () => {
  const tileMap = buildOpenTileMap(5, 5);
  const walkable = buildWalkableTiles(5, 5);
  const pet = createPet('p1', 0, 0, 0);
  pet.state = PetState.WALK;
  pet.path = [{ col: 1, row: 0 }]; // 1-tile path so it stays in WALK
  pet.moveProgress = 0;
  pet.frame = 0;
  pet.frameTimer = 0;
  // Run with dt slightly larger than the animation duration
  updatePet(pet, PET_WALK_FRAME_DURATION_SEC + 0.001, walkable, new Map(), tileMap, new Set());
  // frame should have advanced by 1 (4-step cycle).
  assert.equal(pet.frame, 1);
  // frameTimer should be small positive (the leftover after the threshold)
  assert.ok(pet.frameTimer >= 0 && pet.frameTimer < PET_WALK_FRAME_DURATION_SEC);
});

test('IDLE animation ticks while pet is in IDLE state', () => {
  const tileMap = buildOpenTileMap(3, 3);
  const walkable = buildWalkableTiles(3, 3);
  const pet = createPet('p1', 0, 1, 1);
  pet.wanderTimer = 100; // ensures we stay in IDLE, no state transition
  pet.frame = 0;
  pet.frameTimer = 0;
  updatePet(pet, 0.5, walkable, new Map(), tileMap, new Set());
  // frame may or may not have ticked depending on PET_IDLE_FRAME_DURATION_SEC (=0.3)
  // 0.5s > 0.3s → frame increments by 1, frameTimer holds the remainder
  assert.equal(pet.frame, 1);
});

// ── Defensive / edge cases ────────────────────────────────────

test('updatePet does not throw on dt=0', () => {
  const tileMap = buildOpenTileMap(3, 3);
  const walkable = buildWalkableTiles(3, 3);
  const pet = createPet('p1', 0, 1, 1);
  assert.doesNotThrow(() => updatePet(pet, 0, walkable, new Map(), tileMap, new Set()));
});

test('updatePet handles FOLLOW with null followTargetId (defensive: never enter follow without setting id)', () => {
  // Synthetic: FOLLOW state with no target id. Should exit cleanly.
  const tileMap = buildOpenTileMap(3, 3);
  const walkable = buildWalkableTiles(3, 3);
  const pet = createPet('p1', 0, 1, 1);
  pet.state = PetState.FOLLOW;
  pet.followTargetId = null;
  pet.followDurationLimit = 5;
  updatePet(pet, 0.01, walkable, new Map(), tileMap, new Set());
  assert.equal(pet.state, PetState.IDLE, 'no target → exit FOLLOW');
});

// ── Home room ──────────────────────────────────────────────────

test('a pet with a home room stays inside it for 500 ticks, wandering and following', () => {
  // Two rooms side by side: columns 0-9 are room A, 10-19 room B. The pet lives in A, next to
  // the wall, and a character stands in B within follow range the whole time.
  const cols = 20;
  const rows = 6;
  const tileMap = buildOpenTileMap(cols, rows);
  const walkable = buildWalkableTiles(cols, rows);
  const roomAt = (col: number) => (col < 10 ? 'A' : 'B');
  const pet = createPet('p1', 0, 8, 3);
  pet.homeRoom = 'A';
  const characters = new Map<number, Character>([
    [1, makeChar(1, 11, 3)],
    [2, makeChar(2, 4, 1)],
  ]);

  // Deterministic stream so every wander target and follow roll differs tick to tick.
  let seed = 12345;
  Math.random = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };

  const seen = new Set<string>();
  for (let tick = 0; tick < 500; tick++) {
    updatePet(pet, 0.1, walkable, characters, tileMap, new Set(), roomAt);
    assert.equal(roomAt(pet.tileCol), 'A', `tick ${tick}: pet at ${pet.tileCol},${pet.tileRow}`);
    seen.add(`${pet.tileCol},${pet.tileRow}`);
  }
  assert.ok(seen.size > 5, 'the pet did move around its room');
});

// ── In an office: sun by day, the sofa at night ────────────────

/** Local wall clock for OfficeState (only Date is faked; the tick is driven by update(dt)). */
function at(hour: number): void {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 0, 1, hour, 0));
}

function run(os: OfficeState, seconds: number): void {
  for (let t = 0; t < seconds; t += 0.1) os.update(0.1);
}

function adopt(os: OfficeState, col: number, row: number, homeRoom: string): Pet {
  const pet = createPet('cat', 0, col, row);
  pet.homeRoom = homeRoom;
  os.pets.push(pet);
  return pet;
}

test('by day the cat settles on the sunniest cell of its room, where two shafts cross, and stays', () => {
  loadRealAssets();
  at(12);
  // Two windows two tiles apart on the top wall: their 3-wide shafts overlap under the gap. The
  // brightest cell (worked out by hand from the coverage of both parallelograms) is (4, 3); the
  // first cell either shaft lists is (2, 2), on its own.
  const cols = 12;
  const rows = 10;
  const tiles = new Array(cols * rows).fill(TileType.FLOOR_1);
  const areaTiles = new Array<string | null>(cols * rows).fill('A');
  for (let c = 0; c < cols; c++) {
    tiles[c] = tiles[cols + c] = TileType.WALL;
    areaTiles[c] = areaTiles[cols + c] = null;
  }
  const os = new OfficeState({
    version: 1,
    cols,
    rows,
    tiles,
    areaTiles,
    furniture: [
      { uid: 'w1', type: 'WINDOW', col: 2, row: 0 },
      { uid: 'w2', type: 'WINDOW', col: 4, row: 0 },
    ],
  } as OfficeLayout);
  const cat = adopt(os, 9, 8, 'A');
  run(os, 40);
  assert.deepEqual([cat.tileCol, cat.tileRow], [4, 3]);
  run(os, 30);
  assert.deepEqual([cat.tileCol, cat.tileRow], [4, 3], 'it stays in the sun');
});

test('at night with nobody working the cat sleeps on a sofa cushion and stays; work wakes it', () => {
  loadRealAssets();
  at(22);
  const cols = 12;
  const rows = 10;
  const os = new OfficeState({
    version: 1,
    cols,
    rows,
    tiles: new Array(cols * rows).fill(TileType.FLOOR_1),
    furniture: [
      { uid: 'desk', type: 'DESK_FRONT', col: 7, row: 2 },
      { uid: 'chair', type: 'CUSHIONED_CHAIR_FRONT', col: 8, row: 2 },
      { uid: 'sofa', type: 'SOFA_FRONT', col: 3, row: 5 },
    ],
  } as OfficeLayout);
  // An idle agent does not keep the office awake.
  os.addAgent(1, 0, 0, 'chair', true, undefined, undefined, false);
  const cat = adopt(os, 9, 8, '');
  const cushions = [...os.seats.values()]
    .filter((seat) => seat.couch)
    .map((seat) => `${seat.seatCol},${seat.seatRow}`);
  run(os, 40);
  assert.equal(cat.state, PetState.SLEEP);
  assert.ok(
    cushions.includes(`${cat.tileCol},${cat.tileRow}`),
    `on a cushion, not ${cat.tileCol},${cat.tileRow}`,
  );
  const bed = `${cat.tileCol},${cat.tileRow}`;
  run(os, 30);
  assert.equal(cat.state, PetState.SLEEP, 'no wandering while asleep');
  assert.equal(`${cat.tileCol},${cat.tileRow}`, bed);

  os.setAgentActive(1, true);
  run(os, 2);
  assert.notEqual(cat.state, PetState.SLEEP);
  assert.notEqual(`${cat.tileCol},${cat.tileRow}`, bed, 'it stepped off the sofa');
});
