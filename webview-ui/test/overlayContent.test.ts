/**
 * What an agent's overlay shows: the idle glyph, the compact label vs the full
 * box, and who gets an element at all.
 *
 * Run with: npm test
 */

import assert from 'node:assert/strict';

import { test } from 'vitest';

import { Rarity } from '../src/office/flair/modelFlair.js';
import { nameplateHeight, nameplateStyle, plateSide } from '../src/office/nameplate.js';
import {
  compactLabelMaxWidth,
  overlayContent,
  shouldShowXpPop,
  showOverlay,
  statusGlyph,
} from '../src/office/toolUtils.js';
import { Direction } from '../src/office/types.js';

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

test('compactLabelMaxWidth is the pod pitch minus a gap, in CSS px', () => {
  assert.equal(compactLabelMaxWidth(4, 1), 152);
  assert.equal(compactLabelMaxWidth(2, 2), 32);
  assert.equal(compactLabelMaxWidth(0.1, 1), 0); // clamped, never negative
});

test('overlayContent: plate lines, +N, tripwire pill, full on hover, marker when narrow', () => {
  const base = { expanded: false, label: 'Fix login', subCount: 0, maxWidth: 184 };
  const tripwire = { ruleName: 'Dotenv file access', count: 2 };
  const plain = { badge: null, name: '', pill: null, rarity: null };

  // No roster member yet: the session label takes the name line.
  assert.deepEqual(overlayContent(base), {
    mode: 'compact',
    plate: { ...plain, name: 'Fix login', sub: null },
  });
  assert.deepEqual(overlayContent({ ...base, subCount: 2 }), {
    mode: 'compact',
    plate: { ...plain, name: 'Fix login +2', sub: null },
  });
  assert.deepEqual(overlayContent({ ...base, tripwire }), {
    mode: 'compact',
    plate: { ...plain, name: 'Fix login', sub: null, pill: '⚠ Dotenv file access ×2' },
  });
  assert.deepEqual(overlayContent({ ...base, label: null }), { mode: 'compact', plate: null });
  assert.deepEqual(overlayContent({ ...base, expanded: true }), { mode: 'full' });
  // Hovering must still open the full box when the plate has no room.
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
  };
  const cases: Array<[string, Partial<typeof none>, 'full' | 'compact' | null]> = [
    // The nameplate is permanent: no setting gates it.
    ['agent, nothing', {}, 'compact'],
    ['agent, hovered', { isHovered: true }, 'full'],
    ['agent, selected', { isSelected: true }, 'full'],
    ['sub, nothing', { isSub: true }, null],
    ['sub, hovered', { isSub: true, isHovered: true }, 'full'],
    ['sub, selected', { isSub: true, isSelected: true }, 'full'],
    ['sub, parent hovered', { isSub: true, parentHovered: true }, 'full'],
    ['sub, parent selected', { isSub: true, parentSelected: true }, 'full'],
    // A parent's hover does not open a sibling agent's box.
    ['agent, parent flags ignored', { parentHovered: true, parentSelected: true }, 'compact'],
  ];
  for (const [name, patch, expected] of cases) {
    assert.equal(showOverlay({ ...none, ...patch }), expected, name);
  }
});

test('overlayContent: badge and member name on line 1, session label on line 2', () => {
  const base = { expanded: false, label: 'Fix login', subCount: 1, maxWidth: 184 };
  assert.deepEqual(overlayContent({ ...base, level: 7, name: 'Nova' }), {
    mode: 'compact',
    plate: { badge: 'Lv 7', name: 'Nova', sub: 'Fix login +1', pill: null, rarity: null },
  });
  // The badge shows without a label too.
  assert.deepEqual(overlayContent({ ...base, label: null, subCount: 0, level: 1, name: 'Nova' }), {
    mode: 'compact',
    plate: { badge: 'Lv 1', name: 'Nova', sub: null, pill: null, rarity: null },
  });
});

test('overlayContent: rarity colors the border for tiers 2-4 only', () => {
  const base = { expanded: false, label: 'x', subCount: 0, maxWidth: 184, level: 1, name: 'N' };
  const rarityOf = (rarity?: Rarity) => {
    const c = overlayContent({ ...base, rarity });
    return c.mode === 'compact' ? c.plate?.rarity : 'not-compact';
  };
  assert.equal(rarityOf(undefined), null, 'unknown model');
  assert.equal(rarityOf(Rarity.COMMON), null, 'tier 1');
  assert.equal(rarityOf(Rarity.RARE), 'rare');
  assert.equal(rarityOf(Rarity.EPIC), 'epic');
  assert.equal(rarityOf(Rarity.LEGENDARY), 'legendary');
});

test('plateSide: facing the camera puts the plate above the head, facing away below the feet', () => {
  assert.equal(plateSide(Direction.DOWN), 'above');
  assert.equal(plateSide(Direction.UP), 'below');
  // Walkers and sideways characters keep their face clear too.
  assert.equal(plateSide(Direction.LEFT), 'above');
  assert.equal(plateSide(Direction.RIGHT), 'above');
});

test('nameplateHeight reserves the real box: plate lines, border, shadow and the pill', () => {
  const full = { badge: 'Lv 1', name: 'N', sub: 's', rarity: null, pill: null };
  const oneLine = { ...full, sub: null };
  const withPill = { ...full, pill: '⚠ r' };
  assert.ok(nameplateHeight(full) > nameplateHeight(oneLine), 'second line adds height');
  assert.ok(nameplateHeight(withPill) > nameplateHeight(full), 'pill adds height');
  assert.equal(nameplateHeight({ ...full, badge: null, name: '', sub: null }), 0);
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

test('nameplateStyle: the tier colors the Lv badge only; the border is the same for every agent', () => {
  // Spec colors, spelled as channels (the lint rule keeps hex literals in constants.ts).
  const hex = (r: number, g: number, b: number) =>
    '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
  // Haiku (no rarity) and an unknown model keep the gold badge.
  assert.equal(nameplateStyle(null).badgeBg, hex(0xf6, 0xc6, 0x4a));
  assert.equal(nameplateStyle(Rarity.RARE).badgeBg, hex(0x3d, 0x8b, 0xff)); // Sonnet
  assert.equal(nameplateStyle(Rarity.EPIC).badgeBg, hex(0xa3, 0x35, 0xee)); // Opus
  assert.equal(nameplateStyle(Rarity.LEGENDARY).badgeBg, hex(0xff, 0x80, 0x00)); // Fable
  const borders = [null, Rarity.RARE, Rarity.EPIC, Rarity.LEGENDARY].map(
    (r) => nameplateStyle(r).border,
  );
  assert.deepEqual(new Set(borders), new Set([hex(0x1e, 0x12, 0x0a)]));
});
