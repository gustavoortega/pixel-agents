/**
 * When a layoutLoaded may replace the office: never over unsaved editor changes unless the
 * user imported it, and during a resync not when it restates the layout the page already has
 * (a rebuild re-seats every character). The gate reads the page's editor and resync window
 * when asked, as the hook's message handler does.
 */
import { afterEach, describe, expect, it } from 'vitest';

import { admitLayoutLoaded, noteLayoutSent } from '../src/hooks/layoutLoadedGate.js';
import { editorState } from '../src/office/editor/editorState.js';
import { resync } from '../src/office/engine/resync.js';
import { openEmptyResyncWindow } from './resyncWindow.js';

const layout = {
  version: 1,
  cols: 2,
  rows: 1,
  tiles: [1, 1],
  furniture: [{ uid: 'desk', type: 'DESK_FRONT', col: 0, row: 0 }],
};
/** The same layout as read back from disk with its keys in another order. */
const sameReordered = {
  furniture: [{ row: 0, col: 0, type: 'DESK_FRONT', uid: 'desk' }],
  tiles: [1, 1],
  rows: 1,
  cols: 2,
  version: 1,
};
const changed = { ...layout, tiles: [1, 0] };

afterEach(() => {
  editorState.isEditMode = false;
  editorState.isDirty = false;
  resync.abort();
});

describe('layoutLoaded gate', () => {
  it('C4 keeps unsaved editor changes through a resync and outside one; a user import replaces them', () => {
    editorState.isEditMode = true;
    editorState.isDirty = true;
    expect(admitLayoutLoaded({ layout: changed })).toBe(false);
    openEmptyResyncWindow();
    expect(admitLayoutLoaded({ layout: changed })).toBe(false);
    // VS Code delivers Import Layout as a layoutLoaded: the user chose to replace the edits.
    expect(admitLayoutLoaded({ layout: changed, imported: true })).toBe(true);
  });

  it('edits left in a closed editor hold no layout back', () => {
    editorState.isDirty = true;
    expect(admitLayoutLoaded({ layout: changed })).toBe(true);
  });

  it('a resync skips the layout the page already has, sent or applied, whatever its key order', () => {
    noteLayoutSent(layout);
    openEmptyResyncWindow();
    expect(admitLayoutLoaded({ layout: sameReordered })).toBe(false);
    expect(admitLayoutLoaded({ layout: changed })).toBe(true);
    expect(admitLayoutLoaded({ layout: changed })).toBe(false);
  });
});
