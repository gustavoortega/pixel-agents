/**
 * The two bundled pets at density 2: claudio (a chihuahua) and gitcat (the black lobby cat).
 *
 * Sheet layout (192x192, the 96x96 legacy layout doubled):
 *   row 0 (y 0..63):    walkDown 0..2, idleDown 0..2   (32x64 each, front view)
 *   row 1 (y 64..127):  walkUp 0..2, idleUp 0..2       (32x64 each, back view)
 *   row 2 (y 128..191): walkRight 0..2                 (64x64 each, facing right)
 * Feet stand on art row 61 of each frame. No shadow is baked in: the engine draws it.
 */

import type { Canvas } from './canvas';
import { Art, ball, tri } from './hd';

interface Tones {
  dark: string;
  base: string;
  light: string;
}

interface Species {
  fur: Tones;
  /** Chest, muzzle and paws (the dog's cream; the cat keeps its fur, lit a little). */
  cream: Tones;
  earInner: string;
  nose: string;
  eye: string;
  pupil: string;
  shine: string;
  /** Rim light along the lit top-left of head and back, so a dark coat keeps its shape. */
  rim: string;
  whisker?: string;
  cat: boolean;
}

const CLAUDIO: Species = {
  fur: { dark: '#c06a24', base: '#e8963c', light: '#f6b866' },
  cream: { dark: '#e6d2b0', base: '#fff1d6', light: '#ffffff' },
  earInner: '#f2a0a0',
  nose: '#3a2418',
  eye: '#2a1a12',
  pupil: '#2a1a12',
  shine: '#ffffff',
  rim: '#ffd08a',
  cat: false,
};

const GITCAT: Species = {
  fur: { dark: '#1d1a23', base: '#2f2b38', light: '#4a4558' },
  cream: { dark: '#2a2632', base: '#3a3545', light: '#565068' },
  earInner: '#7a5464',
  nose: '#e88a9a',
  eye: '#c8e05a',
  pupil: '#141218',
  shine: '#ffffff',
  rim: '#6e6884',
  whisker: '#a9a3ba',
  cat: true,
};

const GROUND = 61;

/** Vertical leg from y0 down to the ground with a lighter paw. */
function leg(a: Art, x: number, y0: number, w: number, lift: number, t: Tones, paw: string): void {
  const y1 = GROUND - lift;
  a.rect(x, y0, w, y1 - y0 + 1, t.base);
  a.rect(x + w - 1, y0, 1, y1 - y0 + 1, t.dark);
  a.rect(x, y1 - 1, w, 2, paw);
}

/** Thick polyline (a tail): `pts` from root to tip, last two points in the tip color. */
function tail(a: Art, pts: Array<[number, number]>, t: Tones, tip: string, w = 2): void {
  for (let i = 0; i + 1 < pts.length; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[i + 1];
    a.line(x0, y0, x1, y1, i >= pts.length - 2 ? tip : t.base, w);
    a.line(x0 + 1, y0, x1 + 1, y1, i >= pts.length - 2 ? tip : t.dark, 1);
  }
}

function eyesFront(a: Art, sp: Species, lx: number, rx: number, y: number, blink: boolean): void {
  for (const x of [lx, rx]) {
    if (blink) {
      a.rect(x, y + 1, 3, 1, sp.pupil);
      continue;
    }
    if (sp.cat) {
      a.rect(x, y, 3, 3, sp.eye);
      a.rect(x + 1, y, 1, 3, sp.pupil);
      a.px(x, y, sp.shine);
    } else {
      a.rect(x, y, 3, 3, sp.eye);
      a.px(x, y, sp.shine);
      a.px(x + 1, y, '#5a4030');
    }
  }
}

function whiskers(a: Art, sp: Species, cx: number, y: number): void {
  if (!sp.whisker) {
    return;
  }
  a.line(cx - 4, y, cx - 9, y - 1, sp.whisker);
  a.line(cx - 4, y + 2, cx - 9, y + 3, sp.whisker);
  a.line(cx + 4, y, cx + 9, y - 1, sp.whisker);
  a.line(cx + 4, y + 2, cx + 9, y + 3, sp.whisker);
}

