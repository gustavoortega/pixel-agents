/**
 * Browser runtime mock — fetches assets and injects the same postMessage
 * events the VS Code extension would send.
 *
 * In Vite dev, it prefers pre-decoded JSON endpoints from middleware.
 * In plain browser builds, it falls back to decoding PNGs at runtime.
 *
 * Only imported in browser runtime; tree-shaken from VS Code webview runtime.
 */

import type { RgbaImage } from '../../core/src/assets/artDensity.ts';
import {
  decodeCharacterSheet,
  decodeFloorTile,
  decodeFurnitureImage,
  decodePetSheet,
  decodeWallSet,
} from '../../core/src/assets/artDensity.ts';
import type {
  AssetIndex,
  CatalogEntry,
  CharacterDirectionSprites,
  PetSpriteFrames,
} from '../../core/src/assets/types.ts';
import {
  HERO_LAYOUT_PATH,
  heroMessages,
  type HeroOffice,
  type HeroSceneOptions,
  heroZoomFor,
  parseHeroScene,
  seatHeroAgents,
  startHeroStage,
} from './heroScene.ts';

interface MockPayload {
  characters: CharacterDirectionSprites[];
  floorSprites: string[][][];
  wallSets: string[][][][];
  carpetSets: string[][][][];
  furnitureCatalog: CatalogEntry[];
  furnitureSprites: Record<string, string[][]>;
  layout: unknown;
  /** Set only for `?scene=hero`. */
  hero: { options: HeroSceneOptions; pets: PetSpriteFrames[]; petNames: string[] } | null;
  /** `?scene=empty`: the bundled office with no pets and the cozy lighting off, where nothing moves. */
  empty: boolean;
}

// ── Module-level state ─────────────────────────────────────────────────────────

let mockPayload: MockPayload | null = null;
let heroStaged = false;

// ── PNG decode helpers (browser fallback) ───────────────────────────────────
// Slicing and density detection are the core decoders the server uses, so a 1x and a 2x asset
// directory decode the same here as over the wire.

async function decodePng(url: string): Promise<RgbaImage> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch PNG: ${url} (${res.status.toString()})`);
  }
  const blob = await res.blob();
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    bitmap.close();
    throw new Error('Failed to create 2d canvas context for PNG decode');
  }
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return { width: canvas.width, height: canvas.height, data: imageData.data };
}

async function fetchJsonOptional<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

function getIndexedAssetPath(kind: 'characters' | 'floors' | 'walls', relPath: string): string {
  return relPath.startsWith(`${kind}/`) ? relPath : `${kind}/${relPath}`;
}

async function decodeCharactersFromPng(
  base: string,
  index: AssetIndex,
): Promise<CharacterDirectionSprites[]> {
  const sprites: CharacterDirectionSprites[] = [];
  for (const relPath of index.characters) {
    const png = await decodePng(`${base}assets/${getIndexedAssetPath('characters', relPath)}`);
    sprites.push(decodeCharacterSheet(png));
  }
  return sprites;
}

async function decodeFloorsFromPng(base: string, index: AssetIndex): Promise<string[][][]> {
  const floors: string[][][] = [];
  for (const relPath of index.floors) {
    const png = await decodePng(`${base}assets/${getIndexedAssetPath('floors', relPath)}`);
    floors.push(decodeFloorTile(png));
  }
  return floors;
}

async function decodeWallsFromPng(base: string, index: AssetIndex): Promise<string[][][][]> {
  const wallSets: string[][][][] = [];
  for (const relPath of index.walls) {
    const png = await decodePng(`${base}assets/${getIndexedAssetPath('walls', relPath)}`);
    wallSets.push(decodeWallSet(png));
  }
  return wallSets;
}

async function decodeFurnitureFromPng(
  base: string,
  catalog: CatalogEntry[],
): Promise<Record<string, string[][]>> {
  const sprites: Record<string, string[][]> = {};
  for (const entry of catalog) {
    const png = await decodePng(`${base}assets/${entry.furniturePath}`);
    try {
      sprites[entry.id] = decodeFurnitureImage(png, entry.id, entry.width, entry.height);
    } catch (err) {
      console.warn(`[BrowserMock] ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return sprites;
}

