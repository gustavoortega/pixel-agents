import { TRIPWIRE_COLOR_HIGH, TRIPWIRE_COLOR_LOW, TRIPWIRE_COLOR_MEDIUM } from '../constants.js';

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
