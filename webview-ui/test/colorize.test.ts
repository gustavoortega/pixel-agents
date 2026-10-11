/**
 * Recolored sprites are memoized per (sprite, color): the canvas cache keys on SpriteData
 * identity, so a fresh array for the same request would rebuild a canvas on every draw.
 *
 * Run with: npm test
 */
import { describe, expect, it } from 'vitest';

import { HUE_LOCKED } from '../../core/src/assets/skinTones.js';
import { getColorizedSprite, getHueLockedSprite } from '../src/office/colorize.js';
import type { SpriteData } from '../src/office/types.js';

const hex = (...bytes: number[]) =>
  `#${bytes.map((v) => v.toString(16).padStart(2, '0')).join('')}`.toUpperCase();

const SPRITE: SpriteData = [
  [hex(0x80, 0x40, 0x20), ''],
  [[...HUE_LOCKED][0], hex(0x20, 0x60, 0xa0)],
];
const SHIFT = { h: 90, s: 0, b: 0, c: 0 };

describe('colorize memo', () => {
  it('returns the same object for the same sprite and color, and a new one for a new color', () => {
    const a = getColorizedSprite(SPRITE, SHIFT);
    expect(getColorizedSprite(SPRITE, { ...SHIFT })).toBe(a);
    expect(getColorizedSprite(SPRITE, { ...SHIFT, colorize: true })).not.toBe(a);
    expect(a[0][0]).not.toBe(SPRITE[0][0]);
  });

  it('returns the same object for the same sprite and hue shift', () => {
    const a = getHueLockedSprite(SPRITE, SHIFT);
    expect(getHueLockedSprite(SPRITE, { ...SHIFT })).toBe(a);
    expect(getHueLockedSprite(SPRITE, { ...SHIFT, h: 45 })).not.toBe(a);
  });
});
