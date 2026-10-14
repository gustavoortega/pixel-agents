import { describe, expect, it } from 'vitest';

import type { LimitWindow, UsageLimits } from '../../core/src/messages.js';
import {
  formatDuration,
  limitPace,
  limitsNudge,
  officialRow,
  paceRows,
  paceTipKey,
} from '../src/components/limitsPace.js';

const M = 60_000;
const H = 60 * M;
const D = 24 * H;
const FIVE_H = 5 * H;
const WEEK = 7 * D;
const RECEIVED = Date.parse('2026-10-12T12:00:00Z');

/** A window read at RECEIVED with `elapsed` of it gone. */
function window(used: number, span: number, elapsed: number): LimitWindow {
  return { usedPercentage: used, resetsAt: RECEIVED + (1 - elapsed) * span };
}

function limits(over: Partial<UsageLimits> = {}): UsageLimits {
  return { type: 'usageLimits', receivedAt: RECEIVED, fiveHour: null, sevenDay: null, ...over };
}

describe('formatDuration', () => {
  it.each([
    [-5, '<1m'],
    [0, '<1m'],
    [59_999, '<1m'],
    [M, '1m'],
    [37 * M + 59_000, '37m'],
    [4 * H + 5 * M, '4h05m'],
    [2 * D + 23 * H + 59 * M, '2d23h'],
  ])('%s ms -> %s', (ms, expected) => {
    expect(formatDuration(ms)).toBe(expected);
  });
});

describe('limitPace', () => {
  // Half the window gone: the projection doubles what is used. Colors follow the status line it mirrors.
  it.each([
    [30, 60, 'green'],
    [45, 90, 'yellow'],
    [60, 120, 'red'],
  ])('at half the window, %s used projects %s: %s', (used, projection, tone) => {
    const pace = limitPace(window(used, FIVE_H, 0.5), RECEIVED, 'fiveHour');
    expect(pace.projection).toBeCloseTo(projection);
    expect(pace.tone).toBe(tone);
  });

  it('says when a pace over 100 % runs out, counted from the reading', () => {
    // 60 % in 2.5 h: the remaining 40 % lasts (100 - 60) * 2.5 h / 60 = 1 h 40 m.
    expect(limitPace(window(60, FIVE_H, 0.5), RECEIVED, 'fiveHour').runoutMs).toBeCloseTo(100 * M);
    expect(limitPace(window(45, FIVE_H, 0.5), RECEIVED, 'fiveHour').runoutMs).toBeUndefined();
  });

  // The first 5 % of a window swings wildly: no projection, and the color rests on what is used.
  it('projects nothing early in the window or with nothing used', () => {
    expect(limitPace(window(10, WEEK, 0.04), RECEIVED, 'sevenDay').projection).toBeUndefined();
    expect(limitPace(window(85, WEEK, 0.04), RECEIVED, 'sevenDay').tone).toBe('red');
    expect(limitPace(window(0, FIVE_H, 0.5), RECEIVED, 'fiveHour').projection).toBeUndefined();
  });

  it('colors by the rounded figure the panel prints', () => {
    expect(limitPace(window(79.6, WEEK, 0.04), RECEIVED, 'sevenDay').tone).toBe('red');
  });

  // An overdrawn window never formats a negative duration.
  it.each([100, 250])('clamps the run-out at 0 with %s used', (used) => {
    expect(limitPace(window(used, FIVE_H, 0.5), RECEIVED, 'fiveHour').runoutMs).toBe(0);
  });
});

describe('officialRow', () => {
  it('reads a fresh reading, rounded the way the status line prints it', () => {
    const now = RECEIVED + 5 * M;
    const row = officialRow(
      limits({ fiveHour: { usedPercentage: 37.6, resetsAt: now + 2 * H + 13 * M } }),
      'fiveHour',
      now,
    );
    expect(row).toMatchObject({ text: 'Official · 38% used · resets in 2h13m', stale: false });
  });

  // Pace is computed at the reading, not at now: a stale reading keeps the projection it had.
  it('ages a stale reading and keeps the pace of the moment it was read', () => {
    const fiveHour = window(30, FIVE_H, 0.5); // resets 2 h 30 m after the reading
    const now = RECEIVED + 23 * M;
    expect(officialRow(limits({ fiveHour }), 'fiveHour', now)).toEqual({
      text: 'Official · 30% used · resets in 2h07m · 23m ago',
      tone: 'green',
      stale: true,
      pace: 'on pace for 60%',
    });
  });

  it.each([
    [0.4, 'Official · 0% used'],
    [0, 'Official · 0% used'],
  ])('shows %s used as a real value', (used, prefix) => {
    const row = officialRow(limits({ sevenDay: window(used, WEEK, 0.5) }), 'sevenDay', RECEIVED);
    expect(row?.text.startsWith(prefix)).toBe(true);
  });

  it('has no row once the window reset or before anything was read', () => {
    const fiveHour = window(30, FIVE_H, 0.5);
    expect(officialRow(limits({ fiveHour }), 'fiveHour', fiveHour.resetsAt)).toBeNull();
    expect(officialRow(limits({ fiveHour }), 'sevenDay', RECEIVED)).toBeNull();
    expect(officialRow(null, 'fiveHour', RECEIVED)).toBeNull();
  });

  it('drops the pace line once the limit is reached', () => {
    const row = officialRow(limits({ fiveHour: window(100, FIVE_H, 0.5) }), 'fiveHour', RECEIVED);
    expect(row?.pace).toBeUndefined();
  });
});

