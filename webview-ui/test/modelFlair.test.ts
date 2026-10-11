/**
 * The model look: which flair a tier earns, which outline wins, and where
 * equipment lands. All pure; the canvas just calls these.
 */
import { describe, expect, it } from 'vitest';

import {
  ACCESSORY_FRONT_Z_OFFSET,
  CAPE_BEHIND_Z_OFFSET,
  CAPE_OVER_Z_OFFSET,
  CHARACTER_SITTING_OFFSET_PX,
  HOVERED_OUTLINE_ALPHA,
  OUTLINE_Z_SORT_OFFSET,
  RARITY_COLORS,
  SELECTED_OUTLINE_ALPHA,
} from '../src/constants.js';
import { getCharacterSprite, sheetFrameIndex } from '../src/office/engine/characters.js';
import {
  accessoryPlacement,
  accessoryZ,
  ANCHORS,
  characterDrawOrigin,
  getAccessorySprite,
} from '../src/office/flair/accessories.js';
import {
  AccessoryKind,
  characterFlair,
  characterOutline,
  CompanionKind,
  modelFlair,
  Rarity,
} from '../src/office/flair/modelFlair.js';
import { getTintedOutlineSprite } from '../src/office/sprites/outlineSprites.js';
import { getCharacterSprites, setCharacterTemplates } from '../src/office/sprites/spriteData.js';
import { setProviderCapabilities } from '../src/office/toolUtils.js';
import type { Character, SpriteData } from '../src/office/types.js';
import { CharacterState, Direction } from '../src/office/types.js';

describe('modelFlair', () => {
  it.each([
    [1, Rarity.COMMON, [], CompanionKind.BIRD, false],
    [2, Rarity.RARE, [AccessoryKind.HEADPHONES], CompanionKind.CAT, false],
    [3, Rarity.EPIC, [AccessoryKind.HEADPHONES, AccessoryKind.CAPE], CompanionKind.OWL, false],
    [4, Rarity.LEGENDARY, [AccessoryKind.CAPE, AccessoryKind.CROWN], CompanionKind.DRAGON, true],
  ] as const)('tier %i', (tier, rarity, accessories, companion, sparkles) => {
    expect(modelFlair(tier)).toEqual({ rarity, accessories, companion, sparkles });
  });

  it('gives an unknown model nothing, not the lowest tier', () => {
    const none = modelFlair(undefined);
    expect(none.rarity).toBeUndefined();
    expect(none.companion).toBeUndefined();
    expect(none.accessories).toEqual([]);
    expect(none.sparkles).toBe(false);
  });
});

describe('characterFlair', () => {
  const models = new Map([[7, { tier: 4 as const }]]);

  it('applies the tier to an agent', () => {
    expect(characterFlair({ id: 7, isSubagent: false }, models, true).rarity).toBe(
      Rarity.LEGENDARY,
    );
  });

  it('gives sub-agents and the disabled setting the plain look', () => {
    expect(characterFlair({ id: 7, isSubagent: true }, models, true).rarity).toBeUndefined();
    expect(characterFlair({ id: 7, isSubagent: false }, models, false).rarity).toBeUndefined();
    expect(characterFlair({ id: 8, isSubagent: false }, models, true).rarity).toBeUndefined();
  });
});

describe('characterOutline', () => {
  it.each([Rarity.RARE, Rarity.EPIC, Rarity.LEGENDARY])(
    'draws a %s outline in its color',
    (rarity) => {
      expect(characterOutline({ isSelected: false, isHovered: false, rarity })).toEqual({
        kind: 'rarity',
        color: RARITY_COLORS[rarity],
        alpha: 1,
      });
    },
  );

  it('lets selection and hover win over rarity', () => {
    expect(characterOutline({ isSelected: true, isHovered: false, rarity: Rarity.EPIC })).toEqual({
      kind: 'selection',
      alpha: SELECTED_OUTLINE_ALPHA,
    });
    expect(characterOutline({ isSelected: false, isHovered: true, rarity: Rarity.EPIC })).toEqual({
      kind: 'selection',
      alpha: HOVERED_OUTLINE_ALPHA,
    });
  });

  it('draws no rarity outline for common or an unknown model', () => {
    expect(
      characterOutline({ isSelected: false, isHovered: false, rarity: Rarity.COMMON }),
    ).toBeNull();
    expect(characterOutline({ isSelected: false, isHovered: false, rarity: undefined })).toBeNull();
  });
});

