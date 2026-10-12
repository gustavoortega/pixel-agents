/**
 * The roster rows of the hover/selected box.
 */
import { describe, expect, it } from 'vitest';

import type { CacheTtlSeconds } from '../../core/src/messages.js';
import {
  type FullBoxRow,
  fullBoxRows,
  fullBoxTopOffsetPx,
  type SessionSignals,
} from '../src/office/fullBox.js';
import type { AgentRosterInfo } from '../src/office/toolUtils.js';

const roster: AgentRosterInfo = {
  memberId: 'm1',
  name: 'Luna',
  level: 15,
  xp: 30,
  xpToNext: 120,
  streak: 3,
  mood: 'happy',
};

describe('fullBoxRows', () => {
  it('name, level, xp fraction, streak, mood, model in its rarity', () => {
    expect(fullBoxRows({ roster, model: { id: 'claude-opus-4', rarity: 'epic' } })).toEqual([
      { kind: 'name', text: 'Luna' },
      { kind: 'level', text: 'Lv 15' },
      { kind: 'xp', fraction: 0.25, text: '30/120' },
      { kind: 'streak', count: 3 },
      { kind: 'mood', mood: 'happy' },
      { kind: 'model', text: 'claude-opus-4', rarity: 'epic' },
    ]);
  });

  it('an unknown model gets no model row', () => {
    const rows = fullBoxRows({ roster, model: { id: 'mystery-1' } });
    expect(rows.some((r) => r.kind === 'model')).toBe(false);
    expect(rows).toHaveLength(5);
  });

  it('no streak row at zero', () => {
    const rows = fullBoxRows({ roster: { ...roster, streak: 0 } });
    expect(rows.some((r) => r.kind === 'streak')).toBe(false);
  });

  it('no roster and no model: nothing', () => {
    expect(fullBoxRows({})).toEqual([]);
  });
});

describe('session signal rows', () => {
  const NOW = 1_760_000_000_000;
  const signals = (s: Partial<SessionSignals> = {}): SessionSignals => ({
    contextTokens: 50_000,
    now: NOW,
    ...s,
  });
  const clock = (ttlSeconds: CacheTtlSeconds, leftMs: number) => ({
    ttlSeconds,
    expiresAt: NOW + leftMs,
  });
  const kinds = (rows: FullBoxRow[]) => rows.map((r) => r.kind);
  const model = { id: 'claude-opus-4', rarity: 'epic' as const };

  it('C15 cache, mode and shells follow the roster and model rows, in that order', () => {
    const rows = fullBoxRows({
      roster,
      model,
      signals: signals({ cache: clock(3600, 59 * 60_000 + 30_000), mode: 'auto', shells: 3 }),
    });

    expect(kinds(rows)).toEqual([
      'name',
      'level',
      'xp',
      'streak',
      'mood',
      'model',
      'cache',
      'mode',
      'shells',
    ]);
    expect(rows.slice(-3)).toEqual([
      { kind: 'cache', text: 'cache 59m left' },
      { kind: 'mode', text: 'auto mode on' },
      { kind: 'shells', text: '3 shells' },
    ]);
  });

  it('C15 unknown, the default mode and no shells show no rows', () => {
    expect(fullBoxRows({ signals: signals() })).toEqual([]);
    expect(fullBoxRows({ signals: signals({ mode: 'default', shells: 0 }) })).toEqual([]);
  });

  it.each([
    ['minutes, rounded down', 3600, 59 * 60_000 + 59_999, 'cache 59m left'],
    ['seconds in the last minute', 3600, 42_500, 'cache 42s left'],
    ['cold once it expired', 3600, 0, 'cache cold'],
    ['the 5 minute class, marked', 300, 4 * 60_000, 'cache 4m left (5m)'],
    ['a cold 5 minute class, marked', 300, -1_000, 'cache cold (5m)'],
  ])('C15 the cache row counts %s', (_name, ttlSeconds, leftMs, text) => {
    const rows = fullBoxRows({
      signals: signals({ cache: clock(ttlSeconds as CacheTtlSeconds, leftMs) }),
    });
    expect(rows).toEqual([{ kind: 'cache', text }]);
  });

  it('C15 no cache row while the context is too small for a cold cache to cost anything', () => {
    const rows = fullBoxRows({
      signals: signals({ contextTokens: 19_999, cache: clock(3600, -1) }),
    });
    expect(rows).toEqual([]);
  });

  it('one shell reads singular', () => {
    expect(fullBoxRows({ signals: signals({ shells: 1 }) })).toEqual([
      { kind: 'shells', text: '1 shell' },
    ]);
  });

  it('C15 every session row lifts the box one row pitch, like the roster rows', () => {
    const without = fullBoxRows({ roster, model });
    const withSignals = fullBoxRows({
      roster,
      model,
      signals: signals({ cache: clock(3600, 60_000), mode: 'plan', shells: 2 }),
    });

    expect(fullBoxTopOffsetPx(withSignals, false) - fullBoxTopOffsetPx(without, false)).toBe(
      3 * 14,
    );
  });
});
