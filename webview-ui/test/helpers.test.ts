/**
 * Helpers (sub-agents): they look like the parent's gray cousin, take a free desk seat in the
 * parent's room (or stand clear of the parent), and a saved seat outside the folder's mapped
 * rooms is not honoured.
 */
import { beforeAll, describe, expect, it } from 'vitest';

import { HUE_LOCKED } from '../../core/src/assets/skinTones.js';
import { characterAnimation } from '../src/office/engine/characters.js';
import { OfficeState } from '../src/office/engine/officeState.js';
import { seatedBubbleOffsetPx, seatedDrawOffsetPx } from '../src/office/seatDraw.js';
import { getCharacterSprites } from '../src/office/sprites/spriteData.js';
import type { OfficeLayout, PlacedFurniture } from '../src/office/types.js';
import { Direction, TileType } from '../src/office/types.js';
import { loadRealAssets } from './realAssets.js';

beforeAll(loadRealAssets);

const COLS = 12;
const ROWS = 8;

/** Two rooms side by side: A is columns 0-5, B is columns 6-11. */
function office(furniture: PlacedFurniture[]): OfficeState {
  const areaTiles = Array.from({ length: COLS * ROWS }, (_, i) => (i % COLS < 6 ? 'A' : 'B'));
  return new OfficeState({
    version: 1,
    cols: COLS,
    rows: ROWS,
    tiles: new Array(COLS * ROWS).fill(TileType.FLOOR_1),
    furniture,
    areaTiles,
  } as OfficeLayout);
}

const chair = (uid: string, col: number, row: number): PlacedFurniture => ({
  uid,
  type: 'CUSHIONED_CHAIR_FRONT',
  col,
  row,
});

function saturation(px: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(px.slice(i, i + 2), 16));
  const max = Math.max(r, g, b);
  return max === 0 ? 0 : (max - Math.min(r, g, b)) / max;
}

describe('helper look', () => {
  it('keeps the parent face and washes hair and outfit to gray, without touching the parent sheet', () => {
    for (let n = 0; n < 12; n++) {
      const parentBefore = getCharacterSprites(n, 0).walk[Direction.DOWN][1];
      const helper = getCharacterSprites(n, 0, true).walk[Direction.DOWN][1];
      let satParent = 0;
      let satHelper = 0;
      let skin = 0;
      parentBefore.forEach((row, y) =>
        row.forEach((px, x) => {
          if (px === '') return;
          if (HUE_LOCKED.has(px)) {
            skin++;
            expect(helper[y][x], `char_${n} skin at ${x},${y}`).toBe(px);
          } else {
            satParent += saturation(px);
            satHelper += saturation(helper[y][x]);
          }
        }),
      );
      expect(skin, `char_${n} has skin`).toBeGreaterThan(0);
      expect(satHelper, `char_${n} is grayer than its parent`).toBeLessThan(satParent * 0.6);
      expect(getCharacterSprites(n, 0).walk[Direction.DOWN][1]).toBe(parentBefore);
    }
  });
});

describe('helper placement', () => {
  it('takes the nearest free seat in the parent room, not a nearer one in another room', () => {
    // Parent at (5,3) in room A. Room B's seat (6,3) is one tile away, room A's free seat is four.
    const os = office([chair('parent', 5, 3), chair('a-free', 1, 3), chair('b-near', 6, 3)]);
    os.addAgent(1, 0, 0, 'parent', true);
    const subId = os.addSubagent(1, 'tool-1');
    const sub = os.characters.get(subId)!;
    expect(sub.seatId).toBe('a-free');
    expect([sub.tileCol, sub.tileRow]).toEqual([1, 3]);
    expect(os.seats.get('a-free')!.assigned).toBe(true);
  });

  it('with no free seat, stands two or more tiles from the parent and off its column', () => {
    const os = office([chair('parent', 5, 3)]);
    os.addAgent(1, 0, 0, 'parent', true);
    const sub = os.characters.get(os.addSubagent(1, 'tool-1'))!;
    expect(sub.seatId).toBeNull();
    const dist = Math.max(Math.abs(sub.tileCol - 5), Math.abs(sub.tileRow - 3));
    expect(dist).toBeGreaterThanOrEqual(2);
    expect(sub.tileCol).not.toBe(5);
  });
});

describe('a helper with no seat', () => {
  it('stands at work: no sit offset, the standing frame, however long it runs', () => {
    const os = office([chair('parent', 5, 3)]);
    os.addAgent(1, 0, 0, 'parent', true);
    const sub = os.characters.get(os.addSubagent(1, 'tool-1'))!;
    os.setAgentActive(sub.id, true);
    for (let i = 0; i < 40; i++) os.update(0.1);
    expect(sub.seatId).toBeNull();
    expect(sub.isActive).toBe(true);
    expect(seatedDrawOffsetPx(sub)).toBe(0);
    expect(seatedBubbleOffsetPx(sub)).toBe(0);
    expect(characterAnimation(sub)).toEqual({ set: 'walk', index: 1 });
  });
});

describe('a saved seat outside the folder mapped rooms', () => {
  const furniture = [chair('a-seat', 1, 3), chair('b-seat', 8, 3)];

  it('is not honoured: the agent gets a seat in its mapped room', () => {
    const os = office(furniture);
    os.setAreaMappings({ research: ['A'] });
    os.addAgent(1, 0, 0, 'b-seat', true, 'research');
    expect(os.seatZone(os.characters.get(1)!.seatId!)).toBe('A');
  });

  it('stands when the folder has no mapping (manual placement)', () => {
    const os = office(furniture);
    os.addAgent(1, 0, 0, 'b-seat', true, 'unmapped');
    expect(os.characters.get(1)!.seatId).toBe('b-seat');
  });
});
