/**
 * When a layoutLoaded may replace the office layout. DOM-free: the hook asks, tests ask.
 * Every input is read here when asked, never handed in: the hook's message handler is bound
 * once at mount, so a value it captured would be the mount-time one.
 */

import { editorState } from '../office/editor/editorState.js';
import { resync } from '../office/engine/resync.js';
import { stableStringify } from '../utils/stableStringify.js';

/** stableStringify of the last layout this page applied (layoutLoaded) or sent (saveLayout):
 *  what the server holds, as far as this page knows. */
let lastLayoutJson: string | null = null;

/** Record a layout this page is sending in saveLayout. */
export function noteLayoutSent(layout: unknown): void {
  lastLayoutJson = stableStringify(layout);
}

/** Unsaved layout edits in the page's editor. */
export function isEditDirty(): boolean {
  return editorState.isEditMode && editorState.isDirty;
}

/**
 * Whether a layoutLoaded may replace the layout; when it may, it becomes the layout this page
 * has. Never over unsaved editor changes, unless the user imported it (VS Code delivers an
 * import as a layoutLoaded). During a resync, not when it is the layout this page already has
 * either: rebuilding re-seats every character, so a reconnect would shuffle the office for
 * nothing.
 */
export function admitLayoutLoaded(msg: { layout?: unknown; imported?: unknown }): boolean {
  if (isEditDirty() && msg.imported !== true) return false;
  const incomingJson = stableStringify(msg.layout ?? null);
  if (resync.isActive() && incomingJson === lastLayoutJson) return false;
  lastLayoutJson = incomingJson;
  return true;
}
