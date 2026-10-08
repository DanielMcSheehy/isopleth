/**
 * `auto`: pick a sensible mark and transform from the channel types, like
 * Observable Plot's `Plot.auto`. Returns a list of marks (the chosen mark,
 * plus a zero rule when appropriate) and exposes the decision via `autoSpec`.
 *
 * ```ts
 * plot({ marks: [auto(data, { x: "date", y: "value", color: "series", insights: { anomalies: true } })] })
 * ```
 */

import type { ChannelValue, InsightsConfig, Mark, MarkOptions, Reducer, Row, Value } from "./types.js";
import { inferType, isColor, valueof } from "./channel.js";
import { areaY, areaX, barX, barY, cell, dot, line, lineX, lineY, rect, rectX, rectY, ruleX, ruleY, marks as markList } from "./marks.js";
import { bin, binX, binY, group, groupX, groupY } from "./transforms/group.js";

export interface AutoChannel<D = Row> {
  value?: ChannelValue<D>;
  reduce?: Reducer | null;
  zero?: boolean;
  /** For `color`: a constant color (same as passing a CSS color string). */
  color?: string;
}

export interface AutoOptions<D = Row> {
  x?: ChannelValue<D> | AutoChannel<D>;
  y?: ChannelValue<D> | AutoChannel<D>;
  color?: ChannelValue<D> | AutoChannel<D>;
  size?: ChannelValue<D> | AutoChannel<D>;
  fx?: ChannelValue<D>;
  fy?: ChannelValue<D>;
  mark?: "area" | "bar" | "dot" | "line" | "rule";
  insights?: InsightsConfig;
  id?: string;
  /** Extra options forwarded to the chosen mark (curve, tip, strokeWidth, ...). */
  [extra: string]: unknown;
}

export interface AutoSpec {
  mark: "area" | "bar" | "dot" | "line" | "rule";
  markImpl: string;
  transformImpl: string | null;
  x: { value: unknown; reduce: Reducer | null; zero: boolean };
  y: { value: unknown; reduce: Reducer | null; zero: boolean };
  color: { value: unknown; reduce: Reducer | null; color?: string };
  size: { value: unknown; reduce: Reducer | null };
  reason: string;
}

const ZERO_REDUCERS = new Set(["distinct", "count", "sum", "proportion"]);
const SELECT_REDUCERS = new Set(["first", "last", "mode"]);

const REDUCER_NAMES = /^(count|sum|mean|median|min|max|mode|first|last|deviation|variance|distinct|proportion|proportion-facet|p\d\d)$/;

function parse<D>(v: ChannelValue<D> | AutoChannel<D> | undefined): { value: ChannelValue<D> | undefined; reduce: Reducer | null | undefined; zero: boolean | undefined; color?: string } {
  if (v === undefined || v === null) return { value: undefined, reduce: undefined, zero: undefined };
  if (typeof v === "string" && REDUCER_NAMES.test(v)) return { value: undefined, reduce: v as Reducer, zero: undefined };
  if (typeof v === "object" && !Array.isArray(v) && !(v instanceof Date) && !ArrayBuffer.isView(v) && ("value" in v || "reduce" in v || "zero" in v || "color" in v)) {
    const a = v as AutoChannel<D>;
    return { value: a.value, reduce: a.reduce, zero: a.zero, color: a.color };
  }
  return { value: v as ChannelValue<D>, reduce: undefined, zero: undefined };
}

function isMonotonic(values: Value[] | undefined): boolean {
  if (!values) return false;
  let prev: number | undefined;
  let sign = 0;
  for (const v of values) {
    const n = v instanceof Date ? +v : typeof v === "number" ? v : NaN;
    if (!Number.isFinite(n)) continue;
    if (prev !== undefined && n !== prev) {
      const s = Math.sign(n - prev);
      if (sign && s !== sign) return false;
      sign = s;
    }
    prev = n;
  }
  return true;
}

