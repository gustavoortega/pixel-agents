/**
 * Where the bulbs hang on the FAIRY_LIGHTS strand, in art px of the density-2 sprite.
 *
 * Single source for both sides: scripts/cozy-art/decor.ts paints the strand from these numbers
 * and the runtime centers each bulb's night glow on `fairyBulbCenters()`, so a change to the art
 * moves the glows with it.
 */

/** Sprite size in art px (4x1 tiles at density 2). */
export const FAIRY_ART_W = 128;
export const FAIRY_ART_H = 32;
export const FAIRY_BULB_COUNT = 8;
/** Left edge of the first bulb and the distance between bulbs, art px. */
export const FAIRY_BULB_FIRST_X = 6;
export const FAIRY_BULB_SPACING = 16;
/** Bulb glass size, art px; the glass hangs 2 px under the cap that sits 1 px under the wire. */
export const FAIRY_BULB_GLASS = { w: 3, h: 4 } as const;

/** Height of the sagging wire at art column x. */
export function fairySag(x: number): number {
  return 2 + Math.round(8 * Math.sin((Math.PI * x) / (FAIRY_ART_W - 1)));
}

/** Left edge of bulb i, art px. */
export function fairyBulbX(i: number): number {
  return FAIRY_BULB_FIRST_X + i * FAIRY_BULB_SPACING;
}

/** Center of every bulb's glass, art px from the sprite's top-left. */
export function fairyBulbCenters(): Array<{ x: number; y: number }> {
  const out: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < FAIRY_BULB_COUNT; i++) {
    const x = fairyBulbX(i);
    const glassTop = fairySag(x) + 1 + 2;
    out.push({ x: x + FAIRY_BULB_GLASS.w / 2, y: glassTop + FAIRY_BULB_GLASS.h / 2 });
  }
  return out;
}
