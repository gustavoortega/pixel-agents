import { describe, expect, it } from 'vitest';

import type { TokenSessionTotal, TokenWindow } from '../../core/src/messages.js';
import {
  areaBars,
  areaShares,
  formatPct,
  formatTokens,
  leader,
  modelChips,
  windowCaption,
} from '../src/components/usageView.js';

function win(over: Partial<TokenWindow> = {}): TokenWindow {
  return {
    source: 'estimated',
    start: 0,
    end: 1,
    total: 100,
    raw: 1000,
    byArea: [
      { area: 'Backend', folder: 'api', total: 60, raw: 100, share: 0.6 },
      { area: null, folder: 'scratch', total: 30, raw: 800, share: 0.3 },
      { area: 'Web', folder: 'web', total: 10, raw: 100, share: 0.1 },
    ],
    bySession: [],
    ...over,
  };
}

describe('formatTokens', () => {
  it.each([
    [0, '0'],
    [-5, '0'],
    [999, '999'],
    [1234, '1.2k'],
    [150_000, '150k'],
    [1_500_000, '1.5M'],
    [2_300_000_000, '2.3B'],
  ])('%s -> %s', (n, expected) => {
    expect(formatTokens(n)).toBe(expected);
  });
});

describe('formatPct', () => {
  it.each([
    [0, '0%'],
    [0.004, '<1%'],
    [0.426, '43%'],
    [1.25, '125%'],
  ])('%s -> %s', (f, expected) => {
    expect(formatPct(f)).toBe(expected);
  });
});

describe('areaBars / leader', () => {
  it('ranks by the chosen metric and recomputes shares from it', () => {
    const weighted = areaBars(win(), 'weighted');
    expect(weighted.map((b) => [b.name, b.share])).toEqual([
      ['Backend', 0.6],
      ['scratch', 0.3],
      ['Web', 0.1],
    ]);
    const raw = areaBars(win(), 'raw');
    expect(raw.map((b) => b.name)).toEqual(['scratch', 'Backend', 'Web']);
    expect(raw[0].share).toBe(0.8);
  });

  it('marks unassigned folders as Lobby entries named by folder', () => {
    const bar = areaBars(win(), 'weighted').find((b) => b.name === 'scratch');
    expect(bar?.lobby).toBe(true);
  });

  it('leader is the top bar, or null for an empty window', () => {
    expect(leader(win(), 'weighted')?.name).toBe('Backend');
    expect(leader(win({ total: 0, raw: 0, byArea: [] }), 'weighted')).toBeNull();
  });

  it('carries budget percent only when the server sent it', () => {
    const w = win({
      byArea: [{ area: 'Backend', folder: 'api', total: 60, raw: 1, budgetPct: 0.3 }],
    });
    expect(areaBars(w, 'weighted')[0].budgetPct).toBe(0.3);
    expect(areaBars(win(), 'weighted')[0]).not.toHaveProperty('budgetPct');
  });
});

describe('areaShares', () => {
  it('maps assigned Area labels only; absent or empty windows give nothing', () => {
    expect([...areaShares(win())]).toEqual([
      ['Backend', 0.6],
      ['Web', 0.1],
    ]);
    expect(areaShares(undefined).size).toBe(0);
    expect(areaShares(win({ total: 0 })).size).toBe(0);
  });
});

describe('modelChips', () => {
  it('lists the heaviest models first, without the claude- prefix, capped at three', () => {
    const session = {
      models: {
        'claude-haiku-5-5': 5,
        'claude-opus-5-5': 90,
        'claude-sonnet-5-5': 40,
        'claude-fable-5-1': 1,
      },
    } as unknown as TokenSessionTotal;
    expect(modelChips(session).map((c) => c.label)).toEqual([
      'opus-5-5',
      'sonnet-5-5',
      'haiku-5-5',
    ]);
  });
});

describe('windowCaption', () => {
  it('calls estimated windows estimated and quota windows by their reset', () => {
    expect(windowCaption(win())).toBe('estimated window');
    expect(windowCaption(win({ source: 'quota' }))).toMatch(/^resets \d\d:\d\d$/);
  });
});
