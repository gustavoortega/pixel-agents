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
import { CharacterState, Direction, IdlePose } from '../src/office/types.js';

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
    // A book or mug in hand already says idle; a napper still gets its glyph slot.
    ['seated reader', { ...idle, state: CharacterState.TYPE, pose: IdlePose.READING }, false, null],
    ['seated coffee', { ...idle, state: CharacterState.TYPE, pose: IdlePose.COFFEE }, false, null],
    ['seated napper', { ...idle, state: CharacterState.TYPE, pose: IdlePose.NAPPING }, false, 'z'],
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

const PLAIN = {
  name: '',
  namePv: false,
  medal: null,
  state: null,
  loop: false,
  sub: null,
  helper: false,
  rarity: null,
  pill: null,
};

test('overlayContent: plate lines, +N, tripwire pill, full on hover, marker when narrow', () => {
  const base = { expanded: false, label: 'Fix login', subCount: 0, maxWidth: 184 };
  const tripwire = { ruleName: 'Dotenv file access', count: 2 };
  // No roster member yet: the session label takes the name line, masked like any session text.
  const named = { ...PLAIN, name: 'Fix login', namePv: true };

  assert.deepEqual(overlayContent(base), { mode: 'compact', plate: named });
  // Helpers without a character are counted on line 2; drawn ones have their crew lines.
  assert.deepEqual(overlayContent({ ...base, subCount: 14, drawnSubCount: 12 }), {
    mode: 'compact',
    plate: { ...named, sub: [{ text: '+14 helpers', pv: false }] },
  });
  assert.deepEqual(overlayContent({ ...base, subCount: 2, drawnSubCount: 2 }), {
    mode: 'compact',
    plate: named,
  });
  assert.deepEqual(overlayContent({ ...base, tripwire }), {
    mode: 'compact',
    plate: { ...named, pill: 'Dotenv file access ×2' },
  });
  assert.deepEqual(overlayContent({ ...base, label: null }), { mode: 'compact', plate: null });
  assert.deepEqual(overlayContent({ ...base, expanded: true }), { mode: 'full' });
  // Hovering must still open the full box when the plate has no room.
  assert.deepEqual(overlayContent({ ...base, expanded: true, maxWidth: 56 }), { mode: 'full' });
  assert.deepEqual(overlayContent({ ...base, maxWidth: 89 }), { mode: 'marker' });
  assert.equal(overlayContent({ ...base, maxWidth: 90 }).mode, 'compact');
});

test('showOverlay: helpers get a compact plate and follow their parent for the full box', () => {
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
    ['sub, nothing', { isSub: true }, 'compact'],
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

test('overlayContent: a helper plate is one line, its label and state, no medal or line 2', () => {
  const content = overlayContent({
    expanded: false,
    label: 'Fix login',
    subCount: 2,
    name: 'Nova',
    maxWidth: 184,
    helperOf: 'Ada',
    medal: { tier: 3, fraction: 0.5 },
    plateState: { kind: 'verb', verb: 'reading' },
    branch: 'main',
  });
  assert.deepEqual(content, {
    mode: 'compact',
    plate: {
      ...PLAIN,
      name: 'helper',
      helper: true,
      state: { kind: 'verb', verb: 'reading' },
    },
  });
});

test('overlayContent: line 2 is the branch (else the label), the age and the artifacts', () => {
  const base = { expanded: false, label: 'Fix login', subCount: 0, maxWidth: 184, name: 'Nova' };
  const line2 = (patch: Partial<Parameters<typeof overlayContent>[0]>) => {
    const c = overlayContent({ ...base, ...patch });
    return c.mode === 'compact' ? c.plate?.sub?.map((p) => (p.pv ? `[${p.text}]` : p.text)) : null;
  };
  // Session text is masked in privacy mode; the age and the counts are not.
  assert.deepEqual(line2({}), ['[Fix login]']);
  assert.deepEqual(line2({ branch: 'fix/cart' }), ['[fix/cart]']);
  assert.deepEqual(
    line2({ branch: 'fix/cart', ageMs: 154 * 60_000, artifacts: { count: 3, complete: true } }),
    ['[fix/cart]', '2h34m', '3 artifacts'],
  );
  assert.deepEqual(line2({ label: null, artifacts: { count: 1, complete: true } }), ['1 artifact']);
  // A cut history scan: the count is a floor.
  assert.deepEqual(line2({ label: null, artifacts: { count: 12, complete: false } }), [
    '12+ artifacts',
  ]);
  // Absent is never 0: no artifacts and no age leave nothing behind.
  assert.equal(line2({ label: null, artifacts: { count: 0, complete: true } }), undefined);
  assert.equal(line2({ label: null, ageMs: undefined }), undefined);
});

test('overlayContent: the plate keeps a rarity (the legendary shimmer) for tiers 2-4 only', () => {
  const base = { expanded: false, label: 'x', subCount: 0, maxWidth: 184, name: 'N' };
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
  const full = { ...PLAIN, name: 'N', sub: [{ text: 's', pv: true }] };
  const oneLine = { ...full, sub: null };
  const withPill = { ...full, pill: 'r' };
  assert.ok(nameplateHeight(full) > nameplateHeight(oneLine), 'second line adds height');
  assert.ok(nameplateHeight(withPill) > nameplateHeight(full), 'pill adds height');
  assert.equal(nameplateHeight({ ...full, name: '', sub: null }), 0);
});

test('shouldShowXpPop: every award and level-up pops, once per cooldown', () => {
  const t = 1_000_000;
  assert.equal(shouldShowXpPop({ kind: 'xp', amount: 40, signal: 'tests' }, undefined, t), true);
  assert.equal(shouldShowXpPop({ kind: 'xp', amount: 0 }, undefined, t), false);
  assert.equal(shouldShowXpPop({ kind: 'levelUp' }, undefined, t), true);
  assert.equal(shouldShowXpPop({ kind: 'xp', amount: 60 }, t - 1_499, t), false);
  assert.equal(shouldShowXpPop({ kind: 'xp', amount: 60 }, t - 1_500, t), true);
});

test('nameplateStyle: one border for every agent; idle goes quiet, the inspected agent paper', () => {
  // Spec colors, spelled as channels (the lint rule keeps hex literals in constants.ts).
  const hex = (r: number, g: number, b: number) =>
    '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
  const plain = nameplateStyle();
  assert.equal(plain.bg, hex(0x3b, 0x24, 0x12));
  assert.equal(nameplateStyle({ selected: true }).bg, hex(0xf6, 0xe3, 0xbd));
  assert.equal(nameplateStyle({ selected: true }).text, hex(0x3b, 0x24, 0x12));
  const quiet = nameplateStyle({ quiet: true });
  assert.equal(quiet.quiet, true);
  assert.notEqual(quiet.bg, plain.bg);
  const borders = [{}, { compact: true }, { selected: true }].map((l) => nameplateStyle(l).border);
  assert.deepEqual(new Set(borders), new Set([hex(0x1e, 0x12, 0x0a)]));
});
