/**
 * `stackY` / `stackX`: turn `y` into `y1`/`y2` by stacking series that share
 * the same `x`. Options mirror Plot: `offset` (`null` | `"normalize"` |
 * `"center"` | `"wiggle"`), `order` (`null` | `"value"` | `"sum"` |
 * `"appearance"` | `"inside-out"` | field | function | array), `reverse`.
 */

import type { ChannelValue, MarkOptions, Row, Transform, Value } from "../types.js";
import { carryLabel, isMissing, keyof, toNumber, valueof } from "../channel.js";
import { basic, column, isDataChannel } from "./basic.js";

export type StackOffset = null | undefined | "normalize" | "center" | "wiggle" | ((groups: number[][], Y1: Float64Array, Y2: Float64Array, Z: Value[]) => void);
export type StackOrder = null | undefined | "value" | "x" | "y" | "sum" | "appearance" | "inside-out" | string | Value[] | ((a: Row, b: Row) => number) | ((d: Row) => Value);

export interface StackOptions {
  offset?: StackOffset;
  order?: StackOrder;
  reverse?: boolean;
}

function isStackOptions(o: unknown): o is StackOptions {
  return typeof o === "object" && o !== null && ("offset" in o || "order" in o || ("reverse" in o && Object.keys(o).length === 1));
}

function stackn<D extends object>(axis: "x" | "y", stackOpts: StackOptions, options: MarkOptions<D>): MarkOptions<D> {
  const value = axis === "y" ? options.y : options.x;
  const key = axis === "y" ? options.x : options.y;
  const { offset, order, reverse } = stackOpts;
  const zChannel = options.z ?? (isDataChannel(options.fill) ? options.fill : isDataChannel(options.stroke) ? options.stroke : undefined);
  const [v1, setV1] = column(axis + "1");
  const [v2, setV2] = column(axis + "2");
  const [vm, setVm] = column(axis);

  const transform: Transform<D> = (data, facets) => {
    const n = data.length;
    const V = value === undefined ? undefined : valueof(data, value as ChannelValue<D>);
    const K = key === undefined ? undefined : valueof(data, key as ChannelValue<D>);
    const Z = zChannel === undefined ? undefined : valueof(data, zChannel as ChannelValue<D>);
    const Y = new Float64Array(n);
    for (let i = 0; i < n; i++) Y[i] = V ? toNumber(V[i]) : 1;
    const Y1 = new Float64Array(n);
    const Y2 = new Float64Array(n);
    const newFacets: number[][] = [];
    for (const I of facets) {
      // Group indices by key (x) in order of appearance.
      const byKey = new Map<unknown, number[]>();
      for (const i of I) {
        const k = K ? keyof(K[i]) : 0;
        let g = byKey.get(k);
        if (!g) byKey.set(k, (g = []));
        g.push(i);
      }
      const stacks = [...byKey.values()];
      // Order within each stack.
      const cmp = orderComparator(order, data as readonly Row[], Y, Z, I);
      if (cmp) for (const s of stacks) s.sort(cmp);
      if (reverse) for (const s of stacks) s.reverse();
      // Diverging stack: positives up from zero, negatives down.
      for (const s of stacks) {
        let yp = 0;
        let yn = 0;
        for (const i of s) {
          const v = Y[i];
          if (!Number.isFinite(v)) {
            Y1[i] = NaN;
            Y2[i] = NaN;
            continue;
          }
          if (v < 0) {
            Y1[i] = yn;
            yn += v;
            Y2[i] = yn;
          } else {
            Y1[i] = yp;
            yp += v;
            Y2[i] = yp;
          }
        }
      }
      applyOffset(offset, stacks, Y1, Y2, Z);
      newFacets.push(I);
    }
    const mids = new Float64Array(n);
    for (let i = 0; i < n; i++) mids[i] = (Y1[i] + Y2[i]) / 2;
    setV1(Y1);
    setV2(Y2);
    setVm(mids);
    return { data, facets: newFacets };
  };

  const out: MarkOptions<D> = { ...options };
  if (axis === "y") {
    delete out.y;
    out.y1 = v1 as ChannelValue<D>;
    out.y2 = v2 as ChannelValue<D>;
    out.y = vm as ChannelValue<D>;
  } else {
    delete out.x;
    out.x1 = v1 as ChannelValue<D>;
    out.x2 = v2 as ChannelValue<D>;
    out.x = vm as ChannelValue<D>;
  }
  (out as Record<string, unknown>).__stacked = { axis, offset: offset ?? null, order: order ?? null };
  const prev = ((options as Record<string, unknown>).__labels ?? {}) as Record<string, string | undefined>;
  (out as Record<string, unknown>).__labels = { ...prev, [axis]: carryLabel(value, prev[axis], axis) };
  return basic(out, transform);
}

