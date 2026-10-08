/** Mark → ECharts series compilers. */

import type { Color, GradientSpec, Mark, MarkOptions, Value } from "../types.js";
import { formatValue, isMissing, keyof, toNumber } from "../channel.js";
import { fadeGradient, INSIGHT_COLORS, withOpacity } from "./palette.js";
import type { ResolvedMark } from "./resolve.js";
import { coord, type PositionScale, type Scales } from "./scales.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
export type AnySeries = Record<string, any>;

export interface ItemHighlight {
  color?: string;
  /** Outline instead of recolouring (keeps the series colour visible). */
  border?: string;
  label?: string;
  size?: number;
}

export interface SeriesStyle {
  color?: string;
  opacity?: number;
  width?: number;
  dashed?: boolean;
}

export interface CompileContext {
  scales: Scales;
  facet: number;
  animation: boolean;
  /** Per-row item overrides from insights: markId → rowIndex → style. */
  highlights: Map<string, Map<number, ItemHighlight>>;
  /** Per-series overrides from insights: markId → series key → style. */
  seriesStyles: Map<string, Map<string | number | boolean | null, SeriesStyle>>;
  /** Series that should get a continuous-color visualMap: filled by compilers. */
  visualTargets: { seriesId: string; dimension: number }[];
  theme: "light" | "dark";
}

export interface CompiledMark {
  series: AnySeries[];
  /** Legend entries (names) contributed by this mark. */
  legend: string[];
  /** Preferred tooltip trigger. */
  tooltip: "axis" | "item";
}

interface SeriesGroup {
  key: string | number | boolean | null;
  value: Value | undefined;
  index: number[];
}

/** Split a facet's indices into series by the `z` channel (order of first appearance). */
export function groupSeries(rm: ResolvedMark, I: readonly number[]): SeriesGroup[] {
  const Z = rm.channels.z ?? rm.channels.fill ?? rm.channels.stroke;
  const colorIsContinuous = rm.channels.z === undefined && ((rm.channels.fill && isNumeric(rm.channels.fill)) || (rm.channels.stroke && isNumeric(rm.channels.stroke)));
  if (!Z || colorIsContinuous) return [{ key: null, value: undefined, index: I.slice() }];
  const groups = new Map<string | number | boolean | null, SeriesGroup>();
  for (const i of I) {
    const k = keyof(Z[i]);
    let g = groups.get(k);
    if (!g) groups.set(k, (g = { key: k, value: Z[i], index: [] }));
    g.index.push(i);
  }
  return [...groups.values()];
}

function isNumeric(v: Value[]): boolean {
  for (const x of v) {
    if (x === null || x === undefined) continue;
    return typeof x === "number";
  }
  return false;
}

const curveSmooth: Record<string, number | boolean> = { basis: 0.5, natural: 0.4, "catmull-rom": 0.5, "monotone-x": 0.3, "bump-x": 0.5, linear: false };
const curveStep: Record<string, string> = { step: "middle", "step-before": "start", "step-after": "end" };

function dashType(o: MarkOptions): "solid" | "dashed" | "dotted" | number[] {
  const d = o.strokeDasharray;
  if (!d) return "solid";
  if (Array.isArray(d)) return d;
  const parts = String(d).split(/[\s,]+/).map(Number);
  if (parts.length === 1) return parts[0] <= 2 ? "dotted" : "dashed";
  return parts;
}

function seriesName(rm: ResolvedMark, g: SeriesGroup): string {
  const o = rm.mark.options;
  if (g.value !== undefined) return formatValue(g.value);
  return o.name ?? rm.labels.y ?? rm.labels.x ?? rm.mark.id;
}

function colorFor(rm: ResolvedMark, g: SeriesGroup, ctx: CompileContext, prefer: "fill" | "stroke"): string | GradientSpec | undefined {
  const o = rm.mark.options;
  const c = rm.constants[prefer] ?? rm.constants[prefer === "fill" ? "stroke" : "fill"];
  if (c !== undefined) return c as string | GradientSpec;
  if (g.value !== undefined && ctx.scales.color.kind === "categorical") return ctx.scales.color.colorOf(g.value);
  if (o.id && rm.mark.generated) return undefined;
  return undefined;
}

function applySeriesStyle(series: AnySeries, rm: ResolvedMark, g: SeriesGroup, ctx: CompileContext): void {
  const st = ctx.seriesStyles.get(rm.mark.id)?.get(g.key);
  if (!st) return;
  if (st.color) {
    series.itemStyle = { ...(series.itemStyle ?? {}), color: st.color };
    if (series.lineStyle) series.lineStyle = { ...series.lineStyle, color: st.color };
    if (series.areaStyle) series.areaStyle = { ...series.areaStyle, color: st.color };
  }
  if (st.opacity !== undefined) {
    if (series.lineStyle) series.lineStyle = { ...series.lineStyle, opacity: st.opacity };
    if (series.areaStyle) series.areaStyle = { ...series.areaStyle, opacity: (series.areaStyle.opacity ?? 1) * st.opacity };
    series.itemStyle = { ...(series.itemStyle ?? {}), opacity: st.opacity };
  }
  if (st.width !== undefined && series.lineStyle) series.lineStyle = { ...series.lineStyle, width: st.width };
  if (st.dashed && series.lineStyle) series.lineStyle = { ...series.lineStyle, type: "dashed" };
  series.z = (series.z ?? 2) + (st.width ? 1 : 0);
}

