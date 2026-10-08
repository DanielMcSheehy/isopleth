/**
 * Series-wise maps: `windowY`, `mapY`, `normalizeY`, `imputeY`, `shiftX`,
 * `diffY`. Each operates per series (grouped by `z` ?? `fill` ?? `stroke`)
 * within each facet, in input order, and writes lazily-filled columns.
 */

import type { ChannelValue, MarkOptions, Reducer, Row, Transform, Value, WindowReducer, Interval } from "../types.js";
import { carryLabel, toNumber, valueof } from "../channel.js";
import { getBackend } from "../backend/index.js";
import { maybeInterval } from "../interval.js";
import { basic, column, seriesOf } from "./basic.js";

/** A map function: receives one series' values (input order) and returns the mapped values. */
export type MapFn = (values: Float64Array, indices: number[], data: readonly Row[]) => ArrayLike<number>;

export type MapMethod =
  | "cumsum"
  | "rank"
  | "quantile"
  | "diff"
  | "pct-change"
  | MapFn
  | { mapIndex: (I: number[], S: Float64Array, T: Float64Array) => void };

export interface WindowOptions {
  k: number;
  anchor?: "start" | "middle" | "end";
  reduce?: WindowReducer;
  strict?: boolean;
  /** Plot's `shift` alias: `"leading"` = start, `"trailing"` = end, `"centered"` = middle. */
  shift?: "leading" | "trailing" | "centered";
}

const CHANNELS = { x: ["x", "x1", "x2"], y: ["y", "y1", "y2"] } as const;

function mapn<D extends object>(axis: "x" | "y", fn: MapFn, options: MarkOptions<D>, extraChannels: string[] = []): MarkOptions<D> {
  const names = [...CHANNELS[axis], ...extraChannels].filter((c) => (options as Record<string, unknown>)[c] !== undefined);
  if (names.length === 0) return options;
  const inputs = Object.fromEntries(names.map((c) => [c, (options as Record<string, unknown>)[c] as ChannelValue<D>]));
  const prevLabels = ((options as Record<string, unknown>).__labels ?? {}) as Record<string, string | undefined>;
  const cols = names.map((c) => [c, column(carryLabel(inputs[c], prevLabels[c], c))] as const);
  const transform: Transform<D> = (data, facets) => {
    const outputs: Record<string, Float64Array> = {};
    for (const c of names) {
      const V = valueof(data, inputs[c])!;
      const S = new Float64Array(data.length);
      for (let i = 0; i < S.length; i++) S[i] = toNumber(V[i]);
      const T = new Float64Array(data.length).fill(NaN);
      for (const I of facets) {
        for (const series of seriesOf(data, I, options)) {
          const sub = new Float64Array(series.length);
          for (let j = 0; j < series.length; j++) sub[j] = S[series[j]];
          const mapped = fn(sub, series, data as readonly Row[]);
          for (let j = 0; j < series.length; j++) T[series[j]] = mapped[j];
        }
      }
      outputs[c] = T;
    }
    for (const [c, [, set]] of cols) set(outputs[c]);
    return { data, facets };
  };
  const out: MarkOptions<D> = { ...options };
  for (const [c, [spec]] of cols) (out as Record<string, unknown>)[c] = spec;
  return basic(out, transform);
}

function resolveMap(method: MapMethod): MapFn {
  const b = getBackend();
  if (typeof method === "function") return method;
  if (typeof method === "object" && method !== null && "mapIndex" in method) {
    return (values, indices) => {
      const T = new Float64Array(values.length);
      method.mapIndex(indices.map((_, j) => j), values, T);
      return T;
    };
  }
  switch (method) {
    case "cumsum":
      return (v) => b.cumsum(v);
    case "rank":
      return (v) => b.rank(v);
    case "quantile":
      return (v) => b.quantileRank(v);
    case "diff":
      return (v) => b.diff(v);
    case "pct-change":
      return (v) => b.pctChange(v);
    default:
      throw new Error(`unknown map method: ${String(method)}`);
  }
}

/** Build a rolling-window map (`map({y: window(7)}, ...)`). */
export function window(opts: number | WindowOptions): MapFn {
  const o: WindowOptions = typeof opts === "number" ? { k: opts } : opts;
  const anchor = o.anchor ?? (o.shift === "leading" ? "start" : o.shift === "trailing" ? "end" : "middle");
  const reduce = typeof o.reduce === "string" ? o.reduce : "mean";
  if (typeof o.reduce === "function") {
    const f = o.reduce as (values: Value[]) => Value;
    return (v) => {
      const k = Math.max(1, Math.floor(o.k));
      const s = anchor === "start" ? 0 : anchor === "end" ? k - 1 : Math.floor((k - 1) / 2);
      const out = new Float64Array(v.length).fill(NaN);
      for (let i = 0; i < v.length; i++) {
        const lo = Math.max(0, i - s);
        const hi = Math.min(v.length, i - s + k);
        if (o.strict && (i - s < 0 || i - s + k > v.length)) continue;
        out[i] = toNumber(f(Array.from(v.subarray(lo, hi))));
      }
      return out;
    };
  }
  return (v) => getBackend().window(v, o.k, anchor, reduce, Boolean(o.strict));
}

