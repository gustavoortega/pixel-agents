import {
  COMPACT_LABEL_GAP_PX,
  COMPACT_LABEL_MIN_WIDTH_PX,
  COMPACT_LABEL_SEAT_PITCH_TILES,
  TILE_SIZE,
  TRIPWIRE_COLOR_HIGH,
  TRIPWIRE_COLOR_LOW,
  TRIPWIRE_COLOR_MEDIUM,
} from '../constants.js';

/** Map status prefixes back to tool names for animation selection */
const STATUS_TO_TOOL: Record<string, string> = {
  Reading: 'Read',
  Searching: 'Grep',
  Globbing: 'Glob',
  Fetching: 'WebFetch',
  'Searching web': 'WebSearch',
  Writing: 'Write',
  Editing: 'Edit',
  Running: 'Bash',
  Task: 'Task',
};

export function extractToolName(status: string): string | null {
  for (const [prefix, tool] of Object.entries(STATUS_TO_TOOL)) {
    if (status.startsWith(prefix)) return tool;
  }
  const first = status.split(/[\s:]/)[0];
  return first || null;
}

/** Text under the activity line: the session title, else the folder, else nothing. */
export function agentLabel(sessionTitle?: string, folderName?: string): string | null {
  return sessionTitle || folderName || null;
}

export type TripwireSeverity = 'high' | 'medium' | 'low';

export interface TripwireAlarm {
  ruleName: string;
  severity: TripwireSeverity;
  count: number;
}

const TRIPWIRE_SEVERITY_RANK: Record<TripwireSeverity, number> = { low: 1, medium: 2, high: 3 };

/** Beacon and overlay color for a severity. */
export function tripwireColor(severity: TripwireSeverity): string {
  if (severity === 'high') return TRIPWIRE_COLOR_HIGH;
  if (severity === 'medium') return TRIPWIRE_COLOR_MEDIUM;
  return TRIPWIRE_COLOR_LOW;
}

/** Overlay line for an agent's alarm; the count shows only once there is more than one hit. */
export function tripwireLabel(ruleName: string, count: number): string {
  return count > 1 ? `\u26A0 ${ruleName} \u00D7${count}` : `\u26A0 ${ruleName}`;
}

/** The alarm sound plays for the first hit since an ack or a severity escalation, never on a plain count bump. */
export function shouldPlayTripwireSound(
  prev: TripwireAlarm | undefined,
  next: { severity: TripwireSeverity },
): boolean {
  return !prev || TRIPWIRE_SEVERITY_RANK[next.severity] > TRIPWIRE_SEVERITY_RANK[prev.severity];
}

export type AgentStatus = 'active' | 'idle' | 'waiting' | 'permission';

/** Status as exposed on the overlay (`data-status`), so e2e and styling need not read text. */
export function agentStatus(ch: {
  isActive: boolean;
  bubbleType: 'permission' | 'waiting' | null;
}): AgentStatus {
  if (ch.bubbleType === 'permission') return 'permission';
  if (ch.bubbleType === 'waiting') return 'waiting';
  return ch.isActive ? 'active' : 'idle';
}

/**
 * Glyph drawn above an agent's head. Only an idle agent with nothing else in
 * the above-head slot gets one: a speech bubble or a tripwire beacon owns that
 * slot, and an active agent shows its typing animation instead. The idle
 * "waiting for input" state draws no bubble, so it counts as bubble-free.
 */
export function statusGlyph(
  ch: {
    isActive: boolean;
    bubbleType: 'permission' | 'waiting' | null;
    waitingAwaitingInput?: boolean;
  },
  hasTripwire = false,
): 'z' | null {
  if (ch.isActive || hasTripwire) return null;
  const drawsBubble = ch.bubbleType && !(ch.bubbleType === 'waiting' && ch.waitingAwaitingInput);
  return drawsBubble ? null : 'z';
}

/** Max CSS width of a compact label: one seat's slot minus a gap. `/ dpr` matches overlayProjection. */
export function compactLabelMaxWidth(zoom: number, dpr: number): number {
  return Math.max(
    0,
    (COMPACT_LABEL_SEAT_PITCH_TILES * TILE_SIZE * zoom) / dpr - COMPACT_LABEL_GAP_PX,
  );
}

export type OverlayLine =
  | { kind: 'label'; text: string; suffix: string; badge?: string }
  | { kind: 'tripwire'; text: string };

