import { useEffect, useState } from 'react';

import { spriteWorldHeight, spriteWorldWidth } from '../../../../core/src/assets/artDensity.js';
import { Button } from '../../components/ui/Button.js';
import {
  BUBBLE_VERTICAL_OFFSET_PX,
  CHARACTER_HEAD_HEIGHT_PX,
  CHARACTER_HEAD_WIDTH_PX,
  CHARACTER_SPRITE_HEIGHT_PX,
  COMPACT_LABEL_FEET_GAP_PX,
  CONTEXT_CRITICAL_THRESHOLD,
  CONTEXT_DANGER_THRESHOLD,
  CONTEXT_GAUGE_BG,
  CONTEXT_GAUGE_COLOR_CRITICAL,
  CONTEXT_GAUGE_COLOR_DANGER,
  CONTEXT_GAUGE_COLOR_OK,
  CONTEXT_GAUGE_COLOR_WARN,
  CONTEXT_GAUGE_HEIGHT_PX,
  CONTEXT_GAUGE_WIDTH_PX,
  CONTEXT_WARN_THRESHOLD,
  FULL_BOX_ROW_PX,
  LABEL_LAYOUT_DIM_OPACITY,
  NAMEPLATE_COMPACT_FONT_PX,
  NAMEPLATE_COMPACT_LINE_PX,
  NAMEPLATE_LINE1_PX,
  NAMEPLATE_LINE2_PX,
  NAMEPLATE_NAME_FONT_PX,
  NAMEPLATE_PAD_Y_PX,
  NAMEPLATE_PILL_GAP_PX,
  NAMEPLATE_PILL_HEIGHT_PX,
  NAMEPLATE_SUB_FONT_PX,
  OVERLAY_STACK_GAP_PX,
  RARITY_SHIMMER_SEC,
  TEAM_LEAD_COLOR,
  TEAM_ROLE_COLOR,
  TILE_SIZE,
  TOOL_OVERLAY_VERTICAL_OFFSET,
} from '../../constants.js';
import type { SubagentCharacter } from '../../hooks/subagentMessages.js';
import { fitZoomWholeMap } from '../camera.js';
import { sheetFrameIndex } from '../engine/characters.js';
import type { OfficeState } from '../engine/officeState.js';
import { isShowModelFlairEnabled } from '../engine/renderer.js';
import { ANCHORS } from '../flair/accessories.js';
import { characterFlair, Rarity } from '../flair/modelFlair.js';
import { fullBoxRows } from '../fullBox.js';
import { fxTextBox } from '../fx/fxTextBox.js';
import {
  areaSignRect,
  clampPlate,
  type LabelItem,
  layoutLabels,
  type Rect,
  roomFloorRect,
  withTopWallFace,
} from '../labelLayout.js';
import {
  chipBoxHeight,
  type NameplateStyle,
  nameplateStyle,
  plateAnchorAboveY,
  plateBoxHeight,
  plateIsCompact,
  plateScale,
  type PlateSide,
  plateSide,
  spriteHeadTopY,
} from '../nameplate.js';
import { stackAbove, weatherAnchorY } from '../overlayStack.js';
import { overlayProjection } from '../projection.js';
import { seatedBubbleOffsetPx, seatedDrawOffsetPx } from '../seatDraw.js';
import { BUBBLE_WAITING_SPRITE } from '../sprites/spriteData.js';
import {
  agentLabel,
  agentStatus,
  compactLabelMaxWidth,
  helperPlateInput,
  type NameplateContent,
  type OverlayContent,
  overlayContent,
  showOverlay,
  statusGlyph,
  tripwireColor,
  tripwireLabel,
  type TripwireSeverity,
} from '../toolUtils.js';
import type { Character, ToolActivity } from '../types.js';
import { CharacterState, Direction, IdlePose } from '../types.js';
import { FullBoxRoster } from './FullBoxRoster.js';
import { FxText } from './FxText.js';