function baseSeries(rm: ResolvedMark, g: SeriesGroup, ctx: CompileContext, idx: number): AnySeries {
  const o = rm.mark.options;
  return {
    id: `${rm.mark.id}:${ctx.facet}:${idx}`,
    name: seriesName(rm, g),
    xAxisIndex: ctx.facet,
    yAxisIndex: ctx.facet,
    z: 2 + (o.z2 ?? 0),
    silent: Boolean(o.silent),
    animation: ctx.animation,
    ...(o.tip === false || o.silent ? { tooltip: { show: false } } : {}),
    ...(o.echarts ?? {}),
  };
}

/** Row values for the tooltip: `title` and extra channels. */
function tooltipDims(rm: ResolvedMark): { names: string[]; values: Value[][] } {
  const names: string[] = [];
  const values: Value[][] = [];
  if (rm.channels.title) {
    names.push("title");
    values.push(rm.channels.title);
  }
  for (const [k, v] of Object.entries(rm.extra)) {
    names.push(k);
    values.push(v);
  }
  return { names, values };
}

function withHighlight(item: AnySeries | (number | string | null)[], rm: ResolvedMark, i: number, ctx: CompileContext): AnySeries | (number | string | null)[] {
  const h = ctx.highlights.get(rm.mark.id)?.get(i);
  if (!h) return item;
  const value = Array.isArray(item) ? item : item.value;
  const out: AnySeries = Array.isArray(item) ? { value } : { ...item };
  if (h.color) out.itemStyle = { ...(out.itemStyle ?? {}), color: h.color, borderColor: h.color };
  if (h.border) out.itemStyle = { ...(out.itemStyle ?? {}), borderColor: h.border, borderWidth: 2 };
  if (h.size) out.symbolSize = h.size;
  if (h.label) out.label = { show: true, formatter: h.label, position: "top", color: h.color ?? INSIGHT_COLORS.anomaly, fontWeight: "bold" };
  return out;
}

// ------------------------------------------------------------------ line ---

function compileLine(rm: ResolvedMark, I: number[], ctx: CompileContext): CompiledMark {
  const o = rm.mark.options;
  const { x: xs, y: ys } = ctx.scales;
  const X = rm.channels.x!;
  const Y = rm.channels.y!;
  const series: AnySeries[] = [];
  const legend: string[] = [];
  const colorDim = continuousColorDim(rm);
  groupSeries(rm, I).forEach((g, k) => {
    const color = colorFor(rm, g, ctx, "stroke");
    const data = g.index.map((i) => {
      const row: (number | string | null)[] = [coord(xs, X[i]), coord(ys, Y[i])];
      if (colorDim) row.push(toNumber(colorDim[i]));
      return withHighlight(row, rm, i, ctx);
    });
    const s: AnySeries = {
      ...baseSeries(rm, g, ctx, k),
      type: "line",
      data,
      showSymbol: Boolean(o.symbols) || data.length === 1,
      symbol: o.symbol ?? "circle",
      symbolSize: o.r !== undefined && typeof o.r === "number" ? o.r * 2 : 6,
      connectNulls: Boolean(o.connectNulls),
      lineStyle: { width: o.strokeWidth ?? 1.5, type: dashType(o), opacity: o.strokeOpacity ?? o.opacity ?? 1, ...(color ? { color } : {}) },
      itemStyle: color ? { color } : {},
      emphasis: { focus: "series" },
      smooth: o.curve ? (curveSmooth[o.curve] ?? false) : false,
      ...(o.curve && curveStep[o.curve] ? { step: curveStep[o.curve] } : {}),
      ...(data.length > 5000 ? { sampling: "lttb" } : {}),
    };
    if (o.gradient && color && typeof color === "string" && !colorDim) s.lineStyle.color = Array.isArray(o.gradient) ? horizontalGradient(o.gradient) : color;
    if (colorDim) ctx.visualTargets.push({ seriesId: s.id, dimension: 2 });
    applySeriesStyle(s, rm, g, ctx);
    series.push(s);
    if (!rm.mark.generated && o.legend !== false && (g.value !== undefined || o.name)) legend.push(s.name);
  });
  return { series, legend, tooltip: "axis" };
}

function continuousColorDim(rm: ResolvedMark): Value[] | undefined {
  if (rm.channels.z !== undefined) return undefined;
  const c = rm.channels.fill ?? rm.channels.stroke;
  return c && isNumeric(c) ? c : undefined;
}

function horizontalGradient(colors: string[]): GradientSpec {
  return { type: "linear", x: 0, y: 0, x2: 1, y2: 0, colorStops: colors.map((c, i) => ({ offset: colors.length === 1 ? 0 : i / (colors.length - 1), color: c })) };
}

// ------------------------------------------------------------------ area ---

/** Decide how to render stacked bands: native ECharts stacking or explicit base+band pairs. */
function stackMode(rm: ResolvedMark, groups: SeriesGroup[]): "native" | "bands" | "single" {
  const st = (rm.mark.options as Record<string, unknown>).__stacked as { offset: unknown; order?: unknown } | undefined;
  if (groups.length <= 1) return "single";
  if (!st) return "bands";
  if (st.offset === null || st.offset === undefined || st.offset === "normalize") {
    const order = st.order;
    if (order === undefined || order === null || order === "sum" || order === "appearance" || order === "inside-out" || Array.isArray(order)) return "native";
  }
  return "bands";
}

