/**
 * One world -> device rule for the canvas and the DOM overlays: scale, then round once. A half
 * world px is one art px at ART_DENSITY 2, so rounding before scaling would move sprites and
 * their plates apart by up to half a world px.
 *
 * Run with: npm test
 */
import { describe, expect, it } from 'vitest';

import { characterDrawOrigin } from '../src/office/flair/accessories.js';
import { overlayProjection } from '../src/office/projection.js';
import { CharacterState } from '../src/office/types.js';

describe('worldToDevice', () => {
  // 2x2 tiles (32 world px) fill a 32 * zoom device px container exactly, so the map offset is 0.
  // At zoom 3 world x 10.5 lands on device 31.5: the one level where a half world px is half a
  // device px, so only there does an overlay that skips the rounding drift off its sprite.
  const layout = { cols: 2, rows: 2 };
  const table: Array<[zoom: number, dpr: number, deviceX: number]> = [
    [3, 1, 32],
    [3, 2, 32],
    [4, 1, 42],
    [4, 2, 42],
  ];

  for (const [zoom, dpr, deviceX] of table) {
    it(`puts world x 10.5 on device x ${deviceX} at zoom ${zoom}, dpr ${dpr}, sprite and plate alike`, () => {
      const ch = { x: 10.5, y: 20, state: CharacterState.IDLE };
      const spriteW = 16 * zoom;
      const { drawX } = characterDrawOrigin(ch, spriteW, 32 * zoom, 0, 0, zoom);
      expect(drawX + spriteW / 2).toBe(deviceX);

      const side = (32 * zoom) / dpr;
      const project = overlayProjection(
        layout,
        { width: side, height: side },
        zoom,
        { x: 0, y: 0 },
        dpr,
      );
      // DOM px are device px over dpr
      expect(project.toScreenX(10.5)).toBe(deviceX / dpr);
    });
  }
});