// Both turn-end states show the green checkmark bubble. A finished turn (Stop)
// shows ONLY the checkmark (the label falls through to its normal idle text);
// going idle waiting on the user (Notification(idle_prompt)) additionally
// surfaces this label. Driven by Character.waitingAwaitingInput.
const WAITING_INPUT_ACTIVITY_TEXT = 'Waiting for input';

interface ToolOverlayProps {
  officeState: OfficeState;
  agents: number[];
  agentTools: Record<number, ToolActivity[]>;
  subagentTools: Record<number, Record<string, ToolActivity[]>>;
  subagentCharacters: SubagentCharacter[];
  containerRef: React.RefObject<HTMLDivElement | null>;
  zoom: number;
  panRef: React.RefObject<{ x: number; y: number }>;
  onCloseAgent: (id: number) => void;
  onAckTripwire: (id: number, count: number) => void;
}

/** Derive a short human-readable activity string from tools/status */
function getActivityText(
  agentId: number,
  agentTools: Record<number, ToolActivity[]>,
  isActive: boolean,
  bubbleType: 'permission' | 'waiting' | null,
  waitingAwaitingInput: boolean,
): string {
  if (bubbleType === 'permission') return 'Needs approval';
  // Only the idle case ("Waiting for input") gets a dedicated label. A finished
  // turn (Stop, waitingAwaitingInput=false) falls through so the checkmark alone
  // signals "done", same as the original behavior.
  if (bubbleType === 'waiting' && waitingAwaitingInput) return WAITING_INPUT_ACTIVITY_TEXT;

  const tools = agentTools[agentId];
  if (tools && tools.length > 0) {
    // Find the latest non-done tool
    const activeTool = [...tools].reverse().find((t) => !t.done);
    if (activeTool) {
      if (activeTool.permissionWait) return 'Needs approval';
      return activeTool.status;
    }
    // All tools done but agent still active (mid-turn) — keep showing last tool status
    if (isActive) {
      const lastTool = tools[tools.length - 1];
      if (lastTool) return lastTool.status;
    }
  }

  return 'Idle';
}

function getFuelColor(ratio: number): string {
  if (ratio >= CONTEXT_CRITICAL_THRESHOLD) return CONTEXT_GAUGE_COLOR_CRITICAL;
  if (ratio >= CONTEXT_DANGER_THRESHOLD) return CONTEXT_GAUGE_COLOR_DANGER;
  if (ratio >= CONTEXT_WARN_THRESHOLD) return CONTEXT_GAUGE_COLOR_WARN;
  return CONTEXT_GAUGE_COLOR_OK;
}

// Above the compact labels (40) and the character-anchored sub-panels.
const FULL_BOX_Z_INDEX = 43;
const COMPACT_LABEL_Z_INDEX = 40;

/** The plate itself: `Lv N` badge and name, plus the title line when it is not compact. */
function PlateBox({
  plate,
  style,
  compact,
}: {
  plate: NameplateContent;
  style: NameplateStyle;
  compact: boolean;
}) {
  const line1 = compact ? NAMEPLATE_COMPACT_LINE_PX : NAMEPLATE_LINE1_PX;
  const font = compact ? NAMEPLATE_COMPACT_FONT_PX : NAMEPLATE_NAME_FONT_PX;
  return (
    <div
      className={`nameplate relative flex flex-col max-w-full overflow-hidden${plate.rarity === Rarity.LEGENDARY ? ' rarity-shimmer' : ''}`}
      style={
        {
          '--plate-bg': style.bg,
          '--plate-text': style.text,
          '--plate-border': style.border,
          padding: `${NAMEPLATE_PAD_Y_PX}px 6px`,
          ...(plate.rarity === Rarity.LEGENDARY
            ? { '--rarity-shimmer-sec': `${RARITY_SHIMMER_SEC}s` }
            : {}),
        } as React.CSSProperties
      }
    >
      {(plate.badge || plate.name) && (
        <span
          className="flex items-center gap-4 whitespace-nowrap leading-none"
          style={{ height: line1, fontSize: font }}
        >
          {plate.badge && (
            <span
              className="shrink-0 text-2xs leading-none px-4"
              style={{
                background: style.badgeBg,
                color: style.badgeInk,
                border: `2px solid ${style.badgeInk}`,
                height: line1 - 2,
                display: 'flex',
                alignItems: 'center',
                ...(compact ? { fontSize: font } : {}),
              }}
            >
              {plate.badge}
            </span>
          )}
          <span className="overflow-hidden text-ellipsis">{plate.name}</span>
        </span>
      )}
      {plate.sub && (
        <span
          className="overflow-hidden text-ellipsis block whitespace-nowrap leading-none px-4"
          style={{
            height: NAMEPLATE_LINE2_PX,
            lineHeight: `${NAMEPLATE_LINE2_PX}px`,
            fontSize: NAMEPLATE_SUB_FONT_PX,
            background: style.subBg,
          }}
        >
          {plate.sub}
        </span>
      )}
    </div>
  );
}

