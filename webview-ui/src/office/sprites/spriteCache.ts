import { ART_DENSITY } from '../../../../core/src/assets/constants.js';
import type { SpriteData } from '../types.js';

export { getOutlineSprite, getTintedOutlineSprite } from './outlineSprites.js';

/** RGBA bytes of a sprite, w x h pixels. */
interface Pixels {
  data: Uint8ClampedArray;
  w: number;
  h: number;
}

/** Colors parsed to bytes once per sprite and reused for every zoom. */
const artPixels = new WeakMap<SpriteData, Pixels>();
const zoomCaches = new Map<number, WeakMap<SpriteData, HTMLCanvasElement>>();

/**
 * Bytes of a sprite color. Decoded art is `#RRGGBB` / `#RRGGBBAA`; engine-built sprites (the
 * shadow oval) may use `rgba(...)` constants, which the old fillRect path accepted too.
 */
function parseColor(color: string, out: Uint8ClampedArray): void {
  if (color.startsWith('#')) {
    const hex =
      color.length <= 5 ? [...color.slice(1)].map((ch) => ch + ch).join('') : color.slice(1);
    out[0] = parseInt(hex.slice(0, 2), 16);
    out[1] = parseInt(hex.slice(2, 4), 16);
    out[2] = parseInt(hex.slice(4, 6), 16);
    out[3] = hex.length > 6 ? parseInt(hex.slice(6, 8), 16) : 255;
    return;
  }
  const parts = color.slice(color.indexOf('(') + 1, color.lastIndexOf(')')).split(',');
  out[0] = Number(parts[0]);
  out[1] = Number(parts[1]);
  out[2] = Number(parts[2]);
  out[3] = parts.length > 3 ? Math.round(Number(parts[3]) * 255) : 255;
}

function spritePixels(sprite: SpriteData): Pixels {
  const hit = artPixels.get(sprite);
  if (hit) return hit;
  const h = sprite.length;
  const w = sprite[0]?.length ?? 0;
  const data = new Uint8ClampedArray(w * h * 4);
  // A sprite has a few dozen colors: parse each once, then copy bytes.
  const parsed = new Map<string, Uint8ClampedArray>();
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const color = sprite[y][x];
      if (!color) continue;
      let rgba = parsed.get(color);
      if (!rgba) {
        rgba = new Uint8ClampedArray(4);
        parseColor(color, rgba);
        parsed.set(color, rgba);
      }
      data.set(rgba, (y * w + x) * 4);
    }
  }
  const pixels = { data, w, h };
  artPixels.set(sprite, pixels);
  return pixels;
}

/**
 * Half-size pixels for zoom 1, where an art pixel would be half a device pixel. Per 2x2 block:
 * alpha is the block's mean alpha (clear pixels count as 0) and color is the alpha-weighted mean,
 * so clear pixels never darken an edge. A block of four equal pixels (upscaled 1x art) comes back
 * as that exact pixel, which keeps legacy art identical to how it drew before.
 */
function downsample(src: Pixels): Pixels {
  const f = ART_DENSITY;
  const w = Math.ceil(src.w / f);
  const h = Math.ceil(src.h / f);
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let dy = 0; dy < f; dy++) {
        const sy = y * f + dy;
        if (sy >= src.h) continue;
        for (let dx = 0; dx < f; dx++) {
          const sx = x * f + dx;
          if (sx >= src.w) continue;
          const i = (sy * src.w + sx) * 4;
          const pa = src.data[i + 3];
          r += src.data[i] * pa;
          g += src.data[i + 1] * pa;
          b += src.data[i + 2] * pa;
          a += pa;
        }
      }
      if (a === 0) continue;
      const o = (y * w + x) * 4;
      data[o] = Math.round(r / a);
      data[o + 1] = Math.round(g / a);
      data[o + 2] = Math.round(b / a);
      data[o + 3] = Math.round(a / (f * f));
    }
  }
  return { data, w, h };
}

function canvasOf(px: Pixels): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = px.w;
  canvas.height = px.h;
  const ctx = canvas.getContext('2d')!;
  const image = ctx.createImageData(px.w, px.h);
  image.data.set(px.data);
  ctx.putImageData(image, 0, 0);
  return canvas;
}

/**
 * The sprite drawn at `zoom` device px per WORLD px. Sprites are art px (ART_DENSITY per world
 * px), so the canvas is the sprite's world size times zoom, one art px = zoom / ART_DENSITY
 * device px. Zoom 1 uses the 2x2 downsample instead of half-pixel scaling.
 */
export function getCachedSprite(sprite: SpriteData, zoom: number): HTMLCanvasElement {
  let cache = zoomCaches.get(zoom);
  if (!cache) {
    cache = new WeakMap();
    zoomCaches.set(zoom, cache);
  }
  const cached = cache.get(sprite);
  if (cached) return cached;

  const art = spritePixels(sprite);
  const source = zoom < ART_DENSITY ? downsample(art) : art;
  const scale = zoom < ART_DENSITY ? zoom : zoom / ART_DENSITY;
  const src = canvasOf(source);
  const canvas = document.createElement('canvas');
  canvas.width = source.w * scale;
  canvas.height = source.h * scale;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(src, 0, 0, canvas.width, canvas.height);

  cache.set(sprite, canvas);
  return canvas;
}
