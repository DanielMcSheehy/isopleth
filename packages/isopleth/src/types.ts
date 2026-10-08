/**
 * Public types for the isopleth grammar.
 *
 * The mental model is Observable Plot's: a chart is a list of *marks*; a mark is
 * `mark(data, options)`; options are *channels* (vary per datum) or constants;
 * *transforms* are functions `(transformOptions, markOptions) => markOptions`
 * that derive new data and channels and compose by nesting. isopleth compiles
 * all of that into a single Apache ECharts 6 `option`.
 */

import type { EChartsOption } from "echarts";

/** A row of tidy data. Any object works; fields are looked up by name. */
export type Row = Record<string, unknown>;

/** Plain values that can be plotted. */
export type Value = number | string | Date | boolean | null | undefined;

/**
 * A channel definition:
 * - a field name (`"weight"`),
 * - an accessor `(d, i) => value`,
 * - an array/typed array of the same length as the data,
 * - a constant (number / Date / boolean) that is the same for every datum, or
 * - `{ value, scale?, label? }` for an explicit definition.
 */
export type ChannelValue<D = Row> =
  | string
  | number
  | boolean
  | Date
  | null
  | undefined
  | ArrayLike<Value>
  | ((d: D, i: number, data: readonly D[]) => Value)
  | ChannelSpec<D>;

export interface ChannelSpec<D = Row> {
  value: string | ArrayLike<Value> | ((d: D, i: number, data: readonly D[]) => Value);
  /** `null` to bypass the scale (e.g. literal colors). */
  scale?: "x" | "y" | "color" | "r" | null;
  label?: string;
  /** Used only by `auto`: reducer for this channel. */
  reduce?: Reducer | null;
  zero?: boolean;
}

/** Group reducers (Plot names). `pNN` is a percentile such as `"p90"`. */
export type Reducer =
  | "count"
  | "sum"
  | "mean"
  | "median"
  | "min"
  | "max"
  | "mode"
  | "first"
  | "last"
  | "deviation"
  | "variance"
  | "distinct"
  | "proportion"
  | "proportion-facet"
  | "min-index"
  | "max-index"
  | "x"
  | "x1"
  | "x2"
  | "y"
  | "y1"
  | "y2"
  | "z"
  | `p${number}`
  | ((values: Value[], extent: { data: Row[] }) => Value);

export type WindowReducer = Reducer | "difference" | "ratio";

/** Named time/number intervals (Plot's `interval` option). */
export type IntervalName =
  | "second"
  | "minute"
  | "hour"
  | "day"
  | "week"
  | "month"
  | "quarter"
  | "year"
  | `${number} ${"second" | "minute" | "hour" | "day" | "week" | "month" | "year"}${"s" | ""}`;

export interface IntervalLike {
  floor(v: number): number;
  offset(v: number, step?: number): number;
  range?(start: number, stop: number): number[];
  /** `"time"` intervals produce Dates, `"number"` intervals plain numbers. */
  kind: "time" | "number";
  name?: string;
}

export type Interval = IntervalName | number | IntervalLike;

export type Curve =
  | "linear"
  | "step"
  | "step-before"
  | "step-after"
  | "monotone-x"
  | "basis"
  | "natural"
  | "catmull-rom"
  | "bump-x";

/** A CSS color or an ECharts gradient object. */
export type Color = string | GradientSpec;

export interface GradientSpec {
  type: "linear" | "radial";
  /** Gradient stops; offsets in `[0, 1]`. */
  colorStops: { offset: number; color: string }[];
  x?: number;
  y?: number;
  x2?: number;
  y2?: number;
  r?: number;
}

export type InsightKind =
  | "anomalies"
  | "forecast"
  | "changepoints"
  | "seasonality"
  | "trend"
  | "frequencyOutliers"
  | "categoryOutliers"
  | "seriesOutliers";

/** Options common to every insight. */
export interface InsightBase {
  /** Which marks to analyse: all eligible (default), or mark ids. */
  target?: string | string[];
  /** Draw the insight on the chart (default true). `false` still computes it. */
  show?: boolean;
  /** Color used for the insight's marks. */
  color?: string;
}

