import type { ModelTier } from '../../../../core/src/provider.js';
import { HOVERED_OUTLINE_ALPHA, RARITY_COLORS, SELECTED_OUTLINE_ALPHA } from '../../constants.js';

/**
 * The model look: what an agent's model tier adds to its character. Pure
 * tables and decisions only (no canvas, no DOM), so the renderer, the label
 * overlay and the tests all ask the same functions.
 */

export const Rarity = {
  COMMON: 'common',
  RARE: 'rare',
  EPIC: 'epic',
  LEGENDARY: 'legendary',
} as const;
export type Rarity = (typeof Rarity)[keyof typeof Rarity];

export const AccessoryKind = {
  HEADPHONES: 'headphones',
  CAPE: 'cape',
  CROWN: 'crown',
} as const;
export type AccessoryKind = (typeof AccessoryKind)[keyof typeof AccessoryKind];

export const CompanionKind = {
  BIRD: 'bird',
  CAT: 'cat',
  OWL: 'owl',
  DRAGON: 'dragon',
} as const;
export type CompanionKind = (typeof CompanionKind)[keyof typeof CompanionKind];

export interface ModelFlair {
  /** Absent for an unknown model: no plate color, no outline. */
  rarity?: Rarity;
  accessories: readonly AccessoryKind[];
  companion?: CompanionKind;
  /** Three twinkling sparkles around the character (Fable). */
  sparkles: boolean;
}

/** Unknown model: the look an agent had before the feature existed. */
const NO_FLAIR: ModelFlair = Object.freeze({ accessories: [], sparkles: false });

const FLAIR_BY_TIER: Readonly<Record<ModelTier, ModelFlair>> = {
  1: Object.freeze({
    rarity: Rarity.COMMON,
    accessories: [],
    companion: CompanionKind.BIRD,
    sparkles: false,
  }),
  2: Object.freeze({
    rarity: Rarity.RARE,
    accessories: [AccessoryKind.HEADPHONES],
    companion: CompanionKind.CAT,
    sparkles: false,
  }),
  3: Object.freeze({
    rarity: Rarity.EPIC,
    accessories: [AccessoryKind.HEADPHONES, AccessoryKind.CAPE],
    companion: CompanionKind.OWL,
    sparkles: false,
  }),
  4: Object.freeze({
    rarity: Rarity.LEGENDARY,
    accessories: [AccessoryKind.CAPE, AccessoryKind.CROWN],
    companion: CompanionKind.DRAGON,
    sparkles: true,
  }),
};

/** Undefined tier is "the provider cannot place this model": no flair, never tier 1. */
export function modelFlair(tier: ModelTier | undefined): ModelFlair {
  return tier === undefined ? NO_FLAIR : (FLAIR_BY_TIER[tier] ?? NO_FLAIR);
}

export function rarityColor(rarity: Rarity): string {
  return RARITY_COLORS[rarity];
}

/**
 * The flair a character is drawn with. Sub-agents get none (they are derived
 * from their parent's tool call, not agents with a model of their own), and
 * with the setting off every character keeps its original look.
 */
export function characterFlair(
  ch: { id: number; isSubagent: boolean },
  models: ReadonlyMap<number, { tier?: ModelTier }>,
  enabled: boolean,
): ModelFlair {
  if (!enabled || ch.isSubagent) return NO_FLAIR;
  return modelFlair(models.get(ch.id)?.tier);
}

export type CharacterOutline =
  { kind: 'selection'; alpha: number } | { kind: 'rarity'; color: string; alpha: number };

/**
 * Which 1 px outline a character gets, if any. Selecting or hovering always
 * wins over rarity, so the white selection outline never hides behind a
 * colored one. Common (tier 1) has no outline, only a plate color.
 */
export function characterOutline(opts: {
  isSelected: boolean;
  isHovered: boolean;
  rarity: Rarity | undefined;
}): CharacterOutline | null {
  if (opts.isSelected) return { kind: 'selection', alpha: SELECTED_OUTLINE_ALPHA };
  if (opts.isHovered) return { kind: 'selection', alpha: HOVERED_OUTLINE_ALPHA };
  if (opts.rarity === undefined || opts.rarity === Rarity.COMMON) return null;
  return { kind: 'rarity', color: rarityColor(opts.rarity), alpha: 1 };
}
