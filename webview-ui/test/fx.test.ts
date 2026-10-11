/**
 * XP pops, level-ups and mood weather: the budget, the queue and the global caps.
 */
import { describe, expect, it } from 'vitest';

import {
  CHARACTER_SPRITE_HEIGHT_PX,
  FX_LEVEL_UP_MS,
  FX_STORM_CLOUD_COLOR,
  FX_STORM_CLOUD_SHADE,
  FX_STORM_MS,
} from '../src/constants.js';
import { FxEngine } from '../src/office/fx/fxEngine.js';
import { type FxRenderState, renderFx } from '../src/office/fx/fxRender.js';
import { MoodWeather } from '../src/office/fx/moodWeather.js';
import { spriteHeadTopY } from '../src/office/nameplate.js';
import { weatherAnchorY } from '../src/office/overlayStack.js';
import { seatedDrawOffsetPx } from '../src/office/seatDraw.js';
import type { Character } from '../src/office/types.js';
import { CharacterState } from '../src/office/types.js';

describe('FxEngine level-up', () => {
  it('a level-up with a big amount plays the level-up only, never also a pop', () => {
    const fx = new FxEngine();
    fx.onRosterEvent(1, { kind: 'levelUp', amount: 500, level: 2 }, 0);
    expect(fx.active.map((a) => a.kind)).toEqual(['levelUp']);
  });
});

describe('FxEngine budget', () => {
  it('5 level-ups: 3 play, 2 queue', () => {
    const fx = new FxEngine();
    for (let id = 1; id <= 5; id++) fx.onRosterEvent(id, { kind: 'levelUp', level: 2 }, 0);
    expect(fx.active.map((a) => a.agentId)).toEqual([1, 2, 3]);
    expect(fx.queue.map((q) => q.agentId)).toEqual([4, 5]);
  });

  it('queued level-ups start as slots free up', () => {
    const fx = new FxEngine();
    for (let id = 1; id <= 5; id++) fx.onRosterEvent(id, { kind: 'levelUp', level: 2 }, 0);
    fx.tick(FX_LEVEL_UP_MS);
    expect(fx.active.map((a) => a.agentId)).toEqual([4, 5]);
    expect(fx.queue).toEqual([]);
  });

  it('the queue holds 6 and drops the oldest', () => {
    const fx = new FxEngine();
    for (let id = 1; id <= 10; id++) fx.onRosterEvent(id, { kind: 'levelUp', level: 2 }, 0);
    expect(fx.queue.map((q) => q.agentId)).toEqual([5, 6, 7, 8, 9, 10]);
  });

  it('pops over budget are dropped, not queued', () => {
    const fx = new FxEngine();
    for (let id = 1; id <= 3; id++) fx.onRosterEvent(id, { kind: 'levelUp', level: 2 }, 0);
    fx.onRosterEvent(9, { kind: 'xp', amount: 100 }, 0);
    expect(fx.queue).toEqual([]);
    fx.tick(FX_LEVEL_UP_MS);
    expect(fx.active).toEqual([]);
  });

  it('a pop inside the cooldown is ignored', () => {
    const fx = new FxEngine();
    fx.onRosterEvent(1, { kind: 'xp', amount: 100 }, 0);
    fx.onRosterEvent(1, { kind: 'xp', amount: 100 }, 5000);
    expect(fx.active).toHaveLength(1);
  });
});

describe('FxEngine one level-up per agent', () => {
  it('a second level-up queues and the banner shows the latest level', () => {
    const fx = new FxEngine();
    fx.onRosterEvent(1, { kind: 'levelUp', level: 2 }, 0);
    fx.onRosterEvent(1, { kind: 'levelUp', level: 3 }, 100);
    fx.onRosterEvent(1, { kind: 'levelUp', level: 4 }, 200);
    expect(fx.active.filter((a) => a.agentId === 1)).toHaveLength(1);
    expect(fx.active[0].level).toBe(2);
    expect(fx.queue).toEqual([{ agentId: 1, level: 4 }]);
    fx.tick(FX_LEVEL_UP_MS);
    expect(fx.active.map((a) => a.level)).toEqual([4]);
  });
});