/** Head seen from the front, centered on (cx, cy). */
function headFront(
  a: Art,
  sp: Species,
  cx: number,
  cy: number,
  opts: { blink?: boolean; twitch?: boolean } = {},
): void {
  const t = sp.fur;
  if (sp.cat) {
    // pointed ears
    const tw = opts.twitch ? 2 : 0;
    tri(a, [cx - 8, cy - 1], [cx - 6.5, cy - 11 + tw], [cx - 1, cy - 5], t.base);
    tri(a, [cx + 8, cy - 1], [cx + 6.5, cy - 11], [cx + 1, cy - 5], t.base);
    tri(a, [cx - 6.5, cy - 3], [cx - 5.8, cy - 8 + tw], [cx - 3, cy - 5], sp.earInner);
    tri(a, [cx + 6.5, cy - 3], [cx + 5.8, cy - 8], [cx + 3, cy - 5], sp.earInner);
    ball(a, cx, cy, 8, 6.8, t);
    // muzzle, nose, mouth
    a.oval(cx, cy + 3, 3.4, 2.2, sp.cream.light);
    a.rect(cx - 1, cy + 2, 2, 1, sp.nose);
    a.px(cx - 1, cy + 3, sp.pupil);
    a.px(cx, cy + 3, sp.pupil);
    eyesFront(a, sp, cx - 5, cx + 2, cy - 2, !!opts.blink);
  } else {
    // big chihuahua ears, tilted out
    const tw = opts.twitch ? 2 : 0;
    tri(a, [cx - 7, cy - 1], [cx - 12, cy - 13 + tw], [cx - 1, cy - 6], t.base);
    tri(a, [cx + 7, cy - 1], [cx + 12, cy - 13], [cx + 1, cy - 6], t.base);
    tri(a, [cx - 6.5, cy - 3], [cx - 10, cy - 10 + tw], [cx - 3, cy - 6], sp.earInner);
    tri(a, [cx + 6.5, cy - 3], [cx + 10, cy - 10], [cx + 3, cy - 6], sp.earInner);
    ball(a, cx, cy, 8, 7, t);
    // cream blaze and muzzle
    a.rect(cx - 1, cy - 6, 2, 5, sp.cream.base);
    a.oval(cx, cy + 3.5, 4, 3, sp.cream.base);
    a.oval(cx - 0.5, cy + 3, 2.5, 1.6, sp.cream.light);
    a.rect(cx - 1, cy + 1, 3, 2, sp.nose);
    a.px(cx - 1, cy + 1, '#7a5a48');
    a.rect(cx - 1, cy + 5, 3, 1, sp.cream.dark);
    eyesFront(a, sp, cx - 6, cx + 3, cy - 2, !!opts.blink);
  }
  a.px(cx - 5, cy - 6, sp.rim);
  a.px(cx - 4, cy - 7, sp.rim);
}

/** Head seen from behind. */
function headBack(a: Art, sp: Species, cx: number, cy: number): void {
  const t = sp.fur;
  if (sp.cat) {
    tri(a, [cx - 8, cy - 1], [cx - 6.5, cy - 11], [cx - 1, cy - 5], t.dark);
    tri(a, [cx + 8, cy - 1], [cx + 6.5, cy - 11], [cx + 1, cy - 5], t.dark);
    a.line(cx - 7, cy - 4, cx - 6, cy - 9, t.light);
  } else {
    tri(a, [cx - 7, cy - 1], [cx - 12, cy - 13], [cx - 1, cy - 6], t.dark);
    tri(a, [cx + 7, cy - 1], [cx + 12, cy - 13], [cx + 1, cy - 6], t.dark);
    a.line(cx - 7, cy - 3, cx - 11, cy - 11, t.base);
  }
  ball(a, cx, cy, 8, sp.cat ? 6.8 : 7, t);
  a.px(cx - 5, cy - 6, sp.rim);
  a.px(cx - 4, cy - 7, sp.rim);
}