export interface AnomalyInsight extends InsightBase {
  method?: "mad" | "zscore" | "iqr" | "seasonal" | "ewma" | "auto";
  /** `0` tolerant … `1` sensitive. Overrides `threshold`. */
  sensitivity?: number;
  threshold?: number;
  window?: number;
  period?: number;
  lambda?: number;
  /** Also draw the expected band behind the data (default true). */
  band?: boolean;
}

export interface ForecastInsight extends InsightBase {
  method?: "auto" | "ets" | "mstl" | "naive" | "drift" | "holt" | "holt-winters";
  /** Number of steps ahead (default 10). */
  horizon?: number;
  /** Confidence level for the interval, default 0.95; `0`/`null` disables. */
  level?: number | null;
  period?: number;
  /** Shade the forecast region (default true). */
  shade?: boolean;
  /** Draw the in-sample fit (default false). */
  fitted?: boolean;
}

export interface ChangepointInsight extends InsightBase {
  method?: "auto" | "binseg" | "argpcp" | "normal-gamma";
  /** Cost model for binary segmentation: `"linear"` (default) tolerates trends, `"mean"` is the classic step model. */
  model?: "mean" | "linear";
  minSegment?: number;
  maxChangepoints?: number;
  penalty?: number;
  /** Draw segment mean lines (default true). */
  segments?: boolean;
}

export interface SeasonalityInsight extends InsightBase {
  method?: "auto" | "periodogram" | "autocorrelation";
  minPeriod?: number;
  maxPeriod?: number;
  threshold?: number;
  minStrength?: number;
}

export interface TrendInsight extends InsightBase {
  method?: "ols" | "theil-sen";
}

export interface FrequencyOutlierInsight extends InsightBase {
  sensitivity?: number;
  threshold?: number;
}

export interface CategoryOutlierInsight extends InsightBase {
  /** How to summarise each category before comparing (default `"median"`). */
  reduce?: Reducer;
  sensitivity?: number;
  threshold?: number;
  /** Also flag points that are outliers *within* their category (default true). */
  within?: boolean;
}

export interface SeriesOutlierInsight extends InsightBase {
  method?: "dbscan" | "mad";
  sensitivity?: number;
  /** Draw the normal-cluster band (default true). */
  band?: boolean;
}

/** The `insights` configuration of a plot or a mark. `true` = defaults. */
export interface InsightsConfig {
  anomalies?: boolean | AnomalyInsight;
  forecast?: boolean | ForecastInsight;
  changepoints?: boolean | ChangepointInsight;
  seasonality?: boolean | SeasonalityInsight;
  trend?: boolean | TrendInsight;
  frequencyOutliers?: boolean | FrequencyOutlierInsight;
  categoryOutliers?: boolean | CategoryOutlierInsight;
  seriesOutliers?: boolean | SeriesOutlierInsight;
  /** Append a one-line summary of the findings under the title (default true). */
  annotate?: boolean;
}

/** A computed insight. `data` is the kernel output, `summary` is human-readable. */
export interface Insight<T = unknown> {
  kind: InsightKind;
  /** The mark the insight was computed for. */
  mark: string;
  /** Series key (value of the `z`/`fill`/`stroke` channel) when per-series. */
  series?: Value;
  summary: string;
  data: T;
  /** Kernel/backend that produced it, e.g. `"mad"`, `"ets"`, `"binseg"`. */
  method: string;
  backend: "js" | "wasm";
  /** Non-fatal notes, e.g. "forecast method downgraded to holt (js backend)". */
  warnings?: string[];
}

