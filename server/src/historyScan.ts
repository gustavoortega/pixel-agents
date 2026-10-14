import type { HookProvider } from '../../core/src/provider.js';
import type { AgentStateStore } from './agentStateStore.js';
import { HISTORY_SCAN_MAX_BYTES, HISTORY_SCAN_WALL_MS, SHADOW_ID_BASE } from './constants.js';
import { Budget, scanLines } from './memory/reader.js';
import {
  absorbHistory,
  currentTracker,
  feedFacts,
  type MonitorTracker,
  newFacts,
  publishMonitor,
  trackerOf,
} from './monitorFacts.js';
import type { AgentState } from './types.js';

/**
 * What an agent adopted past the start of its transcript missed: the artifacts it published,
 * the loop it scheduled, its last test run. Live parsing starts at the watch offset, so
 * without this a restored or adopted session would show none of it until it did it again.
 *
 * One streaming read of 0..offset per agent (memory/reader.ts: lines over 1 MiB are skipped
 * unread, every byte is charged), feeding the same reducer as the live parser. Scans run one
 * at a time from one queue, so adopting twenty sessions at startup never reads twenty files
 * at once, and each agent's messages go out when its own scan ends. A scan the budget stops
 * is `complete: false`: counts become floors and per-url publishes are left out.
 */

/** Something else that reads an agent's history in the same pass (the session cost reducer).
 *  Records arrive parsed, in file order, only those before the agent's watch offset. */
export interface HistoryConsumer {
  record(
    agentId: number,
    record: unknown,
    ctx: { agent: AgentState; provider: HookProvider },
  ): void;
  /** The scan ended: `complete` is false when the budget cut it or the file could not be read. */
  done?(agentId: number, complete: boolean): void;
}

const consumers: HistoryConsumer[] = [];

/** Join the history pass. Returns the function that leaves it. */
export function registerHistoryConsumer(consumer: HistoryConsumer): () => void {
  consumers.push(consumer);
  return () => {
    const at = consumers.indexOf(consumer);
    if (at >= 0) consumers.splice(at, 1);
  };
}

interface ScanJob {
  agentId: number;
  agent: AgentState;
  agents: AgentStateStore;
  provider: HookProvider;
  tracker: MonitorTracker;
  file: string;
  offset: number;
}

const queue: ScanJob[] = [];
let draining = false;

/**
 * Queue the history scan of an agent that starts at `fileOffset > 0`. At offset 0 the live
 * replay reads every record, so there is nothing to scan. Once per transcript.
 */
export function scheduleHistoryScan(
  agentId: number,
  agents: AgentStateStore,
  provider: HookProvider | null | undefined,
): void {
  const agent = agents.get(agentId);
  if (!agent || !provider || agentId >= SHADOW_ID_BASE) return;
  if (!agent.jsonlFile || agent.fileOffset <= 0) return;
  const tracker = trackerOf(agent);
  if (tracker.scanRequested) return;
  tracker.scanRequested = true;
  tracker.scanning = true;
  queue.push({
    agentId,
    agent,
    agents,
    provider,
    tracker,
    file: agent.jsonlFile,
    offset: agent.fileOffset,
  });
  void drain();
}

async function drain(): Promise<void> {
  if (draining) return;
  draining = true;
  try {
    for (let job = queue.shift(); job; job = queue.shift()) {
      try {
        await runJob(job);
      } catch {
        // A scan that fails leaves the agent with what the live path reads.
        endScan(job, newFacts(), false);
      }
    }
  } finally {
    draining = false;
  }
}

async function runJob(job: ScanJob): Promise<void> {
  // Removed, or moved to another transcript, while queued.
  if (currentTracker(job.agent) !== job.tracker || !job.agents.has(job.agentId)) return;
  const budget = new Budget(HISTORY_SCAN_WALL_MS, HISTORY_SCAN_MAX_BYTES);
  const history = newFacts();
  const outcome = await scanLines(
    job.file,
    budget,
    (line) => {
      let record: unknown;
      try {
        record = JSON.parse(line.toString('utf8'));
      } catch {
        return;
      }
      feedFacts(history, record, job.provider);
      for (const consumer of [...consumers]) {
        try {
          consumer.record(job.agentId, record, { agent: job.agent, provider: job.provider });
        } catch {
          // One consumer's bug must not end the pass for the others.
        }
      }
    },
    job.offset,
  );
  endScan(job, history, outcome === true);
}

function endScan(job: ScanJob, history: ReturnType<typeof newFacts>, complete: boolean): void {
  const { agent, agentId, agents, tracker } = job;
  if (currentTracker(agent) !== tracker || !agents.has(agentId)) return;
  absorbHistory(tracker.facts, history);
  tracker.complete = complete;
  tracker.scanning = false;
  if (!complete) {
    // Counts only: what the file holds never reaches the log.
    console.log(`[Pixel Agents] Agent ${agentId}: history scan stopped early`);
  }
  publishMonitor(agentId, agent, agents, tracker);
  for (const consumer of [...consumers]) {
    try {
      consumer.done?.(agentId, complete);
    } catch {
      // See above.
    }
  }
}