/** Sort groups by their stacking position so native stacks accumulate in the right order. */
function sortGroupsByBase(groups: SeriesGroup[], Y1: Value[]): SeriesGroup[] {
  const pos = (g: SeriesGroup) => {
    let s = 0;
    let n = 0;
    for (const i of g.index) {
      const v = toNumber(Y1[i]);
      if (Number.isFinite(v)) {
        s += Math.abs(v);
        n++;
      }
    }
    return n ? s / n : 0;
  };
  return groups.slice().sort((a, b) => pos(a) - pos(b));
}

function isZeroBase(Y1: Value[], index: number[]): boolean {
  for (const i of index) {
    const v = toNumber(Y1[i]);
    if (Number.isFinite(v) && Math.abs(v) > 1e-12) return false;
  }
  return true;
}

function compileArea(rm: ResolvedMark, I: number[], ctx: CompileContext, horizontal: boolean): CompiledMark {
  const o = rm.mark.options;
  const { x: xs, y: ys } = ctx.scales;
  // Position channel (x for areaY) and band channels (y1/y2 for areaY).
  const P = horizontal ? rm.channels.y! : rm.channels.x!;
  const B1 = horizontal ? rm.channels.x1 : rm.channels.y1;
  const B2 = horizontal ? (rm.channels.x2 ?? rm.channels.x) : (rm.channels.y2 ?? rm.channels.y);
  if (!B2) return { series: [], legend: [], tooltip: "axis" };
  const ps = horizontal ? ys : xs;
  const bs = horizontal ? xs : ys;
  let groups = groupSeries(rm, I);
  const mode = stackMode(rm, groups);
  if (mode === "native" && B1) groups = sortGroupsByBase(groups, B1);
  const multi = groups.length > 1;
  const series: AnySeries[] = [];
  const legend: string[] = [];
  const stroke = rm.constants.stroke;
  groups.forEach((g, k) => {
    const color = colorFor(rm, g, ctx, "fill");
    const fillOpacity = o.fillOpacity ?? o.opacity ?? (multi ? 0.85 : 0.35);
    const areaColor = o.gradient && typeof color === "string" ? (Array.isArray(o.gradient) ? verticalGradient(o.gradient) : fadeGradient(color, fillOpacity, 0.02)) : color;
    const pair = (i: number, v: Value) => (horizontal ? [coord(bs, v), coord(ps, P[i])] : [coord(ps, P[i]), coord(bs, v)]);
    const lineStyle = stroke ? { width: o.strokeWidth ?? 1, color: stroke, opacity: o.strokeOpacity ?? 1, type: dashType(o) } : { width: 0, opacity: 0 };
    const common = {
      type: "line",
      showSymbol: false,
      connectNulls: Boolean(o.connectNulls),
      smooth: o.curve ? (curveSmooth[o.curve] ?? false) : false,
      ...(o.curve && curveStep[o.curve] ? { step: curveStep[o.curve] } : {}),
      emphasis: { focus: "series" },
    };
    const zeroBase = !B1 || isZeroBase(B1, g.index);
    if (mode === "native" || zeroBase) {
      const data = g.index.map((i) => {
        const v2 = toNumber(B2[i]);
        const v1 = B1 ? toNumber(B1[i]) : 0;
        const h = mode === "native" ? (Number.isFinite(v2) && Number.isFinite(v1) ? v2 - v1 : NaN) : v2;
        return withHighlight(pair(i, Number.isFinite(h) ? h : null), rm, i, ctx);
      });
      const s: AnySeries = {
        ...baseSeries(rm, g, ctx, k),
        ...common,
        data,
        ...(mode === "native" ? { stack: rm.mark.id, stackStrategy: "samesign" } : {}),
        lineStyle: { ...lineStyle, ...(color && !stroke ? { color } : {}) },
        areaStyle: { color: areaColor, opacity: o.gradient ? 1 : fillOpacity, origin: "start" },
        itemStyle: color ? { color } : {},
      };
      applySeriesStyle(s, rm, g, ctx);
      series.push(s);
    } else {
      // Explicit band: transparent base at y1 plus a band of height y2 - y1 in a private stack.
      const stackId = `${rm.mark.id}:${ctx.facet}:${k}:band`;
      const base: AnySeries = {
        ...baseSeries(rm, g, ctx, k),
        ...common,
        id: `${rm.mark.id}:${ctx.facet}:${k}:base`,
        name: `${seriesName(rm, g)} (base)`,
        data: g.index.map((i) => pair(i, toNumber(B1![i]))),
        stack: stackId,
        stackStrategy: "all",
        lineStyle: { width: 0, opacity: 0 },
        itemStyle: { opacity: 0 },
        silent: true,
        tooltip: { show: false },
        emphasis: { disabled: true },
      };
      const band: AnySeries = {
        ...baseSeries(rm, g, ctx, k),
        ...common,
        data: g.index.map((i) => {
          const v1 = toNumber(B1![i]);
          const v2 = toNumber(B2[i]);
          const h = Number.isFinite(v1) && Number.isFinite(v2) ? v2 - v1 : NaN;
          return withHighlight(pair(i, Number.isFinite(h) ? h : null), rm, i, ctx);
        }),
        stack: stackId,
        stackStrategy: "all",
        lineStyle: { ...lineStyle, ...(color && !stroke ? { color } : {}) },
        areaStyle: { color: areaColor, opacity: o.gradient ? 1 : fillOpacity },
        itemStyle: color ? { color } : {},
      };
      applySeriesStyle(band, rm, g, ctx);
      series.push(base, band);
    }
    if (!rm.mark.generated && o.legend !== false && (g.value !== undefined || o.name)) legend.push(seriesName(rm, g));
  });
  return { series, legend, tooltip: "axis" };
}