export interface ScaleOptions {
  type?: "linear" | "log" | "sqrt" | "time" | "utc" | "ordinal" | "band" | "point" | "category";
  domain?: Value[] | [number, number] | [Date, Date];
  label?: string | null;
  /** Include zero in the domain. */
  zero?: boolean;
  /** Draw grid lines. */
  grid?: boolean;
  /** Number of ticks or an interval. */
  ticks?: number | Interval;
  tickFormat?: string | ((v: Value) => string);
  /** Enforce uniform spacing / snap to interval. */
  interval?: Interval;
  reverse?: boolean;
  /** Axis position. */
  axis?: "top" | "bottom" | "left" | "right" | null;
  /** Padding between bars for band scales (0..1). */
  padding?: number;
  /** Show a dataZoom control on this axis. */
  zoom?: boolean | "inside" | "slider";
  /** Percent formatting for normalized data. */
  percent?: boolean;
  /** Axis breaks (ECharts 6): skip ranges of the axis. */
  breaks?: { start: number; end: number; gap?: number | string }[];
  /** Jitter ordinal positions (ECharts 6 `jitter`). */
  jitter?: number;
  nice?: boolean;
}

export interface ColorScaleOptions {
  type?: "categorical" | "ordinal" | "linear" | "sequential" | "diverging" | "log";
  domain?: Value[] | [number, number];
  /** Palette: array of colors, or a named ECharts/isopleth scheme. */
  range?: string[];
  scheme?: string;
  legend?: boolean;
  label?: string;
  /** For continuous colors: number of pieces for a piecewise legend. */
  pieces?: number;
  /** Reverse the palette. */
  reverse?: boolean;
  /** Unknown/null color. */
  unknown?: string;
  /** Per-value colour overrides: `{ "mobile": "#ff0", "web": "#0ff" }`. */
  overrides?: Record<string, string>;
}

export interface FacetOptions {
  /** Facet by this channel (Plot's `fx`/`fy` at plot level). */
  x?: ChannelValue;
  y?: ChannelValue;
  data?: readonly Row[];
  /** Share scales across facets (default true). */
  sharedX?: boolean;
  sharedY?: boolean;
  label?: string | null;
  gap?: number;
}

export interface PlotOptions {
  marks?: Markish[];
  width?: number;
  height?: number;
  title?: string;
  subtitle?: string;
  caption?: string;
  margin?: number | { top?: number; right?: number; bottom?: number; left?: number };
  x?: ScaleOptions;
  y?: ScaleOptions;
  color?: ColorScaleOptions;
  r?: { range?: [number, number]; domain?: [number, number] };
  facet?: FacetOptions;
  /** `"light"` (default), `"dark"`, `"ink"`, a theme registered with `defineTheme`, or a (partial) `Theme` object. */
  theme?: string | Partial<import("./theme.js").Theme>;
  /** Plot-level insights, applied to every eligible mark. */
  insights?: InsightsConfig;
  /** Default: `"axis"` for line/area/bar charts, `"item"` for dots. */
  tooltip?: boolean | "axis" | "item" | Record<string, unknown>;
  legend?: boolean | Record<string, unknown>;
  animation?: boolean;
  /** Extra ECharts option merged last (escape hatch). */
  echarts?: EChartsOption;
  /** Background color (ECharts `backgroundColor`). */
  background?: string;
  /** Show ECharts toolbox (save/zoom/restore). */
  toolbox?: boolean;
}

export interface MarkOptions<D = Row> {
  x?: ChannelValue<D>;
  y?: ChannelValue<D>;
  x1?: ChannelValue<D>;
  x2?: ChannelValue<D>;
  y1?: ChannelValue<D>;
  y2?: ChannelValue<D>;
  /** Series grouping; defaults to `fill` or `stroke` when those are channels. */
  z?: ChannelValue<D>;
  fill?: ChannelValue<D> | Color;
  stroke?: ChannelValue<D> | Color;
  r?: ChannelValue<D>;
  fx?: ChannelValue<D>;
  fy?: ChannelValue<D>;
  text?: ChannelValue<D>;
  title?: ChannelValue<D>;
  /** Extra tooltip channels: `{ "Population": "pop" }`. */
  channels?: Record<string, ChannelValue<D>>;