export function autoSpec<D extends object = Row>(data: readonly D[], options: AutoOptions<D> = {}): AutoSpec {
  const x = parse(options.x);
  const y = parse(options.y);
  const color = parse(options.color);
  const size = parse(options.size);
  if (typeof color.value === "string" && isColor(color.value)) {
    color.color = color.value;
    color.value = undefined;
  }
  let xReduce = x.reduce ?? null;
  let yReduce = y.reduce ?? null;
  let sizeReduce = size.reduce ?? null;
  const colorReduce = color.reduce ?? null;
  const X = valueof(data, x.value);
  const Y = valueof(data, y.value);
  const xOrd = inferType(X) === "ordinal";
  const yOrd = inferType(Y) === "ordinal";
  // Default reducers.
  if (x.value !== undefined && !xReduce && y.value === undefined && yReduce === null && size.value === undefined && sizeReduce === null && y.reduce !== null) yReduce = "count";
  if (y.value !== undefined && !yReduce && x.value === undefined && xReduce === null && size.value === undefined && sizeReduce === null && x.reduce !== null) xReduce = "count";
  if (size.value === undefined && sizeReduce === null && !colorReduce && !xReduce && !yReduce && (x.value === undefined || xOrd) && (y.value === undefined || yOrd) && (x.value !== undefined || y.value !== undefined) && size.reduce !== null) sizeReduce = "count";
  if (xReduce && yReduce) throw new Error("auto: cannot reduce both x and y");

  const zeroReduce = (r: Reducer | null) => typeof r === "string" && ZERO_REDUCERS.has(r);
  let mark: AutoSpec["mark"];
  let reason: string;
  if (options.mark) {
    mark = options.mark;
    reason = `mark "${mark}" requested`;
  } else if (size.value !== undefined || sizeReduce) {
    mark = "dot";
    reason = "size channel → dot";
  } else if (zeroReduce(xReduce) || zeroReduce(yReduce) || colorReduce) {
    mark = "bar";
    reason = `${colorReduce ? "color" : xReduce ? "x" : "y"} is aggregated → bar`;
  } else if (x.value !== undefined && y.value !== undefined) {
    if (xOrd || yOrd) {
      mark = "dot";
      reason = "x and y with an ordinal axis → dot";
    } else if (!xReduce && !yReduce && !isMonotonic(X) && !isMonotonic(Y)) {
      mark = "dot";
      reason = "two quantitative channels, neither ordered → dot";
    } else {
      mark = "line";
      reason = "quantitative y over ordered x → line";
    }
  } else if (x.value !== undefined || y.value !== undefined) {
    mark = "rule";
    reason = "a single channel → rule";
  } else throw new Error("auto: must specify x or y");

  // Implementation.
  let markImpl: string;
  const xZeroReduce = zeroReduce(xReduce);
  const yZeroReduce = zeroReduce(yReduce);
  const xZero = x.zero ?? (xZeroReduce || false);
  const yZero = y.zero ?? (yZeroReduce || false);
  switch (mark) {
    case "dot":
      markImpl = "dot";
      break;
    case "line":
      markImpl = yZero || yReduce || isMonotonic(X) ? "lineY" : xZero || xReduce || isMonotonic(Y) ? "lineX" : "line";
      break;
    case "area":
      markImpl = yZero || yReduce || isMonotonic(X) ? "areaY" : xZero || xReduce || isMonotonic(Y) ? "areaX" : "areaY";
      break;
    case "rule":
      markImpl = x.value !== undefined ? "ruleX" : "ruleY";
      break;
    case "bar":
      if (xReduce) markImpl = yOrd ? "barX" : SELECT_REDUCERS.has(String(xReduce)) && xOrd ? "cell" : "rectX";
      else if (yReduce) markImpl = xOrd ? "barY" : SELECT_REDUCERS.has(String(yReduce)) && yOrd ? "cell" : "rectY";
      else if (colorReduce || sizeReduce) markImpl = xOrd && yOrd ? "cell" : xOrd ? "barY" : yOrd ? "barX" : "rect";
      else markImpl = !xOrd && X && yOrd ? "barX" : !yOrd && Y && xOrd ? "barY" : "cell";
      break;
  }
  let transformImpl: string | null = null;
  if (yReduce) transformImpl = xOrd ? "groupX" : "binX";
  else if (xReduce) transformImpl = yOrd ? "groupY" : "binY";
  else if (colorReduce || sizeReduce) {
    if (x.value !== undefined && y.value !== undefined) transformImpl = xOrd && yOrd ? "group" : xOrd ? "binY" : yOrd ? "binX" : "bin";
    else if (x.value !== undefined) transformImpl = xOrd ? "groupX" : "binX";
    else if (y.value !== undefined) transformImpl = yOrd ? "groupY" : "binY";
  }
  const zeroImplied = (impl: string, axis: "x" | "y") => (axis === "x" ? ["barX", "areaX", "rectX", "ruleY"] : ["barY", "areaY", "rectY", "ruleX"]).includes(impl) && !transformImpl?.startsWith("bin");
  return {
    mark,
    markImpl,
    transformImpl,
    x: { value: x.value, reduce: xReduce, zero: x.zero ?? (xZeroReduce || zeroImplied(markImpl, "x")) },
    y: { value: y.value, reduce: yReduce, zero: y.zero ?? (yZeroReduce || zeroImplied(markImpl, "y")) },
    color: { value: color.value, reduce: colorReduce, color: color.color },
    size: { value: size.value, reduce: sizeReduce },
    reason: `${reason} (${markImpl}${transformImpl ? ` + ${transformImpl}` : ""})`,
  };
}

