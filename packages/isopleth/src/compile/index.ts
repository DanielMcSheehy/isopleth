/** `plot()`: marks → resolved marks → insights → scales → ECharts option. */

import type { EChartsOption } from "echarts";
import type { Insight, Mark, PlotOptions, ScaleOptions, Value } from "../types.js";
import { formatValue, toNumber } from "../channel.js";
import { getBackend } from "../backend/index.js";
import { kernels } from "../backend/js/index.js";
import { maybeInterval } from "../interval.js";
import { flattenMarks } from "../marks.js";
import { applyInsights } from "../insights/index.js";
import { planFacets, resolveMark, type FacetPlan, type ResolvedMark } from "./resolve.js";
import { inferScales, type PositionScale, type Scales } from "./scales.js";
import { compileMark, isBarLike, type AnySeries, type CompileContext } from "./series.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface Compiled {
  option: EChartsOption;
  insights: Insight[];
  warnings: string[];
  scales: Scales;
  marks: Mark[];
  resolved: ResolvedMark[];
  plan: FacetPlan;
  theme: "light" | "dark";
}

export function compile(options: PlotOptions): Compiled {
  const userMarks = flattenMarks(options.marks);
  const plan = planFacets(userMarks, options);
  const resolved = userMarks.map((m) => resolveMark(m, plan, options));
  const theme: "light" | "dark" = options.theme === "dark" ? "dark" : "light";

  // Insights add marks; resolve those too so scales include forecasts/bands.
  const ins = applyInsights(resolved, plan, options);
  const generated = ins.marks.map((m) => resolveMark(m, plan, options));
  const all = [...resolved, ...generated].filter((rm) => !["frame", "gridX", "gridY"].includes(rm.mark.type));
  // Draw order: generated bands (z2 < 0) first, then user marks, then generated overlays.
  all.sort((a, b) => (a.mark.options.z2 ?? 0) - (b.mark.options.z2 ?? 0));

  const scales = inferScales(all, plan.keys.length, options);
  const nFacets = plan.keys.length;
  const ctx: CompileContext = { scales, facet: 0, animation: options.animation ?? true, highlights: ins.highlights, seriesStyles: ins.seriesStyles, visualTargets: [], theme };

  const series: AnySeries[] = [];
  const legendNames: string[] = [];
  let tooltipVotes = { axis: 0, item: 0 };
  for (let f = 0; f < nFacets; f++) {
    for (const rm of all) {
      const c = compileMark(rm, f, ctx);
      series.push(...c.series);
      for (const n of c.legend) if (!legendNames.includes(n)) legendNames.push(n);
      if (f === 0 && !rm.mark.generated && c.series.length) tooltipVotes = { ...tooltipVotes, [c.tooltip]: tooltipVotes[c.tooltip] + 1 };
    }
  }

  const notes = options.insights?.annotate === false ? [] : ins.notes;
  const subtitleLines = wrapNotes([options.subtitle, ...notes].filter(Boolean) as string[], 120);
  const hasLegend = !(options.legend === false || legendNames.length === 0);
  const hasSlider = [scales.x.options.zoom, scales.y.options.zoom].some((z) => z === true || z === "slider");
  const hasColorBar = scales.color.kind === "continuous" && scales.color.legend && ctx.visualTargets.length > 0;
  const layout = facetLayout(plan, options, { legend: hasLegend, slider: hasSlider, colorBar: hasColorBar, titleLines: (options.title ? 1 : 0) + subtitleLines.length });
  const xAxes = plan.keys.map((_, f) => axisOption("x", scales.x, f, plan, options, userMarks, theme));
  const yAxes = plan.keys.map((_, f) => axisOption("y", scales.y, f, plan, options, userMarks, theme));
  const hasFrame = userMarks.some((m) => m.type === "frame");
  for (const ax of [...xAxes, ...yAxes]) if (hasFrame) ax.axisLine = { ...(ax.axisLine ?? {}), show: true };
  if (userMarks.some((m) => m.type === "gridX")) for (const ax of xAxes) ax.splitLine = { show: true };
  if (userMarks.some((m) => m.type === "gridY")) for (const ax of yAxes) ax.splitLine = { show: true };

  const tooltipTrigger = options.tooltip === "item" ? "item" : options.tooltip === "axis" ? "axis" : tooltipVotes.item > tooltipVotes.axis ? "item" : "axis";
  const titles: any[] = [];
  const subtitle = subtitleLines.join("\n");
  if (options.title || subtitle) titles.push({ text: options.title, subtext: subtitle || undefined, left: 8, top: 4, textStyle: { fontSize: 15 }, subtextStyle: { fontSize: 11, lineHeight: 15 } });
  if (options.caption) titles.push({ text: options.caption, left: 8, bottom: 0, textStyle: { fontSize: 11, fontWeight: "normal", color: theme === "dark" ? "#aaa" : "#666" } });
  if (nFacets > 1) {
    plan.keys.forEach((k, f) => {
      const g = layout.grids[f];
      const label = [k.fx, k.fy].filter((v) => v !== undefined).map((v) => formatValue(v)).join(" / ");
      titles.push({ text: label, left: g.left, top: `${Math.max(0, parseFloat(g.top) - 4).toFixed(3)}%`, textStyle: { fontSize: 11, fontWeight: "normal" } });
    });
  }

  const visualMap = buildVisualMaps(ctx, series, scales, theme, hasLegend);
  const dataZoom = buildDataZoom(scales, nFacets, hasLegend);
  const legendOpt = !hasLegend ? { show: false } : { show: true, data: legendNames, bottom: options.caption ? 16 : 0, type: legendNames.length > 12 ? "scroll" : "plain", ...(typeof options.legend === "object" ? options.legend : {}) };
  const tooltip =
    options.tooltip === false
      ? { show: false }
      : {
          trigger: tooltipTrigger,
          confine: true,
          axisPointer: { type: tooltipTrigger === "axis" ? "cross" : "line", snap: true, label: { show: tooltipTrigger === "axis" } },
          valueFormatter: (v: unknown) => (Array.isArray(v) ? v.map((x) => formatValue(x as Value)).join(", ") : formatValue(v as Value)),
          ...(typeof options.tooltip === "object" ? options.tooltip : {}),
        };

  const option: EChartsOption = {
    animation: options.animation ?? true,
    backgroundColor: options.background ?? "transparent",
    ...(scales.color.kind === "categorical" ? { color: scales.color.range } : {}),
    title: titles,
    grid: layout.grids.map((g) => ({ ...g, containLabel: false, outerBoundsMode: "auto" })),
    xAxis: xAxes,
    yAxis: yAxes,
    series: series as any,
    legend: legendOpt as any,
    tooltip: tooltip as any,
    ...(visualMap.length ? { visualMap: visualMap as any } : {}),
    ...(dataZoom.length ? { dataZoom: dataZoom as any } : {}),
    ...(options.toolbox ? { toolbox: { feature: { saveAsImage: {}, dataZoom: {}, restore: {} }, right: 8 } } : {}),
    ...(nFacets > 1 ? { axisPointer: { link: [{ xAxisIndex: "all" }] } } : {}),
  };
  const merged = options.echarts ? deepMerge(option as Record<string, unknown>, options.echarts as Record<string, unknown>) : option;
  return { option: merged as EChartsOption, insights: ins.insights, warnings: ins.warnings, scales, marks: [...userMarks, ...ins.marks], resolved: all, plan, theme };
}

