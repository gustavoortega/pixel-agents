/**
 * XP pops, level-ups and mood weather: the budget, the queue and the global caps.
 */
import { describe, expect, it } from 'vitest';

import { FX_LEVEL_UP_MS, FX_STORM_MS } from '../src/constants.js';
import { FxEngine } from '../src/office/fx/fxEngine.js';
import { MoodWeather } from '../src/office/fx/moodWeather.js';

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
