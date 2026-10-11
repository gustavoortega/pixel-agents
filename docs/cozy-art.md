# Cozy art pack

All sprites listed below are generated from code in `scripts/cozy-art/`. They are our own pixel art, authored as pixel maps and palettes in TypeScript. No third-party sprite is copied.

Generated files:

- `webview-ui/public/assets/characters/char_0..5.png`: one chibi base, palette-swapped for hair, skin and outfit
- `webview-ui/public/assets/floors/floor_0..8.png`, `walls/wall_0.png`, `carpets/carpet_0..2.png`
- the desk, PC, chair, plant, bin, coffee, sofa, bookshelf, clock, whiteboard and painting PNGs under `webview-ui/public/assets/furniture/`
- `webview-ui/src/office/sprites/flair/anchors.json`: head and shoulder rows per direction and a per-frame bob, for accessories drawn over the characters

Furniture manifests, ids, sizes and footprints are untouched. Pets and the furniture not listed above keep their previous art.

## Regenerate

```
npm run cozy:assets
```

Edit the maps in `scripts/cozy-art/`, run the command, and commit the changed PNGs together with the source. The output is deterministic: PNGs are written with stored (uncompressed) deflate blocks, so the same source gives the same bytes on every Node version. `server/__tests__/cozyAssets.test.ts` regenerates into a temp dir and fails when a committed file is stale.

## anchors.json

Per direction (`down`, `up`, `right`): `headTopY` and `shoulderY` are rows inside the 16x32 frame, measured on the neutral frame (walk2, also used for idle). `bob[f]` is how many rows frame `f` sits below that frame, for the head and the shoulders alike.
