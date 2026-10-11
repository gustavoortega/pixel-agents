import type { HookProvider } from '../../core/src/provider.js';
import type { AgentStateStore } from './agentStateStore.js';
import { CONTEXT_SEED_TAIL_BYTES } from './constants.js';
import { readTailLines } from './contextUsage.js';
import type { AgentState } from './types.js';

/**
 * The session title shown in the character's label: what the user named the
 * session, else the CLI's generated name, else nothing (the webview then falls
 * back to the folder). Titles come from user prompts, so their text is never
 * logged.
 */

/** The title the label should show, or undefined when none is known. */
export function derivedTitle(agent: AgentState): string | undefined {
  return agent.customTitle ?? agent.aiTitle;
}

/**
 * Merge titles found in a transcript into the agent and tell the webview when
 * the one it shows changed. Transcripts repeat the same title record many times,
 * so an unchanged result stays silent. `found` is trusted: the provider already
 * dropped blank and non-string values.
 */
export function applySessionTitle(
  agentId: number,
  agent: AgentState,
  agents: AgentStateStore,
  found: { customTitle?: string; aiTitle?: string },
): void {
  const before = derivedTitle(agent);
  agent.titleSourceFile = agent.jsonlFile;
  if (found.customTitle !== undefined) agent.customTitle = found.customTitle;
  if (found.aiTitle !== undefined) agent.aiTitle = found.aiTitle;
  const after = derivedTitle(agent);
  if (after === before || after === undefined) return;
  agents.broadcast({ type: 'agentSessionTitle', id: agentId, title: after });
}

/**
 * Seed the title from a transcript's tail when watching starts.
 *
 * Adopted and restored agents start at end-of-file, so the title records
 * written earlier in the session would never stream past. Same reasoning as
 * `seedContextUsage`. A restore with a mid-file persisted offset may briefly show
 * an older title while replay catches up; the final state is correct.
 */
export function seedSessionTitle(
  agentId: number,
  agents: AgentStateStore,
  provider?: HookProvider | null,
): void {
  const agent = agents.get(agentId);
  if (!agent || !agent.jsonlFile) return;

  // Titles belong to one transcript: a switch or /clear starts a new session.
  if (agent.titleSourceFile !== agent.jsonlFile) {
    const hadTitle = derivedTitle(agent) !== undefined;
    agent.customTitle = undefined;
    agent.aiTitle = undefined;
    agent.titleSourceFile = agent.jsonlFile;
    if (hadTitle) agents.broadcast({ type: 'agentSessionTitle', id: agentId });
  }

  // A file read from the start reaches its titles through the live replay;
  // seeding too would flash the title twice.
  if (agent.fileOffset === 0) return;

  const lines = readTailLines(agent.jsonlFile, CONTEXT_SEED_TAIL_BYTES);
  if (!lines) return; // unreadable transcript -- a later record will set it

  // Newest first: the first title of each kind is the current one.
  const found: { customTitle?: string; aiTitle?: string } = {};
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line) continue;
    let record: unknown;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }
    const titles = provider?.extractSessionTitle?.(record);
    if (!titles) continue;
    found.customTitle ??= titles.customTitle;
    found.aiTitle ??= titles.aiTitle;
    if (found.customTitle !== undefined && found.aiTitle !== undefined) break;
  }
  applySessionTitle(agentId, agent, agents, found);
}
