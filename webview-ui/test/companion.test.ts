/**
 * Companion placement: where the follower of an agent stands, and when it hides.
 */
import { describe, expect, it } from 'vitest';

import { COMPANION_HOVER_PX, COMPANION_TRAIL_LENGTH, TILE_SIZE } from '../src/constants.js';
import { createCharacter } from '../src/office/engine/characters.js';
import { OfficeState } from '../src/office/engine/officeState.js';
import {
  advanceTrail,
  companionHoverOffsetPx,
  companionTile,
  type Tile,
} from '../src/office/flair/companion.js';
import { CompanionKind } from '../src/office/flair/modelFlair.js';
import type { OfficeLayout } from '../src/office/types.js';
import { CharacterState, TileType } from '../src/office/types.js';

const at = (col: number, row: number): Tile => ({ col, row });
const key = (t: Tile) => `${t.col},${t.row}`;
const freeExcept = (...taken: Tile[]) => {
  const blocked = new Set(taken.map(key));
  return (t: Tile) => !blocked.has(key(t));
};

describe('companionTile', () => {
  const agent = at(5, 5);

  it.each([
    ['left first', [], at(4, 5)],
    ['right when left is taken', [at(4, 5)], at(6, 5)],
    ['below when left and right are taken', [at(4, 5), at(6, 5)], at(5, 6)],
  ])('seated: %s', (_name, taken, expected) => {
    expect(
      companionTile({ moving: false, agentTile: agent, trail: [], isFree: freeExcept(...taken) }),
    ).toEqual(expected);
  });

  it('is hidden when left, right and below are all taken (never stacked)', () => {
    const isFree = freeExcept(at(4, 5), at(6, 5), at(5, 6));
    expect(companionTile({ moving: false, agentTile: agent, trail: [], isFree })).toBeNull();
  });

  it('walking: trails on the tile the agent just left, never further back', () => {
    const trail = [at(3, 5), at(2, 5)];
    expect(companionTile({ moving: true, agentTile: at(4, 5), trail, isFree: () => true })).toEqual(
      at(3, 5),
    );
  });

  it('walking: hidden while the tile behind is occupied', () => {
    const trail = [at(3, 5)];
    expect(
      companionTile({ moving: true, agentTile: at(4, 5), trail, isFree: freeExcept(at(3, 5)) }),
    ).toBeNull();
  });

  it('walking with no history yet uses the stationary rule', () => {
    expect(
      companionTile({ moving: true, agentTile: agent, trail: [], isFree: () => true }),
    ).toEqual(at(4, 5));
  });
});

describe('advanceTrail', () => {
  it('records the tile just left, newest first, capped', () => {
    let trail: readonly Tile[] = [];
    trail = advanceTrail(trail, at(1, 1), at(2, 1));
    trail = advanceTrail(trail, at(2, 1), at(3, 1));
    trail = advanceTrail(trail, at(3, 1), at(4, 1));
    expect(trail).toHaveLength(COMPANION_TRAIL_LENGTH);
    expect(trail[0]).toEqual(at(3, 1));
  });

  it('leaves the trail alone while the agent stays on its tile', () => {
    const trail = [at(1, 1)];
    expect(advanceTrail(trail, at(2, 1), at(2, 1))).toBe(trail);
  });
});

describe('companionHoverOffsetPx', () => {
  it('lifts flying kinds by the hover height and leaves walkers on the ground', () => {
    expect(companionHoverOffsetPx(CompanionKind.BIRD, 0)).toBe(-COMPANION_HOVER_PX);
    expect(companionHoverOffsetPx(CompanionKind.DRAGON, 0)).toBe(-COMPANION_HOVER_PX);
    expect(companionHoverOffsetPx(CompanionKind.CAT, 0)).toBe(0);
    expect(companionHoverOffsetPx(CompanionKind.OWL, 0.5)).toBe(0);
  });

  it('bobs a flying companion up by a pixel on alternate beats', () => {
    expect(companionHoverOffsetPx(CompanionKind.BIRD, 0.5)).toBe(-COMPANION_HOVER_PX - 1);
  });
});

describe('OfficeState companions', () => {
  // Column 0 is wall: the left of an agent at col 1 is never free.
  function room(): OfficeState {
    const cols = 6;
    const rows = 3;
    const tiles = Array.from({ length: cols * rows }, (_, i) =>
      i % cols === 0 ? TileType.WALL : TileType.FLOOR_1,
    );
    return new OfficeState({ version: 1, cols, rows, tiles, furniture: [] } as OfficeLayout);
  }

  function seat(os: OfficeState, id: number, col: number, row: number, tier?: 1 | 2 | 3 | 4): void {
    const ch = createCharacter(id, 0, null, null);
    ch.tileCol = col;
    ch.tileRow = row;
    ch.x = col * TILE_SIZE + TILE_SIZE / 2;
    ch.y = row * TILE_SIZE + TILE_SIZE / 2;
    ch.state = CharacterState.TYPE;
    os.characters.set(id, ch);
    os.setAgentModel(id, 'm', tier);
  }

  it('never puts two companions on one tile: the second takes its next free neighbour', () => {
    const os = room();
    // Two rooms, so both agents are heroes: companions are one per room.
    os.getLayout().areaTiles = Array.from({ length: 18 }, (_, i) => (i % 6 < 3 ? 'West' : 'East'));
    seat(os, 1, 1, 1, 3); // left is wall -> takes right (2,1)
    seat(os, 2, 3, 1, 3); // left (2,1) is claimed -> takes right (4,1)
    os.update(0.016);
    const tile = (id: number) => {
      const c = os.companions.get(id)!;
      return `${Math.floor(c.x / TILE_SIZE)},${Math.floor(c.y / TILE_SIZE)}`;
    };
    expect(tile(1)).toBe('2,1');
    expect(tile(2)).toBe('4,1');
  });

  it('hides a companion with no free neighbour and skips agents without a tier', () => {
    const os = room();
    seat(os, 1, 1, 1, 2); // wall left, agent 2 right of it, row 2 below is free...
    seat(os, 2, 2, 1, undefined);
    seat(os, 3, 1, 2, undefined); // ...but a character stands below
    os.update(0.016);
    expect(os.companions.get(1)?.visible).toBe(false);
    expect(os.companions.has(2)).toBe(false);
  });

  it('removes the companion and model with the agent', () => {
    const os = room();
    seat(os, 1, 2, 1, 4);
    os.update(0.016);
    expect(os.companions.has(1)).toBe(true);
    os.removeAgent(1);
    expect(os.companions.has(1)).toBe(false);
    expect(os.models.has(1)).toBe(false);
  });
});
