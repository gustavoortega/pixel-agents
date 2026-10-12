import * as fs from 'fs';

import { CACHE_TTL_1H_SECONDS, CACHE_TTL_5M_SECONDS } from '../../core/src/constants.js';
import type { AgentCache, CacheTtlSeconds } from '../../core/src/messages.js';
import type { HookProvider } from '../../core/src/provider.js';
import type { AgentStateStore } from './agentStateStore.js';
import {
  CONTEXT_SEED_TAIL_BYTES,
  CONTEXT_WINDOW_TIERS,
  DEFAULT_MAX_CONTEXT_TOKENS,
} from './constants.js';
import type { AgentState } from './types.js';

/**
 * How full an agent's context window is — the context gauge above every character.
 *
 * The number is a SNAPSHOT of the newest turn, never a running total: an
 * agent's context is whatever the last request carried, so it drops when the
 * session compacts or clears. Cached prompt tokens dominate that figure
 * (`input_tokens` alone is usually single digits once caching kicks in), so
 * all three prompt counters are summed plus what the model just wrote.
 */
interface UsageBlock {
  input_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  output_tokens?: number;
  /** The cache write split by TTL class. A cache read has no TTL of its own. */
  cache_creation?: {
    ephemeral_5m_input_tokens?: number;
    ephemeral_1h_input_tokens?: number;
  };
}

/** Shape we care about; transcripts carry far more per record. */
interface TranscriptRecord {
  isSidechain?: boolean;
  timestamp?: string;
  message?: { id?: string; model?: string; usage?: UsageBlock };
}

/**
 * Context size implied by one transcript record, or 0 when it says nothing.
 *
 * Zero covers three cases that all mean "no news": records without usage,
 * synthetic assistant messages (API errors, interrupts) which report all-zero
 * usage, and anything malformed. Callers treat 0 as "leave the gauge alone" —
 * a real context is never 0 once a turn has run.
 */
export function extractContextTokens(record: unknown): number {
  const usage = (record as TranscriptRecord | null)?.message?.usage;
  if (!usage || typeof usage !== 'object') return 0;
  const sum =
    (usage.input_tokens ?? 0) +
    (usage.cache_creation_input_tokens ?? 0) +
    (usage.cache_read_input_tokens ?? 0) +
    (usage.output_tokens ?? 0);
  return Number.isFinite(sum) && sum > 0 ? sum : 0;
}

/**
 * Window an observed context has to fit in, when nobody can name it.
 *
 * The provider's answer for the model is the real source (see
 * `HookProvider.contextWindowForModel`); this is the backstop for unrecognized
 * models and for windows larger than anything we know about. It only ever
 * widens: a context that doesn't fit proves the assumption too small, while a
 * context that shrinks proves nothing (a 900k session compacted to 20k is
 * still running in a 1M window).
 */
export function widenContextWindow(observed: number, current: number): number {
  const window = Math.max(current || 0, DEFAULT_MAX_CONTEXT_TOKENS);
  for (const tier of CONTEXT_WINDOW_TIERS) {
    if (tier >= observed) return Math.max(window, tier);
  }
  const largest = CONTEXT_WINDOW_TIERS[CONTEXT_WINDOW_TIERS.length - 1];
  return Math.max(window, Math.ceil(observed / largest) * largest);
}

function applyContextTokens(
  agentId: number,
  agent: AgentState,
  agents: AgentStateStore,
  tokens: number,
  fromMainChain: boolean,
  declaredWindow: number | undefined,
): void {
  if (fromMainChain) agent.sawMainChainUsage = true;
  agent.contextTokens = tokens;
  // A named model wins over the running estimate -- switching models mid-session
  // genuinely changes the window, and the provider knows it while we're only
  // guessing from what we've seen.
  agent.maxContextTokens = widenContextWindow(tokens, declaredWindow ?? agent.maxContextTokens);
  agents.broadcast({
    type: 'agentContextUsage',
    id: agentId,
    contextTokens: agent.contextTokens,
    maxContextTokens: agent.maxContextTokens,
  });
}

/**
 * Fold one freshly-read transcript record into the agent's context gauge.
 *
 * Sidechain records are another agent's turn, but WHOSE depends on the file:
 * in a lead's transcript they're its sub-agents (older Claude formats inline
 * them) and must not move the lead's gauge; a teammate's own transcript is
 * sidechain top to bottom and would otherwise never report anything. So the
 * rule is positional — once this file has produced a main-chain turn, later
 * sidechain records belong to someone else.
 */
