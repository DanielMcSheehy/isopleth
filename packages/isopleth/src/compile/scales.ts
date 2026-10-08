/** Scale inference: x, y, color and r from the resolved marks. */

import type { ColorScaleOptions, PlotOptions, ScaleOptions, ScaleType, Value } from "../types.js";
import { ascending, descending, inferType, isMissing, keyof, toNumber } from "../channel.js";
import { getBackend } from "../backend/index.js";
import { scheme } from "./palette.js";
import type { Theme } from "../theme.js";
import type { ResolvedMark } from "./resolve.js";
import { typeOfChannels } from "./resolve.js";

export interface PositionScale {
  type: ScaleType;
  /** Ordinal domain (in display order). */
  domain: Value[];
  /** Continuous extent over all facets. */
  extent: [number, number];
  /** Per-facet extents (used when facets do not share the scale). */
  facetExtents: [number, number][];
  label?: string;
  zero: boolean;
  log: boolean;
  percent: boolean;
  options: ScaleOptions;
  /** Lookup from ordinal key to domain index. */
  index: Map<string | number | boolean | null, number>;
}

export interface ColorScale {
  kind: "categorical" | "continuous" | "none";
  domain: Value[];
  range: string[];
  colorOf: (v: Value) => string | undefined;
  extent: [number, number];
  stops: string[];
  label?: string;
  legend: boolean;
  options: ColorScaleOptions;
  index: Map<string | number | boolean | null, number>;
}

export interface RScale {
  extent: [number, number];
  range: [number, number];
  sizeOf: (v: Value) => number;
}

export interface Scales {
  x: PositionScale;
  y: PositionScale;
  color: ColorScale;
  r: RScale;
}

const X_CHANNELS = ["x", "x1", "x2"] as const;
const Y_CHANNELS = ["y", "y1", "y2"] as const;
const ZERO_MARKS_Y = new Set(["barY", "areaY", "rectY", "ruleX"]);
const ZERO_MARKS_X = new Set(["barX", "areaX", "rectX", "ruleY"]);

function positionScale(axis: "x" | "y", marks: ResolvedMark[], nFacets: number, options: ScaleOptions = {}): PositionScale {
  const names = axis === "x" ? X_CHANNELS : Y_CHANNELS;
  const chans: Value[][] = [];
  let label: string | undefined;
  for (const m of [...marks.filter((m) => !m.mark.generated), ...marks.filter((m) => m.mark.generated)]) {
    for (const n of names) {
      const v = m.channels[n];
      if (v) {
        chans.push(v);
        if (!m.mark.generated) label ??= m.labels[n] ?? m.labels[axis];
      }
    }
  }
  let type: ScaleType =
    options.type === "ordinal" || options.type === "band" || options.type === "point" || options.type === "category"
      ? "ordinal"
      : options.type === "time" || options.type === "utc"
        ? "temporal"
        : options.type === "linear" || options.type === "log" || options.type === "sqrt"
          ? "quantitative"
          : (typeOfChannels(chans) ?? "quantitative");
  if (options.domain && options.type === undefined) {
    const t = inferType(options.domain as Value[]);
    if (t === "ordinal" || (options.domain as Value[]).length > 2) type = "ordinal";
    else if (t) type = t;
  }

  const domain: Value[] = [];
  const index = new Map<string | number | boolean | null, number>();
  const extent: [number, number] = [Infinity, -Infinity];
  const facetExtents: [number, number][] = Array.from({ length: nFacets }, () => [Infinity, -Infinity]);
  if (type === "ordinal") {
    if (options.domain) for (const v of options.domain as Value[]) addDomain(domain, index, v);
    else {
      const sorted = sortedDomain(axis, marks, names);
      if (sorted) for (const v of sorted) addDomain(domain, index, v);
      else {
        const all: Value[] = [];
        const seen = new Set<unknown>();
        for (const c of chans) for (const v of c) {
          const k = keyof(v);
          if (k === null || seen.has(k)) continue;
          seen.add(k);
          all.push(v);
        }
        all.sort(ascending);
        for (const v of all) addDomain(domain, index, v);
      }
    }
    if (options.reverse) {
      domain.reverse();
      index.clear();
      domain.forEach((v, i) => index.set(keyof(v), i));
    }
  } else {
    for (const m of marks) {
      for (const n of names) {
        const v = m.channels[n];
        if (!v) continue;
        m.facets.forEach((I, f) => {
          const fe = facetExtents[f];
          for (const i of I) {
            const x = toNumber(v[i]);
            if (!Number.isFinite(x)) continue;
            if (x < fe[0]) fe[0] = x;
            if (x > fe[1]) fe[1] = x;
          }
        });
      }
    }
    for (const fe of facetExtents) {
      if (fe[0] < extent[0]) extent[0] = fe[0];
      if (fe[1] > extent[1]) extent[1] = fe[1];
    }
    if (options.domain && options.domain.length === 2) {
      extent[0] = toNumber(options.domain[0] as Value);
      extent[1] = toNumber(options.domain[1] as Value);
    }
  }
  const zero = options.zero ?? marks.some((m) => (axis === "y" ? ZERO_MARKS_Y : ZERO_MARKS_X).has(m.mark.type) && !m.mark.generated);
  return {
    type,
    domain,
    extent,
    facetExtents,
    label: options.label === null ? undefined : (options.label ?? label),
    zero,
    log: options.type === "log",
    percent: Boolean(options.percent),
    options,
    index,
  };
}

