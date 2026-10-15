/**
 * What a plate says an agent is doing, by precedence: it needs you (an alert tab with the minutes
 * it has waited), done (a helper whose task finished), the command it runs (`› git commit`), the
 * verb of its tool, asleep (a loop waiting for its next wake), idle with how long. Pure: the
 * overlay reads the office and passes plain facts, the tests pass a table.
 */

import { extractToolName, isReadingToolName, isSubagentToolName } from './toolUtils.js';

const MIN_MS = 60_000;

/** The tab on the left of an alert plate. Gold waits on you, rust is stuck. */
export interface PlateAlert {
  glyph: '!' | '?' | '×';
  tone: 'wait' | 'stuck';
  /** Epoch ms the wait began; null when the server did not say (the tab shows the glyph alone). */
  since: number | null;
}

export type PlateState =
  | { kind: 'alert'; alert: PlateAlert }
  | { kind: 'done' }
  | { kind: 'cmd'; cmd: string }
  | { kind: 'verb'; verb: string }
  | { kind: 'asleep'; until: number }
  | { kind: 'idle'; since: number | null };

export interface PlateFacts {
  /** A permission prompt is open (an open tool waiting on approval, or the permission bubble). */
  permission: boolean;
  permissionSince?: number;
  /** The agent stopped on a question for the user. */
  question: boolean;
  /** The status's `since`: the question's start, or the idle start. */
  statusSince?: number;
  /** Health stuck, looping or stalled, or an unacknowledged tripwire. */
  stuck: boolean;
  stuckSince?: number;
  /** A helper whose task is over. */
  done: boolean;
  active: boolean;
  /** Status text of the tool running now (`Running: git commit`, `Reading a.ts`), if any. */
  toolStatus: string | null;
  /** The loop's next wake, epoch ms, when the agent is a loop. */
  loopNextAt?: number;
  now: number;
}

/** The Bash status prefix the provider writes before the program (and allowlisted subcommand). */
const COMMAND_PREFIX = 'Running: ';

/** A word for what a tool does, from its status text. */
export function toolVerb(status: string | null): string {
  if (!status) return 'thinking';
  if (status.startsWith('Subtask:')) return 'delegating';
  const tool = extractToolName(status);
  if (tool === 'Read' || tool === 'Grep' || tool === 'Glob' || tool === 'WebFetch')
    return 'reading';
  if (tool === 'WebSearch' || isReadingToolName(tool)) return 'reading';
  if (tool === 'Write' || tool === 'Edit') return 'writing';
  if (tool === 'Task' || isSubagentToolName(tool)) return 'delegating';
  if (status === 'Planning') return 'planning';
  return 'working';
}

export function plateState(f: PlateFacts): PlateState {
  if (f.permission)
    return { kind: 'alert', alert: { glyph: '!', tone: 'wait', since: f.permissionSince ?? null } };
  if (f.question)
    return { kind: 'alert', alert: { glyph: '?', tone: 'wait', since: f.statusSince ?? null } };
  if (f.stuck)
    return {
      kind: 'alert',
      alert: { glyph: '×', tone: 'stuck', since: f.stuckSince ?? null },
    };
  if (f.done) return { kind: 'done' };
  if (f.active && f.toolStatus?.startsWith(COMMAND_PREFIX)) {
    const cmd = f.toolStatus.slice(COMMAND_PREFIX.length).trim();
    if (cmd) return { kind: 'cmd', cmd };
  }
  if (f.active) return { kind: 'verb', verb: toolVerb(f.toolStatus) };
  if (f.loopNextAt !== undefined && f.loopNextAt > f.now)
    return { kind: 'asleep', until: f.loopNextAt };
  return { kind: 'idle', since: f.statusSince ?? null };
}

/** A span of time as the plate words it: `47m`, `1h08m`, `2d3h`. Under a minute is `0m`. */
export function formatSpan(ms: number): string {
  const min = Math.max(0, Math.floor(ms / MIN_MS));
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h${String(min % 60).padStart(2, '0')}m`;
  return `${Math.floor(h / 24)}d${h % 24}h`;
}

/** Local wall-clock time, `17:45`. */
export function clockLabel(epochMs: number): string {
  const d = new Date(epochMs);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** The words after the name (never for an alert: the tab and the rail say it). */
export function stateText(s: PlateState, now: number): string | null {
  switch (s.kind) {
    case 'alert':
      return null;
    case 'done':
      return 'done';
    case 'cmd':
      return s.cmd;
    case 'verb':
      return s.verb;
    case 'asleep':
      return `asleep until ${clockLabel(s.until)}`;
    case 'idle':
      return s.since === null ? 'idle' : `idle ${formatSpan(now - s.since)}`;
  }
}

/** The alert tab's text: the glyph, and the minutes when known. */
export function alertText(a: PlateAlert, now: number): string {
  return a.since === null ? a.glyph : `${a.glyph} ${formatSpan(now - a.since)}`;
}