function orderComparator(order: StackOrder, data: readonly Row[], Y: Float64Array, Z: Value[] | undefined, I: number[]): ((a: number, b: number) => number) | undefined {
  if (order === null || order === undefined) return undefined;
  if (typeof order === "function") {
    if (order.length === 2) {
      const f = order as (a: Row, b: Row) => number;
      return (a, b) => f(data[a], data[b]);
    }
    const f = order as (d: Row) => Value;
    return (a, b) => cmpValue(f(data[a]), f(data[b]));
  }
  if (Array.isArray(order)) {
    const rank = new Map(order.map((v, i) => [keyof(v), i]));
    return (a, b) => (rank.get(keyof(Z?.[a])) ?? Infinity) - (rank.get(keyof(Z?.[b])) ?? Infinity);
  }
  switch (order) {
    case "value":
    case "x":
    case "y":
      return (a, b) => Y[a] - Y[b];
    case "sum":
    case "appearance":
    case "inside-out": {
      if (!Z) return undefined;
      const stat = new Map<unknown, { sum: number; peak: number; peakAt: number; first: number }>();
      for (const i of I) {
        const k = keyof(Z[i]);
        let s = stat.get(k);
        if (!s) stat.set(k, (s = { sum: 0, peak: -Infinity, peakAt: 0, first: i }));
        const v = Y[i];
        if (Number.isFinite(v)) {
          s.sum += v;
          if (v > s.peak) {
            s.peak = v;
            s.peakAt = i;
          }
        }
      }
      if (order === "sum") return (a, b) => (stat.get(keyof(Z[a]))?.sum ?? 0) - (stat.get(keyof(Z[b]))?.sum ?? 0);
      if (order === "appearance") return (a, b) => (stat.get(keyof(Z[a]))?.peakAt ?? 0) - (stat.get(keyof(Z[b]))?.peakAt ?? 0);
      // inside-out: alternate series with early peaks to the bottom and late to the top.
      const keys = [...stat.keys()].sort((a, b) => stat.get(a)!.peakAt - stat.get(b)!.peakAt);
      const rank = new Map<unknown, number>();
      const top: unknown[] = [];
      const bottom: unknown[] = [];
      let tops = 0;
      let bottoms = 0;
      for (const k of keys) {
        const s = stat.get(k)!.sum;
        if (tops < bottoms) {
          tops += s;
          top.push(k);
        } else {
          bottoms += s;
          bottom.push(k);
        }
      }
      [...bottom.reverse(), ...top].forEach((k, i) => rank.set(k, i));
      return (a, b) => (rank.get(keyof(Z[a])) ?? 0) - (rank.get(keyof(Z[b])) ?? 0);
    }
    default: {
      // Field name.
      const V = valueof(data, order as string);
      if (!V) return undefined;
      return (a, b) => cmpValue(V[a], V[b]);
    }
  }
}

function cmpValue(a: Value, b: Value): number {
  if (isMissing(a)) return isMissing(b) ? 0 : 1;
  if (isMissing(b)) return -1;
  const na = toNumber(a);
  const nb = toNumber(b);
  if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
  return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
}

