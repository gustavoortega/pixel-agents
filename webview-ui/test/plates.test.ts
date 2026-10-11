/**
 * Plates scale with the zoom relative to the whole-map fit, and drop their title line when small.
 *
 * Run with: npm test
 */

import { describe, expect, it } from 'vitest';

import { plateAnchorAboveY, plateScale, plateShowsTitle } from '../src/office/nameplate.js';

describe('plateScale', () => {
  it.each([
    [3, 3, 1], // at the whole-map fit a plate is its authored size
    [6, 3, 1.5], // twice the fit zoom is capped
    [10, 3, 1.5],
    [1, 3, 0.6], // far out is floored
    [4, 3, 4 / 3],
    [2, 3, 2 / 3],
  ])('zoom %i against fit %i -> %f', (zoom, fit, expected) => {
    expect(plateScale(zoom, fit)).toBeCloseTo(expected, 10);
  });

  it('shows the title line only at full size or bigger', () => {
    expect(plateShowsTitle(plateScale(2, 3))).toBe(false);
    expect(plateShowsTitle(plateScale(3, 3))).toBe(true);
    expect(plateShowsTitle(plateScale(5, 3))).toBe(true);
  });
});

describe('plateAnchorAboveY', () => {
  it('hangs 2 px over the sprite head: tile centre 40, sat at +6, head row 3 of 32', () => {
    // head top = 40 + 6 - 32 + 3 = 17; the plate's bottom edge is 2 px above it
    expect(plateAnchorAboveY(40, 6, false)).toBe(15);
  });

  it('rises by the slot clearance when a bubble or glyph owns the space above the head', () => {
    expect(plateAnchorAboveY(40, 6, true)).toBe(15 - 16);
  });
});
