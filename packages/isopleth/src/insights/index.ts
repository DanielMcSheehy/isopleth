/**
 * Insights: run the analytics configured in `insights` (plot- or mark-level)
 * against resolved marks, and turn the results into extra marks (anomaly
 * dots, forecast bands, changepoint rules, trend lines), per-item highlights
 * (outlying bars/dots), per-series styles (outlying series) and a summary.
 */

import type {
  AnomalyInsight,
  CategoryOutlierInsight,
  ChangepointInsight,
  ForecastInsight,
  FrequencyOutlierInsight,
  Insight,
  InsightBase,
  InsightKind,
  InsightsConfig,
  Mark,
  PlotOptions,
  Row,
  SeasonalityInsight,
  SeriesOutlierInsight,
  TrendInsight,
  Value,
} from "../types.js";
import type { AnomalyResult, CategoryOutlierResult, ChangepointResult, ForecastResult, FrequencyOutlierResult, SeasonalityResult, SeriesOutlierResult, TrendResult } from "../backend/types.js";
import { getBackend } from "../backend/index.js";
import { formatValue, inferType, keyof, toNumber } from "../channel.js";
import { guessTimeInterval, medianStep } from "../interval.js";
import { createMark } from "../marks.js";
import { INSIGHT_COLORS } from "../compile/palette.js";
import type { ResolvedMark } from "../compile/resolve.js";
import type { FacetPlan } from "../compile/resolve.js";
import { groupSeries, type ItemHighlight, type SeriesStyle } from "../compile/series.js";

export interface InsightOutput {
  marks: Mark[];
  insights: Insight[];
  highlights: Map<string, Map<number, ItemHighlight>>;
  seriesStyles: Map<string, Map<string | number | boolean | null, SeriesStyle>>;
  notes: string[];
  warnings: string[];
}

const SERIES_MARKS = new Set(["line", "lineY", "lineX", "area", "areaY", "dot", "barY", "rectY"]);
const BAR_MARKS = new Set(["barY", "barX", "rectY", "rectX"]);

type Cfg<T> = T & { kind: InsightKind };

function normalize(config: InsightsConfig | undefined, markId: string): Partial<Record<InsightKind, InsightBase>> {
  const out: Partial<Record<InsightKind, InsightBase>> = {};
  if (!config) return out;
  for (const kind of ["anomalies", "forecast", "changepoints", "seasonality", "trend", "frequencyOutliers", "categoryOutliers", "seriesOutliers"] as InsightKind[]) {
    const v = config[kind];
    if (!v) continue;
    const c: InsightBase = v === true ? {} : { ...(v as InsightBase) };
    if (c.target !== undefined) {
      const targets = Array.isArray(c.target) ? c.target : [c.target];
      if (!targets.includes(markId)) continue;
    }
    out[kind] = c;
  }
  return out;
}

interface SeriesData {
  /** Row indices in x order. */
  index: number[];
  x: Float64Array;
  y: Float64Array;
  temporal: boolean;
  key: string | number | boolean | null;
  name: string;
  value: Value | undefined;
}

/** Extract numeric (x, y) per series of a mark, sorted by x. */
function seriesData(rm: ResolvedMark, I: readonly number[]): SeriesData[] {
  const X = rm.channels.x;
  const Y1 = rm.channels.y1;
  const Y2 = rm.channels.y2;
  const Y = rm.channels.y;
  if (!X) return [];
  const stacked = Boolean((rm.mark.options as Record<string, unknown>).__stacked);
  const temporal = inferType(X) === "temporal";
  if (inferType(X) === "ordinal") return [];
  const out: SeriesData[] = [];
  for (const g of groupSeries(rm, I)) {
    const idx = g.index.filter((i) => Number.isFinite(toNumber(X[i]))).sort((a, b) => toNumber(X[a]) - toNumber(X[b]));
    const x = Float64Array.from(idx, (i) => toNumber(X[i]));
    const y = Float64Array.from(idx, (i) => {
      if (stacked && Y1 && Y2) {
        const a = toNumber(Y1[i]);
        const b = toNumber(Y2[i]);
        return Number.isFinite(a) && Number.isFinite(b) ? b - a : NaN;
      }
      const v = Y2 ?? Y;
      return v ? toNumber(v[i]) : NaN;
    });
    if (idx.length === 0) continue;
    out.push({ index: idx, x, y, temporal, key: g.key, name: g.value !== undefined ? formatValue(g.value) : rm.mark.id, value: g.value });
  }
  return out;
}

