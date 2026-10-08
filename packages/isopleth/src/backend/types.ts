/**
 * The numeric backend interface. Two implementations exist:
 * - `js`: pure TypeScript, always available, mirrors the Rust kernels;
 * - `wasm`: `isopleth-core` compiled with wasm-bindgen (faster; has the
 *   augurs-powered models: AutoETS, MSTL, periodogram, BOCPD, DBSCAN).
 *
 * All inputs are `Float64Array` / `Int32Array`; `NaN` means missing.
 */

export interface AnomalyResult {
  scores: number[];
  flags: number[];
  lower: number[];
  upper: number[];
  indices: number[];
  threshold: number;
  method: string;
  period: number | null;
}

export interface ForecastResult {
  point: number[];
  lower: number[];
  upper: number[];
  fitted: number[];
  level: number | null;
  method: string;
  period: number | null;
}

export interface ChangepointResult {
  indices: number[];
  segmentMeans: number[];
  method: string;
}

export interface SeasonalityResult {
  periods: number[];
  strengths: number[];
  method: string;
}

export interface TrendResult {
  slope: number;
  intercept: number;
  fitted: number[];
  r2: number;
  method: string;
}

export interface Decomposition {
  trend: number[];
  seasonal: number[];
  remainder: number[];
  period: number;
}

export interface FrequencyOutlierResult {
  scores: number[];
  rare: number[];
  dominant: number[];
  threshold: number;
}

export interface CategoryOutlierResult {
  aggregates: number[];
  scores: number[];
  categories: number[];
  withinScores: number[];
  within: number[];
  threshold: number;
}

export interface SeriesOutlierResult {
  outlying: number[];
  scores: number[][];
  bandMin: number[];
  bandMax: number[];
  method: string;
}

export interface AnomalyOpts {
  method?: string;
  threshold?: number;
  sensitivity?: number;
  window?: number;
  period?: number;
  lambda?: number;
}

export interface ForecastOpts {
  method?: string;
  horizon?: number;
  level?: number | null;
  period?: number;
}

export interface ChangepointOpts {
  method?: string;
  /** Binary-segmentation cost: `"linear"` (default, trend-aware) or `"mean"`. */
  model?: "mean" | "linear";
  minSegment?: number;
  maxChangepoints?: number;
  penalty?: number;
}

export interface SeasonalityOpts {
  method?: string;
  minPeriod?: number;
  maxPeriod?: number;
  threshold?: number;
  minStrength?: number;
}

export interface BackendCapabilities {
  ets: boolean;
  mstl: boolean;
  periodogram: boolean;
  bocpd: boolean;
  dbscan: boolean;
}

export interface Backend {
  readonly name: "js" | "wasm";
  readonly capabilities: BackendCapabilities;

  ticks(start: number, stop: number, count: number): number[];
  binThresholds(values: Float64Array, rule: string, count: number): Float64Array;
  binThresholdsInterval(values: Float64Array, step: number): Float64Array;
  binAssign(values: Float64Array, edges: Float64Array): Int32Array;

  aggregate(codes: Int32Array, values: Float64Array, nGroups: number, reducer: string): Float64Array;
  counts(codes: Int32Array, nGroups: number): Float64Array;
  combineCodes(a: Int32Array, na: number, b: Int32Array, nb: number): Int32Array;

  window(values: Float64Array, k: number, anchor: string, reduce: string, strict: boolean): Float64Array;
  cumsum(values: Float64Array): Float64Array;
  rank(values: Float64Array): Float64Array;
  quantileRank(values: Float64Array): Float64Array;
  normalize(values: Float64Array, basis: string): Float64Array;
  diff(values: Float64Array): Float64Array;
  pctChange(values: Float64Array): Float64Array;
  impute(values: Float64Array, method: string): Float64Array;

  anomalies(y: Float64Array, opts?: AnomalyOpts): AnomalyResult;
  forecast(y: Float64Array, opts?: ForecastOpts): ForecastResult;
  changepoints(y: Float64Array, opts?: ChangepointOpts): ChangepointResult;
  seasonality(y: Float64Array, opts?: SeasonalityOpts): SeasonalityResult;
  trend(x: Float64Array, y: Float64Array, method: string): TrendResult;
  decompose(y: Float64Array, period: number): Decomposition;
  frequencyOutliers(counts: Float64Array, sensitivity?: number, threshold?: number): FrequencyOutlierResult;
  categoryOutliers(
    codes: Int32Array,
    values: Float64Array,
    nGroups: number,
    reducer?: string,
    sensitivity?: number,
    threshold?: number,
  ): CategoryOutlierResult;
  seriesOutliers(series: Float64Array[], method: string, sensitivity?: number): SeriesOutlierResult;
}

export class BackendError extends Error {
  override name = "IsoplethBackendError";
}
