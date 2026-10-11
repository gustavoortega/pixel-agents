import { describe, expect, it } from 'vitest';

import { TOKEN_LEDGER_TOP_SESSIONS } from '../src/constants.js';
import type { LedgerRecord, Usage4 } from '../src/tokenAggregate.js';
import {
  aggregateWindow,
  groupBlocks,
  ownerSession,
  resolveWindows,
  weightedTokens,
} from '../src/tokenAggregate.js';

const H = 60 * 60 * 1000;
const D = 24 * H;
const at = (iso: string): number => Date.parse(`2026-10-10T${iso}:00Z`);

function rec(over: Partial<LedgerRecord> & { ts: number }): LedgerRecord {
  return { s: 's1', f: 'repo', m: 'claude-opus-5-5', u: [10, 0, 0, 0], ...over };
}

describe('weightedTokens', () => {
  it.each<[string, Usage4, number]>([
    ['input only', [100, 0, 0, 0], 100],
    ['cache creation x1.25', [0, 100, 0, 0], 125],
    ['cache read x0.1', [0, 0, 100, 0], 10],
    ['output x5', [0, 0, 0, 100], 500],
    ['all four', [100, 100, 1000, 10], 100 + 125 + 100 + 50],
  ])('%s', (_name, usage, expected) => {
    expect(weightedTokens(usage)).toBeCloseTo(expected);
  });
});

describe('groupBlocks', () => {
  it.each<[string, string[], Array<[string, string]>]>([
    ['one record floors to the hour', ['10:20'], [['10:00', '15:00']]],
    ['records inside the 5 h span share a block', ['10:20', '14:59'], [['10:00', '15:00']]],
    [
      'a record at the block end starts a new block',
      ['10:20', '15:00'],
      [
        ['10:00', '15:00'],
        ['15:00', '20:00'],
      ],
    ],
    [
      'a gap over 5 h starts a block floored to its own hour',
      ['10:20', '16:40'],
      [
        ['10:00', '15:00'],
        ['16:00', '21:00'],
      ],
    ],
  ])('%s', (_name, stamps, expected) => {
    const blocks = groupBlocks(stamps.map((s) => ({ ts: at(s) })));
    expect(blocks.map((b) => [b.start, b.end])).toEqual(expected.map(([a, b]) => [at(a), at(b)]));
  });
});

describe('resolveWindows', () => {
  const stamps = [at('10:20'), at('12:00')];

  it('current block is the one containing now', () => {
    const w = resolveWindows(stamps, {}, at('13:00'));
    expect(w.block).toEqual({ source: 'estimated', start: at('10:00'), end: at('15:00') });
  });

  it('now past the last block: the block field is absent, not zero', () => {
    expect(resolveWindows(stamps, {}, at('15:30')).block).toBeUndefined();
  });

  it('week is the rolling last 7 days when no quota is known', () => {
    const now = at('13:00');
    expect(resolveWindows(stamps, {}, now).week).toEqual({
      source: 'estimated',
      start: now - 7 * D,
      end: now,
    });
  });

  it('a seven_day reset in the future anchors the week to [reset - 7 d, reset]', () => {
    const now = at('13:00');
    const resetsAt = now + 2 * D;
    const w = resolveWindows(stamps, { week: { ts: now - H, resetsAt } }, now);
    expect(w.week).toEqual({ source: 'quota', start: resetsAt - 7 * D, end: resetsAt });
  });

  it('a five_hour reset in the future anchors the block, even with no record in it', () => {
    const now = at('17:00');
    const resetsAt = now + 2 * H;
    const w = resolveWindows(stamps, { block: { ts: now - H, resetsAt } }, now);
    expect(w.block).toEqual({ source: 'quota', start: resetsAt - 5 * H, end: resetsAt });
  });

  it('a quota reset already in the past is ignored', () => {
    const now = at('13:00');
    const w = resolveWindows(stamps, { week: { ts: now - 9 * D, resetsAt: now - D } }, now);
    expect(w.week.source).toBe('estimated');
  });
});