const xValue = (v: number, temporal: boolean): Value => (temporal ? new Date(v) : v);

export function applyInsights(resolved: ResolvedMark[], plan: FacetPlan, options: PlotOptions): InsightOutput {
  const out: InsightOutput = { marks: [], insights: [], highlights: new Map(), seriesStyles: new Map(), notes: [], warnings: [] };
  const backend = getBackend();
  for (const rm of resolved) {
    if (rm.mark.generated) continue;
    const cfg = { ...normalize(options.insights, rm.mark.id), ...normalize(rm.mark.options.insights, rm.mark.id) };
    if (Object.keys(cfg).length === 0) continue;
    const facetsToRun = rm.faceted ? rm.facets.map((_, f) => f) : [0];
    for (const f of facetsToRun) {
      const I = rm.facets[f] ?? [];
      const facetKey = rm.faceted ? plan.keys[f] : {};
      const facetFields = (row: Row): Row => ({ ...row, ...(facetKey.fx !== undefined ? { fx: facetKey.fx } : {}), ...(facetKey.fy !== undefined ? { fy: facetKey.fy } : {}) });
      const facetOpts = { ...(facetKey.fx !== undefined ? { fx: "fx" } : {}), ...(facetKey.fy !== undefined ? { fy: "fy" } : {}) };
      const series = SERIES_MARKS.has(rm.mark.type) ? seriesData(rm, I) : [];
      for (const [kind, c] of Object.entries(cfg) as [InsightKind, InsightBase][]) {
        try {
          switch (kind) {
            case "anomalies":
              for (const s of series) runAnomalies(rm, s, { ...c, kind } as Cfg<AnomalyInsight>, out, facetFields, facetOpts, backend.name);
              break;
            case "forecast":
              for (const s of series) runForecast(rm, s, { ...c, kind } as Cfg<ForecastInsight>, out, facetFields, facetOpts, backend.name);
              break;
            case "changepoints":
              for (const s of series) runChangepoints(rm, s, { ...c, kind } as Cfg<ChangepointInsight>, out, facetFields, facetOpts, backend.name);
              break;
            case "seasonality":
              for (const s of series) runSeasonality(rm, s, { ...c, kind } as Cfg<SeasonalityInsight>, out, backend.name);
              break;
            case "trend":
              for (const s of series) runTrend(rm, s, { ...c, kind } as Cfg<TrendInsight>, out, facetFields, facetOpts, backend.name);
              break;
            case "frequencyOutliers":
              runFrequencyOutliers(rm, I, { ...c, kind } as Cfg<FrequencyOutlierInsight>, out, facetFields, facetOpts, backend.name);
              break;
            case "categoryOutliers":
              runCategoryOutliers(rm, I, { ...c, kind } as Cfg<CategoryOutlierInsight>, out, facetFields, facetOpts, backend.name);
              break;
            case "seriesOutliers":
              runSeriesOutliers(rm, series, { ...c, kind } as Cfg<SeriesOutlierInsight>, out, facetFields, facetOpts, backend.name);
              break;
          }
        } catch (err) {
          out.warnings.push(`${kind} on ${rm.mark.id}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }
  }
  return out;
}

function note(out: InsightOutput, insight: Insight) {
  out.insights.push(insight);
  out.notes.push(insight.summary);
}

function seriesLabel(rm: ResolvedMark, s: SeriesData): string {
  return s.value !== undefined ? ` (${s.name})` : "";
}

function highlight(out: InsightOutput, markId: string, i: number, h: ItemHighlight) {
  let m = out.highlights.get(markId);
  if (!m) out.highlights.set(markId, (m = new Map()));
  m.set(i, { ...(m.get(i) ?? {}), ...h });
}

// ------------------------------------------------------------- anomalies ---

function runAnomalies(rm: ResolvedMark, s: SeriesData, c: Cfg<AnomalyInsight>, out: InsightOutput, ff: (r: Row) => Row, fo: Row, backendName: "js" | "wasm") {
  if (s.y.filter(Number.isFinite).length < 8) return;
  const r: AnomalyResult = getBackend().anomalies(s.y, { method: c.method, sensitivity: c.sensitivity, threshold: c.threshold, window: c.window, period: c.period, lambda: c.lambda });
  const color = c.color ?? INSIGHT_COLORS.anomaly;
  const points = r.indices.map((j) => ff({ x: xValue(s.x[j], s.temporal), y: s.y[j], score: r.scores[j], expected: (r.lower[j] + r.upper[j]) / 2, series: s.name }));
  const when = r.indices.slice(0, 3).map((j) => formatValue(xValue(s.x[j], s.temporal)));
  const n = r.indices.length;
  note(out, {
    kind: "anomalies",
    mark: rm.mark.id,
    series: s.value,
    method: r.method,
    backend: backendName,
    data: r,
    summary: n === 0 ? `no anomalies${seriesLabel(rm, s)}` : `${n} anomal${n === 1 ? "y" : "ies"}${seriesLabel(rm, s)} at ${when.join(", ")}${n > 3 ? ", …" : ""}`,
  });
  if (c.show === false) return;
  if (c.band !== false) {
    const band = s.index.map((_, j) => ff({ x: xValue(s.x[j], s.temporal), lower: r.lower[j], upper: r.upper[j] }));
    out.marks.push(createMark("areaY", band, { ...fo, x: "x", y1: "lower", y2: "upper", fill: color, fillOpacity: 0.08, silent: true, legend: false, id: `${rm.mark.id}:anomaly-band:${s.key ?? ""}`, z2: -1 }, true));
  }
  if (points.length) {
    out.marks.push(
      createMark(
        "dot",
        points,
        { ...fo, x: "x", y: "y", fill: color, stroke: "#fff", strokeWidth: 1, r: 5, id: `${rm.mark.id}:anomalies:${s.key ?? ""}`, name: "anomaly", channels: { score: (d: Row) => `z = ${formatValue(d.score as number)}` }, z2: 5 },
        true,
      ),
    );
  }
  for (const j of r.indices) highlight(out, rm.mark.id, s.index[j], { color, size: 10 });
}

// -------------------------------------------------------------- forecast ---

function runForecast(rm: ResolvedMark, s: SeriesData, c: Cfg<ForecastInsight>, out: InsightOutput, ff: (r: Row) => Row, fo: Row, backendName: "js" | "wasm") {
  if (s.y.filter(Number.isFinite).length < 5) return;
  const horizon = c.horizon ?? 10;
  const level = c.level === undefined ? 0.95 : c.level;
  const r: ForecastResult = getBackend().forecast(s.y, { method: c.method, horizon, level, period: c.period });
  const warnings: string[] = [];
  if (backendName === "js" && (c.method === "ets" || c.method === "mstl")) warnings.push(`${c.method} needs the wasm backend; used ${r.method}`);
  // Extend x by whole steps.
  const step = medianStep(s.x);
  const last = s.x[s.x.length - 1];
  const iv = s.temporal ? guessTimeInterval(step) : undefined;
  const future: number[] = [];
  let cur = last;
  for (let h = 0; h < horizon; h++) {
    cur = iv ? iv.offset(cur, 1) : cur + (Number.isFinite(step) ? step : 1);
    future.push(cur);
  }
  const color = c.color ?? INSIGHT_COLORS.forecast;
  const lastY = s.y[s.y.length - 1];
  note(out, {
    kind: "forecast",
    mark: rm.mark.id,
    series: s.value,
    method: r.method,
    backend: backendName,
    data: { ...r, x: future.map((v) => xValue(v, s.temporal)) },
    summary: `forecast${seriesLabel(rm, s)}: ${r.method}, ${horizon} steps${r.level ? `, ${Math.round(r.level * 100)}% interval` : ""}${r.period ? `, period ${r.period}` : ""}`,
    warnings: warnings.length ? warnings : undefined,
  });
  if (c.show === false) return;
  const line = [ff({ x: xValue(last, s.temporal), y: Number.isFinite(lastY) ? lastY : null }), ...future.map((x, h) => ff({ x: xValue(x, s.temporal), y: r.point[h] }))];
  if (r.level) {
    const band = future.map((x, h) => ff({ x: xValue(x, s.temporal), lower: r.lower[h], upper: r.upper[h] }));
    band.unshift(ff({ x: xValue(last, s.temporal), lower: Number.isFinite(lastY) ? lastY : null, upper: Number.isFinite(lastY) ? lastY : null }));
    out.marks.push(createMark("areaY", band, { ...fo, x: "x", y1: "lower", y2: "upper", fill: color, fillOpacity: 0.15, silent: true, legend: false, id: `${rm.mark.id}:forecast-band:${s.key ?? ""}`, z2: -1 }, true));
  }
  out.marks.push(createMark("lineY", line, { ...fo, x: "x", y: "y", stroke: color, strokeWidth: 1.5, strokeDasharray: "5 3", id: `${rm.mark.id}:forecast:${s.key ?? ""}`, name: `forecast (${r.method})`, z2: 2 }, true));
  if (c.shade !== false) {
    out.marks.push(createMark("ruleX", [ff({ x: xValue(last, s.temporal) })], { ...fo, x: "x", stroke: color, strokeOpacity: 0.5, strokeDasharray: "2 2", id: `${rm.mark.id}:forecast-start:${s.key ?? ""}` }, true));
  }
  if (c.fitted) {
    const fit = s.index.map((_, j) => ff({ x: xValue(s.x[j], s.temporal), y: Number.isFinite(r.fitted[j]) ? r.fitted[j] : null }));
    out.marks.push(createMark("lineY", fit, { ...fo, x: "x", y: "y", stroke: color, strokeOpacity: 0.5, strokeWidth: 1, id: `${rm.mark.id}:fitted:${s.key ?? ""}` }, true));
  }
}

// ---------------------------------------------------------- changepoints ---

function runChangepoints(rm: ResolvedMark, s: SeriesData, c: Cfg<ChangepointInsight>, out: InsightOutput, ff: (r: Row) => Row, fo: Row, backendName: "js" | "wasm") {
  if (s.y.filter(Number.isFinite).length < 10) return;
  const r: ChangepointResult = getBackend().changepoints(s.y, { method: c.method, model: c.model, minSegment: c.minSegment, maxChangepoints: c.maxChangepoints, penalty: c.penalty });
  const color = c.color ?? INSIGHT_COLORS.changepoint;
  const n = r.indices.length;
  const when = r.indices.slice(0, 3).map((j) => formatValue(xValue(s.x[j], s.temporal)));
  note(out, {
    kind: "changepoints",
    mark: rm.mark.id,
    series: s.value,
    method: r.method,
    backend: backendName,
    data: { ...r, x: r.indices.map((j) => xValue(s.x[j], s.temporal)) },
    summary: n === 0 ? `no changepoints${seriesLabel(rm, s)}` : `${n} changepoint${n === 1 ? "" : "s"}${seriesLabel(rm, s)} at ${when.join(", ")}${n > 3 ? ", …" : ""}`,
  });
  if (c.show === false || n === 0) return;
  out.marks.push(createMark("ruleX", r.indices.map((j) => ff({ x: xValue(s.x[j], s.temporal) })), { ...fo, x: "x", stroke: color, strokeDasharray: "4 2", strokeWidth: 1.5, id: `${rm.mark.id}:changepoints:${s.key ?? ""}`, z2: 2 }, true));
  if (c.segments !== false) {
    const bounds = [0, ...r.indices, s.x.length - 1];
    const segs = r.segmentMeans.map((m, k) => ff({ x1: xValue(s.x[bounds[k]], s.temporal), x2: xValue(s.x[Math.min(bounds[k + 1], s.x.length - 1)], s.temporal), y: m }));
    out.marks.push(createMark("ruleY", segs, { ...fo, y: "y", x1: "x1", x2: "x2", stroke: color, strokeOpacity: 0.8, strokeWidth: 1.5, id: `${rm.mark.id}:segments:${s.key ?? ""}`, z2: 2 }, true));
  }
}

// ----------------------------------------------------------- seasonality ---

function runSeasonality(rm: ResolvedMark, s: SeriesData, c: Cfg<SeasonalityInsight>, out: InsightOutput, backendName: "js" | "wasm") {
  if (s.y.filter(Number.isFinite).length < 12) return;
  const r: SeasonalityResult = getBackend().seasonality(s.y, { method: c.method, minPeriod: c.minPeriod, maxPeriod: c.maxPeriod, threshold: c.threshold, minStrength: c.minStrength });
  const step = medianStep(s.x);
  const unit = s.temporal && Number.isFinite(step) ? guessTimeInterval(step).name : undefined;
  const describe = (p: number) => {
    if (!unit) return String(p);
    const named: Record<string, string> = { "day:7": "weekly", "day:365": "yearly", "day:366": "yearly", "month:12": "yearly", "month:3": "quarterly", "hour:24": "daily", "hour:168": "weekly", "minute:60": "hourly", "week:52": "yearly", "quarter:4": "yearly" };
    const n = named[`${unit}:${p}`];
    return n ? `${p} ${unit}s (${n})` : `${p} ${unit}${p === 1 ? "" : "s"}`;
  };
  note(out, {
    kind: "seasonality",
    mark: rm.mark.id,
    series: s.value,
    method: r.method,
    backend: backendName,
    data: r,
    summary: r.periods.length === 0 ? `no seasonality${seriesLabel(rm, s)}` : `seasonality${seriesLabel(rm, s)}: period ${describe(r.periods[0])} (strength ${r.strengths[0].toFixed(2)})${r.periods.length > 1 ? `, also ${r.periods.slice(1, 3).map(describe).join(", ")}` : ""}`,
  });
}

// ----------------------------------------------------------------- trend ---

function runTrend(rm: ResolvedMark, s: SeriesData, c: Cfg<TrendInsight>, out: InsightOutput, ff: (r: Row) => Row, fo: Row, backendName: "js" | "wasm") {
  if (s.y.filter(Number.isFinite).length < 3) return;
  const r: TrendResult = getBackend().trend(s.x, s.y, c.method ?? "ols");
  const color = c.color ?? INSIGHT_COLORS.trend;
  const total = r.slope * (s.x[s.x.length - 1] - s.x[0]);
  note(out, {
    kind: "trend",
    mark: rm.mark.id,
    series: s.value,
    method: r.method,
    backend: backendName,
    data: r,
    summary: `trend${seriesLabel(rm, s)}: ${total >= 0 ? "+" : ""}${formatValue(total)} over the period (R² ${Number.isFinite(r.r2) ? r.r2.toFixed(2) : "–"})`,
  });
  if (c.show === false) return;
  const pts = [0, s.x.length - 1].map((j) => ff({ x: xValue(s.x[j], s.temporal), y: r.fitted[j] }));
  out.marks.push(createMark("lineY", pts, { ...fo, x: "x", y: "y", stroke: color, strokeDasharray: "6 3", strokeWidth: 1.5, id: `${rm.mark.id}:trend:${s.key ?? ""}`, name: `trend (${r.method})`, z2: 2 }, true));
}

// ---------------------------------------------------------- frequencies ---

/** Category → total height for ordinal bar marks. */
function categoryTotals(rm: ResolvedMark, I: readonly number[]): { values: Value[]; totals: Float64Array; rows: number[][] } | undefined {
  const horizontal = rm.mark.type === "barX" || rm.mark.type === "rectX";
  const K = horizontal ? rm.channels.y : rm.channels.x;
  if (!K || inferType(K) !== "ordinal") return undefined;
  const B1 = horizontal ? rm.channels.x1 : rm.channels.y1;
  const B2 = horizontal ? (rm.channels.x2 ?? rm.channels.x) : (rm.channels.y2 ?? rm.channels.y);
  if (!B2) return undefined;
  const groups = new Map<string | number | boolean | null, { v: Value; total: number; rows: number[] }>();
  for (const i of I) {
    const k = keyof(K[i]);
    if (k === null) continue;
    let g = groups.get(k);
    if (!g) groups.set(k, (g = { v: K[i], total: 0, rows: [] }));
    const h = toNumber(B2[i]) - (B1 ? toNumber(B1[i]) : 0);
    if (Number.isFinite(h)) g.total += h;
    g.rows.push(i);
  }
  const list = [...groups.values()];
  return { values: list.map((g) => g.v), totals: Float64Array.from(list, (g) => g.total), rows: list.map((g) => g.rows) };
}

function runFrequencyOutliers(rm: ResolvedMark, I: readonly number[], c: Cfg<FrequencyOutlierInsight>, out: InsightOutput, ff: (r: Row) => Row, fo: Row, backendName: "js" | "wasm") {
  if (!BAR_MARKS.has(rm.mark.type)) return;
  const cats = categoryTotals(rm, I);
  if (!cats || cats.values.length < 3) return;
  const r: FrequencyOutlierResult = getBackend().frequencyOutliers(cats.totals, c.sensitivity, c.threshold);
  const name = (k: number) => formatValue(cats.values[k]);
  const parts: string[] = [];
  if (r.rare.length) parts.push(`rare: ${r.rare.map(name).join(", ")}`);
  if (r.dominant.length) parts.push(`dominant: ${r.dominant.map(name).join(", ")}`);
  note(out, { kind: "frequencyOutliers", mark: rm.mark.id, method: "robust-z(log count)", backend: backendName, data: { ...r, categories: cats.values }, summary: parts.length ? `frequency outliers — ${parts.join("; ")}` : "no frequency outliers" });
  if (c.show === false) return;
  const single = groupSeries(rm, I).length === 1;
  const horizontal = rm.mark.type === "barX" || rm.mark.type === "rectX";
  const labels: Row[] = [];
  for (const [list, kind] of [[r.rare, "rare"], [r.dominant, "dominant"]] as [number[], "rare" | "dominant"][]) {
    const color = c.color ?? INSIGHT_COLORS[kind];
    for (const k of list) {
      if (single) for (const i of cats.rows[k]) highlight(out, rm.mark.id, i, { color });
      labels.push(ff(horizontal ? { x: cats.totals[k], y: cats.values[k], text: kind, color } : { x: cats.values[k], y: cats.totals[k], text: kind, color }));
    }
  }
  if (labels.length) {
    out.marks.push(createMark("text", labels, { ...fo, x: "x", y: "y", text: "text", fill: c.color ?? INSIGHT_COLORS.anomaly, fontSize: 10, fontWeight: "bold", position: horizontal ? "right" : "top", id: `${rm.mark.id}:frequency-labels`, z2: 6 }, true));
  }
}

// ------------------------------------------------------------ categories ---

function runCategoryOutliers(rm: ResolvedMark, I: readonly number[], c: Cfg<CategoryOutlierInsight>, out: InsightOutput, ff: (r: Row) => Row, fo: Row, backendName: "js" | "wasm") {
  const horizontal = rm.mark.type === "barX" || rm.mark.type === "rectX";
  const K = horizontal ? rm.channels.y : rm.channels.x;
  const V = horizontal ? (rm.channels.x2 ?? rm.channels.x) : (rm.channels.y2 ?? rm.channels.y);
  if (!K || !V || inferType(K) !== "ordinal") return;
  const B1 = horizontal ? rm.channels.x1 : rm.channels.y1;
  const Z = rm.channels.z ?? rm.channels.fill ?? rm.channels.stroke;
  const domain = new Map<string | number | boolean | null, { v: Value; code: number }>();
  const seriesIndex = new Map<string | number | boolean | null, number>();
  const codes = new Int32Array(I.length);
  const scodes = new Int32Array(I.length);
  const values = new Float64Array(I.length);
  I.forEach((i, j) => {
    const k = keyof(K[i]);
    if (k === null) {
      codes[j] = -1;
      return;
    }
    let d = domain.get(k);
    if (!d) domain.set(k, (d = { v: K[i], code: domain.size }));
    codes[j] = d.code;
    const sk = Z ? keyof(Z[i]) : null;
    let si = seriesIndex.get(sk);
    if (si === undefined) seriesIndex.set(sk, (si = seriesIndex.size));
    scodes[j] = si;
    values[j] = toNumber(V[i]) - (B1 ? toNumber(B1[i]) : 0);
  });
  if (domain.size < 3) return;
  const reducer = typeof c.reduce === "string" ? c.reduce : undefined;
  const backend = getBackend();
  // Category level: compare each category's aggregate with the others.
  const r: CategoryOutlierResult = backend.categoryOutliers(codes, values, domain.size, reducer, c.sensitivity, c.threshold);
  // Within level: a point against its own (category × series) group.
  const nSeries = Math.max(1, seriesIndex.size);
  const combined = Int32Array.from(codes, (cc, j) => (cc < 0 ? -1 : cc * nSeries + scodes[j]));
  const rw = nSeries > 1 ? backend.categoryOutliers(combined, values, domain.size * nSeries, reducer, c.sensitivity, c.threshold) : r;
  const cats = [...domain.values()];
  const name = (k: number) => formatValue(cats[k].v);
  const within = c.within === false || BAR_MARKS.has(rm.mark.type) ? [] : rw.within;
  const parts: string[] = [];
  if (r.categories.length) parts.push(`outlying categor${r.categories.length === 1 ? "y" : "ies"}: ${r.categories.map((k) => `${name(k)} (z ${r.scores[k].toFixed(1)})`).join(", ")}`);
  if (within.length) parts.push(`${within.length} within-category outlier${within.length === 1 ? "" : "s"}`);
  note(out, {
    kind: "categoryOutliers",
    mark: rm.mark.id,
    method: `robust-z(${reducer ?? "median"})`,
    backend: backendName,
    data: { ...r, within, withinScores: rw.withinScores, categories: cats.map((d) => d.v) },
    summary: parts.length ? parts.join("; ") : "no category outliers",
  });
  if (c.show === false) return;
  const color = c.color ?? INSIGHT_COLORS.outlier;
  const single = groupSeries(rm, I).length === 1;
  const isBar = BAR_MARKS.has(rm.mark.type);
  const labels: Row[] = [];
  for (const k of r.categories) {
    I.forEach((i, j) => {
      if (codes[j] !== k) return;
      if (isBar && single) highlight(out, rm.mark.id, i, { color });
      else if (!isBar) highlight(out, rm.mark.id, i, { border: color });
    });
    const agg = r.aggregates[k];
    labels.push(ff(horizontal ? { x: agg, y: cats[k].v, text: `z ${r.scores[k].toFixed(1)}` } : { x: cats[k].v, y: agg, text: `z ${r.scores[k].toFixed(1)}` }));
  }
  for (const j of within) highlight(out, rm.mark.id, I[j], { color, size: 10 });
  if (labels.length) out.marks.push(createMark("text", labels, { ...fo, x: "x", y: "y", text: "text", fill: color, fontSize: 10, fontWeight: "bold", position: horizontal ? "right" : "top", id: `${rm.mark.id}:category-labels`, z2: 6 }, true));
}

// ---------------------------------------------------------------- series ---

function runSeriesOutliers(rm: ResolvedMark, series: SeriesData[], c: Cfg<SeriesOutlierInsight>, out: InsightOutput, ff: (r: Row) => Row, fo: Row, backendName: "js" | "wasm") {
  if (series.length < 3) return;
  // Align every series on the union of x positions.
  const xsSet = new Set<number>();
  for (const s of series) for (const x of s.x) xsSet.add(x);
  const xs = [...xsSet].sort((a, b) => a - b);
  const pos = new Map(xs.map((x, i) => [x, i]));
  const aligned = series.map((s) => {
    const a = new Float64Array(xs.length).fill(NaN);
    s.x.forEach((x, j) => (a[pos.get(x)!] = s.y[j]));
    return a;
  });
  const method = c.method ?? "dbscan";
  const r: SeriesOutlierResult = getBackend().seriesOutliers(aligned, method, c.sensitivity);
  const warnings = backendName === "js" && method === "dbscan" ? ["dbscan needs the wasm backend; used mad"] : undefined;
  const names = r.outlying.map((k) => series[k].name);
  note(out, { kind: "seriesOutliers", mark: rm.mark.id, method: r.method, backend: backendName, data: { ...r, series: series.map((s) => s.name) }, summary: names.length ? `outlying series: ${names.join(", ")}` : "no outlying series", warnings });
  if (c.show === false || r.outlying.length === 0) return;
  const color = c.color ?? INSIGHT_COLORS.seriesOutlier;
  let styles = out.seriesStyles.get(rm.mark.id);
  if (!styles) out.seriesStyles.set(rm.mark.id, (styles = new Map()));
  const outlying = new Set(r.outlying);
  series.forEach((s, k) => styles!.set(s.key, outlying.has(k) ? { color, width: 2.5 } : { opacity: 0.35 }));
  if (c.band !== false && r.bandMin.some(Number.isFinite)) {
    const temporal = series[0].temporal;
    const band = xs.map((x, i) => ff({ x: xValue(x, temporal), lower: Number.isFinite(r.bandMin[i]) ? r.bandMin[i] : null, upper: Number.isFinite(r.bandMax[i]) ? r.bandMax[i] : null }));
    out.marks.push(createMark("areaY", band, { ...fo, x: "x", y1: "lower", y2: "upper", fill: INSIGHT_COLORS.band, fillOpacity: 0.1, silent: true, legend: false, id: `${rm.mark.id}:series-band`, z2: -1 }, true));
  }
}