function verticalGradient(colors: string[]): GradientSpec {
  return { type: "linear", x: 0, y: 0, x2: 0, y2: 1, colorStops: colors.map((c, i) => ({ offset: colors.length === 1 ? 0 : i / (colors.length - 1), color: c })) };
}

// ------------------------------------------------------------------- bar ---

function compileBar(rm: ResolvedMark, I: number[], ctx: CompileContext, horizontal: boolean): CompiledMark {
  const o = rm.mark.options;
  const { x: xs, y: ys } = ctx.scales;
  const P = horizontal ? rm.channels.y! : rm.channels.x!;
  const B1 = horizontal ? rm.channels.x1 : rm.channels.y1;
  const B2 = horizontal ? (rm.channels.x2 ?? rm.channels.x) : (rm.channels.y2 ?? rm.channels.y);
  const ps = horizontal ? ys : xs;
  const bs = horizontal ? xs : ys;
  if (!B2) return { series: [], legend: [], tooltip: "axis" };
  let groups = groupSeries(rm, I);
  const dodge = Boolean((o as Record<string, unknown>).dodge);
  const mode = dodge ? "single" : stackMode(rm, groups);
  if (mode === "native" && B1) groups = sortGroupsByBase(groups, B1);
  const series: AnySeries[] = [];
  const legend: string[] = [];
  const colorDim = continuousColorDim(rm);
  const bandsUsed = groups.some((g) => mode === "bands" && B1 && !isZeroBase(B1, g.index));
  const pair = (i: number, v: number | null) => (horizontal ? [v, coord(ps, P[i])] : [coord(ps, P[i]), v]);
  groups.forEach((g, k) => {
    const color = colorFor(rm, g, ctx, "fill");
    const zeroBase = !B1 || isZeroBase(B1, g.index);
    const label = o.label ? { show: true, position: horizontal ? "right" : "top", formatter: typeof o.label === "string" ? o.label : undefined } : undefined;
    const itemStyle: AnySeries = { ...(color ? { color } : {}), opacity: o.fillOpacity ?? o.opacity ?? 1, borderRadius: (o as Record<string, unknown>).borderRadius };
    if (rm.constants.stroke) {
      itemStyle.borderColor = rm.constants.stroke;
      itemStyle.borderWidth = o.strokeWidth ?? 1;
    }
    const common = { type: "bar", barCategoryGap: `${Math.round((ps.options.padding ?? 0.2) * 100)}%`, barMaxWidth: 80, ...(bandsUsed ? { barGap: "-100%" } : dodge ? { barGap: "10%" } : {}), label, itemStyle, emphasis: { focus: "series" } };
    if (mode === "native" || zeroBase || dodge) {
      const data = g.index.map((i) => {
        const v2 = toNumber(B2[i]);
        const v1 = B1 ? toNumber(B1[i]) : 0;
        const h = mode === "native" ? (Number.isFinite(v2) && Number.isFinite(v1) ? v2 - v1 : NaN) : v2;
        const row = pair(i, Number.isFinite(h) ? h : null);
        if (colorDim) row.push(toNumber(colorDim[i]));
        return withHighlight(row, rm, i, ctx);
      });
      const s: AnySeries = { ...baseSeries(rm, g, ctx, k), ...common, data, ...(mode === "native" ? { stack: rm.mark.id, stackStrategy: "samesign" } : {}) };
      if (colorDim) ctx.visualTargets.push({ seriesId: s.id, dimension: 2 });
      applySeriesStyle(s, rm, g, ctx);
      series.push(s);
    } else {
      const stackId = `${rm.mark.id}:${ctx.facet}:${k}:band`;
      const base: AnySeries = {
        ...baseSeries(rm, g, ctx, k),
        ...common,
        id: `${rm.mark.id}:${ctx.facet}:${k}:base`,
        name: `${seriesName(rm, g)} (base)`,
        data: g.index.map((i) => pair(i, Number.isFinite(toNumber(B1![i])) ? toNumber(B1![i]) : null)),
        stack: stackId,
        stackStrategy: "all",
        itemStyle: { color: "transparent", opacity: 0 },
        silent: true,
        tooltip: { show: false },
        emphasis: { disabled: true },
        label: undefined,
      };
      const seg: AnySeries = {
        ...baseSeries(rm, g, ctx, k),
        ...common,
        data: g.index.map((i) => {
          const v1 = toNumber(B1![i]);
          const v2 = toNumber(B2[i]);
          const h = Number.isFinite(v1) && Number.isFinite(v2) ? v2 - v1 : NaN;
          return withHighlight(pair(i, Number.isFinite(h) ? h : null), rm, i, ctx);
        }),
        stack: stackId,
        stackStrategy: "all",
      };
      applySeriesStyle(seg, rm, g, ctx);
      series.push(base, seg);
    }
    if (!rm.mark.generated && o.legend !== false && (g.value !== undefined || o.name)) legend.push(seriesName(rm, g));
  });
  return { series, legend, tooltip: "axis" };
}

// ------------------------------------------------------------------ rect ---

