/**
 * Provider abstraction for AI agent tools.
 *
 * Only HookProvider ships today (Claude Code). Transcript-polling and push-based
 * provider types will be added when a real second provider (Codex, Goose,
 * Discord, etc.) actually lands, derived from that provider's needs rather than
 * speculation.
 */

import type { TeamProvider } from './teamProvider.js';

// ── Turn signals (one classifier for live and derived state) ──

/** What one transcript record says about the turn, in provider-neutral terms.
 *  The live parser and the adoption-time tail walk both read records through
 *  this, so the two can never disagree about what a record means. */
export interface TurnSignal {
  kind:
    | 'prompt' // the user started a turn
    | 'interrupted' // the user cut the turn short
    | 'meta' // CLI-injected user record (slash command output, compaction): not a turn
    | 'toolUse'
    | 'toolResult'
    | 'textAnswer' // assistant text with no tool call
    | 'thinking' // assistant reasoning only
    | 'turnEnd'
    | 'ignore'; // bookkeeping records
  toolUseIds?: string[];
  toolNames?: string[];
  /** Epoch ms the record claims, when it carries one. */
  timestampMs?: number;
}

/** Tool names a provider needs the tail walk to treat specially. */
export interface TurnTraits {
  /** Tools that legitimately run for minutes without writing to the transcript. */
  longRunningTools: ReadonlySet<string>;
  /** Tools that block on an answer from the user. */
  userQuestionTools: ReadonlySet<string>;
}

// ── Normalized Events (all provider types produce these) ──────

export type AgentEvent =
  | {
      kind: 'toolStart';
      toolId: string;
      toolName: string;
      input?: unknown;
      /** True when the tool was spawned to run in the background (e.g. Claude's
       *  `run_in_background` on Agent/Task). Handlers use this to suppress ghost
       *  sub-agent characters for teammate spawns. */
      runInBackground?: boolean;
      /** True when this tool call is a shell command that ships work (a commit or
       *  a PR creation). The provider decides; the command text stays inside it. */
      ships?: boolean;
    }
  | {
      kind: 'toolEnd';
      toolId: string;
      /** True when the tool failed (Claude's PostToolUseFailure). Absent = succeeded. */
      failed?: boolean;
    }
  | {
      kind: 'turnEnd';
      /** True when the turn ended because the agent went idle waiting on the
       *  user (Claude's Notification(idle_prompt)) rather than simply finishing
       *  its response (Stop). Drives the "Waiting for input" vs "Done" label.
       *  Absent/false = the agent finished its turn (Done). */
      awaitingInput?: boolean;
    }
  | {
      kind: 'subagentStart';
      parentToolId: string;
      toolId: string;
      toolName: string;
      input?: unknown;
      runInBackground?: boolean;
    }
  | { kind: 'subagentEnd'; parentToolId: string; toolId: string }
  | {
      kind: 'subagentTurnEnd';
      parentToolId: string;
      /** 'idle' = subagent is idle and ready for more work; 'completed' = subagent
       *  reported its task done. Some providers emit only one; both route to the
       *  same handler but with different downstream cleanup. */
      reason: 'idle' | 'completed';
    }
  | { kind: 'progress'; toolId: string; data: unknown }
  | { kind: 'permissionRequest' }
  | {
      kind: 'sessionStart';
      source?: string;
      /** For external-session adoption: path to the session's transcript file
       *  (if the provider uses one). Undefined for providers without transcripts. */
      transcriptPath?: string;
      /** Working directory the session was started in. Used to match pending
       *  external sessions against known workspace folders. */
      cwd?: string;
    }
  | { kind: 'sessionEnd'; reason?: string };

// ── Model tiers ───────────────────────────────────────────────

/** Capability rank of a model within its provider: 1 smallest ... 4 largest.
 *  The office draws a rarity look from it, so it is a ranking, not a model id. */
export type ModelTier = 1 | 2 | 3 | 4;

// ── Hook-based Provider (CLIs with hooks APIs) ────────────────

export interface HookProvider {
  readonly kind: 'hook';
  readonly id: string;
  readonly displayName: string;
  /** Protocol version. Server refuses to dispatch events from a provider whose
   *  version it doesn't understand. Bump on every breaking change to AgentEvent
   *  / TeamProvider / HookProvider. Start at 1. */
  readonly protocolVersion: number;

  /** Normalize a raw hook event payload into an AgentEvent.
   *  Each CLI sends different JSON (Claude: snake_case, Copilot: camelCase, etc.)
   *  The provider translates to the common AgentEvent format.
   *  Return null for events we should ignore. */
  normalizeHookEvent(raw: Record<string, unknown>): {
    sessionId: string;
    event: AgentEvent;
  } | null;

  /** Install hook scripts that POST to our server. */
  installHooks(serverUrl: string, authToken: string): Promise<void>;
  /** Remove installed hook scripts. */
  uninstallHooks(): Promise<void>;
  /** Check if hooks are currently installed. */
  areHooksInstalled(): Promise<boolean>;
  /** First-run consent copy for THIS provider's hook install: the headline titles the ask, the disclosure is its body
   *  (what is written, what data moves, how to undo; paragraphs split on blank lines). Required, not optional — a
   *  provider that installs anything must state its terms, and the gate ships these verbatim so no client copy can
   *  drift. */
  consentDisclosure(): { headline: string; disclosure: string };