/** Front view, standing or walking (phase 0..2). */
function front(sp: Species, phase: number): Art {
  const a = new Art(32, 64);
  const bob = phase === 1 ? -1 : 0;
  const t = sp.fur;
  const paw = sp.cat ? sp.cream.light : sp.cream.base;
  if (sp.cat) {
    tail(
      a,
      [
        [21, 56],
        [25, 50],
        [26, 44],
        [24, 40],
      ],
      t,
      sp.rim,
    );
    leg(a, 9, 52, 3, phase === 2 ? 1 : 0, { ...t, base: t.dark }, t.base);
    leg(a, 20, 52, 3, phase === 0 ? 1 : 0, { ...t, base: t.dark }, t.base);
    ball(a, 16, 49 + bob, 6.5, 7, t);
    a.oval(16, 50 + bob, 3, 4, sp.cream.base);
    leg(a, 12, 52, 3, phase === 0 ? 2 : 0, t, paw);
    leg(a, 17, 52, 3, phase === 2 ? 2 : 0, t, paw);
    headFront(a, sp, 16, 37 + bob);
    a.outline(0.55, 0.35);
    // the rim light and whiskers sit on top of the outline
    a.line(10, 45 + bob, 12, 43 + bob, sp.rim);
    whiskers(a, sp, 16, 39 + bob);
  } else {
    leg(a, 9, 50, 3, phase === 2 ? 1 : 0, { ...t, base: t.dark }, sp.cream.dark);
    leg(a, 20, 50, 3, phase === 0 ? 1 : 0, { ...t, base: t.dark }, sp.cream.dark);
    ball(a, 16, 46 + bob, 7, 7, t);
    a.oval(16, 47 + bob, 3.5, 5, sp.cream.base);
    leg(a, 11, 50, 4, phase === 0 ? 2 : 0, t, paw);
    leg(a, 17, 50, 4, phase === 2 ? 2 : 0, t, paw);
    headFront(a, sp, 16, 33 + bob);
    a.outline(0.55, 0.35);
  }
  return a;
}

/** Back view, standing or walking. */
function back(sp: Species, phase: number): Art {
  const a = new Art(32, 64);
  const bob = phase === 1 ? -1 : 0;
  const t = sp.fur;
  if (sp.cat) {
    leg(a, 12, 52, 3, phase === 0 ? 1 : 0, { ...t, base: t.dark }, t.dark);
    leg(a, 17, 52, 3, phase === 2 ? 1 : 0, { ...t, base: t.dark }, t.dark);
    ball(a, 16, 49 + bob, 6.5, 7, t);
    leg(a, 9, 53, 4, phase === 2 ? 2 : 0, t, t.base);
    leg(a, 19, 53, 4, phase === 0 ? 2 : 0, t, t.base);
    tail(
      a,
      [
        [17, 54],
        [21, 51],
        [24, 46],
        [25, 41],
        [23, 37],
      ],
      t,
      sp.rim,
    );
    headBack(a, sp, 16, 37 + bob);
    a.outline(0.55, 0.35);
    a.line(10, 45 + bob, 12, 43 + bob, sp.rim);
  } else {
    leg(a, 11, 50, 4, phase === 0 ? 1 : 0, { ...t, base: t.dark }, sp.cream.dark);
    leg(a, 17, 50, 4, phase === 2 ? 1 : 0, { ...t, base: t.dark }, sp.cream.dark);
    ball(a, 16, 46 + bob, 7, 7, t);
    leg(a, 9, 51, 4, phase === 2 ? 2 : 0, t, sp.cream.base);
    leg(a, 19, 51, 4, phase === 0 ? 2 : 0, t, sp.cream.base);
    // curled tail over the back
    a.oval(16, 42 + bob, 3, 3, t.light);
    a.oval(16.5, 42.5 + bob, 1.6, 1.6, t.dark);
    headBack(a, sp, 16, 33 + bob);
    a.outline(0.55, 0.35);
  }
  return a;
}