/** Rectangles with quantitative edges on both axes, drawn with a custom series. */
function compileRect(rm: ResolvedMark, I: number[], ctx: CompileContext): CompiledMark {
  const o = rm.mark.options;
  const { x: xs, y: ys } = ctx.scales;
  const X1 = rm.channels.x1;
  const X2 = rm.channels.x2;
  const Y1 = rm.channels.y1;
  const Y2 = rm.channels.y2 ?? rm.channels.y;
  const ordinalX = xs.type === "ordinal";
  const ordinalY = ys.type === "ordinal";
  // Degrade to bars when one axis is ordinal.
  if (ordinalX && !ordinalY && (X1 === undefined || X2 === undefined)) return compileBar(rm, I, ctx, false);
  if (ordinalY && !ordinalX && (Y1 === undefined || Y2 === undefined)) return compileBar(rm, I, ctx, true);
  if (!X1 || !X2 || !Y2) return { series: [], legend: [], tooltip: "item" };
  const colorDim = continuousColorDim(rm);
  const inset = o.inset ?? 0.5;
  const series: AnySeries[] = [];
  const legend: string[] = [];
  const { names: tipNames, values: tipValues } = tooltipDims(rm);
  groupSeries(rm, I).forEach((g, k) => {
    const color = colorFor(rm, g, ctx, "fill");
    const data = g.index.map((i) => {
      const row: AnySeries = {
        value: [
          coord(xs, X1[i]),
          coord(xs, X2[i]),
          Y1 ? (coord(ys, Y1[i]) ?? 0) : 0,
          coord(ys, Y2[i]),
          colorDim ? toNumber(colorDim[i]) : null,
          ...tipValues.map((v) => (isMissing(v[i]) ? null : formatValue(v[i]))),
        ],
      };
      const h = ctx.highlights.get(rm.mark.id)?.get(i);
      if (h?.color) row.itemStyle = { color: h.color };
      return row;
    });
    const s: AnySeries = {
      ...baseSeries(rm, g, ctx, k),
      type: "custom",
      data,
      encode: { x: [0, 1], y: [2, 3], tooltip: colorDim ? [4] : [3], ...(tipNames.length ? { itemName: 5 } : {}) },
      dimensions: ["x1", "x2", "y1", "y2", rm.labels.fill ?? "value", ...tipNames],
      itemStyle: { ...(color ? { color } : {}), opacity: o.fillOpacity ?? o.opacity ?? 1, ...(rm.constants.stroke ? { borderColor: rm.constants.stroke, borderWidth: o.strokeWidth ?? 1 } : {}) },
      clip: true,
      renderItem: makeRectRenderer(inset, Boolean(colorDim)),
      emphasis: { focus: "series" },
    };
    if (colorDim) ctx.visualTargets.push({ seriesId: s.id, dimension: 4 });
    applySeriesStyle(s, rm, g, ctx);
    series.push(s);
    if (!rm.mark.generated && o.legend !== false && (g.value !== undefined || o.name)) legend.push(s.name);
  });
  return { series, legend, tooltip: "item" };
}

function makeRectRenderer(inset: number, visual: boolean) {
  return (params: any, api: any) => {
    const x1 = api.value(0);
    const x2 = api.value(1);
    const y1 = api.value(2);
    const y2 = api.value(3);
    if ([x1, x2, y1, y2].some((v: unknown) => v === null || v === undefined || Number.isNaN(v))) return null;
    const a = api.coord([x1, y2]);
    const b = api.coord([x2, y1]);
    const left = Math.min(a[0], b[0]) + inset;
    const top = Math.min(a[1], b[1]) + inset;
    const width = Math.max(0, Math.abs(b[0] - a[0]) - 2 * inset);
    const height = Math.max(0, Math.abs(b[1] - a[1]) - 2 * inset);
    const style = { fill: api.visual("color"), opacity: api.visual("opacity") ?? 1, stroke: api.visual("borderColor"), lineWidth: api.visual("borderWidth") ?? 0 };
    void visual;
    return { type: "rect", shape: { x: left, y: top, width, height }, style, emphasis: { style: { opacity: 0.8 } } };
  };
}

// ------------------------------------------------------------------ cell ---

function compileCell(rm: ResolvedMark, I: number[], ctx: CompileContext): CompiledMark {
  const o = rm.mark.options;
  const { x: xs, y: ys } = ctx.scales;
  const X = rm.channels.x!;
  const Y = rm.channels.y!;
  const fill = rm.channels.fill ?? rm.channels.stroke;
  const continuous = fill && isNumeric(fill);
  const constant = rm.constants.fill;
  const { names: tipNames, values: tipValues } = tooltipDims(rm);
  const data = I.map((i) => {
    const row: AnySeries = { value: [coord(xs, X[i]), coord(ys, Y[i]), fill ? (continuous ? toNumber(fill[i]) : formatValue(fill[i])) : 1, ...tipValues.map((v) => formatValue(v[i]))] };
    if (fill && !continuous) row.itemStyle = { color: ctx.scales.color.colorOf(fill[i]) };
    else if (constant) row.itemStyle = { color: constant };
    const h = ctx.highlights.get(rm.mark.id)?.get(i);
    if (h?.color) row.itemStyle = { ...(row.itemStyle ?? {}), borderColor: h.color, borderWidth: 2 };
    return row;
  });
  const g: SeriesGroup = { key: null, value: undefined, index: I };
  const s: AnySeries = {
    ...baseSeries(rm, g, ctx, 0),
    type: "heatmap",
    data,
    dimensions: ["x", "y", rm.labels.fill ?? "value", ...tipNames],
    encode: { x: 0, y: 1, value: 2, tooltip: [2, ...tipNames.map((_, j) => 3 + j)] },
    label: o.label ? { show: true, formatter: (p: any) => formatValue(p.value[2]) } : { show: false },
    itemStyle: { borderColor: ctx.theme === "dark" ? "#111" : "#fff", borderWidth: o.inset ?? 1, opacity: o.fillOpacity ?? o.opacity ?? 1 },
    emphasis: { itemStyle: { shadowBlur: 6, shadowColor: "rgba(0,0,0,0.3)" } },
  };
  if (continuous) ctx.visualTargets.push({ seriesId: s.id, dimension: 2 });
  return { series: [s], legend: [], tooltip: "item" };
}