export function updateContextUsage(
  agentId: number,
  agent: AgentState,
  agents: AgentStateStore,
  record: unknown,
  provider?: HookProvider | null,
): void {
  const tokens = extractContextTokens(record);
  if (tokens <= 0) return;
  const isSidechain = (record as TranscriptRecord | null)?.isSidechain === true;
  if (isSidechain && agent.sawMainChainUsage) return;
  applyContextTokens(agentId, agent, agents, tokens, !isSidechain, windowFor(record, provider));
  if (!isSidechain) applyModel(agentId, agent, agents, record, provider);
  // Same gates as the gauge: a synthetic record or a sub-agent's turn never moves the clock.
  if (stepCacheClock(agent, record)) agents.broadcast(cacheMessage(agentId, agent));
}

// ── Prompt-cache clock ──

/**
 * The prompt-cache clock is an estimate of what Claude Code's statusline calls
 * `prompt_cache`, which reaches neither hooks nor transcripts. It starts at the
 * first transcript line of the turn instead of at the request, so it trails the
 * real one by seconds, never by a TTL class. Cold is left to the reader: the
 * clock only says when the cache expires.
 */
type CacheClock = Pick<AgentState, 'cacheTtlSeconds' | 'cacheExpiresAt' | 'cacheMessageId'>;

/** Epoch ms a transcript record claims, or undefined without a parseable
 *  timestamp. The Claude turn classifier reads time through this too, so the
 *  cache clock and the turn state agree on when a record happened. */
export function recordTimestampMs(record: unknown): number | undefined {
  const value = (record as { timestamp?: unknown } | null)?.timestamp;
  if (typeof value !== 'string') return undefined;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? undefined : ms;
}

/** TTL class a turn wrote the cache with; undefined for a turn that only read it.
 *  A turn that wrote both classes keeps the longer one. */
function cacheWriteTtl(record: unknown): CacheTtlSeconds | undefined {
  const split = (record as TranscriptRecord | null)?.message?.usage?.cache_creation;
  const wrote = (tokens: unknown) => typeof tokens === 'number' && tokens > 0;
  if (wrote(split?.ephemeral_1h_input_tokens)) return CACHE_TTL_1H_SECONDS;
  if (wrote(split?.ephemeral_5m_input_tokens)) return CACHE_TTL_5M_SECONDS;
  return undefined;
}

/**
 * Advance the clock by one usage record the gauge accepted. Returns true when
 * the clock moved and the office should hear about it.
 *
 * The newest write sets the TTL class, with no latch: a 5 minute write after
 * 1 hour ones is the session moving to usage credits, and the clock must say
 * so. A turn that only read the cache keeps the class it had and restarts it.
 */
function stepCacheClock(clock: CacheClock, record: unknown): boolean {
  const rawId = (record as TranscriptRecord | null)?.message?.id;
  const messageId = typeof rawId === 'string' ? rawId : undefined;
  // One message spans several lines with later timestamps; its first line is the turn.
  if (messageId !== undefined && messageId === clock.cacheMessageId) return false;
  // Without a timestamp the record says nothing about when. Reading it as "now"
  // would date a replayed or seeded turn to the moment it was read.
  const at = recordTimestampMs(record);
  if (at === undefined) return false;
  clock.cacheMessageId = messageId;
  const ttl = cacheWriteTtl(record) ?? clock.cacheTtlSeconds;
  if (ttl === undefined) return false; // no write seen yet: unknown, never cold
  clock.cacheTtlSeconds = ttl;
  clock.cacheExpiresAt = at + ttl * 1000;
  return true;
}

/** The agentCache message for an agent: both fields when the clock is known,
 *  neither while it is unknown. */
export function cacheMessage(id: number, agent: AgentState): Record<string, unknown> {
  if (agent.cacheTtlSeconds === undefined || agent.cacheExpiresAt === undefined) {
    return { type: 'agentCache', id } satisfies AgentCache;
  }
  return {
    type: 'agentCache',
    id,
    ttlSeconds: agent.cacheTtlSeconds,
    expiresAt: agent.cacheExpiresAt,
  } satisfies AgentCache;
}

/** Forget the clock (the agent moved to another transcript, or its session
 *  ended) and tell the office it is unknown again. */
export function clearCacheClock(agentId: number, agent: AgentState, agents: AgentStateStore): void {
  agent.cacheTtlSeconds = undefined;
  agent.cacheExpiresAt = undefined;
  agent.cacheMessageId = undefined;
  agents.broadcast(cacheMessage(agentId, agent));
}

/**
 * Track which model the agent's newest main-chain turn ran on, and tell the
 * office when it changes (it draws the rarity look from it).
 *
 * Callers pass main-chain records only: a sidechain turn belongs to a
 * sub-agent, whose model says nothing about this agent. Synthetic records (API
 * errors, interrupts) report zero usage, so the callers' no-news gate keeps
 * them out too. The broadcast is per change, not per line: a transcript
 * repeats the model on every record.
 */
