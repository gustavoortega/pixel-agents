/**
 * Shared sprite colorization module.
 *
 * Two modes:
 * - Colorize (Photoshop-style): grayscale → fixed HSL. For floor tiles and opt-in furniture.
 * - Adjust (default for furniture): shift original pixel HSL values.
 */

import { HUE_LOCKED } from '../../../core/src/assets/skinTones.js';
import type { ColorValue } from '../components/ui/types.js';
import type { SpriteData } from './types.js';

/**
 * Recolored sprites, keyed by (source sprite, color key). Keyed on the sprite object, not a name,
 * so a reloaded sheet never gets a stale hit and the same request always returns the same object
 * (the canvas cache keys on SpriteData identity, so a fresh array would rebuild a canvas per draw).
 */
let colorizeCache = new WeakMap<SpriteData, Map<string, SpriteData>>();

/** Every field that changes the output, including the mode. */
function colorKey(color: ColorValue): string {
  return `${color.h}|${color.s}|${color.b}|${color.c}|${color.colorize ? 1 : 0}`;
}

function memo(sprite: SpriteData, key: string, build: () => SpriteData): SpriteData {
  let byKey = colorizeCache.get(sprite);
  if (!byKey) {
    byKey = new Map();
    colorizeCache.set(sprite, byKey);
  }
  let hit = byKey.get(key);
  if (!hit) {
    hit = build();
    byKey.set(key, hit);
  }
  return hit;
}

/**
 * Get a color-adjusted sprite from cache, or compute and cache it.
 * Dispatches to colorize or adjust mode based on `color.colorize`.
 */
export function getColorizedSprite(sprite: SpriteData, color: ColorValue): SpriteData {
  return memo(sprite, colorKey(color), () =>
    color.colorize ? colorizeSprite(sprite, color) : adjustSprite(sprite, color),
  );
}

/**
 * Adjust mode that leaves every HUE_LOCKED color as it is: the character hue shift and the gray
 * helper look change hair and outfit, never skin, blush or eye shine.
 */
export function getHueLockedSprite(sprite: SpriteData, color: ColorValue): SpriteData {
  return memo(sprite, `locked|${colorKey(color)}`, () =>
    remapColors(sprite, (px) => (HUE_LOCKED.has(px) ? px : adjustColor(px, color))),
  );
}

/** Clear all cached colorized sprites (e.g., on asset reload) */
export function clearColorizeCache(): void {
  colorizeCache = new WeakMap();
}

/** Rebuild the sprite with each distinct color mapped once: a sprite has a few dozen colors and
 *  thousands of pixels, so the HSL math runs per color, not per pixel. */
function remapColors(sprite: SpriteData, map: (px: string) => string): SpriteData {
  const seen = new Map<string, string>();
  return sprite.map((row) =>
    row.map((px) => {
      if (px === '') return '';
      let out = seen.get(px);
      if (out === undefined) {
        out = map(px);
        seen.set(px, out);
      }
      return out;
    }),
  );
}

/**
 * Colorize a sprite using HSL transformation.
 *
 * Algorithm (Photoshop Colorize-style):
 * 1. Parse each pixel's color as perceived luminance (0-1)
 * 2. Apply contrast: stretch/compress around midpoint 0.5
 * 3. Apply brightness: shift lightness up/down
 * 4. Create HSL color with user's hue + saturation
 * 5. Convert HSL -> RGB -> hex
 */
export function colorizeSprite(sprite: SpriteData, color: ColorValue): SpriteData {
  return remapColors(sprite, (px) => colorizeColor(px, color));
}

function colorizeColor(pixel: string, color: ColorValue): string {
  const { h, s, b, c } = color;
  const r = parseInt(pixel.slice(1, 3), 16);
  const g = parseInt(pixel.slice(3, 5), 16);
  const bv = parseInt(pixel.slice(5, 7), 16);
  // Use perceived luminance for grayscale
  let lightness = (0.299 * r + 0.587 * g + 0.114 * bv) / 255;
  // Apply contrast: expand/compress around 0.5
  if (c !== 0) {
    const factor = (100 + c) / 100;
    lightness = 0.5 + (lightness - 0.5) * factor;
  }
  // Apply brightness: shift up/down
  if (b !== 0) {
    lightness = lightness + b / 200;
  }
  lightness = Math.max(0, Math.min(1, lightness));
  return appendAlpha(hslToHex(h, s / 100, lightness), extractAlpha(pixel));
}

/** Extract alpha from a hex pixel string. Returns 255 for #RRGGBB, parsed value for #RRGGBBAA. */
function extractAlpha(pixel: string): number {
  return pixel.length > 7 ? parseInt(pixel.slice(7, 9), 16) : 255;
}

