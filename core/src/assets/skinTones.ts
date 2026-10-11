/**
 * Colors the runtime hue shift never touches: the character skin ramps and the face colors drawn
 * on skin (outline, blush, mouth) plus the shared eye colors. A repeated palette is hue-shifted so
 * two agents with the same sheet look different; these pixels keep a human face.
 *
 * Single source for both sides: scripts/cozy-art/characters.ts paints the sheets from SKIN_RAMPS and
 * EYE_COLORS, and the runtime checks pixels against HUE_LOCKED. Every color is '#RRGGBB' in
 * uppercase, which is how the PNG decoder reports opaque pixels.
 */

/** Warm near-black every skin shade mixes toward, so shadows stay red-brown instead of gray. */
const SKIN_SHADOW = '#1A0804';
const BLUSH = '#FF5A6E';
const LIP = '#4A0A12';

function mix(a: string, b: string, k: number): string {
  const ca = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const cb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  return (
    '#' +
    ca
      .map((v, i) =>
        Math.max(0, Math.min(255, Math.round(v + (cb[i] - v) * k)))
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')
      .toUpperCase()
  );
}

export interface SkinRamp {
  /** The tone itself: lit skin. */
  base: string;
  /** First shade step: cheek and jaw shading, the shadow side of hands. */
  shade: string;
  /** Second shade step: neck under the chin, ears. */
  deep: string;
  /** Third step, the skin outline. */
  outline: string;
  blush: string;
  mouth: string;
}

function ramp(base: string): SkinRamp {
  return {
    base,
    shade: mix(base, SKIN_SHADOW, 0.14),
    deep: mix(base, SKIN_SHADOW, 0.3),
    outline: mix(base, SKIN_SHADOW, 0.5),
    blush: mix(base, BLUSH, 0.38),
    mouth: mix(base, LIP, 0.6),
  };
}

/** The 5 skin tones, light to dark. Sheet n wears tone n mod 5. */
export const SKIN_BASES: readonly string[] = [
  '#F6D9B8',
  '#F2C9A0',
  '#C98D5E',
  '#8D5A3B',
  '#5A3A28',
];

export const SKIN_RAMPS: readonly SkinRamp[] = SKIN_BASES.map(ramp);

/** Shared by every sheet: pupil dark, iris, iris light, shine. */
export const EYE_COLORS = {
  dark: '#24162A',
  iris: '#4A3C8C',
  irisLight: '#9A90E0',
  shine: '#FFFFFF',
} as const;

/** Mouth shades of the 1x sheets (16x32 frames), kept so a legacy external sheet keeps its face. */
const LEGACY_MOUTHS = ['#998772', '#967D63', '#7D573A', '#573825', '#382419'];

export const HUE_LOCKED: ReadonlySet<string> = new Set([
  ...SKIN_RAMPS.flatMap((r) => [r.base, r.shade, r.deep, r.outline, r.blush, r.mouth]),
  ...Object.values(EYE_COLORS),
  ...LEGACY_MOUTHS,
]);