// ------------------------------------------------------------------- dot ---

function compileDot(rm: ResolvedMark, I: number[], ctx: CompileContext): CompiledMark {
  const o = rm.mark.options;
  const { x: xs, y: ys, r } = ctx.scales;
  const X = rm.channels.x;
  const Y = rm.channels.y;
  if (!X && !Y) return { series: [], legend: [], tooltip: "item" };
  const R = rm.channels.r;
  const colorDim = continuousColorDim(rm);
  const { names: tipNames, values: tipValues } = tooltipDims(rm);
  const series: AnySeries[] = [];
  const legend: string[] = [];
  groupSeries(rm, I).forEach((g, k) => {
    const color = colorFor(rm, g, ctx, "fill") ?? colorFor(rm, g, ctx, "stroke");
    const data = g.index.map((i) => {
      const row: AnySeries = {
        value: [X ? coord(xs, X[i]) : 0, Y ? coord(ys, Y[i]) : 0, R ? toNumber(R[i]) : null, colorDim ? toNumber(colorDim[i]) : null, ...tipValues.map((v) => (isMissing(v[i]) ? null : formatValue(v[i])))],
      };
      return withHighlight(row, rm, i, ctx);
    });
    const constR = typeof o.r === "number" ? o.r : undefined;
    const s: AnySeries = {
      ...baseSeries(rm, g, ctx, k),
      type: "scatter",
      data,
      dimensions: ["x", "y", rm.labels.r ?? "r", rm.labels.fill ?? rm.labels.stroke ?? "color", ...tipNames],
      encode: { x: 0, y: 1, tooltip: [0, 1, ...(R ? [2] : []), ...(colorDim ? [3] : []), ...tipNames.map((_, j) => 4 + j)] },
      symbol: o.symbol ?? "circle",
      symbolSize: R ? (value: any) => r.sizeOf(value[2]) * 2 : (constR ?? 3) * 2,
      itemStyle: {
        ...(color ? { color } : {}),
        opacity: o.fillOpacity ?? o.opacity ?? (rm.constants.fill === "none" ? 1 : 0.85),
        ...(rm.constants.stroke ? { borderColor: rm.constants.stroke, borderWidth: o.strokeWidth ?? 1 } : {}),
        ...(rm.constants.fill === "none" ? { color: "transparent", borderColor: typeof color === "string" ? color : undefined, borderWidth: o.strokeWidth ?? 1.5 } : {}),
      },
      emphasis: { focus: "series", scale: 1.4 },
      ...(data.length > 5000 ? { large: true, largeThreshold: 5000 } : {}),
    };
    if (colorDim) ctx.visualTargets.push({ seriesId: s.id, dimension: 3 });
    applySeriesStyle(s, rm, g, ctx);
    series.push(s);
    if (!rm.mark.generated && o.legend !== false && (g.value !== undefined || o.name)) legend.push(s.name);
  });
  return { series, legend, tooltip: "item" };
}

// ------------------------------------------------------------------ rule ---

function compileRule(rm: ResolvedMark, I: number[], ctx: CompileContext, vertical: boolean): CompiledMark {
  const o = rm.mark.options;
  const { x: xs, y: ys } = ctx.scales;
  const P = vertical ? rm.channels.x : rm.channels.y; // position of the rule
  const S1 = vertical ? rm.channels.y1 : rm.channels.x1;
  const S2 = vertical ? (rm.channels.y2 ?? rm.channels.y) : (rm.channels.x2 ?? rm.channels.x);
  if (!P) return { series: [], legend: [], tooltip: "axis" };
  const ps = vertical ? xs : ys;
  const ss = vertical ? ys : xs;
  const T = rm.channels.text ?? rm.channels.title;
  const color = rm.constants.stroke ?? rm.constants.fill ?? (rm.channels.stroke && ctx.scales.color.kind === "categorical" ? undefined : ctx.theme === "dark" ? "#aaa" : "#555");
  const lineStyle = { width: o.strokeWidth ?? 1, type: dashType(o), opacity: o.strokeOpacity ?? o.opacity ?? 1, ...(color ? { color } : {}) };
  const g: SeriesGroup = { key: null, value: undefined, index: I };
  if (S2 === undefined && S1 === undefined) {
    // Full-span rules → markLine on a helper series.
    const data = I.map((i) => {
      const v = coord(ps, P[i]);
      if (v === null) return null;
      const c = rm.channels.stroke ? ctx.scales.color.colorOf(rm.channels.stroke[i]) : undefined;
      const item: AnySeries = vertical ? { xAxis: v } : { yAxis: v };
      if (T && !isMissing(T[i])) item.label = { show: true, formatter: formatValue(T[i]), position: vertical ? "insideEndTop" : "insideEndTop" };
      if (c) item.lineStyle = { color: c };
      return item;
    }).filter(Boolean);
    const s: AnySeries = {
      ...baseSeries(rm, g, ctx, 0),
      type: "line",
      data: [],
      silent: true,
      tooltip: { show: false },
      markLine: { silent: true, symbol: "none", animation: ctx.animation, lineStyle, label: { show: Boolean(T), fontSize: 11 }, data, z: 2 + (o.z2 ?? 0) },
    };
    return { series: [s], legend: [], tooltip: "axis" };
  }
  // Segments → custom series lines.
  const data = I.map((i) => {
    const p = coord(ps, P[i]);
    const a = S1 ? coord(ss, S1[i]) : 0;
    const b = coord(ss, S2![i]);
    return { value: vertical ? [p, a, b] : [a, b, p], ...(T && !isMissing(T[i]) ? { name: formatValue(T[i]) } : {}) };
  });
  const s: AnySeries = {
    ...baseSeries(rm, g, ctx, 0),
    type: "custom",
    data,
    encode: vertical ? { x: 0, y: [1, 2] } : { x: [0, 1], y: 2 },
    clip: true,
    renderItem: (_params: any, api: any) => {
      const v = [api.value(0), api.value(1), api.value(2)];
      if (v.some((x: unknown) => x === null || Number.isNaN(x))) return null;
      const p1 = vertical ? api.coord([v[0], v[1]]) : api.coord([v[0], v[2]]);
      const p2 = vertical ? api.coord([v[0], v[2]]) : api.coord([v[1], v[2]]);
      return { type: "line", shape: { x1: p1[0], y1: p1[1], x2: p2[0], y2: p2[1] }, style: { stroke: lineStyle.color ?? api.visual("color"), lineWidth: lineStyle.width, opacity: lineStyle.opacity, lineDash: lineStyle.type === "dashed" ? [6, 4] : lineStyle.type === "dotted" ? [2, 3] : Array.isArray(lineStyle.type) ? lineStyle.type : undefined, fill: "none" } };
    },
    itemStyle: { opacity: lineStyle.opacity },
  };
  return { series: [s], legend: [], tooltip: "item" };
}

