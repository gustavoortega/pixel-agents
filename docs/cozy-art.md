# Cozy art pack

All sprites listed below are generated from code in `scripts/cozy-art/`. They are our own pixel art, authored as pixel maps and palettes in TypeScript. No third-party sprite is copied.

Generated files:

- `webview-ui/public/assets/characters/char_0..11.png`: one chibi base, palette-swapped for hair and outfit. Each sheet is 112x128: 7 frames x 4 rows (down, up, right, and an idle row of 4 front-view poses: sit-idle, head-down, page-turn A, page-turn B). The decoder appends the idle row to `down` as frames 7..10, so the wire shape is unchanged. The book and the mug an agent holds are not in the sheet: they are palette-free overlays (`sprites/flair/idle-props.json`). Skin comes from a fixed 5-tone ramp (sheet n wears tone n mod 5) and is never hue-shifted at runtime (`SKIN_TONES` in `webview-ui/src/constants.ts` must match `SKIN_RAMP`); the server loads `char_N.png` from 0 upward until the first gap
- `webview-ui/public/assets/floors/floor_0..8.png`, `walls/wall_0.png`, `carpets/carpet_0..2.png`
- the desk, PC, chair, plant, bin, coffee, sofa, bookshelf, clock, whiteboard and painting PNGs under `webview-ui/public/assets/furniture/`
- `WINDOW` (wall, 2x2), `FLOOR_LAMP` (decor, 1x2) and `FAIRY_LIGHTS` (wall, 4x1). Unlike the sprites above they are new ids: their `manifest.json` files are written by hand and committed next to the generated PNG, and `server/__tests__/cozyAssets.test.ts` checks each manifest against the PNG size. `FAIRY_LIGHTS` is a single static frame: the furniture animation cycle only runs for items on auto-on tiles, so a wall item cannot use it
- `webview-ui/src/office/sprites/flair/anchors.json`: head and shoulder rows per direction and a per-frame bob, for accessories drawn over the characters

`floor_0` is deliberately soft (luminance spread of at most 16 levels, half the old contrast) so the wood does not fight the sprites on it; the other floors are unchanged. Furniture manifests, ids, sizes and footprints of the pre-existing sprites are untouched. Pets and the furniture not listed above keep their previous art.

## Regenerate

```
npm run cozy:assets
```

Edit the maps in `scripts/cozy-art/`, run the command, and commit the changed PNGs together with the source. The output is deterministic: PNGs are written with stored (uncompressed) deflate blocks, so the same source gives the same bytes on every Node version. `server/__tests__/cozyAssets.test.ts` regenerates into a temp dir and fails when a committed file is stale.

## anchors.json

Per direction (`down`, `up`, `right`): `headTopY` and `shoulderY` are rows inside the 16x32 frame, measured on the neutral frame (walk2, also used for idle). `bob[f]` is how many rows frame `f`'s head sits below that frame, and `shoulderBob[f]` the same for the shoulder line (they differ only in the nap frame, where the head drops alone). `down` has 11 entries (the 7 walk/type/read frames plus the 4 idle ones), `up` and `right` 7.
