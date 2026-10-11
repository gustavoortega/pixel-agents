/**
 * Drawing helpers for the density 2 art (2 art px per world px). Everything here is
 * deterministic: shapes, alpha blending and the noise hash, no randomness.
 */

import type { Palette } from './canvas';
import { Canvas, parseHex, shade, toHex } from './canvas';

/** Art px per world px for every sprite this module draws. */
export const DENSITY = 2;

/** Deterministic per-pixel noise in 0..1 (same hash as tiles.ts). */
export function noise(x: number, y: number, seed: number): number {
  let h =
    Math.imul(x + 1, 374761393) ^ Math.imul(y + 1, 668265263) ^ Math.imul(seed + 1, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

/** Blend `b` over `a` by k (0 = a, 1 = b). */
export function mix(a: string, b: string, k: number): string {
  const [r1, g1, b1] = parseHex(a);
  const [r2, g2, b2] = parseHex(b);
  return toHex(r1 + (r2 - r1) * k, g1 + (g2 - g1) * k, b1 + (b2 - b1) * k);
}

export class Art {
  readonly c: Canvas;
  constructor(
    readonly w: number,
    readonly h: number,
  ) {
    this.c = new Canvas(w, h);
  }

  alpha(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) {
      return 0;
    }
    return this.c.data[(y * this.w + x) * 4 + 3];
  }

  hex(x: number, y: number): string {
    const i = (y * this.w + x) * 4;
    const d = this.c.data;
    return toHex(d[i], d[i + 1], d[i + 2]);
  }

  /** Source-over: opaque colors replace, translucent ones blend onto what is there. */
  px(x: number, y: number, hex: string): void {
    x = Math.floor(x);
    y = Math.floor(y);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) {
      return;
    }
    const [r, g, b, a] = parseHex(hex);
    const i = (y * this.w + x) * 4;
    const d = this.c.data;
    const da = d[i + 3];
    if (a === 255 || da === 0) {
      d[i] = r;
      d[i + 1] = g;
      d[i + 2] = b;
      d[i + 3] = a;
      return;
    }
    const k = a / 255;
    const outA = a + da * (1 - k);
    const wd = (da * (1 - k)) / outA;
    const ws = a / outA;
    d[i] = Math.round(d[i] * wd + r * ws);
    d[i + 1] = Math.round(d[i + 1] * wd + g * ws);
    d[i + 2] = Math.round(d[i + 2] * wd + b * ws);
    d[i + 3] = Math.round(outA);
  }

  /** Recolor an already opaque pixel only (keeps silhouettes intact). */
  tint(x: number, y: number, hex: string): void {
    if (this.alpha(x, y) > 0) {
      this.px(x, y, hex);
    }
  }

  clear(x: number, y: number): void {
    if (x >= 0 && y >= 0 && x < this.w && y < this.h) {
      this.c.data.fill(0, (y * this.w + x) * 4, (y * this.w + x) * 4 + 4);
    }
  }

  rect(x: number, y: number, w: number, h: number, hex: string): void {
    for (let yy = y; yy < y + h; yy++) {
      for (let xx = x; xx < x + w; xx++) {
        this.px(xx, yy, hex);
      }
    }
  }

  /** 1 px outlined box with a flat fill. */
  box(x: number, y: number, w: number, h: number, fill: string, line: string): void {
    this.rect(x, y, w, h, line);
    this.rect(x + 1, y + 1, w - 2, h - 2, fill);
  }

  oval(cx: number, cy: number, rx: number, ry: number, hex: string): void {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const dx = (x + 0.5 - cx) / rx;
        const dy = (y + 0.5 - cy) / ry;
        if (dx * dx + dy * dy <= 1) {
          this.px(x, y, hex);
        }
      }
    }
  }

  /** Straight pixel line (Bresenham), `t` px thick downward. */
  line(x0: number, y0: number, x1: number, y1: number, hex: string, t = 1): void {
    const dx = Math.abs(x1 - x0);
    const dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    let x = x0;
    let y = y0;
    for (;;) {
      this.rect(x, y, 1, t, hex);
      if (x === x1 && y === y1) {
        break;
      }
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y += sy;
      }
    }
  }

  stamp(rows: readonly string[], pal: Palette, ox = 0, oy = 0): void {
    rows.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) {
        const hex = pal[row[x]];
        if (row[x] !== '.' && hex !== undefined) {
          this.px(ox + x, oy + y, hex);
        }
      }
    });
  }

  /**
   * Outline every opaque shape with a darker shade of the color it touches, lighter on the
   * lit top-left sides. Only transparent pixels change, so the shapes keep their size.
   */
  outline(dark = 0.55, lit = 0.35, region?: [number, number, number, number]): void {
    const [rx, ry, rw, rh] = region ?? [0, 0, this.w, this.h];
    const snap = this.c.data.slice();
    const at = (x: number, y: number): number =>
      x < 0 || y < 0 || x >= this.w || y >= this.h ? -1 : (y * this.w + x) * 4;
    const solid = (x: number, y: number): boolean => {
      const i = at(x, y);
      return i >= 0 && snap[i + 3] === 255;
    };
    for (let y = ry; y < ry + rh; y++) {
      for (let x = rx; x < rx + rw; x++) {
        const i = at(x, y);
        if (i < 0 || snap[i + 3] !== 0) {
          continue;
        }
        // below / right neighbours mean this pixel sits on the shape's top or left side
        const order: Array<[number, number, boolean]> = [
          [0, 1, true],
          [1, 0, true],
          [0, -1, false],
          [-1, 0, false],
        ];
        for (const [dx, dy, litSide] of order) {
          if (solid(x + dx, y + dy)) {
            const j = at(x + dx, y + dy);
            const base = toHex(snap[j], snap[j + 1], snap[j + 2]);
            this.px(x, y, shade(base, -(litSide ? lit : dark)));
            break;
          }
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Wood: the shared 3-tone grain with a darker edge (the approved desk)
// ---------------------------------------------------------------------------

export const WOOD = {
  edge: '#4a2a14',
  O: '#3b2412',
  rim: '#f0c48a',
  L: '#e0a86a',
  M: '#b8783f',
  Mh: shade('#b8783f', 0.14),
  D: '#9a6233',
  X: '#7a4b2b',
};

/**
 * A planked wood surface filling the rectangle. `vertical` runs the planks top to bottom
 * (furniture seen from the side). `plank` is the board width across the grain.
 */
export function woodGrain(
  a: Art,
  x: number,
  y: number,
  w: number,
  h: number,
  seed: number,
  plank = 6,
  vertical = false,
): void {
  // u runs along the grain, v across it
  const U = vertical ? h : w;
  const V = vertical ? w : h;
  const P = (u: number, v: number, hex: string): void =>
    vertical ? a.px(x + v, y + u, hex) : a.px(x + u, y + v, hex);
  for (let v = 0; v < V; v++) {
    for (let u = 0; u < U; u++) {
      P(u, v, WOOD.M);
    }
  }
  const grooves: number[] = [];
  for (let g = plank; g < V - 2; g += plank) {
    grooves.push(g);
  }
  for (const g of grooves) {
    for (let u = 0; u < U; u++) {
      P(u, g, WOOD.D);
      P(u, g + 1, WOOD.Mh);
    }
  }
  for (let v = 0; v < V; v++) {
    if (grooves.includes(v) || grooves.includes(v - 1)) {
      continue;
    }
    let u = Math.floor(noise(v, seed, 21) * 10);
    while (u < U) {
      const len = 5 + Math.floor(noise(u, v + seed, 22) * 11);
      const dark = noise(u, v, 23 + seed) > 0.45;
      for (let k = 0; k < len && u + k < U; k++) {
        P(u + k, v, dark ? WOOD.D : WOOD.Mh);
      }
      u += len + 9 + Math.floor(noise(u, v, 24 + seed) * 20);
    }
  }
  // staggered end joints, one per board
  const boards = [0, ...grooves.map((g) => g + 2)];
  boards.forEach((v0, i) => {
    const v1 = i + 1 < boards.length ? boards[i + 1] - 2 : V;
    if (U < 24 || v1 - v0 < 3) {
      return;
    }
    const ju = 8 + Math.floor(noise(i, seed, 25) * (U - 16));
    for (let v = v0; v < v1; v++) {
      P(ju, v, WOOD.X);
      P(ju + 1, v, WOOD.Mh);
    }
  });
  // a knot when there is room
  if (U >= 40 && V >= 12) {
    const ku = 6 + Math.floor(noise(seed, 1, 26) * (U - 12));
    const kv = 2 + Math.floor(noise(seed, 2, 26) * (V - 5));
    P(ku, kv, WOOD.X);
    P(ku + 1, kv, WOOD.D);
    P(ku - 1, kv, WOOD.D);
    P(ku, kv + 1, WOOD.Mh);
  }
}

/** Outlined wood top: dark edge, lit rim on the far edge, planks inside. */
export function woodTop(
  a: Art,
  x: number,
  y: number,
  w: number,
  h: number,
  seed: number,
  opts: { plank?: number; vertical?: boolean } = {},
): void {
  a.rect(x + 1, y, w - 2, 1, WOOD.edge);
  a.rect(x, y + 1, w, h - 1, WOOD.edge);
  woodGrain(a, x + 1, y + 1, w - 2, h - 2, seed, opts.plank ?? 6, opts.vertical ?? false);
  a.rect(x + 2, y + 1, w - 4, 1, WOOD.rim);
  a.rect(x + 1, y + 2, w - 2, 1, WOOD.L);
  a.rect(x + 1, y + 2, 1, h - 3, WOOD.L);
}

/** Front edge of a top: lit lip, darker body, deep base, outlined. */
export function woodApron(a: Art, x: number, y: number, w: number, h: number): void {
  a.rect(x, y, w, h, WOOD.edge);
  a.rect(x + 1, y, w - 2, 1, WOOD.L);
  a.rect(x + 1, y + 1, w - 2, h - 2, WOOD.D);
  a.rect(x + 1, y + 1, w - 2, 1, shade(WOOD.D, 0.12));
  if (h > 4) {
    a.rect(x + 1, y + h - 3, w - 2, 2, WOOD.X);
  }
}

/** A square leg: outline, lit left face, mid, dark right face, a darker foot. */
export function woodLeg(a: Art, x: number, y: number, w: number, h: number): void {
  a.rect(x, y, w, h, WOOD.edge);
  a.rect(x + 1, y, w - 2, h - 1, WOOD.D);
  a.rect(x + 1, y, Math.max(1, Math.floor((w - 2) / 3)), h - 1, WOOD.M);
  a.rect(
    x + w - 1 - Math.max(1, Math.floor((w - 2) / 3)),
    y,
    Math.max(1, Math.floor((w - 2) / 3)),
    h - 1,
    WOOD.X,
  );
}

/**
 * A soft upholstered block: rounded corners, outline in a deep shade of the fabric,
 * lit top and left, darker bottom and right.
 */
export function pillow(
  a: Art,
  x: number,
  y: number,
  w: number,
  h: number,
  base: string,
  opts: { light?: string; dark?: string; line?: string; round?: number } = {},
): void {
  const light = opts.light ?? shade(base, 0.22);
  const dark = opts.dark ?? shade(base, -0.22);
  const line = opts.line ?? shade(base, -0.62);
  const r = opts.round ?? 2;
  const inside = (xx: number, yy: number, inset: number): boolean => {
    const lx = xx - x - inset;
    const ly = yy - y - inset;
    const ww = w - 2 * inset;
    const hh = h - 2 * inset;
    if (lx < 0 || ly < 0 || lx >= ww || ly >= hh) {
      return false;
    }
    const rr = Math.max(0, r - inset);
    const cx = lx < rr ? rr - lx : lx >= ww - rr ? lx - (ww - rr - 1) : 0;
    const cy = ly < rr ? rr - ly : ly >= hh - rr ? ly - (hh - rr - 1) : 0;
    return cx + cy <= rr;
  };
  for (let yy = y; yy < y + h; yy++) {
    for (let xx = x; xx < x + w; xx++) {
      if (!inside(xx, yy, 0)) {
        continue;
      }
      if (!inside(xx, yy, 1)) {
        a.px(xx, yy, line);
        continue;
      }
      const ly = yy - y;
      const lx = xx - x;
      let col = base;
      if (ly <= 2 || lx <= 1) {
        col = light;
      }
      if (ly >= h - 3 || lx >= w - 2) {
        col = dark;
      }
      a.px(xx, yy, col);
    }
  }
}

/** Filled triangle (pixel centers inside the three edges). */
export function tri(
  a: Art,
  p: [number, number],
  q: [number, number],
  r: [number, number],
  hex: string,
): void {
  const x0 = Math.floor(Math.min(p[0], q[0], r[0]));
  const x1 = Math.ceil(Math.max(p[0], q[0], r[0]));
  const y0 = Math.floor(Math.min(p[1], q[1], r[1]));
  const y1 = Math.ceil(Math.max(p[1], q[1], r[1]));
  const side = (a1: [number, number], b1: [number, number], x: number, y: number): number =>
    (b1[0] - a1[0]) * (y - a1[1]) - (b1[1] - a1[1]) * (x - a1[0]);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const cx = x + 0.5;
      const cy = y + 0.5;
      const s1 = side(p, q, cx, cy);
      const s2 = side(q, r, cx, cy);
      const s3 = side(r, p, cx, cy);
      if ((s1 >= 0 && s2 >= 0 && s3 >= 0) || (s1 <= 0 && s2 <= 0 && s3 <= 0)) {
        a.px(x, y, hex);
      }
    }
  }
}

/** A shaded ball: dark body, base offset toward the top-left light, a small highlight. */
export function ball(
  a: Art,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  tones: { dark: string; base: string; light: string },
): void {
  a.oval(cx, cy, rx, ry, tones.dark);
  a.oval(cx - 0.6, cy - 0.7, rx - 0.8, ry - 0.9, tones.base);
  if (rx > 3 && ry > 3) {
    a.oval(cx - rx * 0.3, cy - ry * 0.35, rx * 0.45, ry * 0.4, tones.light);
  }
}
