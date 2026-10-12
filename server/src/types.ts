import type * as vscode from 'vscode';

import type { ModelTier } from '../../core/src/provider.js';
import type { HookSubRow } from './hookSubRows.js';
import type { LeadWorkflowState } from './workflowRuns.js';

export interface AgentState {
  id: number;
  sessionId: string;
  /** Terminal reference — undefined for extension panel sessions */
  terminalRef?: vscode.Terminal;
  /** Whether this agent was detected from an external source (VS Code extension panel, etc.) */
  isExternal: boolean;
  projectDir: string;
  jsonlFile: string;
  fileOffset: number;
  lineBuffer: string;
  activeToolIds: Set<string>;
  activeToolStatuses: Map<string, string>;
  activeToolNames: Map<string, string>;
  activeSubagentToolIds: Map<string, Set<string>>; // parentToolId → active sub-tool IDs
  activeSubagentToolNames: Map<string, Map<string, string>>; // parentToolId → (subToolId → toolName)
  backgroundAgentToolIds: Set<string>; // tool IDs for run_in_background Agent calls (stay alive until queue-operation)
  isWaiting: boolean;
  /** Meaningful while `isWaiting`: true when the agent stopped on a question for
   *  the user ("Waiting for input"), false/absent when it finished ("Done"). */
  awaitingInput?: boolean;
  /** True when the transcript tail said the agent is mid-turn at adoption or
   *  restore, before any live event confirmed it. Cleared by the first live
   *  record or hook event. Lets a reconnecting client be told `active`. */
  derivedActive?: boolean;
  /** Counts hook events routed to this agent. A derived status is applied only
   *  if the count did not move while it was computed: a hook is fresher. */
  hookSeq?: number;
  permissionSent: boolean;
  hadToolsInTurn: boolean;
  /** Workspace folder name (only set for multi-root workspaces) */
  folderName?: string;
  /** Timestamp of last JSONL data received (ms since epoch) */
  lastDataAt: number;
  /** Total JSONL lines processed for this agent */
  linesProcessed: number;
  /** Set of record.type values we've already warned about (prevents log spam) */
  seenUnknownRecordTypes: Set<string>;
  /** Whether a hook event has been delivered for this agent (suppresses heuristic timers) */
  hookDelivered: boolean;
  /** True when agent has no transcript file (provider doesn't use JSONL). All state from hooks. */
  hooksOnly?: boolean;
  /** Provider that created this agent (defaults to 'claude') */
  providerId?: string;
  /** Set when SessionEnd(reason=clear) fires; cleared when SessionStart(source=clear) reassigns */
  pendingClear?: boolean;
  /** Hook-generated tool ID for PreToolUse/PostToolUse correlation */
  currentHookToolId?: string;
  /** Tool name from the most recent PreToolUse, used to correlate a later SubagentStart
   *  event with the parent tool that launched it. */
  currentHookToolName?: string;
  /** True if the CURRENT PreToolUse tool call is a teammate spawn (per the provider's
   *  `team.isTeammateSpawnCall`). Authoritative source for teammate vs basic-subagent
   *  routing in SubagentStart. Set in PreToolUse, NOT cleared in PostToolUse (survives
   *  the PostToolUse-before-SubagentStart race); overwritten on the next PreToolUse. */
  currentHookIsTeammateSpawn?: boolean;

  // -- Context window usage (server/src/contextUsage.ts) --
  /** Tokens in the agent's context as of its newest turn; 0 until one is seen.
   *  A snapshot, not a running total -- it falls on compaction and /clear. */
  contextTokens: number;
  /** Observational estimate of the window `contextTokens` fits in. Widens as
   *  larger contexts appear, never shrinks. */
  maxContextTokens: number;
  /** True once this transcript produced a main-chain turn, after which
   *  sidechain records belong to sub-agents and stop moving the gauge. */
  sawMainChainUsage?: boolean;

  // -- Model look (server/src/contextUsage.ts) --
  /** Model id of the newest main-chain turn; undefined until one is seen. */
  model?: string;
  /** The provider's tier for `model`; undefined when it cannot place it. */
  modelTier?: ModelTier;

  // -- Session title (server/src/sessionTitle.ts) --
  /** Title the user chose for the session; the newest record wins. */
  customTitle?: string;
  /** Title the CLI generated; used only while there is no customTitle. */
  aiTitle?: string;
  /** The jsonlFile the titles above were read from. A different file (switch,
   *  /clear) means they belong to another session and must be dropped. */
  titleSourceFile?: string;