function CompactLabel({
  id,
  status,
  plate,
  maxWidth,
  left,
  top,
  side,
  scale,
  compact,
  dx,
  dy,
  dim,
  tripwire,
  onAckTripwire,
}: {
  id: number;
  status: string;
  /** Null renders an empty node: markers and agents with nothing to show keep their overlay element. */
  plate: NameplateContent | null;
  maxWidth: number;
  left: number;
  /** Anchor edge: the plate's top for `below`, its bottom for `above`. */
  top: number;
  side: PlateSide;
  /** Plate scale (see `plateScale`): the box is authored at 1 and scaled about its anchor edge. */
  scale: number;
  /** One-line plate (zoom level <= 3): no title, fixed size, a little see-through. */
  compact: boolean;
  /** Sideways shift that keeps the plate inside its room. */
  dx: number;
  dy: number;
  dim: boolean;
  tripwire: { count: number; severity: TripwireSeverity } | undefined;
  onAckTripwire: (id: number, count: number) => void;
}) {
  const hasPlate = !!plate && (plate.badge || plate.name || plate.sub);
  const style = nameplateStyle(plate?.rarity ?? null, compact);
  // The chip sits over the plate on an above-head label and under it on a below-feet one.
  const pillMargin = side === 'above' ? 'marginBottom' : 'marginTop';
  return (
    <div
      className="absolute flex flex-col items-center"
      style={{
        left,
        top,
        maxWidth,
        transform: `translate(calc(-50% + ${dx}px), ${side === 'above' ? `calc(-100% + ${dy}px)` : `${dy}px`}) scale(${scale})`,
        transformOrigin: side === 'above' ? 'bottom center' : 'top center',
        transition: 'transform 120ms',
        opacity: dim ? LABEL_LAYOUT_DIM_OPACITY : 1,
        pointerEvents: 'none',
        zIndex: COMPACT_LABEL_Z_INDEX,
      }}
      data-testid="agent-overlay"
      data-agent-id={id}
      data-status={status}
    >
      {side === 'above' ? (
        <>
          {plate?.pill && (
            <span
              className="overflow-hidden text-ellipsis block whitespace-nowrap leading-none text-2xs cursor-pointer max-w-full"
              // Plates ignore pointer events; the pill opts back in so one click acknowledges it.
              style={{
                height: NAMEPLATE_PILL_HEIGHT_PX,
                [pillMargin]: hasPlate ? NAMEPLATE_PILL_GAP_PX : 0,
                padding: '0 6px',
                lineHeight: `${NAMEPLATE_PILL_HEIGHT_PX - 4}px`,
                background: 'var(--brand-rust)',
                color: 'var(--brand-paper)',
                border: '2px solid var(--brand-ink)',
                pointerEvents: 'auto',
              }}
              title="Click to acknowledge"
              data-testid="tripwire-alarm"
              onClick={(e) => {
                e.stopPropagation();
                if (tripwire) onAckTripwire(id, tripwire.count);
              }}
            >
              {plate.pill}
            </span>
          )}
          {plate && hasPlate && <PlateBox plate={plate} style={style} compact={compact} />}
        </>
      ) : (
        <>
          {plate && hasPlate && <PlateBox plate={plate} style={style} compact={compact} />}
          {plate?.pill && (
            <span
              className="overflow-hidden text-ellipsis block whitespace-nowrap leading-none text-2xs cursor-pointer max-w-full"
              // Plates ignore pointer events; the pill opts back in so one click acknowledges it.
              style={{
                height: NAMEPLATE_PILL_HEIGHT_PX,
                [pillMargin]: hasPlate ? NAMEPLATE_PILL_GAP_PX : 0,
                padding: '0 6px',
                lineHeight: `${NAMEPLATE_PILL_HEIGHT_PX - 4}px`,
                background: 'var(--brand-rust)',
                color: 'var(--brand-paper)',
                border: '2px solid var(--brand-ink)',
                pointerEvents: 'auto',
              }}
              title="Click to acknowledge"
              data-testid="tripwire-alarm"
              onClick={(e) => {
                e.stopPropagation();
                if (tripwire) onAckTripwire(id, tripwire.count);
              }}
            >
              {plate.pill}
            </span>
          )}
        </>
      )}
    </div>
  );
}