describe('accessoryPlacement', () => {
  // dy = anchor row + that frame's bob - the map's own anchor row. Expected
  // numbers come from the sheet measurements in anchors.json, written out here.
  it.each([
    // [kind, dir, sheetFrame, expected dy]; anchors: headTop 3, shoulder 15, bob [1,0,1,0,0,0,1]
    [AccessoryKind.HEADPHONES, Direction.DOWN, 0, 3], // headTop 3 + bob 1 - row 1
    [AccessoryKind.HEADPHONES, Direction.DOWN, 3, 2], // typing frame: bob 0
    [AccessoryKind.HEADPHONES, Direction.UP, 1, 2], // bob 0
    [AccessoryKind.HEADPHONES, Direction.RIGHT, 0, 3], // headTop 3 + bob 1 - row 1
    [AccessoryKind.HEADPHONES, Direction.LEFT, 0, 3], // left reuses right
    [AccessoryKind.HEADPHONES, Direction.RIGHT, 1, 2], // bob 0
    [AccessoryKind.CROWN, Direction.DOWN, 0, 0], // headTop 3 + bob 1 - row 4
    [AccessoryKind.CROWN, Direction.LEFT, 6, 0], // headTop 3 + bob 1 - row 4
    [AccessoryKind.CAPE, Direction.DOWN, 0, 15], // shoulder 15 + bob 1 - row 1
    [AccessoryKind.CAPE, Direction.DOWN, 3, 14], // bob 0
    [AccessoryKind.CAPE, Direction.UP, 0, 16], // shoulder 15 + bob 1 - row 0
    [AccessoryKind.CAPE, Direction.LEFT, 1, 15], // shoulder 15 + bob 0 - row 0
  ] as const)('%s facing %i on sheet frame %i sits at dy %i', (kind, dir, frame, dy) => {
    expect(accessoryPlacement(kind, dir, frame, 3).dy).toBe(dy);
  });

  it('flips the right sprite for left, and keeps one object per (kind, direction, tier)', () => {
    const right = getAccessorySprite(AccessoryKind.HEADPHONES, Direction.RIGHT, 2);
    const left = getAccessorySprite(AccessoryKind.HEADPHONES, Direction.LEFT, 2);
    expect(left).toEqual(right.map((row) => [...row].reverse()));
    expect(getAccessorySprite(AccessoryKind.HEADPHONES, Direction.LEFT, 2)).toBe(left);
  });

  it('colors the cape by tier', () => {
    const opus = getAccessorySprite(AccessoryKind.CAPE, Direction.DOWN, 3);
    const fable = getAccessorySprite(AccessoryKind.CAPE, Direction.DOWN, 4);
    expect(opus).not.toEqual(fable);
    // same shape, different colors: a pixel is transparent in one exactly when in the other
    expect(opus.map((r) => r.map((c) => c === ''))).toEqual(
      fable.map((r) => r.map((c) => c === '')),
    );
  });

  it('has a head and shoulder bob for each sheet frame (down also covers the 4 idle frames)', () => {
    expect(ANCHORS.down.bob).toHaveLength(11);
    expect(ANCHORS.down.shoulderBob).toHaveLength(11);
    expect(ANCHORS.up.bob).toHaveLength(7);
    expect(ANCHORS.right.bob).toHaveLength(7);
  });

  it('keeps the shoulders put while the napping head drops: the cape follows the shoulders', () => {
    const napFrame = 8;
    const cape = accessoryPlacement(AccessoryKind.CAPE, Direction.DOWN, napFrame, undefined);
    const neutral = accessoryPlacement(AccessoryKind.CAPE, Direction.DOWN, 1, undefined);
    const crown = accessoryPlacement(AccessoryKind.CROWN, Direction.DOWN, napFrame, undefined);
    const crownNeutral = accessoryPlacement(AccessoryKind.CROWN, Direction.DOWN, 1, undefined);
    expect(crown.dy - crownNeutral.dy).toBe(6); // the head is 6 rows lower
    expect(cape.dy - neutral.dy).toBe(2); // the first visible shoulder row is 2 lower
  });
});

