/** Loads the bundled sprites (furniture catalog and the 12 character sheets) the way the app does, for tests that need real pixels. */
import * as path from 'path';

import { buildFurnitureCatalog } from '../../core/src/assets/build.js';
import { decodeAllCharacters, decodeAllFurniture } from '../../core/src/assets/loader.js';
import { buildDynamicCatalog } from '../src/office/layout/furnitureCatalog.js';
import { setCharacterTemplates } from '../src/office/sprites/spriteData.js';

const ASSETS = path.resolve(__dirname, '..', 'public', 'assets');

export function loadRealAssets(): void {
  const catalog = buildFurnitureCatalog(ASSETS);
  const sprites = decodeAllFurniture(ASSETS, catalog);
  buildDynamicCatalog({ catalog, sprites });
  setCharacterTemplates(decodeAllCharacters(ASSETS));
}
