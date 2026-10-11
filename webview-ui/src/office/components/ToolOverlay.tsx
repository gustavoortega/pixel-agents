import { useEffect, useState } from 'react';

import { Button } from '../../components/ui/Button.js';
import {
  CHARACTER_SITTING_OFFSET_PX,
  COMPACT_LABEL_FEET_GAP_PX,
  COMPACT_LABEL_LINE_HEIGHT_PX,
  COMPACT_LABEL_TEXT_SHADOW,
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
  LABEL_LAYOUT_DIM_OPACITY,
  TEAM_LEAD_COLOR,
  TEAM_ROLE_COLOR,
  TILE_SIZE,
  TOOL_OVERLAY_VERTICAL_OFFSET,
} from '../../constants.js';
import type { SubagentCharacter } from '../../hooks/useExtensionMessages.js';
import type { OfficeState } from '../engine/officeState.js';
import { areaSignRect, type LabelItem, layoutLabels, type Rect } from '../labelLayout.js';
import { overlayProjection } from '../projection.js';
import {
  agentLabel,
  agentStatus,
  compactLabelMaxWidth,
  type OverlayContent,
  overlayContent,
  showOverlay,
  tripwireColor,
  tripwireLabel,
  type TripwireSeverity,
} from '../toolUtils.js';
import type { ToolActivity } from '../types.js';
import { CharacterState } from '../types.js';

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
  alwaysShowOverlay: boolean;
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