/** Append alpha to a #RRGGBB hex string, omitting if fully opaque. */
function appendAlpha(hex: string, alpha: number): string {
  if (alpha >= 255) return hex;
  return `${hex}${alpha.toString(16).padStart(2, '0').toUpperCase()}`;
}

/** Convert HSL (h: 0-360, s: 0-1, l: 0-1) to #RRGGBB hex string */
function hslToHex(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = h / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r1: number;
  let g1: number;
  let b1: number;

  if (hp < 1) {
    r1 = c;
    g1 = x;
    b1 = 0;
  } else if (hp < 2) {
    r1 = x;
    g1 = c;
    b1 = 0;
  } else if (hp < 3) {
    r1 = 0;
    g1 = c;
    b1 = x;
  } else if (hp < 4) {
    r1 = 0;
    g1 = x;
    b1 = c;
  } else if (hp < 5) {
    r1 = x;
    g1 = 0;
    b1 = c;
  } else {
    r1 = c;
    g1 = 0;
    b1 = x;
  }

  const m = l - c / 2;
  const r = Math.round((r1 + m) * 255);
  const g = Math.round((g1 + m) * 255);
  const bOut = Math.round((b1 + m) * 255);

  return `#${clamp255(r).toString(16).padStart(2, '0')}${clamp255(g).toString(16).padStart(2, '0')}${clamp255(bOut).toString(16).padStart(2, '0')}`.toUpperCase();
}

function clamp255(v: number): number {
  return Math.max(0, Math.min(255, v));
}

/** Convert RGB (0-255 each) to HSL (h: 0-360, s: 0-1, l: 0-1) */
function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rf = r / 255,
    gf = g / 255,
    bf = b / 255;
  const max = Math.max(rf, gf, bf),
    min = Math.min(rf, gf, bf);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === rf) h = ((gf - bf) / d + (gf < bf ? 6 : 0)) * 60;
  else if (max === gf) h = ((bf - rf) / d + 2) * 60;
  else h = ((rf - gf) / d + 4) * 60;
  return [h, s, l];
}

/**
 * Single-color fill: every non-empty pixel becomes the computed HSL color,
 * preserving the original per-pixel alpha. Used by the carpet renderer to
 * recolor a masked layer (main or accent) before merging.
 *
 * Unlike `colorizeSprite`, source pixel luminance is ignored; output lightness
 * is derived purely from `color.b` (brightness) and `color.c` (contrast around
 * the 0.5 midpoint). Caller controls hue + saturation via `color.h` and
 * `color.s`.
 */
export function flatColorizeSprite(sprite: SpriteData, color: ColorValue): SpriteData {
  const { h, s, b, c } = color;
  let lightness = 0.5;
  if (c !== 0) {
    lightness = 0.5 + (lightness - 0.5) * ((100 + c) / 100);
  }
  if (b !== 0) {
    lightness = lightness + b / 200;
  }
  lightness = Math.max(0, Math.min(1, lightness));
  const hex = hslToHex(h, s / 100, lightness);
  return sprite.map((row) =>
    row.map((pixel) => {
      if (pixel === '') return '';
      const alpha = extractAlpha(pixel);
      return appendAlpha(hex, alpha);
    }),
  );
}

/**
 * Adjust a sprite's colors by shifting HSL values (default mode for furniture).
 *
 * H slider (-180 to +180): rotates hue
 * S slider (-100 to +100): shifts saturation
 * B slider (-100 to 100): shifts lightness
 * C slider (-100 to 100): adjusts contrast around midpoint
 */
export function adjustSprite(sprite: SpriteData, color: ColorValue): SpriteData {
  return remapColors(sprite, (px) => adjustColor(px, color));
}

function adjustColor(pixel: string, color: ColorValue): string {
  const { h: hShift, s: sShift, b, c } = color;
  const r = parseInt(pixel.slice(1, 3), 16);
  const g = parseInt(pixel.slice(3, 5), 16);
  const bv = parseInt(pixel.slice(5, 7), 16);
  const [origH, origS, origL] = rgbToHsl(r, g, bv);
  const newH = (((origH + hShift) % 360) + 360) % 360;
  const newS = Math.max(0, Math.min(1, origS + sShift / 100));
  // Apply contrast: expand/compress around 0.5
  let lightness = origL;
  if (c !== 0) {
    const factor = (100 + c) / 100;
    lightness = 0.5 + (lightness - 0.5) * factor;
  }
  if (b !== 0) {
    lightness = lightness + b / 200;
  }
  lightness = Math.max(0, Math.min(1, lightness));
  return appendAlpha(hslToHex(newH, newS, lightness), extractAlpha(pixel));
}