/** Build the marks for `autoSpec`. */
export function auto<D extends object = Row>(data: readonly D[], options: AutoOptions<D> = {}): Mark<D>[] & { spec: AutoSpec } {
  const spec = autoSpec(data, options);
  const { x: _x, y: _y, color: _c, size: _s, fx, fy, mark: _m, insights, id, ...extra } = options;
  const stroked = spec.markImpl.startsWith("line") || spec.markImpl === "dot" || spec.markImpl.startsWith("rule");
  const colorKey: "fill" | "stroke" = stroked ? "stroke" : "fill";
  let opts: MarkOptions<D> = { ...(extra as MarkOptions<D>), x: spec.x.value as ChannelValue<D>, y: spec.y.value as ChannelValue<D>, fx, fy, insights, id };
  if (spec.color.value !== undefined) opts[colorKey] = spec.color.value as ChannelValue<D>;
  else if (spec.color.color) opts[colorKey] = spec.color.color;
  if (spec.size.value !== undefined) opts.r = spec.size.value as ChannelValue<D>;
  const outputs: Record<string, Reducer> = {};
  if (spec.x.reduce) outputs.x = spec.x.reduce;
  if (spec.y.reduce) outputs.y = spec.y.reduce;
  if (spec.color.reduce) outputs[colorKey] = spec.color.reduce;
  if (spec.size.reduce) outputs.r = spec.size.reduce;
  switch (spec.transformImpl) {
    case "groupX":
      opts = groupX(outputs, opts);
      break;
    case "groupY":
      opts = groupY(outputs, opts);
      break;
    case "group":
      opts = group(outputs, opts);
      break;
    case "binX":
      opts = binX(outputs, opts);
      break;
    case "binY":
      opts = binY(outputs, opts);
      break;
    case "bin":
      opts = bin(outputs, opts);
      break;
    default:
      break;
  }
  const impl: Record<string, (d: readonly D[], o: MarkOptions<D>) => Mark<D>> = { line, lineX, lineY, areaY, areaX, barX, barY, rectX, rectY, rect, cell, dot, ruleX: ruleX as never, ruleY: ruleY as never };
  const main = impl[spec.markImpl](data, opts);
  const zeroRule = spec.markImpl === "lineY" || spec.markImpl === "dot" ? (spec.y.zero ? ruleY([0], { strokeOpacity: 0.4 }) : spec.x.zero ? ruleX([0], { strokeOpacity: 0.4 }) : null) : null;
  const list = (stroked ? markList(zeroRule as Mark | null, main as unknown as Mark) : markList(main as unknown as Mark)) as unknown as Mark<D>[] & { spec: AutoSpec };
  list.spec = spec;
  return list;
}
