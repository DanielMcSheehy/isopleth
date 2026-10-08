/**
 * A declarative chart spec — the JSON that the editor edits and that
 * `fromSpec()` turns into marks. It covers the common shapes (one mark over
 * tidy rows, aggregated, stacked, smoothed, faceted, with insights); for
 * anything else use the marks API directly.
 */

import type { ChannelValue, Curve, Interval, InsightsConfig, Mark, PlotOptions, Reducer, Row, Value } from "./types.js";
import { inferType, valueof } from "./channel.js";
import { areaY, barY, cell, dot, lineY, rectY } from "./marks.js";
import { auto } from "./auto.js";
import { binX, group, groupX } from "./transforms/group.js";
import { stackY } from "./transforms/stack.js";
import { windowY } from "./transforms/map.js";

export type SpecMark = "auto" | "line" | "area" | "bar" | "dot" | "cell" | "histogram";

export interface ChartSpec {
  mark: SpecMark;
  x?: string;
  y?: string;
  /** Aggregate `y` per `x` (and colour): `count`, `sum`, `mean`, ... `null`/undefined = raw rows. */
  reduce?: Reducer | null;
  /** Field that colours the marks (also splits series). */
  color?: string;
  /** Field mapped to dot size. */
  size?: string;
  /** Field for small multiples. */
  facet?: string;
  /** Stack series: `true` (stack from zero), `"normalize"` (shares), `"center"`. `false` overlays (areas) or dodges (bars). */
  stack?: boolean | "normalize" | "center";
  /** Rolling-mean window (0 = off). */
  window?: number;
  /** Snap a time/number x to an interval (gaps become visible; with `reduce`, bins). */
  interval?: Interval;
  /** Bin count hint for histograms. */
  bins?: number;
  curve?: Curve;
  gradient?: boolean;
  zoom?: boolean;
  sort?: "none" | "y" | "-y";
  insights?: InsightsConfig;
  /** Per-series colour overrides. */
  colors?: Record<string, string>;
  theme?: string;
  title?: string;
  subtitle?: string;
  xLabel?: string | null;
  yLabel?: string | null;
}

export interface FieldInfo {
  name: string;
  type: "quantitative" | "temporal" | "ordinal";
  /** Distinct values for ordinal fields (first 50). */
  values?: Value[];
}

/** Inspect tidy rows: field names and inferred types. */
export function inspectFields(input: readonly object[], sample = 500): FieldInfo[] {
  const data = input as readonly Row[];
  const names = new Set<string>();
  for (const row of data.slice(0, sample)) for (const k of Object.keys(row as object)) names.add(k);
  const out: FieldInfo[] = [];
  for (const name of names) {
    const vals = valueof(data.slice(0, sample), name) ?? [];
    const type = inferType(vals) ?? "ordinal";
    const info: FieldInfo = { name, type };
    if (type === "ordinal") {
      const seen = new Set<unknown>();
      const values: Value[] = [];
      for (const v of valueof(data, name) ?? []) {
        if (v === null || v === undefined || seen.has(v)) continue;
        seen.add(v);
        values.push(v);
        if (values.length >= 50) break;
      }
      info.values = values;
    }
    out.push(info);
  }
  return out;
}

/** Build the marks for a spec. */
export function specMarks(input: readonly object[], spec: ChartSpec): Mark[] {
  const data = input as readonly Row[];
  const { x, y, color, size, facet } = spec;
  const fields = inspectFields(data, 200);
  const typeOf = (f?: string) => fields.find((d) => d.name === f)?.type;
  const base: Record<string, unknown> = { x, y, fx: facet, curve: spec.curve, gradient: spec.gradient, insights: spec.insights, id: "main" };
  if (spec.interval && spec.mark !== "histogram" && spec.mark !== "bar") base.interval = spec.interval;
  const colorKey = spec.mark === "line" || spec.mark === "dot" ? "stroke" : "fill";
  if (color) base[colorKey] = color;
  if (spec.mark === "dot" && color) base.fill = color;
  if (size) base.r = size;
  if (spec.sort && spec.sort !== "none") base.sort = { x: spec.sort };
  const reduce = spec.reduce ?? undefined;
  let opts: Record<string, unknown> = base;

  switch (spec.mark) {
    case "auto":
      return auto(data, { x, y: reduce && y ? { value: y, reduce } : y, color, size, fx: facet, insights: spec.insights, curve: spec.curve, id: "main" });
    case "histogram": {
      const o = { ...base };
      delete o.y;
      return [rectY(data, binX({ y: "count", ...(spec.bins ? { thresholds: spec.bins } : {}), ...(spec.interval ? { interval: spec.interval } : {}) }, o))];
    }
    case "cell":
      return [cell(data, group({ fill: reduce ?? "count" }, { ...base, fill: color ?? y, label: true }))];
    default:
      break;
  }
  // Aggregation for line/area/bar.
  if (reduce || spec.mark === "bar") {
    const r = reduce ?? (y ? "sum" : "count");
    if (typeOf(x) === "ordinal") opts = groupX({ y: r }, opts);
    else opts = binX({ y: r, ...(spec.interval ? { interval: spec.interval } : spec.bins ? { thresholds: spec.bins } : {}) }, opts);
  }
  if (spec.window && spec.window > 1) opts = windowY({ k: spec.window, anchor: "middle" }, opts);
  const stacked = spec.stack !== false && spec.stack !== undefined && Boolean(color);
  switch (spec.mark) {
    case "line":
      return [lineY(data, opts)];
    case "area": {
      if (spec.stack === "normalize" || spec.stack === "center") return [areaY(data, stackY({ offset: spec.stack }, opts))];
      if (spec.stack === false && color) return [areaY(data, { ...opts, y1: 0, y2: opts.y as ChannelValue, fillOpacity: 0.25 })];
      return [areaY(data, opts)];
    }
    case "bar": {
      if (spec.stack === "normalize" || spec.stack === "center") return [barY(data, stackY({ offset: spec.stack }, opts))];
      if (!stacked && color) return [barY(data, { ...opts, dodge: true })];
      return [barY(data, opts)];
    }
    case "dot":
      return [dot(data, opts)];
    default:
      return [lineY(data, opts)];
  }
}

