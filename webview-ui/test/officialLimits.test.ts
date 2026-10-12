/**
 * The official limits as the Usage panel and the HUD card render them, on a fixed clock: fresh, stale, past their
 * reset, never received, and not installed. Only the pace numbers are limitsPace.test.ts's; these pin which state
 * shows what.
 *
 * Run with: npm test
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { TokenUsage, UsageLimits } from '../../core/src/messages.js';
import { HudCard } from '../src/components/HudCard.js';
import { UsagePanel } from '../src/components/UsagePanel.js';

const M = 60_000;
const H = 60 * M;
const NOW = Date.parse('2026-10-12T12:00:00Z');

/** The ledger's first pass is still running: the official row must not wait for it. */
const SCANNING: TokenUsage = { type: 'tokenUsage', generatedAt: NOW, scanning: true };

/** The first pass is done and a 5-hour block is running: totals the official row must sit above, never replace. */
const TOTALS: TokenUsage = {
  type: 'tokenUsage',
  generatedAt: NOW,
  block: {
    source: 'quota',
    start: NOW - 3 * H,
    end: NOW + 2 * H,
    total: 1_500_000,
    raw: 2_000_000,
    byArea: [],
    bySession: [],
  },
};

function reading(receivedAt: number, fiveHourResetsAt = NOW + 2 * H + 13 * M): UsageLimits {
  return {
    type: 'usageLimits',
    receivedAt,
    fiveHour: { usedPercentage: 37.6, resetsAt: fiveHourResetsAt },
    sevenDay: { usedPercentage: 12, resetsAt: NOW + 3 * 24 * H },
  };
}

function panel(
  limits: UsageLimits | null,
  statuslineInstalled = true,
  usage: TokenUsage = SCANNING,
): string {
  return renderToStaticMarkup(
    createElement(UsagePanel, { usage, limits, statuslineInstalled, onClose: () => {} }),
  );
}

function hud(limits: UsageLimits | null): string {
  return renderToStaticMarkup(
    createElement(HudCard, {
      characters: new Map(),
      zoom: 4,
      onZoomChange: () => {},
      fitActive: false,
      onFit: () => {},
      limits,
    }),
  );
}

/** Visible text: tags dropped, the entities React escapes decoded. */
function text(html: string): string {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&');
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('Usage panel: official row', () => {
  // C5: one more row above the totals, whatever state they are in. It never replaces or hides them.
  it.each([
    ['while the ledger is scanning', SCANNING, 'Reading your transcripts…'],
    ['once the ledger has its totals', TOTALS, '1.5M weighted tokens'],
  ])('shows a fresh reading above the totals %s', (_state, usage, totals) => {
    const shown = text(panel(reading(NOW - 5 * M), true, usage));

    expect(shown).toContain('Official · 38% used · resets in 2h13m');
    expect(shown).not.toContain('ago');
    expect(shown.indexOf(totals)).toBeGreaterThan(shown.indexOf('Official · 38% used'));
  });

  // C5: an idle Claude Code stops posting between turns; known-good numbers stay, dimmed and aged, until the reset.
  it('keeps a stale reading, dimmed and aged', () => {
    const html = panel(reading(NOW - 23 * M));

    expect(text(html)).toContain('Official · 38% used · resets in 2h13m · 23m ago');
    expect(html).toContain('opacity-60');
  });

  it('shows no number once both windows are past their reset, only that it is waiting', () => {
    const past = { ...reading(NOW - 6 * H, NOW - M), sevenDay: null };

    const shown = text(panel(past));

    expect(shown).toContain("Waiting for Claude Code's status line…");
    expect(shown).not.toContain('Official ·');
  });

  it('says how to turn it on when the wrapper is not installed', () => {
    const shown = text(panel(reading(NOW - 5 * M), false));

    expect(shown).toContain('Official limits are off. Turn on "Claude status line" in Settings.');
    expect(shown).not.toContain('Official ·');
  });

  // A VS Code window reusing another window's server is never told it receives the limits: nothing new there.
  it('shows nothing about official limits before the server says it receives them', () => {
    const shown = text(panel(null));

    expect(shown).not.toContain('Official');
    expect(shown).not.toContain('Waiting for');
  });
});

describe('HUD card: limits line', () => {
  it('reads both live windows on one line', () => {
    expect(text(hud(reading(NOW - 5 * M)))).toContain('5h 38% · 7d 12%');
  });

  it('omits a window past its reset, and the whole line when none is live', () => {
    const fiveHourGone = reading(NOW - 6 * H, NOW - M);
    expect(text(hud(fiveHourGone))).toContain('7d 12%');
    expect(text(hud(fiveHourGone))).not.toContain('5h ');

    expect(hud({ ...fiveHourGone, sevenDay: null })).not.toContain('hud-limits');
    expect(hud(null)).not.toContain('hud-limits');
  });
});