  // -- Agent Teams --
  teamName?: string;
  agentName?: string;
  /** True when teamName was read from the session's own record tags (tmux/
   *  inline teams, teammate sessions). Tag identity is authoritative: spawn-
   *  result re-latching (implicit-team generations on resume) only applies to
   *  tag-less leads. Transient — not persisted. */
  teamNameFromTags?: boolean;
  isTeamLead?: boolean;
  leadAgentId?: number;
  /** True when lead spawns teammates via tmux (run_in_background Agent calls) */
  teamUsesTmux?: boolean;
  /** For a promoted anonymous background agent (teams OFF): the lead's Agent
   *  tool_use id that spawned it. Links this character to the lead's
   *  backgroundAgentToolIds entry so the queue-operation completion removes it. */
  spawnToolUseId?: string;
  /** Tool ids of spawn calls whose input carried a `name` — teammates-to-be.
   *  Every agentToolStart (re-)broadcast for these carries isTeammateSpawn so
   *  the webview never creates a Subtask ghost for them. Transient, lazily
   *  created, never persisted. */
  teammateSpawnToolIds?: Set<string>;
  /** Rows SubagentStart drew under an open Task/Agent tool, by the hook's
   *  agent_id (hookSubRows.ts). Transient, never persisted. */
  hookSubRows?: Map<string, HookSubRow>;

  // -- Workflow crews (server/src/workflowRuns.ts) --
  /** A lead's workflow runs, watched helpers and Workflow tool mappings. Only
   *  the mappings are persisted; the rest is re-read from the run journals. */
  workflow?: LeadWorkflowState;
  /** The session whose end disposed `workflow`, with the runs it knew. Not
   *  scanned while the lead is still on it; a Workflow launch there (a resume
   *  under the same id) scans again, those runs taken as completed. Transient. */
  workflowEnded?: { sessionId: string; runIds: Set<string> };

  // -- Tripwires (server/src/tripwires.ts) --
  /** Alarm raised by a detection rule over this agent's tool calls. `count` is every
   *  hit since the last ack; the rule shown is the highest severity seen since then.
   *  Holds ids and labels only, never the matched text. Transient, not persisted. */
  tripwire?: {
    ruleId: string;
    ruleName: string;
    severity: 'high' | 'medium' | 'low';
    count: number;
  };

  // -- Avatar customization --
  /** Preferred character palette (0-11). If undefined, auto-assigned for diversity. */
  palette?: number;
  /** Hue shift in degrees (0-360). Rotates the base palette colors. */
  hueShift?: number;

  // -- Roster + XP (server/src/roster.ts, server/src/xp.ts) --
  /** Roster member this agent holds. Palette and hueShift come from the member. */
  rosterId?: string;
  /** Per-turn XP bookkeeping. Transient, never persisted. */
  xpTurn?: {
    xpToolsInTurn: boolean;
    turnFailed: boolean;
    pendingShip: boolean;
    shipped: boolean;
  };
}

export interface PersistedAgent {
  id: number;
  sessionId?: string;
  /** Terminal name — empty string for extension panel sessions */
  terminalName: string;
  /** Whether this agent was detected from an external source */
  isExternal?: boolean;
  jsonlFile: string;
  projectDir: string;
  /** Workspace folder name (only set for multi-root workspaces) */
  folderName?: string;

  // -- Agent Teams --
  teamName?: string;
  agentName?: string;
  isTeamLead?: boolean;
  leadAgentId?: number;
  teamUsesTmux?: boolean;
  /** Live background-spawn tool ids on a lead. Persisted so the spawns'
   *  transcripts are re-adopted after a reload; the spawned children
   *  themselves are derived state and never persisted. */
  backgroundAgentToolIds?: string[];
  /** Workflow tool_use id -> runId on a lead, so a run's completion
   *  notification still ends its helpers after a restart. */
  workflowRuns?: Record<string, string>;
  /** Workflow runs a lead knows finished, so a restart does not revive their
   *  unfinished agents. Pruned with the run dirs. */
  completedWorkflowRunIds?: string[];
  /** Preferred character palette (0-11). Persisted so colors stay stable
   *  across server restarts; assignPaletteIfNeeded is a no-op on restore. */
  palette?: number;
  /** Hue shift in degrees (0-360). Persisted alongside palette. */
  hueShift?: number;
  /** Roster member this agent held (server/src/roster.ts). Reclaimed on restore. */
  rosterId?: string;
}
