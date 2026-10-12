// webview-ui/src/office/engine/existingAgents.ts
//
// Pure reconciliation for the `existingAgents` restore message. Extracted from
// useExtensionMessages so it can be unit-tested without React (mirrors
// officeCanvasCursor.ts). The deliberate e2e-over-unit policy forbids unit
// tests against the React message handler itself.
//
// The webview must handle BOTH orders in which the two restore messages arrive:
//   - existingAgents before layoutLoaded → buffer, flush on the next layoutLoaded
//   - layoutLoaded before existingAgents → layout + seats already built, add now
// Depending on layoutLoaded always arriving last stranded restored agents on any
// surface that sends layout first (e.g. the VS Code no-assets path), issue #334.

/** Per-agent seat metadata carried by the existingAgents message. */
export interface ExistingAgentMeta {
  palette?: number;
  hueShift?: number;
  seatId?: string;
}

/** An agent buffered until the layout (and its seats) has been built. */
export interface PendingAgent {
  id: number;
  palette?: number;
  hueShift?: number;
  seatId?: string;
  folderName?: string;
  isHeadless?: boolean;
}

/** Minimal structural view of OfficeState this reconciler needs. */
export interface ExistingAgentsOffice {
  characters: { has: (id: number) => boolean };
  addAgent: (
    id: number,
    preferredPalette?: number,
    preferredHueShift?: number,
    preferredSeatId?: string,
    skipSpawnEffect?: boolean,
    folderName?: string,
    nearAgentId?: number,
    initialActive?: boolean,
  ) => void;
  setHeadless: (id: number, headless: boolean) => void;
  /** Top-level agents with a character (helpers excluded). */
  topLevelAgentIds: () => number[];
  /** Remove an agent and its helpers now, with no despawn effect. */
  removeAgentImmediate: (id: number) => void;
  /** Take the server's look and seat for an agent the office already holds. */
  applyAgentMeta: (id: number, meta: ExistingAgentMeta & { folderName?: string }) => void;
}

/**
 * Reconcile an `existingAgents` payload into the office. When the layout is
 * already built, agents are added immediately (skipping the matrix spawn effect,
 * as restored agents do) unless they already exist; otherwise they are pushed
 * onto `pending` to be flushed by the next `layoutLoaded`.
 *
 * `removeMissing` is the resync after a reconnect: the payload is then the whole
 * truth, so top-level agents it does not list are removed with their helpers (no
 * effect), buffered ones it does not list are dropped, and the agents it keeps
 * take its look and seat (after a server restart their ids may name other
 * sessions). Otherwise it only adds.
 *
 * Returns the ids added directly (the caller persists seats when there are any)
 * and the ids removed (the caller forgets them).
 */
export function reconcileExistingAgents(
  os: ExistingAgentsOffice,
  incoming: number[],
  meta: Record<number, ExistingAgentMeta>,
  folderNames: Record<number, string>,
  layoutReady: boolean,
  pending: PendingAgent[],
  headlessAgents: Record<number, boolean> = {},
  opts: { removeMissing?: boolean } = {},
): { added: number[]; removed: number[] } {
  const added: number[] = [];
  const removed: number[] = [];
  if (opts.removeMissing) {
    const keep = new Set(incoming);
    for (const id of os.topLevelAgentIds()) {
      if (keep.has(id)) continue;
      os.removeAgentImmediate(id);
      removed.push(id);
    }
    // Buffered by a handshake that never reached its layoutLoaded.
    for (let i = pending.length - 1; i >= 0; i--) {
      if (!keep.has(pending[i].id)) pending.splice(i, 1);
    }
  }
  for (const id of incoming) {
    const m = meta[id];
    const p: PendingAgent = {
      id,
      palette: m?.palette,
      hueShift: m?.hueShift,
      seatId: m?.seatId,
      folderName: folderNames[id],
      isHeadless: headlessAgents[id] === true,
    };
    if (layoutReady) {
      if (!os.characters.has(p.id)) {
        // Restored agents have no known status yet: idle until the server says.
        os.addAgent(p.id, p.palette, p.hueShift, p.seatId, true, p.folderName, undefined, false);
        if (p.isHeadless) os.setHeadless(p.id, true);
        added.push(p.id);
      } else if (opts.removeMissing) {
        os.applyAgentMeta(p.id, {
          palette: p.palette,
          hueShift: p.hueShift,
          seatId: p.seatId,
          folderName: p.folderName,
        });
      }
    } else {
      pending.push(p);
    }
  }
  return { added, removed };
}