// ------------------------------------------------------------------ text ---

function compileText(rm: ResolvedMark, I: number[], ctx: CompileContext): CompiledMark {
  const o = rm.mark.options;
  const { x: xs, y: ys } = ctx.scales;
  const X = rm.channels.x;
  const Y = rm.channels.y;
  const T = rm.channels.text!;
  const color = rm.constants.fill ?? rm.constants.stroke;
  const data = I.filter((i) => !isMissing(T[i])).map((i) => ({
    value: [X ? coord(xs, X[i]) : 0, Y ? coord(ys, Y[i]) : 0],
    label: { formatter: typeof o.label === "function" ? o.label(rm.data[i], i) : formatValue(T[i]) },
    ...(rm.channels.fill ? { itemStyle: { color: ctx.scales.color.colorOf(rm.channels.fill[i]) } } : {}),
  }));
  const g: SeriesGroup = { key: null, value: undefined, index: I };
  const s: AnySeries = {
    ...baseSeries(rm, g, ctx, 0),
    type: "scatter",
    data,
    symbolSize: 1,
    silent: o.silent ?? true,
    tooltip: { show: false },
    itemStyle: { color: "transparent" },
    label: {
      show: true,
      position: (o as Record<string, unknown>).position ?? "top",
      offset: [o.dx ?? 0, o.dy ?? 0],
      fontSize: (o as Record<string, unknown>).fontSize ?? 11,
      color: color ?? (ctx.theme === "dark" ? "#eee" : "#333"),
      fontWeight: (o as Record<string, unknown>).fontWeight,
      textBorderColor: ctx.theme === "dark" ? "rgba(0,0,0,0.6)" : "rgba(255,255,255,0.8)",
      textBorderWidth: 2,
    },
    labelLayout: { hideOverlap: true },
  };
  return { series: [s], legend: [], tooltip: "item" };
}

// ------------------------------------------------------------ difference ---

