/**
 * Level props on the desk: the unlock table and the slots that keep them off the PC and the
 * companion's cell.
 */
import { describe, expect, it } from 'vitest';

import {
  companionDeskTile,
  deskSlots,
  propPlacements,
  unlockProps,
} from '../src/office/flair/deskProps.js';

describe('unlockProps', () => {
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
    expect(unlockProps(level)).toEqual(kinds);
  });
});

describe('deskSlots', () => {
  const pc = { col: 5, row: 3 };
  const across = { col: 1, row: 0 };
  const desk = (cols: number[]) => new Map(cols.map((c) => [`${c},3`, 48]));

  it('never offers the PC or the companion cell', () => {
    const slots = deskSlots({
      pc,
      across,
      deskTiles: desk([2, 3, 4, 5, 6, 7, 8]),
      electronicsTiles: new Set(['5,3']),
    });
    const keys = slots.map((t) => `${t.col},${t.row}`);
    expect(keys).not.toContain('5,3');
    expect(keys).not.toContain(`${companionDeskTile(pc).col},3`);
    expect(keys).toEqual(['4,3', '3,3', '7,3', '2,3', '8,3']);
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