/** Join notes with separators, wrapping onto new lines past `width` characters. */
function wrapNotes(notes: string[], width: number): string[] {
  const lines: string[] = [];
  let cur = "";
  for (const n of notes) {
    if (cur && (cur + " · " + n).length > width) {
      lines.push(cur);
      cur = n;
    } else cur = cur ? `${cur} · ${n}` : n;
  }
  if (cur) lines.push(cur);
  return lines;
}

// -------------------------------------------------------------- layout ---

interface GridBox {
  left: string;
  top: string;
  width?: string;
  height?: string;
  right?: string;
  bottom?: string;
}

interface LayoutNeeds {
  legend: boolean;
  slider: boolean;
  colorBar: boolean;
  titleLines: number;
}

function facetLayout(plan: FacetPlan, options: PlotOptions, needs: LayoutNeeds): { grids: GridBox[] } {
  const cols = Math.max(1, plan.xs.length || 1);
  const rows = Math.max(1, plan.ys.length || 1);
  const multi = plan.keys.length > 1;
  const m = typeof options.margin === "number" ? { top: options.margin, right: options.margin, bottom: options.margin, left: options.margin } : (options.margin ?? {});
  const hasTitle = needs.titleLines > 0;
  const bottomExtra = (needs.legend ? 24 : 0) + (needs.slider ? 30 : 0) + (options.caption ? 16 : 0);
  if (!multi) {
    const topPad = m.top ?? (hasTitle ? 24 + needs.titleLines * 16 : 20);
    const bottomPad = m.bottom ?? 48 + bottomExtra;
    const leftPad = m.left ?? 56;
    const rightPad = m.right ?? (needs.colorBar ? 90 : 20);
    return { grids: [{ left: `${leftPad}px`, top: `${topPad}px`, right: `${rightPad}px`, bottom: `${bottomPad}px` }] };
  }
  // Facets: ECharts positions are px or %, so small multiples use percentages.
  const leftP = typeof m.left === "number" ? m.left : 7;
  const rightP = typeof m.right === "number" ? m.right : needs.colorBar ? 12 : 3;
  const topP = typeof m.top === "number" ? m.top : hasTitle ? 10 + needs.titleLines * 4 : 8;
  const bottomP = typeof m.bottom === "number" ? m.bottom : 12 + (needs.legend ? 5 : 0) + (needs.slider ? 7 : 0);
  const gapX = options.facet?.gap ?? 4;
  const gapY = options.facet?.gap ?? 9;
  const colW = (100 - leftP - rightP - gapX * (cols - 1)) / cols;
  const rowH = (100 - topP - bottomP - gapY * (rows - 1)) / rows;
  const grids: GridBox[] = [];
  const pct = (v: number) => `${v.toFixed(3)}%`;
  for (const key of plan.keys) {
    const col = plan.xs.length ? plan.xs.findIndex((v) => v === key.fx) : 0;
    const row = plan.ys.length ? plan.ys.findIndex((v) => v === key.fy) : 0;
    grids.push({ left: pct(leftP + col * (colW + gapX)), top: pct(topP + row * (rowH + gapY)), width: pct(colW), height: pct(rowH) });
  }
  return { grids };
}

