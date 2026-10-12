// ── JSONL File Watching ─────────────────────────────────────
export const JSONL_POLL_INTERVAL_MS = 1000;
export const FILE_WATCHER_POLL_INTERVAL_MS = 500;
export const PROJECT_SCAN_INTERVAL_MS = 1000;

// ── Heuristic Agent Status Detection ────────────────────────
// These timers are the fallback when CLI hooks are not active
// (hookDelivered = false). When hooks are working, these are
// suppressed and the server receives instant events instead.
/** Delay before sending agentToolDone (prevents UI flicker on rapid tool transitions) */
export const TOOL_DONE_DELAY_MS = 300;
/** Heuristic: time after a non-exempt tool starts before showing permission bubble.
 *  Not used for teammates -- false positives on slow tools (WebFetch/WebSearch).
 *  Teammates rely on the lead's routed Notification(permission_prompt) hook. */
export const PERMISSION_TIMER_DELAY_MS = 7000;
/** Heuristic: silence duration before marking a text-only turn as complete */
export const TEXT_IDLE_DELAY_MS = 5000;
/** Heuristic: idle threshold for per-agent /clear detection (content check prevents stealing) */
export const CLEAR_IDLE_THRESHOLD_MS = 2000;

// ── External Session Detection ──────────────────────────────
export const EXTERNAL_SCAN_INTERVAL_MS = 3000;
/** Two scan ticks: a transcript born this recently is adopted from its start, and a record
 *  stamped this long before a read from the start began still counts as new. */
export const TRANSCRIPT_FRESHNESS_WINDOW_MS = EXTERNAL_SCAN_INTERVAL_MS * 2;
/** Only adopt JSONL files modified within this window */
export const EXTERNAL_ACTIVE_THRESHOLD_MS = 120_000; // 2 minutes
/** Remove external agents after this much inactivity */
// export const EXTERNAL_STALE_TIMEOUT_MS = 300_000; // 5 minutes - deprecated
export const EXTERNAL_STALE_CHECK_INTERVAL_MS = 30_000;
/** Cooldown after user closes an agent via X. Must be > EXTERNAL_ACTIVE_THRESHOLD_MS
 *  so the file's mtime becomes stale before the dismissal expires. */
export const DISMISSED_COOLDOWN_MS = 180_000; // 3 minutes

// ── Context Window Usage ────────────────────────────────────
/** Window size assumed until a transcript proves otherwise. Transcripts never
 *  state the model's context limit, so this is the floor, not the truth. */
export const DEFAULT_MAX_CONTEXT_TOKENS = 200_000;
/** Known window sizes, ascending. The smallest tier that fits the largest
 *  context observed so far wins; beyond the last tier we round up to a whole
 *  multiple of it, so an unknown future window still reads under 100%. */
export const CONTEXT_WINDOW_TIERS = [200_000, 1_000_000] as const;
/** How much of a transcript's tail to read when seeding an agent's context on
 *  adoption or restore. Comfortably more than one turn's worth of records. */
export const CONTEXT_SEED_TAIL_BYTES = 256 * 1024;

// ── Workflow crews (workflowRuns.ts) ────────────────────────
/** An untracked run is adopted only if its journal or one of its agent
 *  transcripts moved within this window; a tracked run with nobody live is
 *  dropped only once that same test would turn it away. */
export const WORKFLOW_RUN_MAX_AGE_MS = 7_200_000;
/** A started agent whose transcript has been quiet this long is torn down (it
 *  stays a candidate and comes back if the transcript moves again). */
export const WORKFLOW_AGENT_STALE_MS = 900_000;
/** On attach, a transcript up to this size is replayed from the start; a larger
 *  one is tailed (the helper appears on its next tool). */
export const WORKFLOW_ATTACH_TAIL_BYTES = 1_048_576;
/** Re-stat cadence for stale candidates, rejected-as-old run dirs, and a
 *  missing `subagents/workflows` dir (a Workflow launch resets the last one). */
export const WORKFLOW_STALE_RECHECK_MS = 10_000;
export const WORKFLOW_IGNORED_RECHECK_MS = 60_000;
export const WORKFLOW_DIR_MISSING_RECHECK_MS = 5_000;
/** Journals are read in chunks of this size, so memory stays bounded however
 *  much is unread: result lines carry an agent's whole output. */
export const WORKFLOW_JOURNAL_CHUNK_BYTES = 1_048_576;
/** A journal line longer than this is consumed without being parsed. Only a
 *  result gets near it, and its agent then ends with staleness or its run. */
export const WORKFLOW_JOURNAL_MAX_LINE_BYTES = 4 * 1_048_576;

// ── Derived turn state (turnState.ts) ──────────────────────
/** An agent whose last record says "working" but whose files have been quiet
 *  this long is shown idle: the process is gone or the turn was abandoned. */
export const TURN_ACTIVE_STALE_MS = 90_000;
/** Same, while a long-running tool (a shell command, a spawned agent) is pending:
 *  those write nothing for minutes while genuinely working. */
export const TURN_LONG_TOOL_STALE_MS = 15 * 60_000;
/** A finished turn older than this no longer deserves a "Done" bubble. */
export const TURN_WAITING_STALE_MS = 2 * 60 * 60_000;

// ── Global Session Scanning ─────────────────────────────────
/** Only adopt global JSONL files larger than this (filters out empty/init-only sessions) */
export const GLOBAL_SCAN_ACTIVE_MIN_SIZE = 3_072; // 3KB
/** Only adopt global JSONL files modified within this window */
export const GLOBAL_SCAN_ACTIVE_MAX_AGE_MS = 600_000; // 10 minutes

