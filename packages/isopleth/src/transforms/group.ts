/**
 * `group*` and `bin*` transforms: aggregate rows into groups (ordinal keys) or
 * bins (quantitative/temporal thresholds), producing one output row per group
 * with the reduced channels, like Observable Plot.
 *
 * ```ts
 * rectY(data, binX({ y: "count" }, { x: "weight", fill: "sex" }))
 * barY(data, groupX({ y: "sum" }, { x: "region", y: "sales" }))
 * cell(data, group({ fill: "count" }, { x: "day", y: "hour" }))
 * ```
 */

import type { ChannelValue, Interval, MarkOptions, Reducer, Row, Transform, Value } from "../types.js";
import { ascending, encode, inferType, isMissing, toNumber, toNumbers, valueof } from "../channel.js";
import { getBackend } from "../backend/index.js";
import { guessTimeInterval, maybeInterval } from "../interval.js";
import { basic, isDataChannel } from "./basic.js";

export type Thresholds =
  | number
  | "auto"
  | "sturges"
  | "scott"
  | "freedman-diaconis"
  | number[]
  | Interval
  | ((values: number[], min: number, max: number) => number | number[]);

export interface GroupOutputs {
  /** `channel → reducer`; `null` removes a default. */
  [channel: string]: Reducer | null | undefined | boolean | Thresholds | [number, number] | Interval;
}

export interface BinOutputs extends GroupOutputs {
  thresholds?: Thresholds;
  interval?: Interval;
  domain?: [number, number];
  /** `true`/`1` cumulative ascending, `-1` descending. */
  cumulative?: boolean | 1 | -1;
}

/** Special output keys that are not channels. */
const META_KEYS = new Set(["thresholds", "interval", "domain", "cumulative", "filter", "sort", "reverse", "data"]);

interface Axis {
  codes: Int32Array;
  n: number;
  /** For groups: the value per code. For bins: edges (length n + 1). */
  values: Value[];
  bin: boolean;
  temporal: boolean;
}

function groupAxis(V: Value[] | undefined): Axis | undefined {
  if (!V) return undefined;
  const sortedDomain = [...new Map(V.filter((v) => !isMissing(v)).map((v) => [v instanceof Date ? +v : v, v])).values()].sort(ascending);
  const { codes, domain } = encode(V, sortedDomain);
  return { codes, n: domain.length, values: domain, bin: false, temporal: inferType(V) === "temporal" };
}

