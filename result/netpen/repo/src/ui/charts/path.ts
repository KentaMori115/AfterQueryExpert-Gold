/**
 * Turning a series into SVG path data.
 *
 * The only subtlety is gaps. A channel that stopped reporting for two days
 * must show a hole, not a straight line across the outage, because a straight
 * line across an outage is a claim about data nobody has. So a point with a
 * null value breaks the path rather than being skipped over.
 */

export interface Point {
  readonly x: number;
  readonly y: number | null;
}

export interface Projection {
  readonly toX: (value: number) => number;
  readonly toY: (value: number) => number;
}

function round(value: number): string {
  return Number(value.toFixed(2)).toString();
}

/** Path data for a line, broken wherever the series has no value. */
export function linePath(points: readonly Point[], projection: Projection): string {
  const parts: string[] = [];
  let penDown = false;

  for (const point of points) {
    if (point.y === null || !Number.isFinite(point.y) || !Number.isFinite(point.x)) {
      penDown = false;
      continue;
    }
    const x = round(projection.toX(point.x));
    const y = round(projection.toY(point.y));
    parts.push(`${penDown ? 'L' : 'M'}${x} ${y}`);
    penDown = true;
  }

  return parts.join(' ');
}

/**
 * Path data for a filled area between the series and a baseline. Each
 * unbroken run becomes its own closed subpath, so a gap leaves a hole in the
 * fill rather than a wedge across it.
 */
export function areaPath(
  points: readonly Point[],
  projection: Projection,
  baselineValue: number,
): string {
  const baseline = round(projection.toY(baselineValue));
  const parts: string[] = [];
  let run: readonly Point[] = [];

  const flush = (): void => {
    if (run.length === 0) return;
    const first = run[0]!;
    const last = run[run.length - 1]!;
    const body = run
      .map((point) => `L${round(projection.toX(point.x))} ${round(projection.toY(point.y!))}`)
      .join(' ');
    parts.push(
      `M${round(projection.toX(first.x))} ${baseline} ${body} L${round(projection.toX(last.x))} ${baseline} Z`,
    );
    run = [];
  };

  for (const point of points) {
    if (point.y === null || !Number.isFinite(point.y) || !Number.isFinite(point.x)) {
      flush();
      continue;
    }
    run = [...run, point];
  }
  flush();

  return parts.join(' ');
}

/** Unbroken runs of a series, which is what a legend counts to report gaps. */
export function runsIn(points: readonly Point[]): Point[][] {
  const runs: Point[][] = [];
  let current: Point[] = [];

  for (const point of points) {
    if (point.y === null || !Number.isFinite(point.y)) {
      if (current.length > 0) runs.push(current);
      current = [];
      continue;
    }
    current.push(point);
  }

  if (current.length > 0) runs.push(current);
  return runs;
}

/**
 * Thin a series down to a target count, always keeping the first and last
 * point and never merging across a gap. A trace of a year of daily readings is
 * four hundred nodes in the DOM and noticeably slower to pan on a tablet, and
 * nothing is lost: the chart is six hundred pixels wide.
 */
export function thin(points: readonly Point[], maxPoints: number): Point[] {
  if (points.length <= maxPoints || maxPoints < 2) return [...points];

  const stride = (points.length - 1) / (maxPoints - 1);
  const kept: Point[] = [];
  let lastIndex = -1;

  for (let index = 0; index < maxPoints; index += 1) {
    const at = Math.round(index * stride);
    if (at === lastIndex) continue;
    lastIndex = at;
    kept.push(points[at]!);
  }

  return kept;
}
