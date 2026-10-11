/**
 * The glow sprites' gradients: what stops and radius each kind asks the canvas for.
 *
 * Run with: npm test
 */

import assert from 'node:assert/strict';

import { afterAll, beforeAll, test, vi } from 'vitest';

import { getGlowSprite } from '../src/office/sprites/glowSprites.js';

interface GradientCall {
  kind: 'radial' | 'linear';
  args: number[];
  stops: Array<[number, string]>;
}
const gradients: GradientCall[] = [];

beforeAll(() => {
  vi.stubGlobal('document', {
    createElement: () => ({
      width: 0,
      height: 0,
      getContext: () => ({
        fillRect: () => undefined,
        createRadialGradient: (...args: number[]) => {
          const g: GradientCall = { kind: 'radial', args, stops: [] };
          gradients.push(g);
          return { addColorStop: (o: number, c: string) => g.stops.push([o, c]) };
        },
        createLinearGradient: (...args: number[]) => {
          const g: GradientCall = { kind: 'linear', args, stops: [] };
          gradients.push(g);
          return { addColorStop: (o: number, c: string) => g.stops.push([o, c]) };
        },
      }),
    }),
  });
});
afterAll(() => {
  vi.unstubAllGlobals();
});

const build = (kind: Parameters<typeof getGlowSprite>[0]) => {
  gradients.length = 0;
  getGlowSprite(kind, 2.5); // a zoom no other test builds, so the cache is cold
  return gradients[0];
};

/** [offset, alpha] of each stop; colors live in constants.ts, so only their alpha is asserted. */
const alphas = (g: GradientCall) =>
  g.stops.map(([offset, color]) => [offset, Number(/([\d.]+)\)$/.exec(color)![1])]);

test('lampPool: 4 tiles across the radius, bright core, half-strength shoulder, clear edge', () => {
  const g = build('lampPool');
  assert.equal(g.kind, 'radial');
  assert.equal(g.args[5], 4 * 16 * 2.5, 'outer radius');
  assert.deepEqual(alphas(g), [
    [0, 0.38],
    [0.55, 0.16],
    [1, 0],
  ]);
});

test('monitorPool: 2.5 tiles, mint core that is already clear at 70% of the radius', () => {
  const g = build('monitorPool');
  assert.equal(g.args[5], 2.5 * 16 * 2.5, 'outer radius');
  assert.deepEqual(alphas(g), [
    [0, 0.3],
    [0.7, 0],
    [1, 0],
  ]);
});