function binAxis(V: Value[] | undefined, opts: BinOutputs, channelOpts: Record<string, unknown> | undefined): Axis | undefined {
  if (!V) return undefined;
  const backend = getBackend();
  const temporal = inferType(V) === "temporal";
  const nums = toNumbers(V);
  const thresholds = (channelOpts?.thresholds ?? opts.thresholds ?? "auto") as Thresholds;
  const interval = maybeInterval((channelOpts?.interval ?? opts.interval) as Interval | undefined);
  const domain = (channelOpts?.domain ?? opts.domain) as [number, number] | undefined;
  let min = Infinity;
  let max = -Infinity;
  for (const v of nums) {
    if (Number.isFinite(v)) {
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }
  if (domain) {
    min = toNumber(domain[0] as Value);
    max = toNumber(domain[1] as Value);
  }
  let edges: Float64Array | number[];
  if (!Number.isFinite(min) || !Number.isFinite(max)) edges = [];
  else if (interval) {
    const start = interval.floor(min);
    const stop = interval.offset(interval.floor(max), 1);
    edges = [start, ...interval.range!(interval.offset(start, 1), stop), stop];
  } else if (Array.isArray(thresholds)) edges = thresholds.slice().sort((a, b) => a - b);
  else if (typeof thresholds === "function") {
    const r = thresholds(Array.from(nums).filter(Number.isFinite), min, max);
    edges = Array.isArray(r) ? r : Array.from(backend.binThresholds(nums, "count", r));
  } else if (typeof thresholds === "object" && thresholds !== null) {
    const iv = maybeInterval(thresholds)!;
    const start = iv.floor(min);
    const stop = iv.offset(iv.floor(max), 1);
    edges = [start, ...iv.range!(iv.offset(start, 1), stop), stop];
  } else if (temporal) {
    // Time: pick a calendar interval giving roughly the suggested number of bins.
    const count = typeof thresholds === "number" ? thresholds : Math.max(5, Math.min(60, Math.ceil(Math.log2(nums.length)) + 1) * 2);
    const iv = guessTimeInterval((max - min) / Math.max(1, count));
    const start = iv.floor(min);
    const stop = iv.offset(iv.floor(max), 1);
    edges = [start, ...iv.range!(iv.offset(start, 1), stop), stop];
  } else if (typeof thresholds === "number") {
    edges = Array.from(backend.binThresholds(nums, "count", thresholds));
  } else {
    edges = Array.from(backend.binThresholds(nums, thresholds, 0));
  }
  const e = Float64Array.from(edges);
  const codes = e.length >= 2 ? backend.binAssign(nums, e) : new Int32Array(nums.length).fill(-1);
  const values: Value[] = temporal ? Array.from(e, (ms) => new Date(ms)) : Array.from(e);
  return { codes, n: Math.max(0, e.length - 1), values, bin: true, temporal };
}

/** Strip Plot-style per-channel bin options: `x: {value, thresholds, interval, domain}`. */
function splitChannel(v: unknown): { value: ChannelValue | undefined; opts?: Record<string, unknown> } {
  if (typeof v === "object" && v !== null && !Array.isArray(v) && !(v instanceof Date) && !ArrayBuffer.isView(v) && "value" in v) {
    const { value, ...opts } = v as Record<string, unknown>;
    return { value: value as ChannelValue, opts };
  }
  return { value: v as ChannelValue };
}

const reduceNumeric = new Set(["count", "sum", "mean", "median", "min", "max", "mode", "first", "last", "deviation", "variance", "distinct", "proportion", "min-index", "max-index"]);

function reduceGroup(reducer: Reducer, rows: Row[], values: Value[] | undefined, indices: number[], ctx: { total: number; facetTotal: number; group: Record<string, Value> }): Value {
  if (typeof reducer === "function") return reducer(values ?? (rows as unknown as Value[]), { data: rows });
  switch (reducer) {
    case "x":
    case "x1":
    case "x2":
    case "y":
    case "y1":
    case "y2":
    case "z":
      return ctx.group[reducer];
    case "proportion-facet":
      return ctx.facetTotal === 0 ? NaN : (values ? sumOf(values) : rows.length) / ctx.facetTotal;
    case "proportion":
      return ctx.total === 0 ? NaN : (values ? sumOf(values) : rows.length) / ctx.total;
    case "count":
      return values ? values.filter((v) => !isMissing(v)).length : rows.length;
    case "first":
      return values ? values.find((v) => !isMissing(v)) : (rows[0] as unknown as Value);
    case "last":
      return values ? [...values].reverse().find((v) => !isMissing(v)) : (rows[rows.length - 1] as unknown as Value);
    case "distinct":
      return new Set(values?.filter((v) => !isMissing(v)).map((v) => (v instanceof Date ? +v : v))).size;
    case "mode": {
      if (!values) return rows.length;
      const counts = new Map<unknown, [number, Value]>();
      for (const v of values) {
        if (isMissing(v)) continue;
        const k = v instanceof Date ? +v : v;
        const e = counts.get(k);
        if (e) e[0]++;
        else counts.set(k, [1, v]);
      }
      let best: [number, Value] | undefined;
      for (const e of counts.values()) if (!best || e[0] > best[0]) best = e;
      return best?.[1];
    }
    case "min":
    case "max": {
      if (!values) return rows.length;
      const t = inferType(values);
      if (t === "ordinal") {
        const s = values.filter((v) => !isMissing(v)).sort(ascending);
        return reducer === "min" ? s[0] : s[s.length - 1];
      }
      break;
    }
    default:
      break;
  }
  // Numeric reducers over the group's values.
  const nums = values ? toNumbers(values) : Float64Array.from(rows, () => 1);
  const r = getBackend().aggregate(Int32Array.from(nums, () => 0), nums, 1, reducer as string);
  const out = r[0];
  if (reducer === "min-index" || reducer === "max-index") return Number.isNaN(out) ? undefined : indices[out];
  return out;
}

function sumOf(values: Value[]): number {
  let s = 0;
  for (const v of values) {
    const n = toNumber(v);
    if (Number.isFinite(n)) s += n;
  }
  return s;
}

/**
 * The shared implementation. `gx`/`gy` say whether x/y are grouped; `bx`/`by`
 * whether they are binned. `gz` always groups on the series channel.
 */
function groupn<D extends object>(mode: { x?: "group" | "bin"; y?: "group" | "bin"; z?: boolean }, outputs: BinOutputs, options: MarkOptions<D>): MarkOptions<D> {
  const { x: xIn, y: yIn, z, fill, stroke, fx, fy, ...rest } = options;
  const xs = splitChannel(xIn);
  const ys = splitChannel(yIn);
  const fillIsOutput = outputs.fill !== undefined && outputs.fill !== null;
  const strokeIsOutput = outputs.stroke !== undefined && outputs.stroke !== null;
  const zChannel = z !== undefined ? z : isDataChannel(fill) && !fillIsOutput ? fill : isDataChannel(stroke) && !strokeIsOutput ? stroke : undefined;
  const keepEmpty = outputs.filter === null;
  const outputEntries = Object.entries(outputs).filter(([k, v]) => !META_KEYS.has(k) && v !== null && v !== undefined && v !== false) as [string, Reducer][];
  const dataReducer = outputs.data as Reducer | undefined;
  // Inputs consumed by reducers: channel of the same name in options (e.g. y for {y: "sum"}).
  const reducerInputs: Record<string, ChannelValue<D> | undefined> = {};
  for (const [name] of outputEntries) {
    const v = (options as Record<string, unknown>)[name];
    if (name === "x" && mode.x) continue;
    if (name === "y" && mode.y) continue;
    if (v !== undefined && (name !== "fill" && name !== "stroke" ? true : isDataChannel(v))) reducerInputs[name] = v as ChannelValue<D>;
  }

  const transform: Transform<D> = (data, facets) => {
    const rows = data as readonly Row[];
    const X = mode.x ? valueof(data, xs.value as ChannelValue<D>) : undefined;
    const Y = mode.y ? valueof(data, ys.value as ChannelValue<D>) : undefined;
    const Z = zChannel !== undefined ? valueof(data, zChannel as ChannelValue<D>) : undefined;
    const FX = fx !== undefined ? valueof(data, fx as ChannelValue<D>) : undefined;
    const FY = fy !== undefined ? valueof(data, fy as ChannelValue<D>) : undefined;
    const FILL = isDataChannel(fill) && !fillIsOutput ? valueof(data, fill as ChannelValue<D>) : undefined;
    const STROKE = isDataChannel(stroke) && !strokeIsOutput ? valueof(data, stroke as ChannelValue<D>) : undefined;
    const ax = mode.x === "bin" ? binAxis(X, outputs, xs.opts) : groupAxis(X);
    const ay = mode.y === "bin" ? binAxis(Y, outputs, ys.opts) : groupAxis(Y);
    const az = Z ? groupAxisByAppearance(Z) : undefined;
    const inputValues: Record<string, Value[] | undefined> = {};
    for (const [name, ch] of Object.entries(reducerInputs)) inputValues[name] = valueof(data, ch);
    const nX = ax?.n ?? 1;
    const nY = ay?.n ?? 1;
    const nZ = az?.n ?? 1;
    const nGroups = nX * nY * nZ;
    const total = Object.keys(inputValues).length ? undefined : rows.length;
    const outData: Row[] = [];
    const outFacets: number[][] = [];
    const cumulative = outputs.cumulative === true ? 1 : outputs.cumulative === -1 ? -1 : outputs.cumulative === 1 ? 1 : 0;

    const backend = getBackend();
    const numericInput: Record<string, Float64Array | undefined> = {};
    for (const [name, vals] of Object.entries(inputValues)) {
      const t = inferType(vals);
      numericInput[name] = vals && t !== "ordinal" ? toNumbers(vals) : undefined;
    }
    const isVectorizable = (name: string, reducer: Reducer) =>
      typeof reducer === "string" &&
      (reduceNumeric.has(reducer) || /^p\d\d$/.test(reducer)) &&
      reducer !== "proportion" &&
      reducer !== "min-index" &&
      reducer !== "max-index" &&
      (inputValues[name] === undefined || numericInput[name] !== undefined);

    for (const I of facets) {
      const members: number[][] = Array.from({ length: nGroups }, () => []);
      const facetCodes = new Int32Array(rows.length).fill(-1);
      for (const i of I) {
        const cx = ax ? ax.codes[i] : 0;
        const cy = ay ? ay.codes[i] : 0;
        const cz = az ? az.codes[i] : 0;
        if (cx < 0 || cy < 0 || cz < 0) continue;
        const code = (cz * nY + cy) * nX + cx;
        members[code].push(i);
        facetCodes[i] = code;
      }
      const facetIdx: number[] = [];
      const facetTotal = I.length;
      // One backend call per numeric output for the whole facet (the hot path).
      const vectorized: Record<string, Float64Array> = {};
      if (cumulative === 0) {
        for (const [name, reducer] of outputEntries) {
          if (!isVectorizable(name, reducer)) continue;
          vectorized[name] = backend.aggregate(facetCodes, numericInput[name] ?? new Float64Array(0), nGroups, reducer as string);
        }
      }
      // Cumulative bins accumulate members along x within (z, y).
      if (cumulative !== 0 && ax?.bin) {
        for (let cz = 0; cz < nZ; cz++) {
          for (let cy = 0; cy < nY; cy++) {
            const base = (cz * nY + cy) * nX;
            let acc: number[] = [];
            const order = cumulative > 0 ? [...Array(nX).keys()] : [...Array(nX).keys()].reverse();
            for (const cx of order) {
              acc = acc.concat(members[base + cx]);
              members[base + cx] = acc.slice();
            }
          }
        }
      }
      for (let code = 0; code < nGroups; code++) {
        const m = members[code];
        if (m.length === 0 && !keepEmpty) continue;
        const cx = code % nX;
        const cy = Math.floor(code / nX) % nY;
        const cz = Math.floor(code / (nX * nY));
        const groupRows = m.map((i) => rows[i]);
        const row: Row = {};
        if (ax) {
          if (ax.bin) {
            row.x1 = ax.values[cx];
            row.x2 = ax.values[cx + 1];
            row.x = mid(ax.values[cx], ax.values[cx + 1], ax.temporal);
          } else row.x = ax.values[cx];
        }
        if (ay) {
          if (ay.bin) {
            row.y1 = ay.values[cy];
            row.y2 = ay.values[cy + 1];
            row.y = mid(ay.values[cy], ay.values[cy + 1], ay.temporal);
          } else row.y = ay.values[cy];
        }
        if (az) row.z = az.values[cz];
        const first = m[0];
        if (first !== undefined) {
          if (isDataChannel(fill) && !fillIsOutput) row.fill = Z && fill === zChannel ? az!.values[cz] : FILL![first];
          if (isDataChannel(stroke) && !strokeIsOutput) row.stroke = Z && stroke === zChannel ? az!.values[cz] : STROKE![first];
          if (FX) row.fx = FX[first];
          if (FY) row.fy = FY[first];
        } else if (az) {
          if (isDataChannel(fill) && fill === zChannel) row.fill = az.values[cz];
          if (isDataChannel(stroke) && stroke === zChannel) row.stroke = az.values[cz];
        }
        const ctx = { total: total ?? 0, facetTotal, group: row as Record<string, Value> };
        for (const [name, reducer] of outputEntries) {
          if (vectorized[name]) {
            row[name] = vectorized[name][code];
            continue;
          }
          const vals = inputValues[name] ? m.map((i) => inputValues[name]![i]) : undefined;
          if (reducer === "proportion" || reducer === "proportion-facet") {
            const all = inputValues[name];
            ctx.total = all ? sumOf(all) : rows.length;
            ctx.facetTotal = all ? sumOf(I.map((i) => all[i])) : I.length;
          }
          row[name] = reduceGroup(reducer, groupRows, vals, m, ctx);
        }
        row.data = dataReducer ? reduceGroup(dataReducer, groupRows, undefined, m, ctx) : groupRows;
        facetIdx.push(outData.length);
        outData.push(row);
      }
      outFacets.push(facetIdx);
    }
    return { data: outData as unknown as D[], facets: outFacets };
  };

  // Rebind channels to the output row fields.
  const out: MarkOptions<D> = { ...(rest as MarkOptions<D>) };
  if (mode.x === "bin") {
    out.x1 = "x1";
    out.x2 = "x2";
    if (!outputEntries.some(([k]) => k === "x")) out.x = "x";
  } else if (mode.x === "group") out.x = "x";
  else if (xIn !== undefined && !outputEntries.some(([k]) => k === "x")) out.x = xIn;
  if (mode.y === "bin") {
    out.y1 = "y1";
    out.y2 = "y2";
    if (!outputEntries.some(([k]) => k === "y")) out.y = "y";
  } else if (mode.y === "group") out.y = "y";
  else if (yIn !== undefined && !outputEntries.some(([k]) => k === "y")) out.y = yIn;
  for (const [name] of outputEntries) (out as Record<string, unknown>)[name] = name;
  if (zChannel !== undefined) out.z = "z";
  if (isDataChannel(fill) || fillIsOutput) out.fill = "fill";
  else if (fill !== undefined) out.fill = fill;
  if (isDataChannel(stroke) || strokeIsOutput) out.stroke = "stroke";
  else if (stroke !== undefined) out.stroke = stroke;
  if (fx !== undefined) out.fx = "fx";
  if (fy !== undefined) out.fy = "fy";
  (out as Record<string, unknown>).__grouped = { x: mode.x, y: mode.y };
  return basic(out, transform);
}

function groupAxisByAppearance(V: Value[]): Axis {
  const { codes, domain } = encode(V);
  return { codes, n: domain.length, values: domain, bin: false, temporal: inferType(V) === "temporal" };
}

function mid(a: Value, b: Value, temporal: boolean): Value {
  const m = (toNumber(a) + toNumber(b)) / 2;
  return temporal ? new Date(m) : m;
}

export function groupX<D extends object = Row>(outputs: GroupOutputs = { y: "count" }, options: MarkOptions<D> = {}): MarkOptions<D> {
  return groupn({ x: "group", z: true }, outputs, options);
}
export function groupY<D extends object = Row>(outputs: GroupOutputs = { x: "count" }, options: MarkOptions<D> = {}): MarkOptions<D> {
  return groupn({ y: "group", z: true }, outputs, options);
}
export function group<D extends object = Row>(outputs: GroupOutputs = { fill: "count" }, options: MarkOptions<D> = {}): MarkOptions<D> {
  return groupn({ x: "group", y: "group", z: true }, outputs, options);
}
export function groupZ<D extends object = Row>(outputs: GroupOutputs = { x: "count" }, options: MarkOptions<D> = {}): MarkOptions<D> {
  return groupn({ z: true }, outputs, options);
}
export function binX<D extends object = Row>(outputs: BinOutputs = { y: "count" }, options: MarkOptions<D> = {}): MarkOptions<D> {
  return groupn({ x: "bin", y: options.y !== undefined && outputs.y === undefined ? "group" : undefined, z: true }, outputs, options);
}
export function binY<D extends object = Row>(outputs: BinOutputs = { x: "count" }, options: MarkOptions<D> = {}): MarkOptions<D> {
  return groupn({ y: "bin", x: options.x !== undefined && outputs.x === undefined ? "group" : undefined, z: true }, outputs, options);
}
export function bin<D extends object = Row>(outputs: BinOutputs = { fill: "count" }, options: MarkOptions<D> = {}): MarkOptions<D> {
  return groupn({ x: "bin", y: "bin", z: true }, outputs, options);
}