// ---------------------------------------------------------------- axes ---

function axisOption(axis: "x" | "y", scale: PositionScale, f: number, plan: FacetPlan, options: PlotOptions, marks: Mark[], theme: "light" | "dark"): any {
  const o: ScaleOptions = scale.options;
  const cols = Math.max(1, plan.xs.length || 1);
  const rows = Math.max(1, plan.ys.length || 1);
  const col = f % cols;
  const row = Math.floor(f / cols);
  const isEdge = axis === "x" ? row === rows - 1 : col === 0;
  const barLike = marks.some(isBarLike);
  const shared = axis === "x" ? options.facet?.sharedX !== false : options.facet?.sharedY !== false;
  const out: any = {
    gridIndex: f,
    type: scale.type === "ordinal" ? "category" : scale.type === "temporal" ? "time" : scale.log ? "log" : "value",
    show: o.axis !== null,
    name: isEdge ? scale.label : undefined,
    nameLocation: "middle",
    nameGap: axis === "x" ? 26 : 36,
    nameTextStyle: { fontSize: 11, color: theme === "dark" ? "#bbb" : "#555" },
    axisLabel: { hideOverlap: true, fontSize: 11, showMaxLabel: undefined },
    splitLine: { show: o.grid ?? (axis === "y" && scale.type !== "ordinal"), lineStyle: { opacity: 0.35, type: "dashed" } },
    axisTick: { show: scale.type === "ordinal", alignWithLabel: true },
    axisLine: { show: scale.type === "ordinal" || axis === "x" },
    inverse: Boolean(o.reverse),
  };
  if (scale.type === "ordinal") {
    out.data = scale.domain.map((v) => (v instanceof Date ? v.toISOString() : String(v)));
    out.boundaryGap = barLike;
    if (o.jitter) out.jitter = o.jitter;
    if (scale.domain.length <= 30) out.axisLabel.interval = 0;
    if (scale.domain.length > 12 && axis === "x") out.axisLabel.rotate = scale.domain.length > 30 ? 60 : 35;
  } else {
    if (!scale.zero) out.scale = true;
    if (scale.type === "temporal") out.axisLabel.formatter = typeof o.tickFormat === "string" ? o.tickFormat : undefined;
    if (o.breaks) out.breaks = o.breaks.map((b) => ({ start: b.start, end: b.end, gap: b.gap ?? "2%" }));
    if (scale.percent) out.axisLabel.formatter = (v: number) => `${Math.round(v * 100)}%`;
    const nice = scale.options.nice !== false;
    const extent = shared ? scale.extent : (scale.facetExtents[f] ?? scale.extent);
    if (plan.keys.length > 1 && shared && Number.isFinite(extent[0]) && Number.isFinite(extent[1]) && scale.type === "quantitative") {
      const [lo, hi] = nice ? kernels.nice(scale.zero ? Math.min(0, extent[0]) : extent[0], scale.zero ? Math.max(0, extent[1]) : extent[1], 6) : extent;
      out.min = lo;
      out.max = hi;
    }
    if (o.domain && o.domain.length === 2) {
      out.min = toNumber(o.domain[0] as Value);
      out.max = toNumber(o.domain[1] as Value);
    }
    if (typeof o.ticks === "number") out.splitNumber = o.ticks;
    else if (o.ticks !== undefined && scale.type === "quantitative") {
      const iv = maybeInterval(o.ticks);
      if (iv) out.interval = iv.offset(0, 1);
    }
  }
  if (typeof o.tickFormat === "function") {
    const fmt = o.tickFormat;
    out.axisLabel.formatter = (v: Value) => fmt(scale.type === "temporal" ? new Date(toNumber(v)) : v);
  } else if (typeof o.tickFormat === "string" && scale.type !== "temporal") out.axisLabel.formatter = o.tickFormat;
  if (o.axis === "top" || o.axis === "right") out.position = o.axis;
  return out;
}