function applyModel(
  agentId: number,
  agent: AgentState,
  agents: AgentStateStore,
  record: unknown,
  provider?: HookProvider | null,
): void {
  const model = (record as TranscriptRecord | null)?.message?.model;
  if (typeof model !== 'string' || !model) return;
  const tier = provider?.modelTier?.(model);
  if (model === agent.model && tier === agent.modelTier) return;
  agent.model = model;
  agent.modelTier = tier;
  agents.broadcast(
    tier === undefined
      ? { type: 'agentModel', id: agentId, model }
      : { type: 'agentModel', id: agentId, model, tier },
  );
}

/** The provider's window for whichever model wrote this record. */
function windowFor(record: unknown, provider?: HookProvider | null): number | undefined {
  return provider?.contextWindowForModel?.((record as TranscriptRecord | null)?.message?.model);
}

/**
 * The last `bytes` of a file as lines, or null when it can't be read.
 * A mid-file start lands inside a record, so that leading fragment is dropped.
 */
export function readTailLines(file: string, bytes: number): string[] | null {
  try {
    const stat = fs.statSync(file);
    const start = Math.max(0, stat.size - bytes);
    const length = stat.size - start;
    if (length <= 0) return [];
    const fd = fs.openSync(file, 'r');
    try {
      const buf = Buffer.alloc(length);
      fs.readSync(fd, buf, 0, length, start);
      let text = buf.toString('utf8');
      if (start > 0) text = text.slice(text.indexOf('\n') + 1);
      return text.split('\n');
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return null;
  }
}

/**
 * Seed the gauge and the cache clock from a transcript's tail when watching starts.
 *
 * Most agents are adopted or restored mid-session with `fileOffset` at
 * end-of-file, so streaming alone leaves them gauge-less until their next
 * turn, and an office full of idle agents would show nothing. Reading the last
 * chunk finds the newest usage without replaying history. The two seed apart:
 * an agent moved to another transcript keeps its gauge until its next turn but
 * must not keep the old file's clock.
 */
export function seedContextUsage(
  agentId: number,
  agents: AgentStateStore,
  provider?: HookProvider | null,
): void {
  const agent = agents.get(agentId);
  if (!agent || !agent.jsonlFile) return;
  const needGauge = agent.contextTokens <= 0;
  const needClock = agent.cacheExpiresAt === undefined;
  if (!needGauge && !needClock) return;

  const lines = readTailLines(agent.jsonlFile, CONTEXT_SEED_TAIL_BYTES);
  if (!lines) return; // unreadable transcript -- the stream will seed it on the next turn

  // Usage records in file order; the all-zero gate applies to both seeds.
  const usage: Array<{ record: unknown; tokens: number }> = [];
  for (const line of lines) {
    if (!line) continue;
    let record: unknown;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }
    const tokens = extractContextTokens(record);
    if (tokens > 0) usage.push({ record, tokens });
  }
  if (needGauge) seedGauge(agentId, agent, agents, usage, provider);
  if (needClock) seedCacheClock(agentId, agent, agents, usage);
}

function seedGauge(
  agentId: number,
  agent: AgentState,
  agents: AgentStateStore,
  usage: ReadonlyArray<{ record: unknown; tokens: number }>,
  provider?: HookProvider | null,
): void {
  // Newest first. Main-chain wins; sidechain is the fallback that makes
  // teammate transcripts (sidechain-only files) work.
  let sidechain: { tokens: number; window: number | undefined } | null = null;
  for (let i = usage.length - 1; i >= 0; i--) {
    const { record, tokens } = usage[i];
    if ((record as TranscriptRecord).isSidechain === true) {
      sidechain ??= { tokens, window: windowFor(record, provider) };
      continue;
    }
    applyContextTokens(agentId, agent, agents, tokens, true, windowFor(record, provider));
    applyModel(agentId, agent, agents, record, provider);
    return;
  }
  if (sidechain) {
    applyContextTokens(agentId, agent, agents, sidechain.tokens, false, sidechain.window);
  }
}

/**
 * Run the tail's main-chain turns through the live rule, oldest first, so a
 * seeded clock is exactly what streaming the same lines would have produced.
 * A tail with no cache write in it leaves the clock unknown, never cold.
 */
function seedCacheClock(
  agentId: number,
  agent: AgentState,
  agents: AgentStateStore,
  usage: ReadonlyArray<{ record: unknown }>,
): void {
  const clock: CacheClock = {};
  for (const { record } of usage) {
    if ((record as TranscriptRecord).isSidechain !== true) stepCacheClock(clock, record);
  }
  if (clock.cacheTtlSeconds === undefined || clock.cacheExpiresAt === undefined) return;
  agent.cacheTtlSeconds = clock.cacheTtlSeconds;
  agent.cacheExpiresAt = clock.cacheExpiresAt;
  agent.cacheMessageId = clock.cacheMessageId;
  agents.broadcast(cacheMessage(agentId, agent));
}
