/**
 * `intervalX` / `intervalY`: snap a quantitative or temporal channel to an
 * interval, merge rows that land on the same step, and insert the missing
 * steps so gaps become visible (or get filled). This is what a mark's
 * `interval` option applies implicitly.
 *
 * ```ts
 * lineY(data, { x: "date", y: "value", interval: "day" })            // gaps for missing days
 * lineY(data, intervalX({ interval: "hour", reduce: "sum", fill: 0 }, { x: "ts", y: "n" }))
 * ```
 */

import type { ChannelValue, Interval, MarkOptions, Reducer, Row, Transform, Value } from "../types.js";
import { carryLabel, inferType, toNumber, valueof } from "../channel.js";
import { getBackend } from "../backend/index.js";
import { maybeInterval } from "../interval.js";
import { basic, seriesOf } from "./basic.js";

export interface IntervalTransformOptions {
  interval: Interval;
  /** How to combine rows that fall on the same step (default `"first"`). */
  reduce?: Reducer;
  /** Value for missing steps: `null` (gap, default), a number, `"linear"`, `"previous"`, `"next"`. */
  fill?: null | number | "linear" | "previous" | "next" | "zero";
  /** Also extend to a full range `[start, stop]` (numbers or dates). */
  domain?: [Value, Value];
}

function intervaln<D extends object>(axis: "x" | "y", opts: IntervalTransformOptions, options: MarkOptions<D>): MarkOptions<D> {
  const iv = maybeInterval(opts.interval)!;
  const reduce = typeof opts.reduce === "string" ? opts.reduce : "first";
  const other = axis === "x" ? "y" : "x";
  const posIn = (options as Record<string, unknown>)[axis] as ChannelValue<D> | undefined;
  const valIn = (options as Record<string, unknown>)[other] as ChannelValue<D> | undefined;
  const transform: Transform<D> = (data, facets) => {
    const P = valueof(data, posIn);
    if (!P) return { data, facets };
    const temporal = inferType(P) === "temporal";
    const V = valIn !== undefined ? valueof(data, valIn) : undefined;
    const outData: Row[] = [];
    const outFacets: number[][] = [];
    const backend = getBackend();
    for (const I of facets) {
      const fidx: number[] = [];
      for (const series of seriesOf(data, I, options)) {
        // Group by snapped position, in order of position.
        const groups = new Map<number, number[]>();
        for (const i of series) {
          const p = toNumber(P[i]);
          if (!Number.isFinite(p)) continue;
          const s = iv.floor(p);
          let g = groups.get(s);
          if (!g) groups.set(s, (g = []));
          g.push(i);
        }
        if (groups.size === 0) continue;
        const steps = [...groups.keys()].sort((a, b) => a - b);
        let start = steps[0];
        let stop = steps[steps.length - 1];
        if (opts.domain) {
          start = Math.min(start, iv.floor(toNumber(opts.domain[0])));
          stop = Math.max(stop, iv.floor(toNumber(opts.domain[1])));
        }
        const full = [start, ...iv.range!(iv.offset(start, 1), iv.offset(stop, 1))];
        const template = data[series[0]] as Row;
        const vals = new Float64Array(full.length).fill(NaN);
        const rowsAt: (Row | undefined)[] = new Array(full.length);
        full.forEach((s, j) => {
          const g = groups.get(s);
          if (!g) return;
          rowsAt[j] = data[g[0]] as Row;
          if (V) {
            const nums = Float64Array.from(g, (i) => toNumber(V[i]));
            vals[j] = backend.aggregate(Int32Array.from(nums, () => 0), nums, 1, reduce)[0];
          }
        });
        let filled: Float64Array | number[] = vals;
        if (opts.fill === "linear" || opts.fill === "previous" || opts.fill === "next") filled = backend.impute(vals, opts.fill);
        else if (opts.fill === "zero") filled = backend.impute(vals, "0");
        else if (typeof opts.fill === "number") filled = backend.impute(vals, String(opts.fill));
        full.forEach((s, j) => {
          const base = rowsAt[j] ?? template;
          const row: Row = { ...base, __interval: temporal ? new Date(s) : s, __value: V ? (Number.isFinite(filled[j]) ? filled[j] : null) : undefined, __missing: rowsAt[j] === undefined };
          fidx.push(outData.length);
          outData.push(row);
        });
      }
      outFacets.push(fidx);
    }
    return { data: outData as unknown as D[], facets: outFacets };
  };
  const out: MarkOptions<D> = { ...options };
  delete out.interval;
  (out as Record<string, unknown>)[axis] = "__interval";
  if (valIn !== undefined) (out as Record<string, unknown>)[other] = "__value";
  const prev = ((options as Record<string, unknown>).__labels ?? {}) as Record<string, string | undefined>;
  (out as Record<string, unknown>).__labels = { ...prev, [axis]: carryLabel(posIn, prev[axis], axis), ...(valIn !== undefined ? { [other]: carryLabel(valIn, prev[other], other) } : {}) };
  return basic(out, transform);
}

export function intervalX<D extends object = Row>(opts: IntervalTransformOptions | Interval, options: MarkOptions<D> = {}): MarkOptions<D> {
  const o = typeof opts === "object" && opts !== null && "interval" in opts ? opts : { interval: opts as Interval };
  return intervaln("x", o, options);
}
export function intervalY<D extends object = Row>(opts: IntervalTransformOptions | Interval, options: MarkOptions<D> = {}): MarkOptions<D> {
  const o = typeof opts === "object" && opts !== null && "interval" in opts ? opts : { interval: opts as Interval };
  return intervaln("y", o, options);
}