function CompactLabel({
  id,
  status,
  content,
  maxWidth,
  left,
  top,
  dy,
  dim,
  tripwire,
  onAckTripwire,
}: {
  id: number;
  status: string;
  content: Extract<OverlayContent, { mode: 'compact' | 'marker' }>;
  maxWidth: number;
  left: number;
  top: number;
  dy: number;
  dim: boolean;
  tripwire: { count: number; severity: TripwireSeverity } | undefined;
  onAckTripwire: (id: number, count: number) => void;
}) {
  const lines = content.mode === 'compact' ? content.lines : [];
  // An empty element still renders so every agent keeps its overlay node (tests
  // count them, and hover/select swap it for the full box in place).
  return (
    <div
      className="absolute flex flex-col overflow-hidden"
      style={{
        left,
        top,
        maxWidth,
        transform: `translate(-50%, ${dy}px)`,
        transition: 'transform 120ms',
        opacity: dim ? LABEL_LAYOUT_DIM_OPACITY : 1,
        pointerEvents: 'none',
        zIndex: COMPACT_LABEL_Z_INDEX,
      }}
      data-testid="agent-overlay"
      data-agent-id={id}
      data-status={status}
    >
      {lines.map((line) =>
        line.kind === 'label' ? (
          <span
            key="label"
            className="flex whitespace-nowrap leading-none text-2xs"
            style={{ height: COMPACT_LABEL_LINE_HEIGHT_PX, textShadow: COMPACT_LABEL_TEXT_SHADOW }}
          >
            {line.badge && <span className="shrink-0 pr-1">{line.badge}</span>}
            <span className="overflow-hidden text-ellipsis">{line.text}</span>
            {line.suffix && <span className="shrink-0">{line.suffix}</span>}
          </span>
        ) : (
          <span
            key="tripwire"
            className="overflow-hidden text-ellipsis block whitespace-nowrap leading-none text-2xs cursor-pointer"
            // Labels ignore pointer events; the alarm line opts back in so one click acknowledges it.
            style={{
              height: COMPACT_LABEL_LINE_HEIGHT_PX,
              color: tripwireColor(tripwire?.severity ?? 'low'),
              pointerEvents: 'auto',
            }}
            title="Click to acknowledge"
            data-testid="tripwire-alarm"
            onClick={(e) => {
              e.stopPropagation();
              if (tripwire) onAckTripwire(id, tripwire.count);
            }}
          >
            {line.text}
          </span>
        ),
      )}
    </div>
  );
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
  alwaysShowOverlay,
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
  const project = overlayProjection(
    officeState.getLayout(),
    el.getBoundingClientRect(),
    zoom,
    panRef.current,
    window.devicePixelRatio || 1,
  );

  const selectedId = officeState.selectedAgentId;
  const hoveredId = officeState.hoveredAgentId;

  // All character IDs
  const allIds = [...agents, ...subagentCharacters.map((s) => s.id)];

  // Pass 1: decide what each character gets. Compact labels are then laid out
  // together so they can avoid each other and the room signs; full boxes are
  // not part of that pass.
  const dpr = window.devicePixelRatio || 1;
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
      alwaysShow: alwaysShowOverlay,
    });
    if (shown === 'full') {
      plans.set(id, { kind: 'full' });
    } else if (shown === 'compact') {
      const content = overlayContent({
        expanded: false,
        label: agentLabel(officeState.sessionTitles.get(id), ch.folderName),
        subCount: subagentCharacters.filter((s) => s.parentAgentId === id).length,
        tripwire: officeState.tripwires.get(id),
        level: officeState.rosters.get(id)?.level,
        maxWidth,
      });
      if (content.mode === 'full') continue;
      plans.set(id, { kind: 'compact', content });
      if (content.mode === 'compact' && content.lines.length > 0) {
        // Anchor on the tile centre, not the sprite, so labels do not reshuffle while agents walk.
        const sit = ch.state === CharacterState.TYPE ? CHARACTER_SITTING_OFFSET_PX : 0;
        labelItems.push({
          id,
          col: ch.tileCol,
          row: ch.tileRow,
          x: project.toScreenX((ch.tileCol + 0.5) * TILE_SIZE),
          y: project.toScreenY((ch.tileRow + 0.5) * TILE_SIZE + sit) + COMPACT_LABEL_FEET_GAP_PX,
          w: maxWidth,
          h: content.lines.length * COMPACT_LABEL_LINE_HEIGHT_PX,
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

  return (
    <>
      {allIds.map((id) => {
        const ch = officeState.characters.get(id);
        const plan = plans.get(id);
        if (!ch || !plan) return null;

        const isSelected = selectedId === id;
        const isSub = ch.isSubagent;
        const status = agentStatus(ch);

        if (plan.kind === 'compact') {
          const sit = ch.state === CharacterState.TYPE ? CHARACTER_SITTING_OFFSET_PX : 0;
          const placement = placements.get(id);
          return (
            <CompactLabel
              key={id}
              id={id}
              status={status}
              content={plan.content}
              maxWidth={maxWidth}
              left={project.toScreenX(ch.x)}
              top={project.toScreenY(ch.y + sit) + COMPACT_LABEL_FEET_GAP_PX}
              dy={placement?.dy ?? 0}
              dim={placement?.dim ?? false}
              tripwire={officeState.tripwires.get(id)}
              onAckTripwire={onAckTripwire}
            />
          );
        }

        // Position above character
        const sittingOffset = ch.state === CharacterState.TYPE ? CHARACTER_SITTING_OFFSET_PX : 0;
        const screenX = project.toScreenX(ch.x);
        const screenY = project.toScreenY(ch.y + sittingOffset - TOOL_OVERLAY_VERTICAL_OFFSET);

        // Get activity text
        const hasWaitingBubble = ch.bubbleType === 'waiting';
        const subHasPermission = isSub && ch.bubbleType === 'permission';
        let activityText: string;
        if (hasWaitingBubble && ch.waitingAwaitingInput) {
          // Idle, waiting on the user -> dedicated label. A finished turn (Stop)
          // shows only the checkmark and falls through to the normal idle text.
          activityText = WAITING_INPUT_ACTIVITY_TEXT;
        } else if (isSub) {
          if (subHasPermission) {
            activityText = 'Needs approval';
          } else {
            // Hover shows the subtask title; SELECTING the sub reveals its live
            // tool activity (watched sub-agents stream it via subagentToolStart).
            const sub = subagentCharacters.find((s) => s.id === id);
            const rows = sub ? subagentTools[sub.parentAgentId]?.[sub.parentToolId] : undefined;
            const activeRow =
              isSelected && rows ? [...rows].reverse().find((t) => !t.done) : undefined;
            activityText = activeRow?.status ?? (sub?.label || 'Subtask');
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
        const hasExtraLines = !!(label || teamRoleLabel || tripwire);

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
              top: screenY - (hasExtraLines ? 34 : 28),
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
