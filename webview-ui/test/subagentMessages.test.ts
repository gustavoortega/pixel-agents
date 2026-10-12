/**
 * Sub-agent messages applied to the office and the helper lists: only a start
 * creates a helper, a workflow helper is named on its plate by the label its
 * start carried, and every crew helper of a lead counts on the lead's plate.
 * Plates are read through helperPlateInput, the same input the overlay uses.
 */
import { beforeAll, describe, expect, it } from 'vitest';

import {
  applySubagentMessage,
  type SubagentCharacter,
  type SubagentSink,
  type SubagentTools,
} from '../src/hooks/subagentMessages.js';
import { OfficeState } from '../src/office/engine/officeState.js';
import { helperPlateInput, overlayContent } from '../src/office/toolUtils.js';
import type { OfficeLayout } from '../src/office/types.js';
import { TileType } from '../src/office/types.js';
import { loadRealAssets } from './realAssets.js';

beforeAll(loadRealAssets);

const CREW = 'wf:5b1fa126-e5b:';
const HELPER = `${CREW}a1`;

/** The hook's React state, as plain values. */
function sinkFor(os: OfficeState): SubagentSink & {
  tools: () => SubagentTools;
  characters: () => SubagentCharacter[];
} {
  let tools: SubagentTools = {};
  let characters: SubagentCharacter[] = [];
  return {
    os,
    background: {},
    updateTools: (fn) => {
      tools = fn(tools);
    },
    updateCharacters: (fn) => {
      characters = fn(characters);
    },
    tools: () => tools,
    characters: () => characters,
  };
}

function officeWithLead(): OfficeState {
  const os = new OfficeState({
    version: 1,
    cols: 10,
    rows: 6,
    tiles: new Array(60).fill(TileType.FLOOR_1),
    furniture: [],
  } as OfficeLayout);
  os.addAgent(1, 0, 0, undefined, true);
  return os;
}

const start = (label: string, parentToolId = HELPER) => ({
  type: 'subagentToolStart',
  id: 1,
  parentToolId,
  toolId: 'toolu_r1',
  status: 'Reading x.ts',
  label,
  group: 'scout',
});

/** The compact plate the overlay draws for character `id`. */
function plateOf(os: OfficeState, sink: ReturnType<typeof sinkFor>, id: number) {
  const content = overlayContent({
    expanded: false,
    label: null,
    maxWidth: 184,
    ...helperPlateInput(os, sink.characters(), id),
  });
  return content.mode === 'compact' ? content.plate : null;
}

describe('subagent messages', () => {
  it('C24 a done that lands after the clear leaves the helper removed', () => {
    const os = officeWithLead();
    const sink = sinkFor(os);
    applySubagentMessage(sink, start('probe:kappa'));
    expect(os.getSubagentId(1, HELPER)).not.toBeNull();

    applySubagentMessage(sink, { type: 'subagentClear', id: 1, parentToolId: HELPER });
    applySubagentMessage(sink, {
      type: 'subagentToolDone',
      id: 1,
      parentToolId: HELPER,
      toolId: 'toolu_r1',
    });
    applySubagentMessage(sink, { type: 'subagentToolPermission', id: 1, parentToolId: HELPER });

    expect(os.getSubagentId(1, HELPER)).toBeNull();
    expect(sink.characters()).toEqual([]);
    expect(sink.tools()).toEqual({});
  });

  it('C6 the plate names a workflow helper by its label and its parent', () => {
    const os = officeWithLead();
    os.sessionTitles.set(1, 'Ada');
    const sink = sinkFor(os);
    applySubagentMessage(sink, start('probe:kappa'));
    applySubagentMessage(sink, start(`${'\u{1F600}'.repeat(20)}abcdefghij`, `${CREW}a2`));
    const helper = os.getSubagentId(1, HELPER)!;

    // The label sits in a bidi isolate: its own direction never reorders the parent's name.
    expect(plateOf(os, sink, helper)?.name).toBe('\u2068probe:kappa\u2069 · Ada');
    // Past 24 code points the plate cuts the label; the full box shows all of it, the group under it.
    expect(plateOf(os, sink, os.getSubagentId(1, `${CREW}a2`)!)?.name).toBe(
      `\u2068${'\u{1F600}'.repeat(20)}abcd…\u2069 · Ada`,
    );
    expect(sink.characters().find((s) => s.id === helper)).toMatchObject({
      plateLabel: 'probe:kappa',
      group: 'scout',
    });
  });

  it('C19 every crew helper of a lead counts on its plate, drawn or not', () => {
    const os = officeWithLead();
    const sink = sinkFor(os);
    for (let i = 1; i <= 14; i++) applySubagentMessage(sink, start(`step ${i}`, `${CREW}a${i}`));

    // Past the cap of 12 the rest wait without a character.
    expect([...os.characters.values()].filter((ch) => ch.isSubagent)).toHaveLength(12);
    expect(plateOf(os, sink, 1)).toMatchObject({ name: '+14 helpers' });
  });
});