/** Sitting, front view; f 0..2: neutral, blink, ear twitch with a tail flick. */
function sitFront(sp: Species, f: number): Art {
  const a = new Art(32, 64);
  const t = sp.fur;
  if (sp.cat) {
    ball(a, 16, 54, 9, 7, t);
    ball(a, 16, 49, 6.5, 6.5, t);
    a.oval(16, 51, 3, 4, sp.cream.base);
    leg(a, 12, 52, 3, 0, t, sp.cream.light);
    leg(a, 17, 52, 3, 0, t, sp.cream.light);
    // tail wrapped round the paws
    const tip = f === 2 ? 5 : 7;
    a.rect(tip, 59, 18 - tip + 8, 2, t.base);
    a.rect(tip, 58, 2, 1, sp.rim);
    headFront(a, sp, 16, 40, { blink: f === 1, twitch: f === 2 });
    a.outline(0.55, 0.35);
    a.line(9, 50, 11, 47, sp.rim);
    whiskers(a, sp, 16, 42);
  } else {
    ball(a, 16, 54, 9, 7, t);
    ball(a, 16, 48, 6.5, 6.5, t);
    a.oval(16, 50, 3.5, 5, sp.cream.base);
    leg(a, 11, 52, 4, 0, t, sp.cream.base);
    leg(a, 17, 52, 4, 0, t, sp.cream.base);
    a.oval(f === 2 ? 26 : 25, 58, 3, 2, t.base);
    headFront(a, sp, 16, 37, { blink: f === 1, twitch: f === 2 });
    a.outline(0.55, 0.35);
  }
  return a;
}

/** Sitting, back view; the tail sweeps a little each frame. */
function sitBack(sp: Species, f: number): Art {
  const a = new Art(32, 64);
  const t = sp.fur;
  ball(a, 16, 54, 9, 7, t);
  ball(a, 16, 48, 6.5, 6.5, t);
  if (sp.cat) {
    const end = [24, 26, 25][f];
    tail(
      a,
      [
        [18, 60],
        [22, 60],
        [end, 58],
        [end + 1, 55],
      ],
      t,
      sp.rim,
    );
    headBack(a, sp, 16, 40);
  } else {
    a.oval(16 + (f - 1), 44, 3, 3, t.light);
    a.oval(16.5 + (f - 1), 44.5, 1.6, 1.6, t.dark);
    headBack(a, sp, 16, 37);
  }
  a.outline(0.55, 0.35);
  a.line(9, 50, 11, 47, sp.rim);
  return a;
}