function compileDifference(rm: ResolvedMark, I: number[], ctx: CompileContext): CompiledMark {
  const o = rm.mark.options as MarkOptions & { positiveFill?: string; negativeFill?: string; positiveFillOpacity?: number; negativeFillOpacity?: number };
  const { x: xs, y: ys } = ctx.scales;
  const X1 = rm.channels.x1!;
  const X2 = rm.channels.x2!;
  const Y1 = rm.channels.y1!;
  const Y2 = rm.channels.y2!;
  const series: AnySeries[] = [];
  const positive = o.positiveFill ?? INSIGHT_COLORS.positive;
  const negative = o.negativeFill ?? INSIGHT_COLORS.negative;
  const fillOpacity = o.fillOpacity ?? 0.5;
  groupSeries(rm, I).forEach((g, k) => {
    // Comparison series resampled onto the metric's x positions (needed for shiftX).
    const xm = g.index.map((i) => toNumber(X2[i]));
    const ym = g.index.map((i) => toNumber(Y2[i]));
    const cmpPts = g.index.map((i) => [toNumber(X1[i]), toNumber(Y1[i])] as [number, number]).filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1])).sort((a, b) => a[0] - b[0]);
    const sameX = g.index.every((i) => toNumber(X1[i]) === toNumber(X2[i]));
    const yc = sameX ? g.index.map((i) => toNumber(Y1[i])) : xm.map((x) => interpolate(cmpPts, x));
    // Insert crossing points so the fills meet exactly where the lines cross.
    const px: number[] = [];
    const pm: number[] = [];
    const pc: number[] = [];
    for (let j = 0; j < xm.length; j++) {
      if (j > 0) {
        const d0 = ym[j - 1] - yc[j - 1];
        const d1 = ym[j] - yc[j];
        if (Number.isFinite(d0) && Number.isFinite(d1) && d0 * d1 < 0) {
          const t = d0 / (d0 - d1);
          px.push(xm[j - 1] + t * (xm[j] - xm[j - 1]));
          const yv = ym[j - 1] + t * (ym[j] - ym[j - 1]);
          pm.push(yv);
          pc.push(yv);
        }
      }
      px.push(xm[j]);
      pm.push(ym[j]);
      pc.push(yc[j]);
    }
    const asCoord = (v: number) => (xs.type === "temporal" || xs.type === "quantitative" ? v : coord(xs, X2[g.index[0]]));
    const mk = (name: string, base: number[], height: number[], color: string, opacity: number, idx: string): AnySeries[] => {
      const stackId = `${rm.mark.id}:${ctx.facet}:${k}:${idx}`;
      const common = { type: "line", showSymbol: false, xAxisIndex: ctx.facet, yAxisIndex: ctx.facet, animation: ctx.animation, stack: stackId, stackStrategy: "all", silent: true, tooltip: { show: false }, emphasis: { disabled: true }, z: 1 };
      return [
        { ...common, id: `${stackId}:base`, name: `${name} base`, data: px.map((x, j) => [asCoord(x), Number.isFinite(base[j]) ? base[j] : null]), lineStyle: { width: 0, opacity: 0 }, itemStyle: { opacity: 0 } },
        { ...common, id: `${stackId}:band`, name, data: px.map((x, j) => [asCoord(x), Number.isFinite(height[j]) ? height[j] : null]), lineStyle: { width: 0, opacity: 0 }, areaStyle: { color, opacity }, itemStyle: { color } },
      ];
    };
    const posBase = pc.map((c, j) => Math.min(c, pm[j]));
    const posH = pm.map((m, j) => Math.max(0, m - pc[j]));
    const negBase = pm.map((m, j) => Math.min(m, pc[j]));
    const negH = pc.map((c, j) => Math.max(0, c - pm[j]));
    series.push(...mk("positive", pc.map((c, j) => (Number.isFinite(posBase[j]) ? posBase[j] : c)), posH, positive, o.positiveFillOpacity ?? fillOpacity, "pos"));
    series.push(...mk("negative", negBase, negH, negative, o.negativeFillOpacity ?? fillOpacity, "neg"));
    const stroke = rm.constants.stroke ?? (ctx.theme === "dark" ? "#eee" : "#222");
    series.push({
      ...baseSeries(rm, g, ctx, k),
      type: "line",
      data: xm.map((x, j) => [asCoord(x), Number.isFinite(ym[j]) ? ym[j] : null]),
      showSymbol: false,
      lineStyle: { width: o.strokeWidth ?? 1.5, color: stroke, opacity: o.strokeOpacity ?? 1 },
      itemStyle: { color: stroke },
      emphasis: { focus: "series" },
    });
    if (!sameX || o.stroke === undefined) {
      series.push({
        ...baseSeries(rm, g, ctx, k),
        id: `${rm.mark.id}:${ctx.facet}:${k}:cmp`,
        name: `${seriesName(rm, g)} (comparison)`,
        type: "line",
        data: xm.map((x, j) => [asCoord(x), Number.isFinite(yc[j]) ? yc[j] : null]),
        showSymbol: false,
        lineStyle: { width: 1, color: stroke, opacity: 0.35, type: "dashed" },
        itemStyle: { color: stroke },
        tooltip: { show: false },
        silent: true,
      });
    }
  });
  return { series, legend: [], tooltip: "axis" };
}

function interpolate(pts: [number, number][], x: number): number {
  if (pts.length === 0 || !Number.isFinite(x)) return NaN;
  if (x < pts[0][0] || x > pts[pts.length - 1][0]) return NaN;
  let lo = 0;
  let hi = pts.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (pts[mid][0] <= x) lo = mid;
    else hi = mid;
  }
  const [x0, y0] = pts[lo];
  const [x1, y1] = pts[hi];
  if (x1 === x0) return y0;
  return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
}

// ---------------------------------------------------------------- driver ---

export function compileMark(rm: ResolvedMark, facet: number, ctx: CompileContext): CompiledMark {
  const I = rm.facets[facet] ?? [];
  const type = rm.mark.type;
  const c = { ...ctx, facet };
  switch (type) {
    case "line":
    case "lineY":
    case "lineX":
      return rm.channels.x && rm.channels.y ? compileLine(rm, I, c) : empty();
    case "area":
    case "areaY":
      return compileArea(rm, I, c, false);
    case "areaX":
      return compileArea(rm, I, c, true);
    case "barY":
      return compileBar(rm, I, c, false);
    case "barX":
      return compileBar(rm, I, c, true);
    case "rectY":
    case "rectX":
    case "rect":
      return compileRect(rm, I, c);
    case "cell":
      return compileCell(rm, I, c);
    case "dot":
      return compileDot(rm, I, c);
    case "ruleX":
      return compileRule(rm, I, c, true);
    case "ruleY":
      return compileRule(rm, I, c, false);
    case "text":
      return compileText(rm, I, c);
    case "differenceY":
    case "differenceX":
      return compileDifference(rm, I, c);
    default:
      return empty();
  }
}

function empty(): CompiledMark {
  return { series: [], legend: [], tooltip: "axis" };
}

/** Used by facets/axes: does this mark draw bars (needs `boundaryGap`)? */
export function isBarLike(mark: Mark): boolean {
  return mark.type === "barY" || mark.type === "barX" || mark.type === "cell" || mark.type === "rectY" || mark.type === "rectX";
}

export { withOpacity };
export type { Color };
