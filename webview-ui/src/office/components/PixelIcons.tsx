/** Small pixel icons drawn as rects, for glyphs FS Pixel Sans lacks (✓, ⚠). */

type Runs = ReadonlyArray<readonly [x: number, y: number, w: number]>;

function PixelRuns({
  runs,
  cols,
  rows,
  px,
  color,
  testId,
}: {
  runs: Runs;
  cols: number;
  rows: number;
  px: number;
  color: string;
  testId: string;
}) {
  return (
    <svg
      width={cols * px}
      height={rows * px}
      viewBox={`0 0 ${cols} ${rows}`}
      shapeRendering="crispEdges"
      className="shrink-0 inline-block"
      aria-hidden="true"
      data-testid={testId}
    >
      {runs.map(([x, y, w]) => (
        <rect key={`${x}:${y}`} x={x} y={y} width={w} height={1} fill={color} />
      ))}
    </svg>
  );
}

/** The done check, 7 x 6 art pixels. */
const CHECK_RUNS: Runs = [
  [6, 0, 1],
  [5, 1, 2],
  [0, 2, 1],
  [4, 2, 2],
  [0, 3, 2],
  [3, 3, 2],
  [1, 4, 3],
  [2, 5, 1],
];

/** A warning triangle with the `!` cut out of it, 7 x 6 art pixels. */
const WARN_RUNS: Runs = [
  [3, 0, 1],
  [2, 1, 3],
  [2, 2, 1],
  [4, 2, 1],
  [1, 3, 2],
  [4, 3, 2],
  [1, 4, 5],
  [0, 5, 3],
  [4, 5, 3],
];

export function PixelCheck({ px, color }: { px: number; color: string }) {
  return (
    <PixelRuns
      runs={CHECK_RUNS}
      cols={7}
      rows={6}
      px={px}
      color={color}
      testId="plate-done-check"
    />
  );
}

/** The tripwire's warning sign, in the text's own color. */
export function PixelWarn({ px }: { px: number }) {
  return (
    <PixelRuns
      runs={WARN_RUNS}
      cols={7}
      rows={6}
      px={px}
      color="currentColor"
      testId="tripwire-icon"
    />
  );
}