  /** Format tool status for display (e.g., "Read" -> "Reading foo.ts") */
  formatToolStatus(toolName: string, input?: unknown): string;
  /** Tools that don't trigger permission timers */
  readonly permissionExemptTools: ReadonlySet<string>;
  /** Tools that spawn sub-agent characters */
  readonly subagentToolNames: ReadonlySet<string>;
  /** Tools that should show the "reading" character animation instead of "typing".
   *  The provider classifies tools as read-like or write-like; the webview renders
   *  the animation. Allows new providers to override without webview edits. */
  readonly readingTools: ReadonlySet<string>;
  /** Terminal name prefix used when launching this CLI. Used by the extension to
   *  match VS Code terminals to agents for heuristic adoption. */
  readonly terminalNamePrefix?: string;

  /** Context window, in tokens, for a model id this CLI reports in its
   *  transcripts. Transcripts state token usage but never the limit it counts
   *  against, so only the provider can say — and getting it wrong is visible:
   *  the office renders usage/window as a context gauge over every character.
   *  Return undefined for an unrecognized model; the runtime then keeps its
   *  previous estimate and widens it if a context ever exceeds it. */
  contextWindowForModel?(model: string | undefined): number | undefined;

  /** Session title(s) carried by one transcript record, or null when the record
   *  has none. `customTitle` is a name the user chose, `aiTitle` one the CLI
   *  generated; the runtime prefers the former. Return only non-empty trimmed
   *  strings, capped at SESSION_TITLE_MAX_LENGTH: a field that is missing, blank
   *  or not a string is absent, never an empty title. */
  extractSessionTitle?(record: unknown): { customTitle?: string; aiTitle?: string } | null;

  /** Classify one parsed transcript record. Required for the adoption-time tail
   *  walk (server/src/turnState.ts); a provider without it keeps the old behavior
   *  of showing adopted agents as unknown. */
  turnSignal?(record: unknown): TurnSignal;
  /** Tool names the tail walk treats specially. See `TurnTraits`. */
  readonly turnTraits?: TurnTraits;

  /** How this CLI's transcripts report token usage. Present = the token ledger can
   *  total usage across sessions. See `TranscriptUsageSource`. */
  readonly transcriptUsage?: TranscriptUsageSource;
  /** Tier of a model id this CLI reports in its transcripts. Undefined for an
   *  id it cannot place: unknown means no flair, never the lowest tier. */
  modelTier?(model: string): ModelTier | undefined;

  // ── Optional file fallback (heuristic mode) ──

  /** Session directories to scan. Undefined = no file fallback. */
  getSessionDirs?(workspacePath: string): string[];
  /** Root directories containing every session this provider may have started
   *  (across all workspaces). Used by global session discovery / "Watch All
   *  Sessions". Each returned dir contains subdirs whose entries are session
   *  transcript files. Undefined = this provider doesn't support global scan. */
  getAllSessionRoots?(): string[];
  /** Glob pattern for session files (e.g., '*.jsonl'). */
  readonly sessionFilePattern?: string;
  /** Parse one line of a transcript file into an AgentEvent. */
  parseTranscriptLine?(line: string): AgentEvent | null;
  /** Build CLI launch command for +Agent button. */
  buildLaunchCommand?(
    sessionId: string,
    cwd: string,
    opts?: { bypassPermissions?: boolean },
  ): {
    command: string;
    args: string[];
    env?: Record<string, string>;
  };

  // ── Optional team/subagent extension (Agent Teams on Claude; empty for single-agent CLIs) ──

  /** Optional reference to a TeamProvider. When set, the hook handler registers team-aware
   *  branches (subagent routing, teammate discovery, permission forwarding, etc.). */
  readonly team?: TeamProvider;
}

// TODO(provider type taxonomy): FileProvider (polling-only CLIs) and StreamProvider
// (push-based external services) will be added alongside the first real second provider

/** One deduplicable usage report found in a transcript line. Counts are raw
 *  tokens: [input, cache-creation, cache-read, output]. */
export interface UsageRecord {
  /** Stable per-message id. The same message can be copied across lines and files (streaming repeats, resumed or
   *  forked sessions), so the ledger counts each id once. */
  messageId: string;
  /** The session the record claims. Records written by sub-agents carry their parent's session id. */
  sessionId: string;
  /** Epoch ms. */
  ts: number;
  model: string;
  usage: [number, number, number, number];
}

/** A provider quota announcement: the window it limits and when that window resets (epoch ms). */
export interface QuotaSignal {
  window: 'block' | 'week';
  ts: number;
  resetsAt: number;
}

/** What one transcript line yields; any subset may be present. */
export interface UsageLine {
  usage?: UsageRecord;
  quota?: QuotaSignal;
  /** Title record: the session it names and the title kinds it carries. */
  title?: { sessionId: string; customTitle?: string; aiTitle?: string };
}

/** A transcript file the ledger should read. */
export interface UsageTranscript {
  path: string;
  /** Name of the project directory holding the file (the area-mapping identity), top level only. */
  projectDirName: string;
  /** Session id implied by the path, used when a record carries none. */
  fallbackSessionId: string;
  size: number;
  mtimeMs: number;
}

/**
 * The provider-owned half of the token ledger: where transcripts live and how a
 * line reads. Everything CLI-specific (directory layout, record shape, quota
 * fields) stays behind this seam; the ledger only sees `UsageLine`s.
 */
export interface TranscriptUsageSource {
  /** Lines containing none of these substrings are skipped without a JSON parse. */
  readonly linePrefilters: readonly string[];
  /** Transcripts under `root` modified at or after `minMtimeMs`, including sub-agent transcripts. */
  listTranscripts(root: string, minMtimeMs: number): Promise<UsageTranscript[]>;
  /** Root directory holding every project. */
  usageRoot(): string;
  /** Parse one line; null when it carries nothing the ledger uses. `fallbackSessionId` stands in for a record that
   *  names no session. */
  parseUsageLine(line: string, fallbackSessionId: string): UsageLine | null;
}
