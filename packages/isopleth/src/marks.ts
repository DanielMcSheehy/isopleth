/**
 * Mark constructors. A mark is `{type, data, options, id}`; constructors apply
 * Plot's implicit transforms (`stackY` for areaY/barY/rectY, `interval`
 * snapping for lines/areas/bars/dots) so the common cases "just work".
 */

import type { Mark, MarkOptions, MarkType, Markish, Row } from "./types.js";
import { identity } from "./channel.js";
import { stackX, stackY } from "./transforms/stack.js";
import { intervalX, intervalY } from "./transforms/interval.js";

let counter = 0;

export function createMark<D extends object = Row>(type: MarkType, data: readonly D[] | null | undefined, options: MarkOptions<D> = {}, generated = false): Mark<D> {
  const id = options.id ?? `${type}-${++counter}`;
  return { type, data: data ?? [], options: { ...options, id }, id, generated };
}

/** Reset the auto-id counter (used by tests). */
export function resetMarkIds(): void {
  counter = 0;
}

function withInterval<D extends object>(axis: "x" | "y", options: MarkOptions<D>): MarkOptions<D> {
  if (options.interval === undefined || options.interval === null) return options;
  const { interval, ...rest } = options;
  const o = { interval, reduce: (options as Record<string, unknown>).reduce as never, fill: (options as Record<string, unknown>).fillMissing as never };
  return axis === "x" ? intervalX(o, rest as MarkOptions<D>) : intervalY(o, rest as MarkOptions<D>);
}

function maybeStackY<D extends object>(options: MarkOptions<D>): MarkOptions<D> {
  if (options.y1 !== undefined || options.y2 !== undefined) return options;
  return stackY(options);
}
function maybeStackX<D extends object>(options: MarkOptions<D>): MarkOptions<D> {
  if (options.x1 !== undefined || options.x2 !== undefined) return options;
  return stackX(options);
}

// ------------------------------------------------------------------ lines ---

/** A line through points in data order (x and y both free). */
export function line<D extends object = Row>(data: readonly D[], options: MarkOptions<D> = {}): Mark<D> {
  return createMark("line", data, options);
}
/** A line with y as a function of x (the usual time series). */
export function lineY<D extends object = Row>(data: readonly D[], options: MarkOptions<D> = {}): Mark<D> {
  return createMark("lineY", data, withInterval("x", options));
}
export function lineX<D extends object = Row>(data: readonly D[], options: MarkOptions<D> = {}): Mark<D> {
  return createMark("lineX", data, withInterval("y", options));
}

// ------------------------------------------------------------------ areas ---

export function area<D extends object = Row>(data: readonly D[], options: MarkOptions<D> = {}): Mark<D> {
  return createMark("area", data, options);
}
/** Area from a baseline (`y1`, default 0 via stacking) up to `y2`/`y`; stacks series automatically. */
export function areaY<D extends object = Row>(data: readonly D[], options: MarkOptions<D> = {}): Mark<D> {
  return createMark("areaY", data, maybeStackY(withInterval("x", options)));
}
export function areaX<D extends object = Row>(data: readonly D[], options: MarkOptions<D> = {}): Mark<D> {
  return createMark("areaX", data, maybeStackX(withInterval("y", options)));
}

// ------------------------------------------------------------------- bars ---

/** Vertical bars on an ordinal x; stacks series automatically. */
export function barY<D extends object = Row>(data: readonly D[], options: MarkOptions<D> = {}): Mark<D> {
  return createMark("barY", data, maybeStackY(options));
}
/** Horizontal bars on an ordinal y. */
export function barX<D extends object = Row>(data: readonly D[], options: MarkOptions<D> = {}): Mark<D> {
  return createMark("barX", data, maybeStackX(options));
}
/** Rectangles with quantitative `x1`/`x2` (histograms via `binX`). */
export function rectY<D extends object = Row>(data: readonly D[], options: MarkOptions<D> = {}): Mark<D> {
  return createMark("rectY", data, maybeStackY(options));
}
export function rectX<D extends object = Row>(data: readonly D[], options: MarkOptions<D> = {}): Mark<D> {
  return createMark("rectX", data, maybeStackX(options));
}
export function rect<D extends object = Row>(data: readonly D[], options: MarkOptions<D> = {}): Mark<D> {
  return createMark("rect", data, options);
}
/** Cells on two ordinal axes (heatmaps via `group`). */
export function cell<D extends object = Row>(data: readonly D[], options: MarkOptions<D> = {}): Mark<D> {
  return createMark("cell", data, options);
}