// ── Display Truncation + Pixel Agents Server paths ──────────
// Centralized in core/src/constants.ts; re-exported here for back-compat.
export {
  HOOK_API_PREFIX,
  HOOK_SCRIPTS_DIR,
  SERVER_JSON_DIR,
  SERVER_JSON_NAME,
  SESSION_TITLE_MAX_LENGTH,
  TASK_DESCRIPTION_DISPLAY_MAX_LENGTH,
} from '../../core/src/constants.js';

// ── Multi-Server Discovery ──────────────────────────────────
/** Subdirectory (under SERVER_JSON_DIR) holding one registry entry per live
 *  server, so a hook event can fan out to every running instance instead of
 *  only the single legacy server.json pointer. See server/src/server.ts. */
export const SERVERS_DIR = 'servers';
/** Valid explicit TCP port range. Port 0 remains an internal-only signal for
 *  OS-assigned ephemeral binding and is never accepted from persisted records
 *  or the CLI's --port option. */
export const MIN_PORT = 1;
export const MAX_PORT = 65_535;
/** Format version stamped on every registry entry (both the per-server records
 *  and the legacy server.json). Bump on breaking field changes; additive
 *  fields (servesSpa, protocol itself) don't require a bump -- readers already
 *  tolerate unknown/missing fields (see ServerConfig.debugLog precedent). */
export const SERVER_REGISTRY_PROTOCOL_VERSION = 1;

// ── WebSocket close codes (application range 4000-4999) ────
/** Embedded mode: Bearer token missing or wrong. */
export const WS_CLOSE_UNAUTHORIZED = 4001;
/** Standalone mode: the handshake's Origin is not this server's own origin.
 *  WebSocket connects bypass CORS, so this is the only thing standing between
 *  a drive-by web page and the privileged client-message channel. */
export const WS_CLOSE_FORBIDDEN_ORIGIN = 4003;

export const HOOK_EVENT_BUFFER_MS = 5_000;
/** Grace period after SessionEnd(reason=clear/resume) before triggering onSessionEnd.
 *  /clear and /resume fire SessionEnd then SessionStart within ms. This timeout is a
 *  safety net: if SessionStart never arrives (e.g. the CLI crashes mid-transition),
 *  the agent is cleaned up instead of staying as a zombie with pendingClear forever. */
export const SESSION_END_GRACE_MS = 2000;
export const MAX_HOOK_BODY_SIZE = 65_536; // 64KB

// ── Layout/Config Persistence ──────────────────────────────
export const LAYOUT_FILE_DIR = '.pixel-agents';
export const LAYOUT_FILE_NAME = 'layout.json';
export const LAYOUT_FILE_POLL_INTERVAL_MS = 2000;
export const LAYOUT_REVISION_KEY = 'layoutRevision';
export const CONFIG_FILE_NAME = 'config.json';
export const TRIPWIRES_FILE_NAME = 'tripwires.json';

// ── Roster ─────────────────────────────────────────────────
export const ROSTER_FILE_NAME = 'roster.json';
/** XP and counters are batched; claims and releases write immediately. */
export const ROSTER_FLUSH_DEBOUNCE_MS = 2000;
export const ROSTER_LOCK_RETRIES = 20;
export const ROSTER_LOCK_RETRY_MS = 50;
/** Only an unreadable lockfile is broken by age; a readable one is broken when its owner pid is dead. */
export const ROSTER_LOCK_STALE_MS = 5000;

// ── Avatar Customization ────────────────────────────────────
/** Number of pre-colored bundled character palettes (char_0.png–char_11.png).
 *  Mirrors `PALETTE_COUNT` in webview-ui/src/constants.ts; kept separate
 *  because the server has no DOM/sprite access and cannot import the webview
 *  constant. The two values must stay in sync. */
export const PALETTE_COUNT = 12;
/** Inclusive upper bound for a valid agent hue shift, in degrees. Used by
 *  clientMessageHandler to guard saveAgentSeats payloads from a remote or
 *  hand-edited source corrupting the stored values with out-of-range values. */
export const HUE_SHIFT_MAX_DEG = 360;

// ── Token ledger ──
/** Transcripts untouched for longer than this are never read, and cached records older than this are pruned. */
export const TOKEN_LEDGER_WINDOW_MS = 8 * 24 * 60 * 60 * 1000;
export const TOKEN_LEDGER_WEEK_MS = 7 * 24 * 60 * 60 * 1000;
export const TOKEN_LEDGER_BLOCK_MS = 5 * 60 * 60 * 1000;
/** Incremental re-read cadence, and the floor between two `tokenUsage` broadcasts. */
export const TOKEN_LEDGER_TICK_MS = 30_000;
/** Cache flush cadence while running (shutdown flushes synchronously). */
export const TOKEN_LEDGER_CACHE_FLUSH_MS = 10 * 60 * 1000;
export const TOKEN_LEDGER_READ_HIGH_WATER_MARK = 1024 * 1024;
export const TOKEN_LEDGER_TOP_SESSIONS = 15;
export const TOKEN_LEDGER_CACHE_FILE = 'ledger-cache.json';

// ── XP signals ──
/** Paid signal keys remembered per agent. A key only has to outlive re-reads of its own
 *  record, so the oldest are dropped past this. */
export const SIGNAL_KEYS_MAX = 500;
