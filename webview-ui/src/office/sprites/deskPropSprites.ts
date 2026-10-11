import type { DeskPropKind } from '../flair/deskProps.js';
import type { SpriteData } from '../types.js';

/** Small desk props, drawn once as SpriteData so the sprite cache keys on identity. */

const PALETTE: Record<string, string> = {
  '.': '',
  g: '#4f9a4a',
  G: '#3a7a3a',
  p: '#b8524a',
  P: '#8a3a34',
  y: '#ffe066',
  Y: '#e8c27a',
  d: '#6b4128',
  w: '#fff4dc',
  b: '#8fc6ff',
  o: '#f6c64a',
  O: '#c8962a',
};

function build(rows: string[]): SpriteData {
  return rows.map((r) => [...r].map((ch) => PALETTE[ch] ?? ''));
}

const SPRITES: Record<DeskPropKind, SpriteData> = {
  plant: build(['..g.g.', '.gGgg.', '..gGg.', '.gGg..', '..pp..', '.pPPp.', '.pPPp.', '..pp..']),
  lamp: build(['.yyyy.', 'yYYYYy', '.YYYY.', '..dd..', '..dd..', '..dd..', '.dddd.']),
  photo: build(['dddddd', 'dwbbwd', 'dbbbbd', 'dbwwbd', 'dddddd', '.d..d.']),
  trophy: build(['o.oo.o', 'oooooo', '.oOOo.', '..OO..', '..OO..', '.dddd.', '.dddd.']),
};

export function deskPropSprite(kind: DeskPropKind): SpriteData {
  return SPRITES[kind];
}