// ------------------------------------------------------------------- dots ---

export function dot<D extends object = Row>(data: readonly D[], options: MarkOptions<D> = {}): Mark<D> {
  return createMark("dot", data, withInterval("x", options));
}
/** Dots with x as the primary channel (alias of `dot`). */
export const dotX = dot;
export const dotY = dot;

// ------------------------------------------------------------------ rules ---

/** Vertical rules at `x` (data values by default): `ruleX([new Date("2024-01-01")])`. */
export function ruleX<D = Row>(data: readonly D[], options: MarkOptions<D & Row> = {}): Mark<D & Row> {
  const o = { ...options };
  if (o.x === undefined && o.x1 === undefined) (o as Record<string, unknown>).x = identity;
  return createMark("ruleX", data as readonly (D & Row)[], o);
}
/** Horizontal rules at `y`: `ruleY([0])` draws a zero line. */
export function ruleY<D = Row>(data: readonly D[], options: MarkOptions<D & Row> = {}): Mark<D & Row> {
  const o = { ...options };
  if (o.y === undefined && o.y1 === undefined) (o as Record<string, unknown>).y = identity;
  return createMark("ruleY", data as readonly (D & Row)[], o);
}

// ------------------------------------------------------------------- text ---

export function text<D = Row>(data: readonly D[], options: MarkOptions<D & Row> = {}): Mark<D & Row> {
  const o = { ...options };
  if (o.text === undefined) (o as Record<string, unknown>).text = identity;
  return createMark("text", data as readonly (D & Row)[], o);
}
export const textX = text;
export const textY = text;

// ------------------------------------------------------------- difference ---

export interface DifferenceOptions<D = Row> extends MarkOptions<D> {
  positiveFill?: string;
  negativeFill?: string;
  positiveFillOpacity?: number;
  negativeFillOpacity?: number;
}

/**
 * Fill between a comparison (`y1`, default 0) and a metric (`y2`/`y`), green
 * where the metric is above and blue where below (Plot's `differenceY`).
 * With `shiftX` the metric is compared against its own past.
 */
export function differenceY<D extends object = Row>(data: readonly D[], options: DifferenceOptions<D> = {}): Mark<D> {
  const o: MarkOptions<D> = { ...options };
  if (o.y2 === undefined && o.y !== undefined) o.y2 = o.y;
  if (o.x2 === undefined && o.x !== undefined) o.x2 = o.x;
  const shifted = o.x1 !== undefined && o.x1 !== o.x2;
  if (o.x1 === undefined) o.x1 = o.x2;
  if (o.y1 === undefined) o.y1 = shifted ? o.y2 : 0;
  delete o.y;
  delete o.x;
  return createMark("differenceY", data, o);
}
export function differenceX<D extends object = Row>(data: readonly D[], options: DifferenceOptions<D> = {}): Mark<D> {
  const o: MarkOptions<D> = { ...options };
  if (o.x2 === undefined && o.x !== undefined) o.x2 = o.x;
  if (o.y2 === undefined && o.y !== undefined) o.y2 = o.y;
  if (o.y1 === undefined) o.y1 = o.y2;
  if (o.x1 === undefined) o.x1 = 0;
  delete o.y;
  delete o.x;
  return createMark("differenceX", data, o);
}

// ---------------------------------------------------------------- helpers ---

/** Frame around the plot area. */
export function frame(options: MarkOptions = {}): Mark {
  return createMark("frame", [], options);
}
/** Vertical grid lines (`x: {grid: true}` is equivalent). */
export function gridX(options: MarkOptions = {}): Mark {
  return createMark("gridX", [], options);
}
export function gridY(options: MarkOptions = {}): Mark {
  return createMark("gridY", [], options);
}

/** Flatten nested/conditional marks into a list. */
export function flattenMarks(marks: Markish | Markish[] | undefined): Mark[] {
  const out: Mark[] = [];
  const visit = (m: Markish | Markish[] | undefined) => {
    if (!m) return;
    if (Array.isArray(m)) m.forEach(visit);
    else out.push(m as Mark);
  };
  visit(marks);
  return out;
}

/** Group several marks into one list (Plot's `Plot.marks`). */
export function marks(...ms: Markish[]): Mark[] {
  return flattenMarks(ms);
}
