import { GLOW_COLORS } from '../../constants.js';
import type { GlowKind } from '../lighting.js';
import { createGlowCache, glowSize } from '../lighting.js';

/** Radial glows for monitors and lamps. Painted with the `screen` blend by the renderer, so
 *  only the shape and falloff live here. */
function buildGlow(kind: GlowKind, zoom: number): HTMLCanvasElement {
  const { w, h } = glowSize(kind, zoom);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  const colors = GLOW_COLORS[kind];
  // The fairy band fades down the wall; every other glow is round.
  const gradient =
    kind === 'fairyBand'
      ? ctx.createLinearGradient(0, 0, 0, h)
      : ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
  gradient.addColorStop(0, colors.core);
  gradient.addColorStop(1, colors.edge);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, w, h);
  return canvas;
}

const glowCache = createGlowCache(buildGlow);

export function getGlowSprite(kind: GlowKind, zoom: number): HTMLCanvasElement {
  return glowCache.get(kind, zoom);
}
