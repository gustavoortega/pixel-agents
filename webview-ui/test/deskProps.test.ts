/**
 * Level props on the desk: the unlock table and the slots that keep them off the PC and the
 * companion's cell.
 */
import { describe, expect, it } from 'vitest';

import { deskSlots, pcForSeat, propPlacements } from '../src/office/flair/deskProps.js';
import { Direction } from '../src/office/types.js';

describe('desk prop unlocks', () => {
  // Enough slots that none is dropped, so the placements are exactly what the level unlocks.
  const ampleSlots = [0, 1, 2, 3].map((col) => ({ col, row: 3 }));
  it.each([
    [0, []],
    [4, []],
    [5, ['plant']],
    [9, ['plant']],
    [10, ['plant', 'lamp']],
    [15, ['lamp', 'photo']],
    [20, ['photo', 'trophy']],
    [99, ['photo', 'trophy']],
  ])('level %i', (level, kinds) => {
    expect(propPlacements(level, ampleSlots).map((p) => p.kind)).toEqual(kinds);
  });
});

describe('deskSlots', () => {
  const pc = { col: 5, row: 3 };
  const across = { col: 1, row: 0 };
  const desk = (cols: number[]) => new Map(cols.map((c) => [`${c},3`, 48]));

  it('never offers the PC, and runs nearest first, left before right', () => {
    const slots = deskSlots({
      pc,
      across,
      deskTiles: desk([2, 3, 4, 5, 6, 7, 8]),
      electronicsTiles: new Set(['5,3']),
    });
    const keys = slots.map((t) => `${t.col},${t.row}`);
    expect(keys).not.toContain('5,3');
    expect(keys).toEqual(['4,3', '6,3', '3,3', '7,3', '2,3', '8,3']);
  });

  it('skips cells that are not desk, other electronics and blocked cells', () => {
    const slots = deskSlots({
      pc,
      across,
      deskTiles: desk([4, 7, 3]),
      electronicsTiles: new Set(['5,3', '3,3']),
      blocked: new Set(['7,3']),
    });
    expect(slots).toEqual([{ col: 4, row: 3 }]);
  });

  it('never offers the cell in front of a face-on seat (layout v7 pod: seat beside the PC)', () => {
    // Seat at (4, 3) faces down over the desk; the PC sits one column to its right.
    const slots = deskSlots({
      pc,
      across,
      deskTiles: desk([3, 4, 5]),
      electronicsTiles: new Set(['5,3']),
      seat: { col: 4, row: 3 },
    });
    expect(slots).toEqual([{ col: 3, row: 3 }]);
  });
});

describe('propPlacements', () => {
  const slots = [
    { col: 4, row: 3 },
    { col: 3, row: 3 },
  ];
  it('puts the unlocks in slot order', () => {
    expect(propPlacements(20, slots)).toEqual([
      { kind: 'photo', tile: slots[0] },
      { kind: 'trophy', tile: slots[1] },
    ]);
  });
  it('with one slot shows only the latest', () => {
    expect(propPlacements(20, slots.slice(0, 1))).toEqual([{ kind: 'trophy', tile: slots[0] }]);
  });
  it('no slot, no prop', () => {
    expect(propPlacements(20, [])).toEqual([]);
  });
});

describe('pcForSeat', () => {
  const tiles = (col: number, row: number) => [
    { col, row },
    { col, row: row + 1 },
  ];
  // A layout v7 pod at c=1, r=3: face-on seat (2,4), PC_BACK (3,4); desk B's PC_FRONT (2,6); back-view seat (2,8).
  const seats = [
    { uid: 'chair-a', col: 2, row: 4, facing: Direction.DOWN },
    { uid: 'chair-b', col: 2, row: 8, facing: Direction.UP },
  ];
  const pcs = [
    { uid: 'pc-a', orientation: 'back', tiles: tiles(3, 4) },
    { uid: 'pc-b', orientation: 'front', tiles: tiles(2, 6) },
  ];

  it('gives the face-on seat its own PC_BACK, never the opposite desk, and the back-view seat its PC_FRONT', () => {
    const m = pcForSeat(seats, pcs);
    expect(m.get('chair-a')).toBe('pc-a');
    expect(m.get('chair-b')).toBe('pc-b');
  });

  it('a seat whose only nearby PC faces the wrong way has none', () => {
    expect(pcForSeat([seats[0]], [pcs[1]]).size).toBe(0);
  });

  it('takes the nearest PC, ties to the lower column', () => {
    const near = [
      { uid: 'right', orientation: 'back', tiles: tiles(3, 4) },
      { uid: 'left', orientation: 'back', tiles: tiles(1, 4) },
    ];
    expect(pcForSeat([seats[0]], near).get('chair-a')).toBe('left');
  });
});
