/**
 * Colors the runtime never recolors. The hue shift that tells repeated palettes apart and the
 * gray helper look both skip these pixels, so a face keeps a human skin tone whatever the outfit
 * does. One module for the generator that paints them and the runtime that skips them: a copy
 * would drift, and a drifted shade turns green on the twelfth agent.
 *
 * Values are as the PNG decoder reports them (uppercase #RRGGBB).
 */

/** The 5-tone skin ramp of the bundled characters, followed by each tone's mouth shade. */
export const HUE_LOCKED: ReadonlySet<string> = new Set([
  '#F6D9B8',
  '#F2C9A0',
  '#C98D5E',
  '#8D5A3B',
  '#5A3A28',
  '#998772',
  '#967D63',
  '#7D573A',
  '#573825',
  '#382419',
]);