// ----------------------------------------------------------- visual map ---

function buildVisualMaps(ctx: CompileContext, series: AnySeries[], scales: Scales, theme: "light" | "dark", hasLegend: boolean): any[] {
  void hasLegend;
  if (ctx.visualTargets.length === 0 || scales.color.kind !== "continuous") return [];
  const byDim = new Map<number, number[]>();
  for (const t of ctx.visualTargets) {
    const idx = series.findIndex((s) => s.id === t.seriesId);
    if (idx < 0) continue;
    let list = byDim.get(t.dimension);
    if (!list) byDim.set(t.dimension, (list = []));
    list.push(idx);
  }
  const [lo, hi] = scales.color.extent;
  return [...byDim.entries()].map(([dimension, seriesIndex], k) => ({
    type: scales.color.options.pieces ? "piecewise" : "continuous",
    ...(scales.color.options.pieces ? { splitNumber: scales.color.options.pieces } : {}),
    show: k === 0 && scales.color.legend,
    seriesIndex,
    dimension,
    min: lo,
    max: hi,
    inRange: { color: scales.color.stops },
    calculable: true,
    orient: "vertical",
    right: 4,
    top: "middle",
    itemWidth: 12,
    itemHeight: 120,
    text: scales.color.label ? [`${scales.color.label}`, ""] : undefined,
    textStyle: { fontSize: 11, color: theme === "dark" ? "#bbb" : "#555" },
    formatter: (v: number) => formatValue(v),
    precision: Number.isInteger(lo) && Number.isInteger(hi) ? 0 : 2,
  }));
}

function buildDataZoom(scales: Scales, nFacets: number, hasLegend: boolean): any[] {
  const out: any[] = [];
  const all = Array.from({ length: nFacets }, (_, i) => i);
  for (const [axis, scale] of [["x", scales.x], ["y", scales.y]] as const) {
    const z = scale.options.zoom;
    if (!z) continue;
    const idx = axis === "x" ? { xAxisIndex: all } : { yAxisIndex: all };
    if (z === true || z === "inside") out.push({ type: "inside", ...idx, filterMode: "none" });
    if (z === true || z === "slider") out.push({ type: "slider", ...idx, filterMode: "none", height: 18, bottom: hasLegend ? 30 : 6 });
  }
  return out;
}

export function deepMerge(a: Record<string, unknown>, b: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...a };
  for (const [k, v] of Object.entries(b)) {
    const cur = out[k];
    if (v && typeof v === "object" && !Array.isArray(v) && cur && typeof cur === "object" && !Array.isArray(cur)) out[k] = deepMerge(cur as Record<string, unknown>, v as Record<string, unknown>);
    else if (Array.isArray(v) && Array.isArray(cur) && k === "series") out[k] = [...cur, ...v];
    else out[k] = v;
  }
  return out;
}

export { getBackend };