  fillOpacity?: number;
  strokeOpacity?: number;
  strokeWidth?: number;
  strokeDasharray?: string | number[];
  opacity?: number;
  curve?: Curve;
  /** Line/area: bridge gaps instead of breaking at null/NaN (default false). */
  connectNulls?: boolean;
  /** Snap values to an interval (and reveal gaps). */
  interval?: Interval;
  /** Bar/rect inset in pixels or bar gap fraction. */
  inset?: number;
  symbol?: "circle" | "rect" | "roundRect" | "triangle" | "diamond" | "pin" | "arrow" | "none";
  /** Show symbols on lines (default false). */
  symbols?: boolean;
  /** Mark id (for insight targeting and ECharts series ids). */
  id?: string;
  /** Legend name (defaults to `id` or the channel label). */
  name?: string;
  /** Show this mark in the legend (default true when it has a z/fill/stroke channel). */
  legend?: boolean;
  /** Enable tooltips for this mark (default true). */
  tip?: boolean | "x" | "y" | "xy";
  /** Sort order for ordinal scale domains: `{ x: "y" }`, `{ x: "-y" }`, ... */
  sort?: SortOrder<D> | null;
  filter?: ChannelValue<D>;
  reverse?: boolean;
  /** Mark-level insights. */
  insights?: InsightsConfig;
  /** Hide from the legend and tooltips (used by generated insight marks). */
  silent?: boolean;
  /** Draw order; higher is on top. */
  z2?: number;
  /** Custom transform; usually produced by `binX`, `stackY`, ... */
  transform?: Transform<D>;
  /** Per-mark ECharts series overrides (escape hatch). */
  echarts?: Record<string, unknown>;
  /** Data-driven gradient along the mark (`fill`/`stroke` of a numeric channel). */
  gradient?: GradientSpec | string[] | boolean;
  /** Label formatter for text marks / bar labels. */
  label?: boolean | string | ((d: D, i: number) => string);
  [extra: string]: unknown;
}

export type SortOrder<D = Row> =
  | string
  | ((a: D, b: D) => number)
  | {
      x?: SortChannel;
      y?: SortChannel;
      color?: SortChannel;
      fx?: SortChannel;
      fy?: SortChannel;
      channel?: string;
      order?: "ascending" | "descending";
      reduce?: Reducer;
      limit?: number;
      reverse?: boolean;
    };

export type SortChannel = string | { value: string; order?: "ascending" | "descending"; reduce?: Reducer; limit?: number; reverse?: boolean };

/** Index arrays per facet (Plot's `facets`). */
export type Facets = number[][];

export interface TransformResult<D = Row> {
  data: readonly D[];
  facets: Facets;
}

/** `(data, facets) => { data, facets }`. Transforms run before channels are resolved. */
export type Transform<D = Row> = (data: readonly D[], facets: Facets) => TransformResult<D>;

export type MarkType =
  | "line"
  | "lineX"
  | "lineY"
  | "area"
  | "areaX"
  | "areaY"
  | "bar"
  | "barX"
  | "barY"
  | "rect"
  | "rectX"
  | "rectY"
  | "cell"
  | "dot"
  | "ruleX"
  | "ruleY"
  | "text"
  | "differenceY"
  | "differenceX"
  | "frame"
  | "gridX"
  | "gridY";

export interface Mark<D = Row> {
  readonly type: MarkType;
  readonly data: readonly D[];
  readonly options: MarkOptions<D>;
  /** Stable id (auto-assigned when not given). */
  readonly id: string;
  /** True for marks generated by insights. */
  readonly generated?: boolean;
}

/* eslint-disable-next-line @typescript-eslint/no-explicit-any */
export type Markish = Mark<any> | Mark<any>[] | Markish[] | null | undefined | false;

/** Which scale a channel belongs to. */
export type ScaleType = "quantitative" | "temporal" | "ordinal";

export interface ResolvedScale {
  type: ScaleType;
  /** For ordinal scales: ordered domain values. */
  domain: Value[];
  /** For continuous scales: `[min, max]`. */
  extent: [number, number];
  label?: string;
}