describe('ownerSession', () => {
  const first = new Map([
    ['zzz', 100],
    ['aaa', 200],
    ['bbb', 100],
  ]);

  it.each<[string, Pick<LedgerRecord, 's' | 'x'>, string]>([
    ['earliest own first record wins over alphabet', { s: 'aaa', x: ['zzz'] }, 'zzz'],
    ['stored order does not matter', { s: 'zzz', x: ['aaa'] }, 'zzz'],
    ['equal first records: smallest session id', { s: 'zzz', x: ['bbb'] }, 'bbb'],
    ['unknown first record loses', { s: 'ghost', x: ['aaa'] }, 'aaa'],
    ['single candidate', { s: 'aaa' }, 'aaa'],
  ])('%s', (_name, partial, expected) => {
    expect(ownerSession({ ts: 0, f: 'f', m: 'm', u: [1, 0, 0, 0], ...partial }, first)).toBe(
      expected,
    );
  });
});

describe('aggregateWindow', () => {
  const ctx = {
    sessionFirst: new Map<string, number>(),
    titles: new Map<string, string>(),
    mappings: {},
  };
  const span = { start: 0, end: 1000 };

  it('omits share when the window total is 0', () => {
    const out = aggregateWindow([rec({ ts: 10, u: [0, 0, 0, 0] })], span, ctx);
    expect(out.total).toBe(0);
    expect(out.byArea[0]).not.toHaveProperty('share');
  });

  it('groups by first mapped label; unmapped folders stay under their own name with area null', () => {
    const out = aggregateWindow(
      [
        rec({ ts: 1, f: 'api', u: [60, 0, 0, 0] }),
        rec({ ts: 2, f: 'web', u: [30, 0, 0, 0] }),
        rec({ ts: 3, f: 'misc', u: [10, 0, 0, 0] }),
      ],
      span,
      { ...ctx, mappings: { api: ['Backend', 'Other'], web: ['Backend'] } },
    );
    expect(out.byArea.map((a) => [a.area, a.folder, a.total, a.share])).toEqual([
      ['Backend', 'api', 90, 0.9],
      [null, 'misc', 10, 0.1],
    ]);
  });

  it('adds budget percentages only when a budget is given', () => {
    const records = [rec({ ts: 1, u: [50, 0, 0, 0] })];
    expect(aggregateWindow(records, span, ctx).byArea[0]).not.toHaveProperty('budgetPct');
    expect(aggregateWindow(records, span, { ...ctx, budget: 200 }).byArea[0].budgetPct).toBe(0.25);
  });

  it('ranks sessions with equal totals by session id', () => {
    const out = aggregateWindow(
      [rec({ ts: 1, s: 'tie-b', u: [5, 0, 0, 0] }), rec({ ts: 2, s: 'tie-a', u: [5, 0, 0, 0] })],
      span,
      ctx,
    );
    expect(out.bySession.map((s) => s.sessionId)).toEqual(['tie-a', 'tie-b']);
  });

  it('keeps only the top sessions by total, with weighted and raw per-model counts', () => {
    const records: LedgerRecord[] = [];
    for (let i = 0; i < TOKEN_LEDGER_TOP_SESSIONS + 5; i++) {
      records.push(rec({ ts: i + 1, s: `s${String(i).padStart(2, '0')}`, u: [i + 1, 0, 0, 0] }));
    }
    records.push(rec({ ts: 99, s: 's00', m: 'claude-haiku-5-5', u: [0, 4, 0, 2] }));
    const out = aggregateWindow(records, span, ctx);
    expect(out.bySession).toHaveLength(TOKEN_LEDGER_TOP_SESSIONS);
    expect(out.bySession[0].sessionId).toBe(`s${TOKEN_LEDGER_TOP_SESSIONS + 4}`);
    const all = aggregateWindow(
      records.filter((r) => r.s === 's00'),
      span,
      ctx,
    ).bySession[0];
    expect(all.models).toEqual({ 'claude-opus-5-5': 1, 'claude-haiku-5-5': 4 * 1.25 + 2 * 5 });
    expect(all.rawModels['claude-haiku-5-5']).toEqual([0, 4, 0, 2]);
  });
});