/** Something is drawn on the canvas right above the head (bubble, idle glyph, Zz, beacon). */
function headSlotTaken(ch: Character, hasTripwire: boolean): boolean {
  const bubble = ch.bubbleType && !(ch.bubbleType === 'waiting' && ch.waitingAwaitingInput);
  return !!bubble || hasTripwire || statusGlyph(ch, hasTripwire) !== null;
}

/** A napping agent's head is lowered onto the desk: the plate follows it down. Walkers and typists do not bob it. */
function napHeadBobPx(ch: Character): number {
  const napping =
    ch.pose === IdlePose.NAPPING && ch.state === CharacterState.TYPE && ch.dir === Direction.DOWN;
  return napping ? (ANCHORS.down.bob[sheetFrameIndex(ch)] ?? 0) : 0;
}

export function ToolOverlay({
  officeState,
  agents,
  agentTools,
  subagentTools,
  subagentCharacters,
  containerRef,
  zoom,
  panRef,
  onCloseAgent,
  onAckTripwire,
}: ToolOverlayProps) {
  const [, setTick] = useState(0);
  useEffect(() => {
    let rafId = 0;
    const tick = () => {
      setTick((n) => n + 1);
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, []);

  const el = containerRef.current;
  if (!el) return null;
  const dpr = window.devicePixelRatio || 1;
  const containerRect = el.getBoundingClientRect();
  const project = overlayProjection(
    officeState.getLayout(),
    containerRect,
    zoom,
    panRef.current,
    dpr,
  );
  // Up to zoom level 3 plates are one-line and fixed size. Above that they keep their share of the
  // screen: scaled against the zoom at which the whole map fits.
  const compact = plateIsCompact(zoom);
  const fitScale = plateScale(
    zoom,
    fitZoomWholeMap(
      { cols: officeState.getLayout().cols, rows: officeState.getLayout().rows },
      containerRect,
      dpr,
    ),
  );
  const scale = compact ? 1 : fitScale;

  const selectedId = officeState.selectedAgentId;
  const hoveredId = officeState.hoveredAgentId;

  // All character IDs
  const allIds = [...agents, ...subagentCharacters.map((s) => s.id)];

  // Pass 1: decide what each character gets. Compact labels are then laid out
  // together so they can avoid each other and the room signs; full boxes are
  // not part of that pass.
  const maxWidth = compactLabelMaxWidth(zoom, dpr);
  const plans = new Map<
    number,
    | { kind: 'full' }
    | { kind: 'compact'; content: Extract<OverlayContent, { mode: 'compact' | 'marker' }> }
  >();
  const labelItems: LabelItem[] = [];
  for (const id of allIds) {
    const ch = officeState.characters.get(id);
    if (!ch) continue;
    const isSelected = selectedId === id;
    const isHovered = hoveredId === id;
    const parentId = ch.isSubagent ? ch.parentAgentId : null;
    const shown = showOverlay({
      isSub: ch.isSubagent,
      isSelected,
      isHovered,
      parentSelected: parentId !== null && selectedId === parentId,
      parentHovered: parentId !== null && hoveredId === parentId,
    });
    if (shown === 'full') {
      plans.set(id, { kind: 'full' });
    } else if (shown === 'compact') {
      const content = overlayContent({
        expanded: false,
        label: agentLabel(officeState.sessionTitles.get(id), ch.folderName),
        ...helperPlateInput(officeState, subagentCharacters, id),
        tripwire: officeState.tripwires.get(id),
        level: officeState.rosters.get(id)?.level,
        name: officeState.rosters.get(id)?.name,
        rarity: characterFlair(ch, officeState.models, isShowModelFlairEnabled()).rarity,
        maxWidth,
      });
      if (content.mode === 'full') continue;
      // Compact plates lose their title line: `Lv N  Name` is what still reads at that size.
      const shown: typeof content =
        content.mode === 'compact' && content.plate && compact
          ? { mode: 'compact', plate: { ...content.plate, sub: null } }
          : content;
      plans.set(id, { kind: 'compact', content: shown });
      if (shown.mode === 'compact' && shown.plate) {
        // Anchor on the tile centre, not the sprite, so plates do not reshuffle while agents walk.
        const sit = seatedDrawOffsetPx(ch);
        const plateH = plateBoxHeight(shown.plate, compact) * scale;
        const chipH = chipBoxHeight(shown.plate) * scale;
        const h = plateH + (plateH > 0 && chipH > 0 ? NAMEPLATE_PILL_GAP_PX : 0) + chipH;
        const side = plateSide(ch.dir);
        const tileMidY = (ch.tileRow + 0.5) * TILE_SIZE;
        labelItems.push({
          id,
          col: ch.tileCol,
          row: ch.tileRow,
          x: project.toScreenX((ch.tileCol + 0.5) * TILE_SIZE),
          y:
            side === 'below'
              ? project.toScreenY(tileMidY + sit) + COMPACT_LABEL_FEET_GAP_PX
              : project.toScreenY(plateAnchorAboveY(tileMidY, sit, false, napHeadBobPx(ch))) - h,
          w: maxWidth,
          h,
          plateH,
          chipH,
          grow: side === 'below' ? 'down' : 'up',
        });
      }
    }
  }

  const layout = officeState.getLayout();
  const obstacles: Rect[] = [];
  for (const area of layout.areas ?? []) {
    const r = areaSignRect(layout.areaTiles, layout.cols, area.label, zoom);
    if (!r) continue;
    const x = project.toScreenX(r.x);
    const y = project.toScreenY(r.y);
    obstacles.push({
      x,
      y,
      w: project.toScreenX(r.x + r.w) - x,
      h: project.toScreenY(r.y + r.h) - y,
    });
  }
  const placements = layoutLabels(labelItems, obstacles);
  // Last step: the stack above each head (plate, chip, bubble) never leaves the floor of its
  // room, so it cannot cross a wall or the top edge. Applied after the collision pass because the
  // wall wins over the nicest spot, and as a group so the order survives the clamp.
  const clamps = new Map<number, { dx: number; dy: number }>();
  officeState.bubbleLift.clear();
  // Weather defaults to just above the head; the stack loop below raises it to the stack's top.
  officeState.weatherAnchor.clear();
  for (const ch of officeState.characters.values()) {
    officeState.weatherAnchor.set(ch.id, spriteHeadTopY(ch.y, seatedDrawOffsetPx(ch)));
  }
  const fxSlots = new Map<number, Rect>();
  const fxBoxes = new Map<number, { w: number; h: number }>();
  for (const e of officeState.fx.active) {
    const box = fxTextBox(e, fitScale);
    const prev = fxBoxes.get(e.agentId);
    if (!prev || box.h > prev.h) fxBoxes.set(e.agentId, box);
  }
  const zoomPx = 1 / project.toWorldLength(1);
  const bubbleBox = {
    w: spriteWorldWidth(BUBBLE_WAITING_SPRITE) * (1 / project.toWorldLength(1)),
    h: spriteWorldHeight(BUBBLE_WAITING_SPRITE) * (1 / project.toWorldLength(1)),
  };
  for (const it of labelItems) {
    const ch = officeState.characters.get(it.id);
    if (!ch) continue;
    const world = withTopWallFace(
      roomFloorRect(layout.areaTiles, layout.cols, layout.rows, officeState.roomOf(ch)),
    );
    const x0 = project.toScreenX(world.x);
    const y0 = project.toScreenY(world.y);
    const floor: Rect = {
      x: x0,
      y: y0,
      w: project.toScreenX(world.x + world.w) - x0,
      h: project.toScreenY(world.y + world.h) - y0,
    };
    const pdy = placements.get(it.id)?.dy ?? 0;
    if (it.grow === 'up') {
      const hasCanvasItem = headSlotTaken(ch, officeState.tripwires.has(it.id));
      const stack = stackAbove({
        x: it.x,
        headTop: it.y + it.h,
        plate: (it.plateH ?? 0) > 0 ? { w: it.w, h: it.plateH ?? 0 } : null,
        chip: (it.chipH ?? 0) > 0 ? { w: it.w, h: it.chipH ?? 0 } : null,
        fx: fxBoxes.get(it.id) ?? null,
        bubble: hasCanvasItem ? bubbleBox : null,
        dy: pdy,
        floor,
        head: {
          x: it.x - (CHARACTER_HEAD_WIDTH_PX * zoomPx) / 2,
          y: it.y + it.h,
          w: CHARACTER_HEAD_WIDTH_PX * zoomPx,
          h: CHARACTER_HEAD_HEIGHT_PX * zoomPx,
        },
        feetY: it.y + it.h + CHARACTER_SPRITE_HEIGHT_PX * zoomPx,
        noFlip: ch.seatId !== null && ch.state === CharacterState.TYPE && ch.dir === Direction.DOWN,
      });
      clamps.set(it.id, { dx: stack.shift.dx, dy: stack.shift.dy - pdy });
      if (stack.fx) fxSlots.set(it.id, stack.fx);
      const stackTop = Math.min(
        ...[stack.plate, stack.chip, stack.fx, stack.bubble]
          .filter((r): r is Rect => r !== null)
          .map((r) => r.y),
      );
      officeState.weatherAnchor.set(
        it.id,
        weatherAnchorY(
          Number.isFinite(stackTop) ? project.toWorldLength(stackTop - project.toScreenY(0)) : null,
          spriteHeadTopY(ch.y, seatedDrawOffsetPx(ch)),
        ),
      );
      if (stack.bubble) {
        // World y of the bubble's bottom edge, against where the renderer draws it by default.
        const bottomWorld = project.toWorldLength(
          stack.bubble.y + stack.bubble.h - project.toScreenY(0),
        );
        const defaultBottom = ch.y + seatedBubbleOffsetPx(ch) - BUBBLE_VERTICAL_OFFSET_PX - 1;
        // Negative when the stack flipped below the feet: the bubble is drawn lower, not lifted.
        officeState.bubbleLift.set(it.id, defaultBottom - bottomWorld);
      }
      continue;
    }
    // Plate below the feet (back view): the FX text stands just above the head, the weather
    // already hangs from there.
    const fxBox = fxBoxes.get(it.id);
    if (fxBox) {
      const headTopY = project.toScreenY(spriteHeadTopY(ch.y, seatedDrawOffsetPx(ch)));
      fxSlots.set(it.id, {
        x: project.toScreenX(ch.x) - fxBox.w / 2,
        y: headTopY - OVERLAY_STACK_GAP_PX - fxBox.h,
        w: fxBox.w,
        h: fxBox.h,
      });
    }
    const plate: Rect = { x: it.x - it.w / 2, y: it.y + pdy, w: it.w, h: it.h };
    const fitted = clampPlate(plate, floor);
    clamps.set(it.id, { dx: fitted.x - plate.x, dy: fitted.y - plate.y });
  }

  return (
    <>
      <FxText
        officeState={officeState}
        scale={fitScale}
        toScreenX={project.toScreenX}
        toScreenY={project.toScreenY}
        slots={fxSlots}
      />
      {allIds.map((id) => {
        const ch = officeState.characters.get(id);
        const plan = plans.get(id);
        if (!ch || !plan) return null;

        const isSelected = selectedId === id;
        const isSub = ch.isSubagent;
        const status = agentStatus(ch);

        if (plan.kind === 'compact') {
          const sit = seatedDrawOffsetPx(ch);
          const placement = placements.get(id);
          const side = plateSide(ch.dir);
          return (
            <CompactLabel
              key={id}
              id={id}
              status={status}
              plate={plan.content.mode === 'compact' ? plan.content.plate : null}
              maxWidth={maxWidth / scale}
              left={project.toScreenX(ch.x)}
              top={
                side === 'below'
                  ? project.toScreenY(ch.y + sit) + COMPACT_LABEL_FEET_GAP_PX
                  : project.toScreenY(plateAnchorAboveY(ch.y, sit, false, napHeadBobPx(ch)))
              }
              side={side}
              scale={scale}
              compact={compact}
              dx={clamps.get(id)?.dx ?? 0}
              dy={(placement?.dy ?? 0) + (clamps.get(id)?.dy ?? 0)}
              dim={placement?.dim ?? false}
              tripwire={officeState.tripwires.get(id)}
              onAckTripwire={onAckTripwire}
            />
          );
        }

        // Position above character
        const sittingOffset = seatedDrawOffsetPx(ch);
        const screenX = project.toScreenX(ch.x);
        const screenY = project.toScreenY(ch.y + sittingOffset - TOOL_OVERLAY_VERTICAL_OFFSET);

        // Get activity text
        const hasWaitingBubble = ch.bubbleType === 'waiting';
        const subHasPermission = isSub && ch.bubbleType === 'permission';
        // A workflow helper has no parent tool row: everything it shows comes from its own entry.
        const sub = isSub ? subagentCharacters.find((s) => s.id === id) : undefined;
        let activityText: string;
        if (hasWaitingBubble && ch.waitingAwaitingInput) {
          // Idle, waiting on the user -> dedicated label. A finished turn (Stop)
          // shows only the checkmark and falls through to the normal idle text.
          activityText = WAITING_INPUT_ACTIVITY_TEXT;
        } else if (isSub) {
          if (subHasPermission) {
            activityText = 'Needs approval';
          } else {
            // Hover shows the subtask title (a workflow helper's full label); SELECTING the sub
            // reveals its live tool activity (watched sub-agents stream it via subagentToolStart).
            const rows = sub ? subagentTools[sub.parentAgentId]?.[sub.parentToolId] : undefined;
            const activeRow =
              isSelected && rows ? [...rows].reverse().find((t) => !t.done) : undefined;
            activityText = activeRow?.status ?? (sub?.plateLabel || sub?.label || 'Subtask');
          }
        } else {
          activityText = getActivityText(
            id,
            agentTools,
            ch.isActive,
            ch.bubbleType,
            ch.waitingAwaitingInput ?? false,
          );
        }

        // Determine dot color
        const tools = agentTools[id];
        const hasPermission = subHasPermission || tools?.some((t) => t.permissionWait && !t.done);
        const hasActiveTools = tools?.some((t) => !t.done);
        const isActive = ch.isActive;
        const hasWaiting = ch.bubbleType === 'waiting';

        let dotColor: string | null = null;
        if (hasPermission || hasWaiting) {
          dotColor = 'var(--color-status-permission)';
        } else if (isActive && hasActiveTools) {
          dotColor = 'var(--color-status-active)';
        }

        // Team info
        const teamRoleLabel = ch.isTeamLead ? 'LEAD' : ch.agentName || null;
        const label = agentLabel(officeState.sessionTitles.get(id), ch.folderName);
        const tripwire = officeState.tripwires.get(id);
        const rosterRows = fullBoxRows({
          roster: officeState.rosters.get(id),
          model: {
            id: officeState.models.get(id)?.model ?? '',
            rarity: characterFlair(ch, officeState.models, isShowModelFlairEnabled()).rarity,
          },
        });
        const group = sub?.group;
        const hasExtraLines = !!(label || teamRoleLabel || tripwire || group);

        // Context gauge. Every agent gets one — lead, teammate, adopted,
        // headless — as soon as it has taken a turn. Sub-agents never do: they
        // have no session of their own, so contextTokens stays 0.
        const contextRatio = ch.contextTokens / ch.maxContextTokens;
        const showContextGauge = !isSub && ch.contextTokens > 0;

        return (
          <div
            key={id}
            className="absolute flex flex-col items-center -translate-x-1/2"
            style={{
              left: screenX,
              // The box grows downward from `top`, so each roster row lifts it to keep the character clear.
              top: screenY - (hasExtraLines ? 34 : 28) - rosterRows.length * FULL_BOX_ROW_PX,
              pointerEvents: isSelected ? 'auto' : 'none',
              zIndex: FULL_BOX_Z_INDEX,
            }}
            data-testid="agent-overlay"
            data-agent-id={id}
            data-status={status}
          >
            <div className="flex items-center border-border px-8 pt-2 pb-4 gap-5 pixel-panel whitespace-nowrap max-w-2xs">
              {dotColor && (
                <span
                  className={`w-6 h-6 rounded-full shrink-0 ${isActive && !hasPermission && !hasWaiting ? 'pixel-pulse' : ''}`}
                  style={{ background: dotColor }}
                />
              )}
              <div className="flex flex-col gap-0 overflow-hidden">
                {teamRoleLabel && (
                  <span
                    className="overflow-hidden text-ellipsis block leading-none"
                    style={{
                      fontSize: '18px',
                      color: ch.isTeamLead ? TEAM_LEAD_COLOR : TEAM_ROLE_COLOR,
                      fontWeight: ch.isTeamLead ? 'bold' : undefined,
                    }}
                  >
                    {teamRoleLabel}
                  </span>
                )}
                <span
                  className="overflow-hidden text-ellipsis block leading-none"
                  style={{
                    fontSize: isSub ? '20px' : '22px',
                    fontStyle: isSub ? 'italic' : undefined,
                  }}
                >
                  {activityText}
                </span>
                {group && (
                  <span className="text-2xs leading-none overflow-hidden text-ellipsis block">
                    {group}
                  </span>
                )}
                {tripwire && (
                  <span
                    className="overflow-hidden text-ellipsis block leading-none cursor-pointer"
                    // The panel ignores pointer events unless selected; the alarm line opts
                    // back in so one click acknowledges it.
                    style={{
                      fontSize: '18px',
                      color: tripwireColor(tripwire.severity),
                      pointerEvents: 'auto',
                    }}
                    title="Click to acknowledge"
                    data-testid="tripwire-alarm"
                    onClick={(e) => {
                      e.stopPropagation();
                      onAckTripwire(id, tripwire.count);
                    }}
                  >
                    {tripwireLabel(tripwire.ruleName, tripwire.count)}
                  </span>
                )}
                {label && (
                  <span className="text-2xs leading-none overflow-hidden text-ellipsis block">
                    {label}
                  </span>
                )}
                <FullBoxRoster rows={rosterRows} />
              </div>
              {isSelected && !isSub && (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={(e) => {
                    e.stopPropagation();
                    onCloseAgent(id);
                  }}
                  title="Close agent"
                  className="ml-2 shrink-0 leading-none"
                >
                  ×
                </Button>
              )}
            </div>
            {showContextGauge && (
              <div
                style={{
                  width: CONTEXT_GAUGE_WIDTH_PX,
                  height: CONTEXT_GAUGE_HEIGHT_PX,
                  background: CONTEXT_GAUGE_BG,
                  marginTop: 2,
                }}
                title={`${Math.round(contextRatio * 100)}% context used (${(ch.contextTokens / 1000).toFixed(0)}k of ${(ch.maxContextTokens / 1000).toFixed(0)}k tokens)`}
                data-testid="context-gauge"
                data-context-pct={Math.round(contextRatio * 100)}
              >
                <div
                  style={{
                    width: `${Math.min(contextRatio * 100, 100)}%`,
                    height: '100%',
                    background: getFuelColor(contextRatio),
                  }}
                />
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}
