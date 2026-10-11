/** Tiny RGBA canvas plus pixel-map stamping, shared by every cozy art module. */

import type { Rgba } from './png';

/** Map of single characters to colors. Characters missing from the palette are transparent. */
export type Palette = Record<string, string>;

export function parseHex(hex: string): [number, number, number, number] {
  const h = hex.replace('#', '');
  if (h.length !== 6 && h.length !== 8) {
    throw new Error(`bad color ${hex}`);
  }
  const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) : 255;
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
    a,
  ];
}

export function toHex(r: number, g: number, b: number): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** Mix toward white (amount > 0) or black (amount < 0). */
export function shade(hex: string, amount: number): string {
  const [r, g, b] = parseHex(hex);
  const target = amount >= 0 ? 255 : 0;
  const k = Math.abs(amount);
  return toHex(r + (target - r) * k, g + (target - g) * k, b + (target - b) * k);
}

export class Canvas implements Rgba {
  readonly data: Uint8Array;
  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    this.data = new Uint8Array(width * height * 4);
  }

  set(x: number, y: number, hex: string): void {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) {
      return;
    }
    const [r, g, b, a] = parseHex(hex);
    const i = (y * this.width + x) * 4;
    this.data[i] = r;
    this.data[i + 1] = g;
    this.data[i + 2] = b;
    this.data[i + 3] = a;
  }

  /** Stamp a pixel map: '.' and characters absent from the palette leave the canvas untouched. */
  stamp(rows: readonly string[], pal: Palette, ox = 0, oy = 0): void {
    rows.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) {
        const hex = pal[row[x]];
        if (row[x] !== '.' && hex !== undefined) {
          this.set(ox + x, oy + y, hex);
        }
      }
    });
  }
}

/** Left half + its mirror image. */
export function mirror(rows: readonly string[]): string[] {
  return rows.map((r) => r + r.split('').reverse().join(''));
}

/** Flip a map horizontally (used for left-hand variants of side-facing art). */
export function flipRows(rows: readonly string[]): string[] {
  return rows.map((r) => r.split('').reverse().join(''));
}

/** Fail loudly when an authored map has ragged rows. */
export function assertRect(name: string, rows: readonly string[], w: number, h: number): void {
  if (rows.length !== h) {
    throw new Error(`${name}: expected ${h} rows, got ${rows.length}`);
  }
  rows.forEach((r, i) => {
    if (r.length !== w) {
      throw new Error(`${name}: row ${i} has ${r.length} columns, expected ${w}`);
    }
  });
}
