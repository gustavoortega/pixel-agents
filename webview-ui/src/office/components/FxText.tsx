import {
  FX_BANNER_FONT_PX,
  FX_LEVEL_UP_MS,
  FX_POP_MS,
  FX_POP_RISE_PX,
  FX_TEXT_COLOR,
  FX_TEXT_FONT_PX,
  FX_TEXT_OUTLINE,
  FX_TEXT_OUTLINE_PX,
} from '../../constants.js';
import type { OfficeState } from '../engine/officeState.js';
import type { Rect } from '../labelLayout.js';
import { spriteHeadTopY } from '../nameplate.js';
import { seatedDrawOffsetPx } from '../seatDraw.js';

const FX_TEXT_Z_INDEX = 41;
const OUTLINE = [
  `${FX_TEXT_OUTLINE_PX}px ${FX_TEXT_OUTLINE_PX}px 0 ${FX_TEXT_OUTLINE}`,
  `-${FX_TEXT_OUTLINE_PX}px ${FX_TEXT_OUTLINE_PX}px 0 ${FX_TEXT_OUTLINE}`,
  `${FX_TEXT_OUTLINE_PX}px -${FX_TEXT_OUTLINE_PX}px 0 ${FX_TEXT_OUTLINE}`,
  `-${FX_TEXT_OUTLINE_PX}px -${FX_TEXT_OUTLINE_PX}px 0 ${FX_TEXT_OUTLINE}`,
].join(', ');

/**
 * "+N XP" and "Level N!" as DOM text in the plate layer: they take the plates' scale, not the
 * canvas zoom. Positions and fades are computed from the effect's age on every overlay tick.
 */
export function FxText({
  officeState,
  scale,
  toScreenX,
  toScreenY,
  slots,
}: {
  officeState: OfficeState;
  /** The plate layer's scale: FX text grows and shrinks with the nameplates. */
  scale: number;
  toScreenX: (worldX: number) => number;
  toScreenY: (worldY: number) => number;
  /** Screen box each agent's FX text takes in its overlay stack (above the plate). Without one the
   *  text stands on the head top. */
  slots?: ReadonlyMap<number, Rect>;
}) {
  const now = officeState.fx.now;
  return (
    <>
      {officeState.fx.active.map((e) => {
        const ch = officeState.characters.get(e.agentId);
        if (!ch) return null;
        const age = now - e.startedAt;
        const slot = slots?.get(e.agentId);
        const x = slot ? slot.x + slot.w / 2 : toScreenX(ch.x);
        // The text's bottom edge: the slot's, or the head top when the agent has no stack.
        const headY = slot
          ? slot.y + slot.h
          : toScreenY(spriteHeadTopY(ch.y, seatedDrawOffsetPx(ch)));
        if (e.kind === 'pop') {
          const t = Math.min(1, age / FX_POP_MS);
          return (
            <div
              key={`pop-${e.agentId}-${e.startedAt}`}
              className="absolute whitespace-nowrap leading-none"
              style={{
                left: x,
                top: headY,
                transform: `translate(-50%, calc(-100% - ${t * FX_POP_RISE_PX}px)) scale(${scale})`,
                opacity: Math.min(1, (1 - t) * 3),
                fontSize: FX_TEXT_FONT_PX,
                color: FX_TEXT_COLOR,
                textShadow: OUTLINE,
                pointerEvents: 'none',
                zIndex: FX_TEXT_Z_INDEX,
              }}
              data-testid="fx-xp-pop"
            >
              {`+${e.amount} XP`}
            </div>
          );
        }
        const t = Math.min(1, age / FX_LEVEL_UP_MS);
        // Pops in over the first tenth, holds, shrinks away over the last tenth.
        const grow = Math.min(1, t / 0.1, (1 - t) / 0.1);
        return (
          <div
            key={`lvl-${e.agentId}-${e.startedAt}`}
            className="absolute whitespace-nowrap leading-none"
            style={{
              left: x,
              top: headY,
              transform: `translate(-50%, -100%) scale(${scale * grow})`,
              fontSize: FX_BANNER_FONT_PX,
              color: FX_TEXT_COLOR,
              textShadow: OUTLINE,
              pointerEvents: 'none',
              zIndex: FX_TEXT_Z_INDEX,
            }}
            data-testid="fx-level-up"
          >
            {`Level ${e.level}!`}
          </div>
        );
      })}
    </>
  );
}