/** Apply per-channel maps: `map({y: "cumsum", y2: window(3)}, options)`. */
export function map<D extends object = Row>(maps: Record<string, MapMethod>, options: MarkOptions<D> = {}): MarkOptions<D> {
  let out = options;
  for (const [c, m] of Object.entries(maps)) {
    const fn = resolveMap(m);
    out = mapn(c.startsWith("x") ? "x" : "y", fn, out, [c]);
  }
  return out;
}

export function mapY<D extends object = Row>(method: MapMethod, options: MarkOptions<D> = {}): MarkOptions<D> {
  return mapn("y", resolveMap(method), options);
}
export function mapX<D extends object = Row>(method: MapMethod, options: MarkOptions<D> = {}): MarkOptions<D> {
  return mapn("x", resolveMap(method), options);
}

/** Rolling window over y, y1, y2: `windowY(7, {...})` or `windowY({k: 28, reduce: "median", anchor: "end"}, {...})`. */
export function windowY<D extends object = Row>(opts: number | WindowOptions, options: MarkOptions<D> = {}): MarkOptions<D> {
  return mapn("y", window(opts), options);
}
export function windowX<D extends object = Row>(opts: number | WindowOptions, options: MarkOptions<D> = {}): MarkOptions<D> {
  return mapn("x", window(opts), options);
}

export type Basis = "first" | "last" | "min" | "max" | "mean" | "median" | "sum" | "extent" | "deviation" | `p${number}` | ((values: Float64Array) => number);

function normalizeFn(basis: Basis): MapFn {
  if (typeof basis === "function") {
    return (v) => {
      const b = basis(v);
      const out = new Float64Array(v.length);
      for (let i = 0; i < v.length; i++) out[i] = v[i] / b;
      return out;
    };
  }
  return (v) => getBackend().normalize(v, basis);
}

/** Normalize each series by a basis, e.g. `normalizeY("first", {...})` for an index chart. */
export function normalizeY<D extends object = Row>(basis: Basis | MarkOptions<D> = "first", options?: MarkOptions<D>): MarkOptions<D> {
  if (typeof basis === "object") return mapn("y", normalizeFn("first"), basis);
  return mapn("y", normalizeFn(basis), options ?? {});
}
export function normalizeX<D extends object = Row>(basis: Basis | MarkOptions<D> = "first", options?: MarkOptions<D>): MarkOptions<D> {
  if (typeof basis === "object") return mapn("x", normalizeFn("first"), basis);
  return mapn("x", normalizeFn(basis), options ?? {});
}

export type ImputeMethod = "linear" | "previous" | "next" | "zero" | number;

/** Fill missing `y` values per series: `imputeY("linear", {...})`. */
export function imputeY<D extends object = Row>(method: ImputeMethod = "linear", options: MarkOptions<D> = {}): MarkOptions<D> {
  return mapn("y", (v) => getBackend().impute(v, String(method)), options);
}
export function imputeX<D extends object = Row>(method: ImputeMethod = "linear", options: MarkOptions<D> = {}): MarkOptions<D> {
  return mapn("x", (v) => getBackend().impute(v, String(method)), options);
}

/** First differences of y per series (`y[i] - y[i-1]`). */
export function diffY<D extends object = Row>(options: MarkOptions<D> = {}): MarkOptions<D> {
  return mapn("y", (v) => getBackend().diff(v), options);
}

/** Cumulative sum of y per series. */
export function cumsumY<D extends object = Row>(options: MarkOptions<D> = {}): MarkOptions<D> {
  return mapn("y", (v) => getBackend().cumsum(v), options);
}

/**
 * Shift x: `shiftX("+1 year", {x, y})` sets `x1 = x + 1 year` and `x2 = x` so a
 * `differenceY` compares the series with its own past (Plot's `shiftX`).
 */
export function shiftX<D extends object = Row>(by: Interval | string | number, options: MarkOptions<D> = {}): MarkOptions<D> {
  const { sign, interval } = parseShift(by);
  const [x1, setX1] = column("x1");
  const [x2, setX2] = column("x2");
  const transform: Transform<D> = (data, facets) => {
    const X = valueof(data, options.x as ChannelValue<D>)!;
    const temporal = X.some((v) => v instanceof Date);
    const shifted: Value[] = X.map((v) => {
      const n = toNumber(v);
      if (!Number.isFinite(n)) return v;
      const s = interval.offset(n, sign);
      return temporal ? new Date(s) : s;
    });
    setX1(shifted);
    setX2(X);
    return { data, facets };
  };
  const out: MarkOptions<D> = { ...options, x1: x1 as ChannelValue<D>, x2: x2 as ChannelValue<D> };
  delete out.x;
  return basic(out, transform);
}

function parseShift(by: Interval | string | number): { sign: number; interval: { offset(v: number, k: number): number } } {
  if (typeof by === "number") return { sign: Math.sign(by) || 1, interval: { offset: (v, k) => v + k * Math.abs(by) } };
  if (typeof by === "string") {
    const m = /^\s*([+-])?\s*(.*)$/.exec(by)!;
    const sign = m[1] === "-" ? -1 : 1;
    return { sign, interval: maybeInterval(m[2] as Interval)! };
  }
  return { sign: 1, interval: maybeInterval(by)! };
}

/** Reducer type re-export for convenience. */
export type { Reducer };