function addDomain(domain: Value[], index: Map<string | number | boolean | null, number>, v: Value) {
  const k = keyof(v);
  if (k === null || index.has(k)) return;
  index.set(k, domain.length);
  domain.push(v);
}

/** Honour mark-level `sort: {x: "-y"}` for ordinal domains. */
function sortedDomain(axis: "x" | "y", marks: ResolvedMark[], names: readonly string[]): Value[] | undefined {
  for (const m of marks) {
    const s = m.mark.options.sort;
    if (!s || typeof s !== "object" || typeof s === "function") continue;
    const spec = (s as Record<string, unknown>)[axis];
    if (spec === undefined) continue;
    let channel: string;
    let order: "ascending" | "descending" = "ascending";
    let reduce = "max";
    let limit: number | undefined;
    let reverse = false;
    if (typeof spec === "string") channel = spec;
    else {
      const o = spec as { value: string; order?: "ascending" | "descending"; reduce?: string; limit?: number; reverse?: boolean };
      channel = o.value;
      if (o.order) order = o.order;
      if (typeof o.reduce === "string") reduce = o.reduce;
      limit = o.limit;
      reverse = Boolean(o.reverse);
    }
    if (channel.startsWith("-")) {
      channel = channel.slice(1);
      order = "descending";
    }
    const K = m.channels[names[0] as "x"] ?? m.channels[axis];
    const V = m.channels[channel as "y"];
    if (!K || !V) continue;
    const groups = new Map<string | number | boolean | null, { v: Value; vals: number[] }>();
    for (let i = 0; i < K.length; i++) {
      const k = keyof(K[i]);
      if (k === null) continue;
      let g = groups.get(k);
      if (!g) groups.set(k, (g = { v: K[i], vals: [] }));
      g.vals.push(toNumber(V[i]));
    }
    const backend = getBackend();
    const scored = [...groups.values()].map((g) => {
      const nums = Float64Array.from(g.vals);
      return { v: g.v, s: backend.aggregate(Int32Array.from(nums, () => 0), nums, 1, reduce)[0] };
    });
    scored.sort((a, b) => (order === "descending" ? descending(a.s, b.s) : ascending(a.s, b.s)));
    let out = scored.map((d) => d.v);
    if (reverse) out.reverse();
    if (limit !== undefined) out = limit >= 0 ? out.slice(0, limit) : out.slice(limit);
    return out;
  }
  return undefined;
}

