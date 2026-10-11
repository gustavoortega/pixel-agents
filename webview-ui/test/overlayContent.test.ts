/**
 * What an agent's overlay shows: the idle glyph, the compact label vs the full
 * box, and who gets an element at all.
 *
 * Run with: npm test
 */

import assert from 'node:assert/strict';

import { test } from 'vitest';

import {
  compactLabelMaxWidth,
  overlayContent,
  shouldShowXpPop,
  showOverlay,
  statusGlyph,
} from '../src/office/toolUtils.js';

test('statusGlyph: only an idle agent with nothing else above its head gets a z', () => {
  const idle = { isActive: false, bubbleType: null };
  const cases: Array<[string, Parameters<typeof statusGlyph>[0], boolean, 'z' | null]> = [
    ['idle, no bubble', idle, false, 'z'],
    ['active', { ...idle, isActive: true }, false, null],
    ['waiting bubble (done)', { ...idle, bubbleType: 'waiting' }, false, null],
    ['permission bubble', { ...idle, bubbleType: 'permission' }, false, null],
    // The idle "waiting for input" state draws no bubble, so the slot is free.
    [
      'waiting for input (no bubble drawn)',
      { ...idle, bubbleType: 'waiting', waitingAwaitingInput: true },
      false,
      'z',
    ],
    ['tripwire beacon owns the slot', idle, true, null],
  ];
  for (const [name, ch, tripwire, expected] of cases) {
    assert.equal(statusGlyph(ch, tripwire), expected, name);
  }
});

test('compactLabelMaxWidth is the seat pitch minus a gap, in CSS px', () => {
  assert.equal(compactLabelMaxWidth(3, 1), 184);
  assert.equal(compactLabelMaxWidth(2, 2), 56);
  assert.equal(compactLabelMaxWidth(0.1, 1), 0); // clamped, never negative
});

test('overlayContent: compact label, +N, tripwire line, full on hover, marker when narrow', () => {
  const base = { expanded: false, label: 'Fix login', subCount: 0, maxWidth: 184 };
  const tripwire = { ruleName: 'Dotenv file access', count: 2 };

  assert.deepEqual(overlayContent(base), {
    mode: 'compact',
    lines: [{ kind: 'label', text: 'Fix login', suffix: '' }],
  });
  assert.deepEqual(overlayContent({ ...base, subCount: 2 }), {
    mode: 'compact',
    lines: [{ kind: 'label', text: 'Fix login', suffix: ' +2' }],
  });
  assert.deepEqual(overlayContent({ ...base, tripwire }), {
    mode: 'compact',
    lines: [
      { kind: 'label', text: 'Fix login', suffix: '' },
      { kind: 'tripwire', text: '⚠ Dotenv file access ×2' },
    ],
  });
  assert.deepEqual(overlayContent({ ...base, label: null }), { mode: 'compact', lines: [] });
  assert.deepEqual(overlayContent({ ...base, expanded: true }), { mode: 'full' });
  // Hovering must still open the full box when the compact label has no room.
  assert.deepEqual(overlayContent({ ...base, expanded: true, maxWidth: 56 }), { mode: 'full' });
  assert.deepEqual(overlayContent({ ...base, maxWidth: 89 }), { mode: 'marker' });
  assert.equal(overlayContent({ ...base, maxWidth: 90 }).mode, 'compact');
});

test('showOverlay: sub-agents have no compact label but follow their parent', () => {
  const none = {
    isSub: false,
    isSelected: false,
    isHovered: false,
    parentSelected: false,
    parentHovered: false,
    alwaysShow: false,
  };
  const cases: Array<[string, Partial<typeof none>, 'full' | 'compact' | null]> = [
    ['agent, nothing', {}, null],
    ['agent, always-show', { alwaysShow: true }, 'compact'],
    ['agent, hovered', { isHovered: true, alwaysShow: true }, 'full'],
    ['agent, selected', { isSelected: true }, 'full'],
    ['sub, always-show', { isSub: true, alwaysShow: true }, null],
    ['sub, hovered', { isSub: true, isHovered: true }, 'full'],
    ['sub, selected', { isSub: true, isSelected: true }, 'full'],
    ['sub, parent hovered', { isSub: true, parentHovered: true }, 'full'],
    ['sub, parent selected', { isSub: true, parentSelected: true }, 'full'],
    // A parent's hover does not open a sibling agent's box.
    ['agent, parent flags ignored', { parentHovered: true, parentSelected: true }, null],
  ];
  for (const [name, patch, expected] of cases) {
    assert.equal(showOverlay({ ...none, ...patch }), expected, name);
  }
});

test('overlayContent: the level badge rides the label line, and shows without a label', () => {
  const base = { expanded: false, label: 'Fix login', subCount: 1, maxWidth: 184 };
  assert.deepEqual(overlayContent({ ...base, level: 7 }), {
    mode: 'compact',
    lines: [{ kind: 'label', text: 'Fix login', suffix: ' +1', badge: 'Lv7' }],
  });
  assert.deepEqual(overlayContent({ ...base, label: null, subCount: 0, level: 1 }), {
    mode: 'compact',
    lines: [{ kind: 'label', text: '', suffix: '', badge: 'Lv1' }],
  });
});

test('shouldShowXpPop: only a ship, a level-up or a big bonus, once per cooldown', () => {
  const t = 1_000_000;
  assert.equal(shouldShowXpPop({ kind: 'xp', amount: 85 }, undefined, t), false);
  assert.equal(shouldShowXpPop({ kind: 'xp', amount: 15 }, undefined, t), false);
  assert.equal(shouldShowXpPop({ kind: 'xp', amount: 100 }, undefined, t), true); // ship
  assert.equal(shouldShowXpPop({ kind: 'xp', amount: 105 }, undefined, t), true); // 3-streak bonus
  assert.equal(shouldShowXpPop({ kind: 'levelUp' }, undefined, t), true);
  assert.equal(shouldShowXpPop({ kind: 'levelUp' }, t - 9_999, t), false);
  assert.equal(shouldShowXpPop({ kind: 'levelUp' }, t - 10_000, t), true);
});
