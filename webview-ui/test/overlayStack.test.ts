/**
 * The stack above an agent's head, bottom to top: sprite, plate, tripwire chip, bubble. No two
 * boxes may overlap and none may sit on the head, whatever the mix and wherever the room wall is (a close wall flips the
 * group below the feet).
 */
import { describe, expect, it } from 'vitest';

import type { Rect } from '../src/office/labelLayout.js';
import { stackAbove } from '../src/office/overlayStack.js';

const overlaps = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

const plate = { w: 120, h: 28 };
const chip = { w: 120, h: 18 };
const bubble = { w: 22, h: 26 };
/** Head top at y = 300; the head box is the sprite's top 24 px, 32 px wide. */
const HEAD_TOP = 300;
const head: Rect = { x: 184, y: HEAD_TOP, w: 32, h: 24 };
const FEET = HEAD_TOP + 32;

describe('overlay stack', () => {
  const cases: Array<[string, Parameters<typeof stackAbove>[0]]> = [
    ['plate only', { x: 200, headTop: HEAD_TOP, plate, chip: null, bubble: null }],
    ['plate and bubble', { x: 200, headTop: HEAD_TOP, plate, chip: null, bubble }],
    ['plate and chip', { x: 200, headTop: HEAD_TOP, plate, chip, bubble: null }],
    ['plate, chip and bubble', { x: 200, headTop: HEAD_TOP, plate, chip, bubble }],
    ['pushed up by a neighbour', { x: 200, headTop: HEAD_TOP, plate, chip, bubble, dy: -40 }],
    [
      'wall just above: the group is clamped down as one',
      {
        x: 200,
        headTop: HEAD_TOP,
        plate,
        chip,
        bubble,
        floor: { x: 0, y: 230, w: 400, h: 200 },
        head,
        feetY: FEET,
      },
    ],
  ];

  it.each(cases)('%s: no box overlaps another or the head', (_name, input) => {
    const s = stackAbove(input);
    const boxes = [s.plate, s.chip, s.bubble].filter((r): r is Rect => r !== null);
    for (const [i, a] of boxes.entries()) {
      expect(overlaps(a, head), `box ${i} on the head`).toBe(false);
      for (const b of boxes.slice(i + 1))
        expect(overlaps(a, b), `box ${i} over another`).toBe(false);
    }
  });

  it('orders the boxes bottom to top: plate, then chip, then bubble', () => {
    const s = stackAbove({ x: 200, headTop: HEAD_TOP, plate, chip, bubble });
    expect(s.plate!.y + s.plate!.h).toBeLessThanOrEqual(HEAD_TOP);
    expect(s.chip!.y + s.chip!.h).toBeLessThanOrEqual(s.plate!.y);
    expect(s.bubble!.y + s.bubble!.h).toBeLessThanOrEqual(s.chip!.y);
  });

  it('flips the whole group below the feet, order intact, when the wall would push it onto the head', () => {
    const floor: Rect = { x: 0, y: 230, w: 400, h: 200 };
    const s = stackAbove({
      x: 200,
      headTop: HEAD_TOP,
      plate,
      chip,
      bubble,
      floor,
      head,
      feetY: FEET,
    });
    expect(s.plate!.y).toBeGreaterThanOrEqual(FEET);
    expect(s.chip!.y).toBeGreaterThanOrEqual(s.plate!.y + s.plate!.h);
    expect(s.bubble!.y).toBeGreaterThanOrEqual(s.chip!.y + s.chip!.h);
    expect(s.bubble!.y + s.bubble!.h).toBeLessThanOrEqual(floor.y + floor.h);
  });

  it('keeps above and accepts the clamp when below does not fit either', () => {
    const floor: Rect = { x: 0, y: 230, w: 400, h: 110 };
    const s = stackAbove({
      x: 200,
      headTop: HEAD_TOP,
      plate,
      chip,
      bubble,
      floor,
      head,
      feetY: FEET,
    });
    expect(s.bubble!.y).toBeGreaterThanOrEqual(floor.y);
    expect(s.chip!.y).toBeGreaterThan(s.bubble!.y);
    expect(s.plate!.y).toBeGreaterThan(s.chip!.y);
  });
});
