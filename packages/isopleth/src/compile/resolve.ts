/** Run transforms, compute facets and resolve channels for every mark. */

import type { ChannelValue, Color, Facets, Mark, MarkOptions, PlotOptions, Row, Value } from "../types.js";
import { inferType, isColor, isGradient, keyof, labelof, valueof } from "../channel.js";
import { isDataChannel } from "../transforms/basic.js";

export const CHANNEL_NAMES = ["x", "y", "x1", "x2", "y1", "y2", "z", "fill", "stroke", "r", "text", "title", "fx", "fy"] as const;
export type ChannelName = (typeof CHANNEL_NAMES)[number];

export interface FacetKey {
  fx?: Value;
  fy?: Value;
}

export interface FacetPlan {
  keys: FacetKey[];
  xs: Value[];
  ys: Value[];
  /** Index of the facet for `(fx, fy)`. */
  index: Map<string, number>;
}

export interface ResolvedMark {
  mark: Mark;
  data: readonly Row[];
  /** Index arrays, one per facet in `plan.keys`. */
  facets: Facets;
  channels: Partial<Record<ChannelName, Value[]>>;
  /** Extra tooltip channels (`options.channels`). */
  extra: Record<string, Value[]>;
  /** Literal colors (`fill: "red"`). */
  constants: { fill?: Color; stroke?: Color };
  labels: Partial<Record<ChannelName, string>>;
  /** True when the mark is faceted (its rows are split across facets). */
  faceted: boolean;
}

const facetKeyOf = (fx: Value, fy: Value) => `${String(keyof(fx))}\u0000${String(keyof(fy))}`;

/** Build the facet plan from plot-level `facet` and every mark's `fx`/`fy`. */
export function planFacets(marks: readonly Mark[], options: PlotOptions): FacetPlan {
  const xs = new Map<unknown, Value>();
  const ys = new Map<unknown, Value>();
  const add = (map: Map<unknown, Value>, values: Value[] | undefined) => {
    if (!values) return;
    for (const v of values) {
      const k = keyof(v);
      if (k !== null && !map.has(k)) map.set(k, v);
    }
  };
  for (const mark of marks) {
    const fx = mark.options.fx ?? (options.facet?.x !== undefined && appliesTo(mark, options) ? options.facet.x : undefined);
    const fy = mark.options.fy ?? (options.facet?.y !== undefined && appliesTo(mark, options) ? options.facet.y : undefined);
    add(xs, fx !== undefined ? safeValueof(mark.data, fx) : undefined);
    add(ys, fy !== undefined ? safeValueof(mark.data, fy) : undefined);
  }
  const xList = [...xs.values()].sort(natural);
  const yList = [...ys.values()].sort(natural);
  const keys: FacetKey[] = [];
  const index = new Map<string, number>();
  if (xList.length === 0 && yList.length === 0) return { keys: [{}], xs: [], ys: [], index };
  for (const fy of yList.length ? yList : [undefined]) {
    for (const fx of xList.length ? xList : [undefined]) {
      index.set(facetKeyOf(fx, fy), keys.length);
      keys.push({ fx, fy });
    }
  }
  return { keys, xs: xList, ys: yList, index };
}

function appliesTo(mark: Mark, options: PlotOptions): boolean {
  // Plot-level facets apply to marks sharing the facet data (or all marks when no facet data is given).
  return options.facet?.data === undefined || options.facet.data === mark.data;
}

function natural(a: Value, b: Value): number {
  const na = a instanceof Date ? +a : typeof a === "number" ? a : NaN;
  const nb = b instanceof Date ? +b : typeof b === "number" ? b : NaN;
  if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
  return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
}

function safeValueof(data: readonly Row[], ch: unknown): Value[] | undefined {
  try {
    return valueof(data, ch as ChannelValue);
  } catch {
    return undefined;
  }
}