/** Build full plot options for a spec. */
export function fromSpec(data: readonly object[], spec: ChartSpec): PlotOptions {
  const o: PlotOptions = {
    marks: specMarks(data, spec),
    theme: spec.theme,
    title: spec.title,
    subtitle: spec.subtitle,
    x: { label: spec.xLabel === undefined ? undefined : spec.xLabel, zoom: spec.zoom },
    y: { label: spec.yLabel === undefined ? undefined : spec.yLabel, percent: spec.stack === "normalize" },
    color: { overrides: spec.colors },
  };
  if (spec.facet) o.facet = { x: spec.facet };
  return o;
}

const q = (v: unknown) => JSON.stringify(v);

/** Generate an `ip.plot({...})` snippet equivalent to the spec. */
export function specToCode(spec: ChartSpec, dataName = "data"): string {
  const { x, y, color, size, facet } = spec;
  const ch: string[] = [];
  if (x) ch.push(`x: ${q(x)}`);
  if (y && spec.mark !== "histogram") ch.push(`y: ${q(y)}`);
  const colorKey = spec.mark === "line" ? "stroke" : spec.mark === "auto" ? "color" : "fill";
  if (color) ch.push(`${colorKey}: ${q(color)}`);
  if (size) ch.push(spec.mark === "auto" ? `size: ${q(size)}` : `r: ${q(size)}`);
  if (facet) ch.push(`fx: ${q(facet)}`);
  if (spec.curve) ch.push(`curve: ${q(spec.curve)}`);
  if (spec.gradient) ch.push("gradient: true");
  if (spec.interval && (spec.mark === "line" || spec.mark === "area" || spec.mark === "dot") && !spec.reduce) ch.push(`interval: ${q(spec.interval)}`);
  if (spec.sort && spec.sort !== "none") ch.push(`sort: { x: ${q(spec.sort)} }`);
  if (spec.stack === false && color && spec.mark === "bar") ch.push("dodge: true");
  let options = `{ ${ch.join(", ")} }`;
  const reduce = spec.reduce ?? (spec.mark === "bar" ? (y ? "sum" : "count") : undefined);
  let markCall: string;
  switch (spec.mark) {
    case "auto":
      markCall = `ip.auto(${dataName}, { ${[x && `x: ${q(x)}`, y && (spec.reduce ? `y: { value: ${q(y)}, reduce: ${q(spec.reduce)} }` : `y: ${q(y)}`), color && `color: ${q(color)}`, size && `size: ${q(size)}`, facet && `fx: ${q(facet)}`].filter(Boolean).join(", ")} })`;
      break;
    case "histogram":
      markCall = `ip.rectY(${dataName}, ip.binX({ y: "count"${spec.bins ? `, thresholds: ${spec.bins}` : ""}${spec.interval ? `, interval: ${q(spec.interval)}` : ""} }, ${options}))`;
      break;
    case "cell":
      markCall = `ip.cell(${dataName}, ip.group({ fill: ${q(reduce ?? "count")} }, { x: ${q(x)}, y: ${q(y)}, fill: ${q(color ?? y)}, label: true }))`;
      break;
    default: {
      if (reduce) options = `ip.groupX({ y: ${q(reduce)} }, ${options})`;
      if (spec.window && spec.window > 1) options = `ip.windowY(${spec.window}, ${options})`;
      if ((spec.stack === "normalize" || spec.stack === "center") && (spec.mark === "area" || spec.mark === "bar")) options = `ip.stackY({ offset: ${q(spec.stack)} }, ${options})`;
      const fn = { line: "lineY", area: "areaY", bar: "barY", dot: "dot" }[spec.mark] ?? "lineY";
      markCall = `ip.${fn}(${dataName}, ${options})`;
    }
  }
  const plotOpts: string[] = [`marks: [${markCall}]`];
  if (spec.insights && Object.keys(spec.insights).length) plotOpts.push(`insights: ${JSON.stringify(spec.insights)}`);
  if (spec.facet) plotOpts.push(`facet: { x: ${q(spec.facet)} }`);
  if (spec.zoom) plotOpts.push(`x: { zoom: true }`);
  if (spec.stack === "normalize") plotOpts.push(`y: { percent: true }`);
  if (spec.colors && Object.keys(spec.colors).length) plotOpts.push(`color: { overrides: ${JSON.stringify(spec.colors)} }`);
  if (spec.theme && spec.theme !== "light") plotOpts.push(`theme: ${q(spec.theme)}`);
  if (spec.title) plotOpts.push(`title: ${q(spec.title)}`);
  return `ip.plot({\n  ${plotOpts.join(",\n  ")},\n})`;
}
