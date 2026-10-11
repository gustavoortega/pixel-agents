/**
 * One companion per room: the hero ranking, and the hero's companion sitting on its desk.
 */
import { describe, expect, it } from 'vitest';

import { createCharacter } from '../src/office/engine/characters.js';
import { OfficeState } from '../src/office/engine/officeState.js';
import { type HeroCandidate, heroPerRoom } from '../src/office/flair/hero.js';
import { buildDynamicCatalog } from '../src/office/layout/furnitureCatalog.js';
import type { OfficeLayout } from '../src/office/types.js';
import { TILE_SIZE, TileType } from '../src/office/types.js';

const cand = (id: number, room: string | null, level: number, activeAt = 0): HeroCandidate => ({
  id,
  room,
  level,
  activeAt,
});

describe('heroPerRoom', () => {
  it('picks the highest level in each room', () => {
    const heroes = heroPerRoom([
      cand(1, 'A', 3),
      cand(2, 'A', 7),
      cand(3, 'B', 1),
      cand(4, 'B', 1),
    ]);
    expect([...heroes].sort()).toEqual([2, 3]);
  });

  it('breaks a level tie by most recent activity, then lowest id', () => {
    expect([...heroPerRoom([cand(1, 'A', 4, 10), cand(2, 'A', 4, 20)])]).toEqual([2]);
    expect([...heroPerRoom([cand(5, 'A', 4, 10), cand(2, 'A', 4, 10)])]).toEqual([2]);
  });

  it('treats agents outside every area as one room', () => {
    expect([...heroPerRoom([cand(1, null, 2), cand(2, null, 9)])]).toEqual([2]);
  });
});

describe('OfficeState hero companion', () => {
  const sprite = (w: number, h: number) => Array.from({ length: h }, () => new Array(w).fill(''));
  const entry = (id: string, category: string, w: number, h: number, extra = {}) => ({
    id,
    label: id,
    category,
    width: w * TILE_SIZE,
    height: h * TILE_SIZE,
    footprintW: w,
    footprintH: h,
    isDesk: category === 'desks',
    orientation: 'front',
    ...extra,
  });

  // Desk on cols 2-4 rows 2-3, the monitor on its first column, a chair above facing down.
  function office(): OfficeState {
    buildDynamicCatalog({
      catalog: [
        entry('DESK_FRONT', 'desks', 3, 2, { backgroundTiles: 1 }),
        // A seat facing down meets a PC shown from behind.
        entry('PC_FRONT_OFF', 'electronics', 1, 2, {
          orientation: 'back',
          backgroundTiles: 1,
          canPlaceOnSurfaces: true,
        }),
        entry('CHAIR_FRONT', 'chairs', 1, 1),
      ],
      sprites: {
        DESK_FRONT: sprite(48, 32),
        PC_FRONT_OFF: sprite(16, 32),
        CHAIR_FRONT: sprite(16, 16),
      },
    });
    const cols = 8;
    const rows = 6;
    const layout = {
      version: 1,
      cols,
      rows,
      tiles: new Array(cols * rows).fill(TileType.FLOOR_1),
      furniture: [
        { uid: 'desk', type: 'DESK_FRONT', col: 2, row: 2 },
        { uid: 'pc', type: 'PC_FRONT_OFF', col: 2, row: 2 },
        { uid: 'chair', type: 'CHAIR_FRONT', col: 2, row: 1 },
      ],
    } as OfficeLayout;
    return new OfficeState(layout);
  }

  function addAgent(os: OfficeState, id: number, level: number, seatId: string | null): void {
    const seat = seatId ? os.seats.get(seatId)! : null;
    const ch = createCharacter(id, 0, seatId, seat);
    if (!seat) {
      ch.tileCol = 6;
      ch.tileRow = 4;
      ch.x = 6 * TILE_SIZE + TILE_SIZE / 2;
      ch.y = 4 * TILE_SIZE + TILE_SIZE / 2;
    }
    os.characters.set(id, ch);
    os.setAgentModel(id, 'm', 3);
    os.setRoster(id, {
      memberId: `m${id}`,
      name: `a${id}`,
      level,
      xp: 0,
      xpToNext: 10,
      streak: 0,
      mood: 'neutral',
    });
  }

  it('keeps the companion of the room hero only', () => {
    const os = office();
    addAgent(os, 1, 2, 'chair');
    addAgent(os, 2, 9, null);
    os.update(0.016);
    expect(os.companions.has(2)).toBe(true);
    expect(os.companions.has(1)).toBe(false);
  });

  it('puts a seated hero companion on its desk, on the first free cell beside the monitor', () => {
    const os = office();
    addAgent(os, 1, 5, 'chair');
    addAgent(os, 2, 1, null);
    os.update(0.016);
    const c = os.companions.get(1)!;
    expect([Math.floor(c.x / TILE_SIZE), Math.floor(c.y / TILE_SIZE)]).toEqual([3, 2]);
    expect(c.deskZY).not.toBeNull();
  });
});
