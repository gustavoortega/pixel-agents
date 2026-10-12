import type { OfficeState } from '../src/office/engine/officeState.js';
import { resync, type ResyncSink } from '../src/office/engine/resync.js';

/** Open the page's resync window over an empty office, as a reconnect's existingAgents does
 *  (resync.test.ts drives that path on a real office). */
export function openEmptyResyncWindow(): void {
  const office = { subagentMeta: new Map() } as unknown as OfficeState;
  const sink = { updateSubagentTools: () => {} } as unknown as ResyncSink;
  resync.begin(office, { agents: [] }, sink);
}
