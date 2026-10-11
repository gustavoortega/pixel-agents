/** Seeded particle layouts for the sparkle burst and the confetti, so a burst replays identically. */

export interface Particle {
  /** Launch velocity, world px/s. */
  vx: number;
  vy: number;
  colorIndex: number;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** `count` particles fanned over a full circle (sparkle) or an upward cone (confetti). */
export function makeParticles(
  seed: number,
  count: number,
  speed: number,
  upward: boolean,
  colors: number,
): Particle[] {
  const rnd = mulberry32(seed);
  const out: Particle[] = [];
  for (let i = 0; i < count; i++) {
    const angle = upward
      ? -Math.PI / 2 + (rnd() - 0.5) * Math.PI * 0.9
      : ((i + rnd() * 0.5) / count) * Math.PI * 2;
    const v = speed * (0.6 + rnd() * 0.4);
    out.push({
      vx: Math.cos(angle) * v,
      vy: Math.sin(angle) * v,
      colorIndex: Math.floor(rnd() * colors),
    });
  }
  return out;
}

/** Position after `ageSec` of flight under `gravity` (0 for the sparkle burst). */
export function particleAt(p: Particle, ageSec: number, gravity: number): { x: number; y: number } {
  return { x: p.vx * ageSec, y: p.vy * ageSec + 0.5 * gravity * ageSec * ageSec };
}