function colorScale(marks: ResolvedMark[], options: ColorScaleOptions = {}, theme: Theme): ColorScale {
  const chans: Value[][] = [];
  let label: string | undefined;
  for (const m of marks) {
    if (m.mark.generated) continue;
    for (const n of ["fill", "stroke", "z"] as const) {
      const v = m.channels[n];
      if (v && n !== "z") label ??= m.labels[n];
      if (v) chans.push(v);
    }
  }
  const index = new Map<string | number | boolean | null, number>();
  const none: ColorScale = { kind: "none", domain: [], range: [], colorOf: () => undefined, extent: [0, 1], stops: [], legend: false, options, index };
  if (chans.length === 0 && !options.domain) return none;
  const t = options.type === "categorical" || options.type === "ordinal" ? "ordinal" : options.type ? "quantitative" : typeOfChannels(chans);
  if (t === "ordinal" || t === undefined) {
    const domain: Value[] = [];
    const seen = new Set<unknown>();
    const push = (v: Value) => {
      const k = keyof(v);
      if (k === null || seen.has(k)) return;
      seen.add(k);
      index.set(k, domain.length);
      domain.push(v);
    };
    if (options.domain) (options.domain as Value[]).forEach(push);
    else for (const c of chans) for (const v of c) push(v);
    let range = options.range ?? (options.scheme ? scheme(options.scheme, "observable10") : theme.categorical);
    if (options.reverse) range = range.slice().reverse();
    const overrides = new Map<string | number | boolean | null, string>();
    if (options.overrides) for (const [k, c] of Object.entries(options.overrides)) overrides.set(k, c);
    const colorOf = (v: Value) => {
      const k = keyof(v);
      const o = overrides.get(k) ?? overrides.get(String(k));
      if (o) return o;
      const i = index.get(k);
      if (i === undefined) return options.unknown ?? theme.textMuted;
      return range[i % range.length];
    };
    const effectiveRange = domain.map((v) => colorOf(v));
    return { kind: "categorical", domain, range: effectiveRange.length ? effectiveRange : range, colorOf, extent: [0, 1], stops: [], label: options.label ?? label, legend: options.legend ?? domain.length > 1, options, index };
  }
  // Continuous.
  let lo = Infinity;
  let hi = -Infinity;
  for (const c of chans) for (const v of c) {
    const x = toNumber(v);
    if (!Number.isFinite(x)) continue;
    if (x < lo) lo = x;
    if (x > hi) hi = x;
  }
  if (options.domain && options.domain.length === 2) {
    lo = toNumber(options.domain[0] as Value);
    hi = toNumber(options.domain[1] as Value);
  }
  const diverging = options.type === "diverging";
  let stops = options.range ?? (options.scheme ? scheme(options.scheme, "viridis") : diverging ? theme.diverging : theme.sequential);
  if (options.reverse) stops = stops.slice().reverse();
  if (diverging && !options.domain) {
    const m = Math.max(Math.abs(lo), Math.abs(hi));
    lo = -m;
    hi = m;
  }
  const colorOf = (v: Value) => {
    const x = toNumber(v);
    if (!Number.isFinite(x)) return options.unknown ?? theme.textMuted;
    const t = hi === lo ? 0.5 : Math.min(1, Math.max(0, (x - lo) / (hi - lo)));
    return interpolateStops(stops, t);
  };
  return { kind: "continuous", domain: [], range: stops, colorOf, extent: [lo, hi], stops, label: options.label ?? label, legend: options.legend ?? true, options, index };
}

function interpolateStops(stops: string[], t: number): string {
  if (stops.length === 1) return stops[0];
  const p = t * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(p));
  const f = p - i;
  const a = hex(stops[i]);
  const b = hex(stops[i + 1]);
  if (!a || !b) return stops[i];
  const c = a.map((x, k) => Math.round(x + (b[k] - x) * f));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

function hex(c: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{6})$/i.exec(c.trim());
  if (!m) return null;
  return [parseInt(m[1].slice(0, 2), 16), parseInt(m[1].slice(2, 4), 16), parseInt(m[1].slice(4, 6), 16)];
}

function rScale(marks: ResolvedMark[], options: PlotOptions["r"] = {}): RScale {
  let lo = Infinity;
  let hi = -Infinity;
  for (const m of marks) {
    const v = m.channels.r;
    if (!v) continue;
    for (const x of v) {
      const n = toNumber(x);
      if (!Number.isFinite(n)) continue;
      if (n < lo) lo = n;
      if (n > hi) hi = n;
    }
  }
  if (options.domain) [lo, hi] = options.domain;
  const range = options.range ?? [2, 9];
  const sizeOf = (v: Value) => {
    const n = toNumber(v);
    if (!Number.isFinite(n) || hi <= 0) return range[0];
    // sqrt scale so area is proportional to value
    const t = Math.sqrt(Math.max(0, n) / hi);
    return range[0] + t * (range[1] - range[0]);
  };
  return { extent: [Number.isFinite(lo) ? lo : 0, Number.isFinite(hi) ? hi : 1], range, sizeOf };
}

export function inferScales(marks: ResolvedMark[], nFacets: number, options: PlotOptions, theme: Theme): Scales {
  return {
    x: positionScale("x", marks, nFacets, options.x),
    y: positionScale("y", marks, nFacets, options.y),
    color: colorScale(marks, options.color, theme),
    r: rScale(marks, options.r),
  };
}

/** Value → axis coordinate: ordinal → domain label string, temporal → ms, numeric → number; missing → null. */
export function coord(scale: PositionScale, v: Value): string | number | null {
  if (isMissing(v)) return null;
  if (scale.type === "ordinal") return v instanceof Date ? v.toISOString() : String(v);
  const n = toNumber(v);
  return Number.isFinite(n) ? n : null;
}