describe('accessoryZ', () => {
  const body = 100.5;
  const outline = body - OUTLINE_Z_SORT_OFFSET;

  it.each([Direction.DOWN, Direction.LEFT, Direction.RIGHT])(
    'orders outline < cape < body < headphones/crown facing %i',
    (dir) => {
      const cape = accessoryZ(AccessoryKind.CAPE, dir, body);
      expect(outline).toBeLessThan(cape);
      expect(cape).toBe(body - CAPE_BEHIND_Z_OFFSET);
      expect(cape).toBeLessThan(body);
      expect(accessoryZ(AccessoryKind.HEADPHONES, dir, body)).toBe(body + ACCESSORY_FRONT_Z_OFFSET);
      expect(accessoryZ(AccessoryKind.CROWN, dir, body)).toBeGreaterThan(body);
    },
  );

  it('hangs the cape over the body when facing up (back to the camera)', () => {
    const cape = accessoryZ(AccessoryKind.CAPE, Direction.UP, body);
    expect(cape).toBe(body + CAPE_OVER_Z_OFFSET);
    expect(cape).toBeGreaterThan(body);
    expect(cape).toBeLessThan(accessoryZ(AccessoryKind.HEADPHONES, Direction.UP, body));
  });
});

describe('characterDrawOrigin', () => {
  it('shifts a seated character down by the sitting offset, and equipment with it', () => {
    const base = { x: 40, y: 40 };
    const standing = characterDrawOrigin({ ...base, state: CharacterState.IDLE }, 32, 64, 0, 0, 2);
    const seated = characterDrawOrigin({ ...base, state: CharacterState.TYPE }, 32, 64, 0, 0, 2);
    expect(seated.drawX).toBe(standing.drawX);
    expect(seated.drawY - standing.drawY).toBe(CHARACTER_SITTING_OFFSET_PX * 2);
  });
});

function frame(tag: string): SpriteData {
  return Array.from({ length: 32 }, () => new Array<string>(16).fill(tag));
}

function makeChar(overrides: Partial<Character>): Character {
  return {
    state: CharacterState.IDLE,
    dir: Direction.DOWN,
    frame: 0,
    currentTool: null,
    ...overrides,
  } as Character;
}

describe('sheetFrameIndex', () => {
  setProviderCapabilities({ readingTools: ['Read'], subagentToolNames: [] });

  it.each([
    [CharacterState.IDLE, 0, null, 1], // idle reuses walk2
    [CharacterState.WALK, 0, null, 0],
    [CharacterState.WALK, 1, null, 1],
    [CharacterState.WALK, 2, null, 2],
    [CharacterState.WALK, 3, null, 1],
    [CharacterState.TYPE, 0, 'Edit', 3],
    [CharacterState.TYPE, 1, 'Edit', 4],
    [CharacterState.TYPE, 0, 'Read', 5],
    [CharacterState.TYPE, 1, 'Read', 6],
  ] as const)('%s frame %i tool %s -> sheet frame %i', (state, frameNo, tool, expected) => {
    expect(sheetFrameIndex(makeChar({ state, frame: frameNo, currentTool: tool }))).toBe(expected);
  });
});

describe('tinted outline memo', () => {
  it('returns the same SpriteData for one (sheet, direction, frame, color) across draws', () => {
    // Seven distinct frames per direction so each frame is its own sprite object
    const dirFrames = (tag: string) => Array.from({ length: 7 }, (_, i) => frame(`${tag}${i}`));
    setCharacterTemplates([{ down: dirFrames('d'), up: dirFrames('u'), right: dirFrames('r') }]);
    const ch = makeChar({ state: CharacterState.WALK, dir: Direction.RIGHT, frame: 2 });

    const first = getCharacterSprite(ch, getCharacterSprites(0, 0));
    const second = getCharacterSprite(ch, getCharacterSprites(0, 0));
    const a = getTintedOutlineSprite(first, RARITY_COLORS.epic);
    expect(getTintedOutlineSprite(second, RARITY_COLORS.epic)).toBe(a);

    // A different color or frame is a different outline
    expect(getTintedOutlineSprite(first, RARITY_COLORS.rare)).not.toBe(a);
    const other = getCharacterSprite({ ...ch, frame: 1 }, getCharacterSprites(0, 0));
    expect(getTintedOutlineSprite(other, RARITY_COLORS.epic)).not.toBe(a);
    // and it really is tinted, one pixel larger on each side
    expect(a).toHaveLength(34);
    expect(a.flat()).toContain(RARITY_COLORS.epic);
  });
});