/** Side view facing right, 64x64, walk phase 0..2. */
function side(sp: Species, phase: number): Art {
  const a = new Art(64, 64);
  const t = sp.fur;
  const farT = { ...t, base: t.dark };
  const bob = phase === 1 ? -1 : 0;
  // leg swing per phase: [far back, far front, near back, near front]
  const swing = [
    [2, -2, -2, 2],
    [0, 0, 0, 0],
    [-2, 2, 2, -2],
  ][phase];
  const legLine = (hx: number, hy: number, dx: number, tt: Tones, paw: string, w: number): void => {
    const fx = hx + dx;
    for (let y = hy; y <= GROUND; y++) {
      const x = Math.round(hx + ((fx - hx) * (y - hy)) / (GROUND - hy));
      a.rect(x, y, w, 1, tt.base);
      a.px(x + w - 1, y, tt.dark);
    }
    a.rect(fx, GROUND - 1, w + 1, 2, paw);
  };
  if (sp.cat) {
    tail(
      a,
      [
        [17, 46],
        [12, 42],
        [9, 35],
        [11, 29],
        [14, 27],
      ],
      t,
      sp.rim,
    );
    legLine(21, 50, swing[0], farT, t.dark, 3);
    legLine(37, 50, swing[1], farT, t.dark, 3);
    ball(a, 28, 47 + bob, 12, 6, t);
    legLine(18, 50, swing[2], t, sp.cream.light, 4);
    legLine(34, 50, swing[3], t, sp.cream.light, 4);
    // head
    tri(a, [38, 35 + bob], [40, 26 + bob], [44, 33 + bob], t.base);
    tri(a, [43, 33 + bob], [47, 25 + bob], [49, 34 + bob], t.base);
    tri(a, [44.5, 32 + bob], [46.5, 28 + bob], [47.5, 33 + bob], GITCAT.earInner);
    ball(a, 44, 39 + bob, 7, 6, t);
    a.oval(49, 41 + bob, 3, 2, sp.cream.light);
    a.rect(51, 40 + bob, 2, 1, sp.nose);
    a.rect(46, 37 + bob, 3, 3, sp.eye);
    a.rect(47, 37 + bob, 1, 3, sp.pupil);
    a.px(46, 37 + bob, sp.shine);
    a.outline(0.55, 0.35);
    a.line(20, 42 + bob, 32, 41 + bob, sp.rim);
    a.line(39, 34 + bob, 42, 33 + bob, sp.rim);
    if (sp.whisker) {
      a.line(50, 42 + bob, 56, 41 + bob, sp.whisker);
      a.line(50, 43 + bob, 56, 45 + bob, sp.whisker);
    }
  } else {
    legLine(22, 49, swing[0], farT, sp.cream.dark, 3);
    legLine(38, 49, swing[1], farT, sp.cream.dark, 3);
    // curled tail
    a.line(19, 42 + bob, 15, 37 + bob, t.base, 2);
    a.oval(15, 36 + bob, 2.4, 2.4, t.light);
    ball(a, 30, 45 + bob, 12, 7, t);
    a.oval(37, 48 + bob, 5, 3, sp.cream.base);
    legLine(19, 49, swing[2], t, sp.cream.base, 4);
    legLine(35, 49, swing[3], t, sp.cream.base, 4);
    // head: a round skull, a short snout, the big ear swept back
    ball(a, 45, 36 + bob, 7.5, 7, t);
    tri(a, [39, 33 + bob], [38, 19 + bob], [46, 30 + bob], t.base);
    tri(a, [40.5, 31 + bob], [39.5, 22 + bob], [44.5, 30 + bob], sp.earInner);
    a.oval(51, 39 + bob, 4, 3, sp.cream.base);
    a.rect(54, 37 + bob, 2, 2, sp.nose);
    a.rect(47, 33 + bob, 3, 3, sp.eye);
    a.px(47, 33 + bob, sp.shine);
    a.rect(50, 42 + bob, 3, 1, sp.cream.dark);
    a.outline(0.55, 0.35);
  }
  return a;
}

function blit(dst: Art, src: Art, ox: number, oy: number): void {
  for (let y = 0; y < src.h; y++) {
    for (let x = 0; x < src.w; x++) {
      const i = (y * src.w + x) * 4;
      const d = ((oy + y) * dst.w + ox + x) * 4;
      dst.c.data.set(src.c.data.subarray(i, i + 4), d);
    }
  }
}

export function buildPetSheet(sp: Species): Canvas {
  const sheet = new Art(192, 192);
  for (let f = 0; f < 3; f++) {
    blit(sheet, front(sp, f), f * 32, 0);
    blit(sheet, sitFront(sp, f), (3 + f) * 32, 0);
    blit(sheet, back(sp, f), f * 32, 64);
    blit(sheet, sitBack(sp, f), (3 + f) * 32, 64);
    blit(sheet, side(sp, f), f * 64, 128);
  }
  return sheet.c;
}

export function buildPets(): Record<string, Canvas> {
  return {
    'pets/claudio/pet.png': buildPetSheet(CLAUDIO),
    'pets/gitcat/pet.png': buildPetSheet(GITCAT),
  };
}