function applyOffset(offset: StackOffset, stacks: number[][], Y1: Float64Array, Y2: Float64Array, Z: Value[] | undefined): void {
  if (!offset) return;
  if (typeof offset === "function") {
    offset(stacks, Y1, Y2, Z ?? []);
    return;
  }
  if (offset === "normalize") {
    for (const s of stacks) {
      let lo = 0;
      let hi = 0;
      for (const i of s) {
        if (Number.isFinite(Y1[i])) {
          lo = Math.min(lo, Y1[i], Y2[i]);
          hi = Math.max(hi, Y1[i], Y2[i]);
        }
      }
      const span = hi - lo;
      for (const i of s) {
        if (!Number.isFinite(Y1[i])) continue;
        Y1[i] = span === 0 ? 0 : (Y1[i] - lo) / span;
        Y2[i] = span === 0 ? 0 : (Y2[i] - lo) / span;
      }
    }
    return;
  }
  if (offset === "center") {
    for (const s of stacks) {
      let lo = Infinity;
      let hi = -Infinity;
      for (const i of s) {
        if (Number.isFinite(Y1[i])) {
          lo = Math.min(lo, Y1[i], Y2[i]);
          hi = Math.max(hi, Y1[i], Y2[i]);
        }
      }
      if (!Number.isFinite(lo)) continue;
      const m = (lo + hi) / 2;
      for (const i of s) {
        if (!Number.isFinite(Y1[i])) continue;
        Y1[i] -= m;
        Y2[i] -= m;
      }
    }
    return;
  }
  if (offset === "wiggle") {
    // Streamgraph baseline that minimises the weighted change in slope (d3's stackOffsetWiggle).
    if (!Z) return;
    let prevStack: Map<unknown, number> | undefined;
    let prevY = 0;
    for (const s of stacks) {
      const cur = new Map<unknown, number>();
      let sum = 0;
      let dy = 0;
      for (const i of s) {
        const h = Y2[i] - Y1[i];
        if (!Number.isFinite(h)) continue;
        const k = keyof(Z[i]);
        const prevH = prevStack?.get(k) ?? h;
        dy += (h - prevH) * (sum + h / 2);
        sum += h;
        cur.set(k, h);
      }
      const y0 = prevStack ? prevY - (sum > 0 ? dy / sum : 0) : 0;
      for (const i of s) {
        if (!Number.isFinite(Y1[i])) continue;
        Y1[i] += y0;
        Y2[i] += y0;
      }
      prevStack = cur;
      prevY = y0;
    }
  }
}

function split<D extends object>(a: StackOptions | MarkOptions<D> | undefined, b: MarkOptions<D> | undefined): [StackOptions, MarkOptions<D>] {
  if (b === undefined) {
    if (a === undefined) return [{}, {}];
    if (isStackOptions(a)) {
      const { offset, order, reverse, ...rest } = a as StackOptions & MarkOptions<D>;
      return [{ offset, order, reverse }, rest as MarkOptions<D>];
    }
    return [{}, a as MarkOptions<D>];
  }
  return [(a as StackOptions) ?? {}, b];
}

export function stackY<D extends object = Row>(stack?: StackOptions | MarkOptions<D>, options?: MarkOptions<D>): MarkOptions<D> {
  const [s, o] = split(stack, options);
  return stackn("y", s, o);
}
export function stackX<D extends object = Row>(stack?: StackOptions | MarkOptions<D>, options?: MarkOptions<D>): MarkOptions<D> {
  const [s, o] = split(stack, options);
  return stackn("x", s, o);
}
/** Like `stackY` but exposes only the lower edge as `y`. */
export function stackY1<D extends object = Row>(stack?: StackOptions | MarkOptions<D>, options?: MarkOptions<D>): MarkOptions<D> {
  const o = stackY(stack, options);
  return { ...o, y: o.y1, y1: undefined, y2: undefined };
}
/** Like `stackY` but exposes only the upper edge as `y`. */
export function stackY2<D extends object = Row>(stack?: StackOptions | MarkOptions<D>, options?: MarkOptions<D>): MarkOptions<D> {
  const o = stackY(stack, options);
  return { ...o, y: o.y2, y1: undefined, y2: undefined };
}
export function stackX1<D extends object = Row>(stack?: StackOptions | MarkOptions<D>, options?: MarkOptions<D>): MarkOptions<D> {
  const o = stackX(stack, options);
  return { ...o, x: o.x1, x1: undefined, x2: undefined };
}
export function stackX2<D extends object = Row>(stack?: StackOptions | MarkOptions<D>, options?: MarkOptions<D>): MarkOptions<D> {
  const o = stackX(stack, options);
  return { ...o, x: o.x2, x1: undefined, x2: undefined };
}