describe('MoodWeather storm', () => {
  const moods = (m: Record<number, 'happy' | 'frustrated' | 'neutral' | 'alarmed'>) =>
    new Map(Object.entries(m).map(([k, v]) => [Number(k), v]));

  it('shows while frustrated and is gone 20 s after the mood started', () => {
    const w = new MoodWeather();
    w.update(moods({ 1: 'frustrated' }), 0);
    expect(w.stormAlpha(1, 1000)).toBe(1);
    expect(w.stormAlpha(1, FX_STORM_MS - 1000)).toBeGreaterThan(0);
    expect(w.stormAlpha(1, FX_STORM_MS - 1000)).toBeLessThan(1);
    expect(w.stormAlpha(1, FX_STORM_MS)).toBeNull();
  });

  it('is back when the mood re-enters', () => {
    const w = new MoodWeather();
    w.update(moods({ 1: 'frustrated' }), 0);
    w.update(moods({ 1: 'neutral' }), 25_000);
    w.update(moods({ 1: 'frustrated' }), 30_000);
    expect(w.stormAlpha(1, 31_000)).toBe(1);
  });

  it('at most 2 storms at once', () => {
    const w = new MoodWeather();
    w.update(moods({ 1: 'frustrated', 2: 'frustrated', 3: 'frustrated' }), 0);
    expect([1, 2, 3].filter((id) => w.stormAlpha(id, 1000) !== null)).toEqual([1, 2]);
  });
});

describe('MoodWeather heart', () => {
  const moods = (m: Record<number, 'happy' | 'neutral'>) =>
    new Map(Object.entries(m).map(([k, v]) => [Number(k), v]));

  it('one heart on entering happy, then every 30 s', () => {
    const w = new MoodWeather();
    w.update(moods({ 1: 'neutral' }), 0);
    expect(w.hearts).toHaveLength(0);
    w.update(moods({ 1: 'happy' }), 1000);
    expect(w.hearts).toHaveLength(1);
    w.update(moods({ 1: 'happy' }), 20_000);
    expect(w.hearts).toHaveLength(0);
    w.update(moods({ 1: 'happy' }), 31_000);
    expect(w.hearts).toHaveLength(1);
  });

  it('none after leaving happy', () => {
    const w = new MoodWeather();
    w.update(moods({ 1: 'happy' }), 0);
    w.update(moods({ 1: 'neutral' }), 10_000);
    w.update(moods({ 1: 'neutral' }), 31_000);
    expect(w.hearts).toHaveLength(0);
  });

  it('office-wide: 1 heart per 10 s, the held one goes out when the gap opens', () => {
    const w = new MoodWeather();
    w.update(moods({ 1: 'happy', 2: 'happy' }), 0);
    expect(w.hearts.map((h) => h.agentId)).toEqual([1]);
    w.update(moods({ 1: 'happy', 2: 'happy' }), 5000);
    expect(w.hearts).toEqual([]);
    w.update(moods({ 1: 'happy', 2: 'happy' }), 10_000);
    expect(w.hearts.map((h) => h.agentId)).toEqual([2]);
  });
});

describe('storm cloud placement', () => {
  const ZOOM = 4;
  const OX = 10;
  const OY = 20;
  /** Seated agent: the sprite is drawn 6 px low while the old bubble anchor sat 10 px low. */
  const seated = { id: 7, x: 100, y: 200, state: CharacterState.TYPE } as Character;

  /** Bottom edge, in device px, of the cloud renderFx draws with the given anchors. */
  function cloudBottom(anchors?: ReadonlyMap<number, number>): number {
    const weather = new MoodWeather();
    weather.update(new Map([[seated.id, 'frustrated' as const]]), 0);
    const state: FxRenderState = { effects: [], weather, nowMs: 1000, anchors };
    let fill = '';
    let bottom = -Infinity;
    const ctx = {
      save() {},
      restore() {},
      set fillStyle(v: string) {
        fill = v;
      },
      set globalAlpha(_v: number) {},
      fillRect(_x: number, y: number, _w: number, h: number) {
        if (fill === FX_STORM_CLOUD_COLOR || fill === FX_STORM_CLOUD_SHADE)
          bottom = Math.max(bottom, y + h);
      },
    } as unknown as CanvasRenderingContext2D;
    renderFx(ctx, state, [seated], OX, OY, ZOOM);
    return bottom;
  }

  const headTopDevice = OY + Math.round(spriteHeadTopY(seated.y, seatedDrawOffsetPx(seated)) * ZOOM);

  it('face-on: the cloud floats above the stack top, not inside the head', () => {
    const headTop = spriteHeadTopY(seated.y, seatedDrawOffsetPx(seated));
    const stackTop = headTop - 40;
    const anchors = new Map([[seated.id, weatherAnchorY(stackTop, headTop)]]);
    expect(cloudBottom(anchors)).toBeLessThanOrEqual(OY + stackTop * ZOOM);
    expect(cloudBottom(anchors)).toBeLessThan(headTopDevice);
  });

  it('back view: the stack is below the feet, so the cloud stands just above the head', () => {
    const headTop = spriteHeadTopY(seated.y, seatedDrawOffsetPx(seated));
    const belowFeet = headTop + CHARACTER_SPRITE_HEIGHT_PX + 10;
    const anchors = new Map([[seated.id, weatherAnchorY(belowFeet, headTop)]]);
    expect(cloudBottom(anchors)).toBeLessThanOrEqual(headTopDevice);
  });
});