const HERO_PET_DIRS = ['claudio', 'gitcat'];

async function decodeHeroPets(
  base: string,
): Promise<{ pets: PetSpriteFrames[]; petNames: string[] }> {
  const pets: PetSpriteFrames[] = [];
  const petNames: string[] = [];
  for (const dir of HERO_PET_DIRS) {
    const manifest = (await fetch(`${base}assets/pets/${dir}/manifest.json`).then((r) =>
      r.json(),
    )) as { name: string };
    pets.push(decodePetSheet(await decodePng(`${base}assets/pets/${dir}/pet.png`)));
    petNames.push(manifest.name);
  }
  return { pets, petNames };
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Call before createRoot() in main.tsx.
 * Fetches all pre-decoded assets from the Vite dev server and stores them
 * for dispatchMockMessages().
 */
export async function initBrowserMock(): Promise<void> {
  console.log('[BrowserMock] Loading assets...');

  const base = import.meta.env.BASE_URL; // '/' in dev, '/sub/' with a subpath, './' in production

  const [assetIndex, catalog] = await Promise.all([
    fetch(`${base}assets/asset-index.json`).then((r) => r.json()) as Promise<AssetIndex>,
    fetch(`${base}assets/furniture-catalog.json`).then((r) => r.json()) as Promise<CatalogEntry[]>,
  ]);

  const shouldTryDecoded = import.meta.env.DEV;
  const [decodedCharacters, decodedFloors, decodedWalls, decodedFurniture] = shouldTryDecoded
    ? await Promise.all([
        fetchJsonOptional<CharacterDirectionSprites[]>(`${base}assets/decoded/characters.json`),
        fetchJsonOptional<string[][][]>(`${base}assets/decoded/floors.json`),
        fetchJsonOptional<string[][][][]>(`${base}assets/decoded/walls.json`),
        fetchJsonOptional<Record<string, string[][]>>(`${base}assets/decoded/furniture.json`),
      ])
    : [null, null, null, null];

  const hasDecoded = !!(decodedCharacters && decodedFloors && decodedWalls && decodedFurniture);

  if (!hasDecoded) {
    if (shouldTryDecoded) {
      console.log('[BrowserMock] Decoded JSON not found, decoding PNG assets in browser...');
    } else {
      console.log('[BrowserMock] Decoding PNG assets in browser...');
    }
  }

  const [characters, floorSprites, wallSets, furnitureSprites] = hasDecoded
    ? [decodedCharacters!, decodedFloors!, decodedWalls!, decodedFurniture!]
    : await Promise.all([
        decodeCharactersFromPng(base, assetIndex),
        decodeFloorsFromPng(base, assetIndex),
        decodeWallsFromPng(base, assetIndex),
        decodeFurnitureFromPng(base, catalog),
      ]);

  const heroOptions = parseHeroScene(window.location.search);
  const empty = new URLSearchParams(window.location.search).get('scene') === 'empty';
  const layoutPath = heroOptions ? HERO_LAYOUT_PATH : assetIndex.defaultLayout;
  const fetched: Record<string, unknown> | null = layoutPath
    ? await fetch(`${base}assets/${layoutPath}`).then((r) => r.json())
    : null;
  const layout = empty && fetched ? { ...fetched, pets: [] } : fetched;
  // The dev mock sends no pets; the scene's cat needs its sprites.
  const heroPets = heroOptions ? await decodeHeroPets(base) : null;

  // Carpets only have a decoded-JSON endpoint (no PNG fallback / asset-index
  // entry); empty array is fine — the carpet tab just won't render variants.
  const carpetSets =
    (shouldTryDecoded
      ? await fetchJsonOptional<string[][][][]>(`${base}assets/decoded/carpets.json`)
      : null) ?? [];

  mockPayload = {
    characters,
    floorSprites,
    wallSets,
    carpetSets,
    furnitureCatalog: catalog,
    furnitureSprites,
    layout,
    hero: heroOptions && heroPets ? { options: heroOptions, ...heroPets } : null,
    empty,
  };

  console.log(
    `[BrowserMock] Ready (${hasDecoded ? 'decoded-json' : 'browser-png-decode'}) — ${characters.length} chars, ${floorSprites.length} floors, ${wallSets.length} wall sets, ${carpetSets.length} carpets, ${catalog.length} furniture items`,
  );
}

/**
 * Call inside a useEffect in App.tsx -- after the window message listener
 * in useExtensionMessages has been registered.
 *
 * Only used in Vite dev mode (npm run dev). In standalone server mode and
 * VS Code mode, the server/extension sends all state over the transport.
 */
export function dispatchMockMessages(host?: {
  office: HeroOffice;
  /** Fix the camera at this zoom (fit-to-activity stops). */
  setZoom: (zoom: number) => void;
}): void {
  if (!mockPayload) return;

  const {
    characters,
    floorSprites,
    wallSets,
    carpetSets,
    furnitureCatalog,
    furnitureSprites,
    layout,
    hero,
    empty,
  } = mockPayload;

  function dispatch(data: unknown): void {
    window.dispatchEvent(new MessageEvent('message', { data }));
  }

  // Must match the load order defined in CLAUDE.md:
  // characterSpritesLoaded -> floorTilesLoaded -> wallTilesLoaded -> carpetTilesLoaded
  //   -> furnitureAssetsLoaded -> layoutLoaded
  dispatch({ type: 'characterSpritesLoaded', characters });
  if (hero) dispatch({ type: 'petSpritesLoaded', pets: hero.pets, petNames: hero.petNames });
  dispatch({ type: 'floorTilesLoaded', sprites: floorSprites });
  dispatch({ type: 'wallTilesLoaded', sets: wallSets });
  dispatch({ type: 'carpetTilesLoaded', sets: carpetSets });
  dispatch({ type: 'furnitureAssetsLoaded', catalog: furnitureCatalog, sprites: furnitureSprites });
  dispatch({ type: 'layoutLoaded', layout });
  dispatch({
    type: 'settingsLoaded',
    soundEnabled: false,
    extensionVersion: '1.3.0',
    // The scene gets no "what's new" toast.
    lastSeenVersion: hero ? '1.3' : '1.2',
    // Fairy lights twinkle at night with the lighting on: the empty scene keeps it off.
    ...(empty ? { cozyLighting: false } : {}),
  });

  // StrictMode runs the mount effect twice in dev; the scene stages once.
  if (hero && host && !heroStaged) {
    heroStaged = true;
    seatHeroAgents(host.office);
    for (const msg of heroMessages()) dispatch(msg);
    startHeroStage(host.office, dispatch);
    const fit = (): void =>
      host.setZoom(
        heroZoomFor(
          host.office.getLayout(),
          { width: window.innerWidth, height: window.innerHeight },
          window.devicePixelRatio || 1,
        ),
      );
    fit();
    window.addEventListener('resize', fit);
    if (!hero.options.hud) hideHud();
  }

  console.log('[BrowserMock] Messages dispatched');
}

/** `&hud=0`: the scene is a screenshot, so the HUD card, toolbar and status badge stay out of it. */
function hideHud(): void {
  const style = document.createElement('style');
  style.textContent =
    [
      '[data-testid="hud-card"]',
      '.absolute.top-8.pixel-panel',
      '.absolute.bottom-10.left-10.brand-panel',
    ].join(', ') + ' { display: none !important; }';
  document.head.appendChild(style);
}
