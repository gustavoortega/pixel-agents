/**
 * Walking keeps wall time at any frame rate: the loop steps 60 times a second on a fast display,
 * 30 under its cap, and the ground covered must not depend on which.
 *
 * Run with: npm test
 */
import { beforeAll, describe, expect, it } from 'vitest';

import { OfficeState } from '../src/office/engine/officeState.js';
import { createPet, updatePet } from '../src/office/engine/petEntity.js';
import type { OfficeLayout, PetBed, TileType as TileTypeVal } from '../src/office/types.js';
import { PetState, TILE_SIZE, TileType } from '../src/office/types.js';
import { loadRealAssets } from './realAssets.js';

const COLS = 14;
const ROWS = 3;
/** `tiles` tiles east along row 1, from column 1. */
const eastPath = (tiles: number) =>
  Array.from({ length: tiles }, (_, i) => ({ col: 2 + i, row: 1 }));

beforeAll(loadRealAssets);

interface Walk {
  walker: { path: unknown[]; x: number; y: number };
  step: (dt: number) => void;
}

function character(tiles: number): Walk {
  const os = new OfficeState({
    version: 1,
    cols: COLS,
    rows: ROWS,
    tiles: new Array(COLS * ROWS).fill(TileType.FLOOR_1),
    furniture: [],
  } as OfficeLayout);
  // No chairs: the idle agent stands where it is put, at the path's start.
  os.addAgent(1, 0, 0, undefined, true, undefined, undefined, false);
  const ch = os.characters.get(1)!;
  Object.assign(ch, { tileCol: 1, tileRow: 1, x: 1.5 * TILE_SIZE, y: 1.5 * TILE_SIZE });
  if (!os.walkToTile(1, 1 + tiles, 1) || ch.path.length !== tiles)
    throw new Error('no straight walk');
  return { walker: ch, step: (dt) => os.update(dt) };
}

function openFloor() {
  const tileMap: TileTypeVal[][] = Array.from({ length: ROWS }, () =>
    new Array<TileTypeVal>(COLS).fill(TileType.FLOOR_1 as TileTypeVal),
  );
  const walkable = tileMap.flatMap((row, r) => row.map((_, c) => ({ col: c, row: r })));
  return { tileMap, walkable };
}

function pet(tiles: number): Walk {
  const { tileMap, walkable } = openFloor();
  const p = createPet('cat', 0, 1, 1);
  p.state = PetState.WALK;
  p.path = eastPath(tiles);
  return {
    walker: p,
    step: (dt) => updatePet(p, dt, walkable, new Map(), tileMap, new Set()),
  };
}

/** A pet at bedtime, `tiles` tiles west of the cell beside its cushion: it paths there itself. */
function petToBed(tiles: number): Walk {
  const { tileMap, walkable } = openFloor();
  const p = createPet('cat', 0, 1, 1);
  const bed: PetBed = {
    seatId: 'sofa',
    approach: { col: 1 + tiles, row: 1 },
    cushion: { col: 2 + tiles, row: 1 },
  };
  return {
    walker: p,
    step: (dt) =>
      updatePet(p, dt, walkable, new Map(), tileMap, new Set(), undefined, { kind: 'bed', bed }),
  };
}

function walkAt(start: Walk, hz: number, seconds: number): Walk['walker'] {
  const steps = Math.round(seconds * hz);
  if (Math.abs(steps - seconds * hz) > 1e-9) {
    throw new Error(`${seconds} s is not a whole number of ${hz} Hz steps`);
  }
  for (let i = 0; i < steps; i++) start.step(1 / hz);
  return start.walker;
}

describe('walking at 30 and 60 Hz', () => {
  // Each walk ends mid-tile (3 tiles/s for an agent, 2 for a pet), so float drift can never leave
  // one rate a tile behind the other. A frame-count walk loses part of a step at every tile, and
  // the pet's slower step loses less, so its walk is longer.
  it.each([
    { name: 'agent', start: character, tiles: 6, seconds: 1.5 },
    { name: 'pet', start: pet, tiles: 10, seconds: 4.2 },
    { name: 'pet heading to bed', start: petToBed, tiles: 10, seconds: 4.2 },
  ])('a walking $name is on the same tile and spot at either rate', ({ start, tiles, seconds }) => {
    const fast = walkAt(start(tiles), 60, seconds);
    const capped = walkAt(start(tiles), 30, seconds);
    expect(fast.path.length).toBeGreaterThan(0);
    expect(capped.path.length).toBe(fast.path.length);
    expect(Math.abs(fast.x - capped.x) + Math.abs(fast.y - capped.y)).toBeLessThanOrEqual(2);
  });
});