/** Resolve one mark: facets → transform → channels. */
export function resolveMark(mark: Mark, plan: FacetPlan, options: PlotOptions): ResolvedMark {
  const o = mark.options as MarkOptions;
  const fxCh = o.fx ?? (options.facet?.x !== undefined && appliesTo(mark, options) ? options.facet.x : undefined);
  const fyCh = o.fy ?? (options.facet?.y !== undefined && appliesTo(mark, options) ? options.facet.y : undefined);
  const n = mark.data.length;
  const all = Array.from({ length: n }, (_, i) => i);
  let facets: Facets;
  let faceted = false;
  if ((fxCh !== undefined || fyCh !== undefined) && plan.keys.length > 0 && (plan.xs.length || plan.ys.length)) {
    const FX = fxCh !== undefined ? safeValueof(mark.data, fxCh) : undefined;
    const FY = fyCh !== undefined ? safeValueof(mark.data, fyCh) : undefined;
    if (FX || FY) {
      faceted = true;
      facets = plan.keys.map(() => []);
      for (let i = 0; i < n; i++) {
        const fx = FX ? FX[i] : undefined;
        const fy = FY ? FY[i] : undefined;
        // A mark faceted on one axis only is repeated along the other.
        for (let k = 0; k < plan.keys.length; k++) {
          const key = plan.keys[k];
          if (FX && keyof(key.fx) !== keyof(fx)) continue;
          if (FY && keyof(key.fy) !== keyof(fy)) continue;
          facets[k].push(i);
        }
      }
    } else facets = plan.keys.map(() => all);
  } else facets = plan.keys.map(() => all);

  // Make fx/fy resolvable after the transform (the transform copies them onto output rows).
  const opts: MarkOptions = { ...o };
  if (fxCh !== undefined && opts.fx === undefined) opts.fx = fxCh;
  if (fyCh !== undefined && opts.fy === undefined) opts.fy = fyCh;

  let data: readonly Row[] = mark.data;
  if (typeof opts.transform === "function") {
    const r = opts.transform(data, facets);
    data = r.data;
    facets = r.facets;
  }

  const channels: Partial<Record<ChannelName, Value[]>> = {};
  const labels: Partial<Record<ChannelName, string>> = {};
  const constants: { fill?: Color; stroke?: Color } = {};
  for (const name of CHANNEL_NAMES) {
    const v = (opts as Record<string, unknown>)[name];
    if (v === undefined || v === null) continue;
    if ((name === "fill" || name === "stroke") && (isColor(v) || isGradient(v))) {
      constants[name] = v as Color;
      continue;
    }
    if (name === "fill" || name === "stroke") {
      if (!isDataChannel(v)) continue;
    }
    if (name === "r" && typeof v === "number") continue;
    channels[name] = valueof(data, v as ChannelValue);
    const label = labelof(v);
    if (label && !label.startsWith("__") && label !== name) labels[name] = label;
  }
  const carried = (opts as Record<string, unknown>).__labels as Record<string, string | undefined> | undefined;
  if (carried) for (const [k, l] of Object.entries(carried)) if (l && labels[k as ChannelName] === undefined && channels[k as ChannelName]) labels[k as ChannelName] = l;
  // Derived labels for transformed channels (bins/groups keep the input name).
  const extra: Record<string, Value[]> = {};
  if (opts.channels) for (const [k, ch] of Object.entries(opts.channels)) extra[k] = valueof(data, ch) ?? [];
  return { mark, data, facets, channels, extra, constants, labels, faceted };
}

/** Scale type of a set of channels (first defined wins; ordinal dominates). */
export function typeOfChannels(values: (Value[] | undefined)[]): "quantitative" | "temporal" | "ordinal" | undefined {
  let result: "quantitative" | "temporal" | "ordinal" | undefined;
  for (const v of values) {
    const t = inferType(v);
    if (!t) continue;
    if (t === "ordinal") return "ordinal";
    if (t === "temporal") result = "temporal";
    else if (!result) result = "quantitative";
  }
  return result;
}