describe('limitsNudge', () => {
  it('names the weekly window first when both run out', () => {
    const both = limits({
      fiveHour: window(60, FIVE_H, 0.5),
      sevenDay: window(60, WEEK, 0.5),
    });
    expect(limitsNudge(both, RECEIVED)).toBe(
      'at this pace the 7d window runs out in 2d8h, before reset: slow down or use a cheaper model',
    );
  });

  it('falls back to the 5-hour window', () => {
    const fiveOnly = limits({ fiveHour: window(60, FIVE_H, 0.5), sevenDay: window(10, WEEK, 0.5) });
    expect(limitsNudge(fiveOnly, RECEIVED)).toBe(
      'at this pace the 5h window runs out in 1h40m, before reset: slow down or use a cheaper model',
    );
  });

  it.each([100, 250])('says the limit is reached with %s used', (used) => {
    expect(limitsNudge(limits({ fiveHour: window(used, FIVE_H, 0.5) }), RECEIVED)).toBe(
      'the 5h limit is reached: resets in 2h30m',
    );
  });

  it('stays quiet on a pace that fits the window', () => {
    expect(limitsNudge(limits({ fiveHour: window(30, FIVE_H, 0.5) }), RECEIVED)).toBeNull();
  });
});

describe('paceRows (the monitor Pace panel)', () => {
  // One row per live window; the head says the one thing about it, by its pace.
  it.each([
    [
      'runs out before a 5-hour reset: its clock',
      'fiveHour',
      60,
      0.5,
      ['runs out', 'CLOCK', ''],
      'red',
    ],
    [
      'runs out before the weekly reset: how long',
      'sevenDay',
      60,
      0.5,
      ['runs out in', '2d8h', ''],
      'red',
    ],
    ['lands under 100 %: where it lands', 'fiveHour', 30, 0.5, ['', '60%', 'at reset'], 'green'],
    ['early in the window: only what is used', 'fiveHour', 3, 0.02, ['', '3%', 'used'], 'green'],
    ['full: reached', 'sevenDay', 100, 0.5, ['', '100%', 'used · limit reached'], 'red'],
  ] as const)('%s', (_case, key, used, elapsed, head, tone) => {
    const span = key === 'fiveHour' ? FIVE_H : WEEK;
    const [row] = paceRows(limits({ [key]: window(used, span, elapsed) }), RECEIVED);
    const shown = head[1] === 'CLOCK' ? [head[0], row.head.value, head[2]] : head;
    expect([row.head.before, row.head.value, row.head.after]).toEqual(shown);
    expect(row.tone).toBe(tone);
    expect(row.mark).toBe(Math.round(elapsed * 100));
    expect(row.usedInHead).toBe(head[2].startsWith('used'));
  });

  it('dates the run-out from the reading and prints it as a clock', () => {
    // 60 % in 2.5 h runs out 1 h 40 m after the reading.
    const [row] = paceRows(limits({ fiveHour: window(60, FIVE_H, 0.5) }), RECEIVED);
    expect(row.outAt).toBe(RECEIVED + 100 * M);
    const at = new Date(RECEIVED + 100 * M);
    const clock = `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
    expect(row.head.value).toBe(clock);
  });

  it('has no row for a window with no reading or past its reset, so nothing reads 0 %', () => {
    expect(paceRows(null, RECEIVED)).toEqual([]);
    const gone = { usedPercentage: 50, resetsAt: RECEIVED - M };
    expect(paceRows(limits({ fiveHour: gone }), RECEIVED)).toEqual([]);
    expect(
      paceRows(limits({ sevenDay: window(10, WEEK, 0.5) }), RECEIVED).map((r) => r.key),
    ).toEqual(['sevenDay']);
  });

  it('ages a stale reading and leaves a fresh one unaged', () => {
    const read = limits({ fiveHour: window(30, FIVE_H, 0.5) });
    expect(paceRows(read, RECEIVED + 5 * M)[0].age).toBeUndefined();
    expect(paceRows(read, RECEIVED + 23 * M)[0].age).toBe('23m ago');
  });

  it('puts the one tip on the weekly window first, then the 5-hour one, and none on a safe pace', () => {
    const both = limits({ fiveHour: window(60, FIVE_H, 0.5), sevenDay: window(60, WEEK, 0.5) });
    expect(paceTipKey(paceRows(both, RECEIVED))).toBe('sevenDay');
    const block = limits({ fiveHour: window(60, FIVE_H, 0.5), sevenDay: window(10, WEEK, 0.5) });
    expect(paceTipKey(paceRows(block, RECEIVED))).toBe('fiveHour');
    const safe = limits({ fiveHour: window(30, FIVE_H, 0.5) });
    expect(paceTipKey(paceRows(safe, RECEIVED))).toBeNull();
  });
});
