# Cozy art pack

All sprites listed below are generated from code in `scripts/cozy-art/`. They are our own pixel art, authored as pixel maps and palettes in TypeScript. No third-party sprite is copied.

Generated files:

- `webview-ui/public/assets/characters/char_0..11.png`: one chibi base, palette-swapped for hair and outfit. Each sheet is 112x128: 7 frames x 4 rows (down, up, right, and an idle row of 4 front-view poses: sit-idle, head-down, page-turn A, page-turn B). The decoder appends the idle row to `down` as frames 7..10, so the wire shape is unchanged. The book and the mug an agent holds are not in the sheet: they are palette-free overlays (`sprites/flair/idle-props.json`). Skin comes from a fixed 5-tone ramp (sheet n wears tone n mod 5) and is never hue-shifted at runtime (`SKIN_TONES` in `webview-ui/src/constants.ts` must match `SKIN_RAMP`); the server loads `char_N.png` from 0 upward until the first gap
- `webview-ui/public/assets/floors/floor_0..8.png` (32x32), `walls/wall_0.png` (128x256: a 4x4 grid of 32x64 auto-tile pieces) and `carpets/carpet_0..2.png` (128x128: 4x4 marching-squares pieces of 32x32)
- every furniture PNG under `webview-ui/public/assets/furniture/` (desks, tables, PCs, chairs, benches, sofas, plants, pots, bin, coffee, shelves, clock, whiteboard, paintings, `WINDOW`, `FLOOR_LAMP`, `FAIRY_LIGHTS`). The manifests are written by hand and committed next to the generated PNGs. `FAIRY_LIGHTS` is a single static frame: the furniture animation cycle only runs for items on auto-on tiles, so a wall item cannot use it
- `webview-ui/public/assets/pets/claudio/pet.png` and `pets/gitcat/pet.png` (192x192): rows 0 and 1 hold 6 frames of 32x64 (walk and idle, front then back), row 2 holds 3 frames of 64x64 (walk right). Feet stand on art row 61 of each frame
- `webview-ui/src/office/sprites/flair/anchors.json`: head and shoulder rows per direction and a per-frame bob, for accessories drawn over the characters

## Environment art at density 2

Floors, walls, carpets, furniture and pets are drawn at density 2: two art px per world px. Every furniture PNG measures twice the `width` and `height` of its manifest member, which stay in world px, and each manifest carries `"density": 2`. Footprints and ids are unchanged, and every shape sits where the 1x art had it (old coordinates x2), so desk tops, seats and surface items keep lining up. `server/__tests__/cozyAssets.test.ts` checks that every shipped environment PNG is generated and has its 2x size.

No drop shadows or light halos are baked into the art: the engine draws shadows, and `lighting.ts` draws the lamp and monitor glows. The lit PC screens keep a soft glow around their code lines because it sits on the opaque screen.

`floor_0` is deliberately soft (luminance spread of at most 16 levels) so the oak does not fight the sprites on it. Floors and carpets stay grayscale for runtime colorizing, and each carpet keeps exactly two gray levels (main and accent). The wall keeps its cream cap and paper, with the `#6b4128` baseboard in the six art rows above the bottom outline.

## Regenerate

```
npm run cozy:assets
```

Edit the maps in `scripts/cozy-art/`, run the command, and commit the changed PNGs together with the source. The output is deterministic: PNGs are written with stored (uncompressed) deflate blocks, so the same source gives the same bytes on every Node version. `server/__tests__/cozyAssets.test.ts` regenerates into a temp dir and fails when a committed file is stale.

## anchors.json

Per direction (`down`, `up`, `right`): `headTopY` and `shoulderY` are rows inside the 16x32 frame, measured on the neutral frame (walk2, also used for idle). `bob[f]` is how many rows frame `f`'s head sits below that frame, and `shoulderBob[f]` the same for the shoulder line (they differ only in the nap frame, where the head drops alone). `down` has 11 entries (the 7 walk/type/read frames plus the 4 idle ones), `up` and `right` 7.