/** Compact level badge shown before the session label. */
export function levelBadge(level: number): string {
  return `Lv${level}`;
}

/** The roster member an agent plays, as last sent by the server. */
export interface AgentRosterInfo {
  memberId: string;
  name: string;
  level: number;
  /** XP earned inside the current level; the bar fraction is xp / xpToNext. */
  xp: number;
  xpToNext: number;
  streak: number;
  mood: 'alarmed' | 'frustrated' | 'happy' | 'neutral';
}

export interface RosterEventInfo {
  kind: 'xp' | 'levelUp';
  amount?: number;
}

/** Amount at or above which an XP award is worth a "+N XP" pop: a ship is 100, a clean tool turn
 *  with a 3-streak bonus is 105. Smaller awards only move the bar. */
export const XP_POP_MIN_AMOUNT = 100;
export const XP_POP_COOLDOWN_MS = 10_000;

/** Show "+N XP" for a ship, a level-up or a big bonus, at most once per cooldown per agent. */
export function shouldShowXpPop(
  event: RosterEventInfo,
  lastShownAt: number | undefined,
  now: number,
): boolean {
  const worthy =
    event.kind === 'levelUp' || (event.amount !== undefined && event.amount >= XP_POP_MIN_AMOUNT);
  return worthy && (lastShownAt === undefined || now - lastShownAt >= XP_POP_COOLDOWN_MS);
}

export type OverlayContent =
  { mode: 'full' } | { mode: 'marker' } | { mode: 'compact'; lines: OverlayLine[] };

/**
 * What an agent's overlay shows. Hovered or selected -> today's full box.
 * Otherwise a one-line compact label (session label, " +N" for live
 * sub-agents, plus the tripwire line), or just a marker when there is no room.
 */
export function overlayContent(state: {
  expanded: boolean;
  label: string | null;
  subCount: number;
  tripwire?: { ruleName: string; count: number } | null;
  /** Roster level; the badge shows even when the agent has no label. */
  level?: number;
  maxWidth: number;
}): OverlayContent {
  if (state.expanded) return { mode: 'full' };
  if (state.maxWidth < COMPACT_LABEL_MIN_WIDTH_PX) return { mode: 'marker' };
  const lines: OverlayLine[] = [];
  if (state.label || state.level !== undefined) {
    lines.push({
      kind: 'label',
      text: state.label ?? '',
      suffix: state.subCount > 0 ? ` +${state.subCount}` : '',
      ...(state.level !== undefined ? { badge: levelBadge(state.level) } : {}),
    });
  }
  if (state.tripwire) {
    lines.push({
      kind: 'tripwire',
      text: tripwireLabel(state.tripwire.ruleName, state.tripwire.count),
    });
  }
  return { mode: 'compact', lines };
}

/**
 * Which element an agent gets: the full box, the compact label, or none.
 * Sub-agents have no compact label (their parent shows +N); they get the full
 * box when they or their parent are hovered or selected.
 */
export function showOverlay(s: {
  isSub: boolean;
  isSelected: boolean;
  isHovered: boolean;
  parentSelected: boolean;
  parentHovered: boolean;
  alwaysShow: boolean;
}): 'full' | 'compact' | null {
  const self = s.isSelected || s.isHovered;
  if (s.isSub) return self || s.parentSelected || s.parentHovered ? 'full' : null;
  if (self) return 'full';
  return s.alwaysShow ? 'compact' : null;
}

// ── Provider capabilities (tool taxonomy for rendering decisions) ────────────
// Populated once by the `providerCapabilities` postMessage after `webviewReady`.
// Modules classifying tools (character animation, subagent creation gate) read
// from here instead of hardcoding Claude-specific tool names.

const providerCaps: {
  readingTools: Set<string>;
  subagentToolNames: Set<string>;
} = {
  readingTools: new Set(),
  subagentToolNames: new Set(),
};

export function setProviderCapabilities(caps: {
  readingTools: string[];
  subagentToolNames: string[];
}): void {
  providerCaps.readingTools = new Set(caps.readingTools);
  providerCaps.subagentToolNames = new Set(caps.subagentToolNames);
}

export function isReadingToolName(name: string | null | undefined): boolean {
  return typeof name === 'string' && providerCaps.readingTools.has(name);
}

export function isSubagentToolName(name: string | null | undefined): boolean {
  return typeof name === 'string' && providerCaps.subagentToolNames.has(name);
}
