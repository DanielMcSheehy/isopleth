/**
 * Insight kernels in TypeScript. These mirror `isopleth-core::insights`; the
 * models that need augurs (AutoETS, MSTL, periodogram, BOCPD, DBSCAN) are
 * replaced by deterministic alternatives and reported as such in `method`.
 */

import * as S from "./stats.js";
import { aggregate, impute, parseReducer } from "./kernels.js";
import { BackendError } from "../types.js";
import type {
  AnomalyOpts,
  AnomalyResult,
  CategoryOutlierResult,
  ChangepointOpts,
  ChangepointResult,
  Decomposition,
  ForecastOpts,
  ForecastResult,
  FrequencyOutlierResult,
  SeasonalityOpts,
  SeasonalityResult,
  SeriesOutlierResult,
  TrendResult,
} from "../types.js";

const arr = (a: ArrayLike<number>): number[] => Array.from(a);

// ------------------------------------------------------------ decompose ---

export function centredMovingMedian(y: ArrayLike<number>, period: number): Float64Array {
  const n = y.length;
  const width = Math.max(1, period % 2 === 0 ? period + 1 : period);
  const half = Math.floor(width / 2);
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const lo = Math.max(0, i - half);
    const hi = Math.min(n, i + half + 1);
    const buf: number[] = [];
    for (let j = lo; j < hi; j++) if (Number.isFinite(y[j])) buf.push(y[j]);
    buf.sort((a, b) => a - b);
    out[i] = S.quantileSorted(buf, 0.5);
  }
  return out;
}

export function centredMovingAverage(y: ArrayLike<number>, period: number): Float64Array {
  const n = y.length;
  const half = Math.floor(period / 2);
  const out = new Float64Array(n);
  const slice = (lo: number, hi: number) => {
    const b: number[] = [];
    for (let j = lo; j < hi; j++) b.push(y[j]);
    return b;
  };
  if (period % 2 === 1 || period === 0) {
    for (let i = 0; i < n; i++) out[i] = S.mean(slice(Math.max(0, i - half), Math.min(n, i + half + 1)));
    return out;
  }
  for (let i = 0; i < n; i++) {
    const a = S.mean(slice(Math.max(0, i - half), Math.min(n, i + half)));
    const b = S.mean(slice(Math.max(0, i + 1 - half), Math.min(n, i + half + 1)));
    out[i] = (a + b) / 2;
  }
  return out;
}

export function decompose(y: Float64Array, period: number): Decomposition {
  const n = y.length;
  if (period < 2) throw new BackendError("period must be >= 2");
  if (n < 2 * period) throw new BackendError(`not enough data: needed ${2 * period}, got ${n}`);
  const filled = impute(y, "linear");
  const trend = centredMovingAverage(centredMovingMedian(filled, period), period);
  const byPhase: number[][] = Array.from({ length: period }, () => []);
  for (let i = 0; i < n; i++) {
    const v = filled[i] - trend[i];
    if (Number.isFinite(v)) byPhase[i % period].push(v);
  }
  const phase = byPhase.map((b) => (b.length ? S.median(b) : 0));
  const mp = S.mean(phase);
  for (let i = 0; i < period; i++) phase[i] -= mp;
  const seasonal = new Array<number>(n);
  const remainder = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    seasonal[i] = phase[i % period];
    remainder[i] = Number.isFinite(y[i]) ? y[i] - trend[i] - seasonal[i] : NaN;
  }
  return { trend: arr(trend), seasonal, remainder, period };
}

// ---------------------------------------------------------- seasonality ---

export function detrend(y: ArrayLike<number>): Float64Array {
  const x = Float64Array.from({ length: y.length }, (_, i) => i);
  const [slope, intercept] = S.ols(x, y);
  const out = new Float64Array(y.length);
  for (let i = 0; i < y.length; i++) out[i] = Number.isFinite(slope) ? y[i] - (slope * i + intercept) : y[i];
  return out;
}

export function autocorrelationPeriods(y: ArrayLike<number>, minPeriod: number, maxPeriod: number, threshold: number): number[] {
  const n = y.length;
  if (n < 4 || maxPeriod < minPeriod) return [];
  const hi = Math.min(maxPeriod, n - 2);
  const acf: number[] = [];
  for (let lag = 0; lag <= hi + 1; lag++) acf.push(S.autocorrelation(y, lag));
  const cands: [number, number][] = [];
  for (let lag = Math.max(2, minPeriod); lag <= hi; lag++) {
    if (acf[lag] > threshold && acf[lag] >= acf[lag - 1] && acf[lag] >= acf[lag + 1]) cands.push([lag, acf[lag]]);
  }
  cands.sort((a, b) => b[1] - a[1]);
  const out: number[] = [];
  for (const [lag] of cands) {
    if (out.some((p) => lag % p === 0 || p % lag === 0)) continue;
    out.push(lag);
  }
  return out;
}

export function seasonality(y: Float64Array, opts: SeasonalityOpts = {}): SeasonalityResult {
  const n = y.length;
  const minPeriod = opts.minPeriod ?? 4;
  const maxPeriod = Math.max(minPeriod, opts.maxPeriod ?? Math.min(Math.floor(n / 3), 512));
  if (n < 3 * Math.max(2, minPeriod)) return { periods: [], strengths: [], method: "none" };
  const filled = detrend(impute(y, "linear"));
  const minStrength = opts.minStrength ?? 0.3;
  const threshold = opts.method === "autocorrelation" ? (opts.threshold ?? 0.3) : 0.3;
  const periods = autocorrelationPeriods(filled, minPeriod, maxPeriod, threshold);
  let scored = periods.map((p) => [p, S.autocorrelation(filled, p)] as [number, number]).filter(([, s]) => Number.isFinite(s) && s >= minStrength);
  scored = scored.filter(([p, s]) => !scored.some(([q, t]) => q < p && p % q === 0 && t >= s - 0.05));
  scored.sort((a, b) => b[1] - a[1]);
  return { periods: scored.map((s) => s[0]), strengths: scored.map((s) => s[1]), method: "autocorrelation" };
}

// -------------------------------------------------------------- anomaly ---

export function defaultWindow(n: number, period?: number): number {
  const base = period !== undefined && period >= 4 ? Math.max(7, 2 * period) : Math.max(7, Math.floor(n / 10));
  const w = Math.min(base, Math.max(1, n));
  return w % 2 === 0 ? w + 1 : w;
}

export function rollingMedianMad(y: ArrayLike<number>, k: number): [Float64Array, Float64Array] {
  const n = y.length;
  k = Math.max(1, Math.min(k, Math.max(1, n)));
  const half = Math.floor((k - 1) / 2);
  const global = Math.max(Number.EPSILON, S.mad(y) * S.MAD_TO_SIGMA);
  const centre = new Float64Array(n);
  const scale = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let lo = Math.max(0, i - half);
    const hi = Math.min(n, lo + k);
    lo = Math.min(lo, Math.max(0, hi - k));
    const buf: number[] = [];
    for (let j = lo; j < hi; j++) if (Number.isFinite(y[j])) buf.push(y[j]);
    buf.sort((a, b) => a - b);
    const m = S.quantileSorted(buf, 0.5);
    const dev = buf.map((v) => Math.abs(v - m)).sort((a, b) => a - b);
    const s = S.quantileSorted(dev, 0.5) * S.MAD_TO_SIGMA;
    centre[i] = m;
    scale[i] = s > 0 && Number.isFinite(s) ? s : global;
  }
  return [centre, scale];
}

function finish(scores: number[], lower: number[], upper: number[], threshold: number, method: string, period: number | null): AnomalyResult {
  const flags = scores.map((s) => (Number.isFinite(s) && s > threshold ? 1 : 0));
  const indices: number[] = [];
  flags.forEach((f, i) => f && indices.push(i));
  return { scores, flags, lower, upper, indices, threshold, method, period };
}

function scoreAgainst(y: ArrayLike<number>, centre: ArrayLike<number>, scale: ArrayLike<number>, threshold: number, method: string, period: number | null) {
  const n = y.length;
  const scores = new Array<number>(n);
  const lower = new Array<number>(n);
  const upper = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const s = Number.isFinite(scale[i]) && scale[i] > 0 ? scale[i] : Number.EPSILON;
    lower[i] = centre[i] - threshold * s;
    upper[i] = centre[i] + threshold * s;
    scores[i] = Number.isFinite(y[i]) ? Math.abs(y[i] - centre[i]) / s : NaN;
  }
  return finish(scores, lower, upper, threshold, method, period);
}

export function anomalies(y: Float64Array, opts: AnomalyOpts = {}): AnomalyResult {
  const n = y.length;
  if (S.count(y) < 3) throw new BackendError(`not enough data: needed 3, got ${S.count(y)}`);
  const method = opts.method ?? "mad";
  switch (method) {
    case "auto":
    case "mad": {
      const threshold = S.thresholdFromSensitivity(opts.sensitivity, opts.threshold ?? 3.5);
      const k = opts.window ?? defaultWindow(n, opts.period);
      const [c, s] = rollingMedianMad(y, k);
      return scoreAgainst(y, c, s, threshold, "mad", null);
    }
    case "zscore":
    case "z-score": {
      const threshold = S.thresholdFromSensitivity(opts.sensitivity, opts.threshold ?? 3);
      const m = S.mean(y);
      const sd = S.deviation(y);
      return scoreAgainst(y, new Float64Array(n).fill(m), new Float64Array(n).fill(sd), threshold, "zscore", null);
    }
    case "iqr": {
      const k = opts.sensitivity !== undefined ? 2.25 - 1.5 * Math.min(1, Math.max(0, opts.sensitivity)) : (opts.threshold ?? 1.5);
      const sorted = S.sortedFinite(y);
      const q1 = S.quantileSorted(sorted, 0.25);
      const q3 = S.quantileSorted(sorted, 0.75);
      const iqr = q3 - q1;
      const lo = q1 - k * iqr;
      const hi = q3 + k * iqr;
      const scores = arr(y).map((v) => {
        if (!Number.isFinite(v)) return NaN;
        if (iqr === 0) return v < lo || v > hi ? Infinity : 0;
        return v > q3 ? (v - q3) / iqr : v < q1 ? (q1 - v) / iqr : 0;
      });
      return finish(scores, new Array(n).fill(lo), new Array(n).fill(hi), k, "iqr", null);
    }
    case "seasonal":
    case "stl": {
      const threshold = S.thresholdFromSensitivity(opts.sensitivity, opts.threshold ?? 3.5);
      const period = opts.period ?? seasonality(y).periods[0] ?? 0;
      if (period < 2 || n < 2 * period) return anomalies(y, { ...opts, method: "mad" });
      const d = decompose(y, period);
      const k = opts.window ?? defaultWindow(n, period);
      const [rc, rs] = rollingMedianMad(d.remainder, k);
      const centre = new Float64Array(n);
      for (let i = 0; i < n; i++) centre[i] = d.trend[i] + d.seasonal[i] + rc[i];
      return scoreAgainst(y, centre, rs, threshold, "seasonal", period);
    }
    case "ewma": {
      const threshold = S.thresholdFromSensitivity(opts.sensitivity, opts.threshold ?? 3);
      const lambda = Math.min(1, Math.max(0.01, opts.lambda ?? 0.3));
      const sigma = Math.max(Number.EPSILON, S.mad(y) * S.MAD_TO_SIGMA);
      const centre = new Float64Array(n);
      const scale = new Float64Array(n);
      let z = S.median(y);
      for (let i = 0; i < n; i++) {
        const t = i + 1;
        const s = Math.max(Number.EPSILON, sigma * Math.sqrt((lambda / (2 - lambda)) * (1 - Math.pow(1 - lambda, 2 * t))));
        centre[i] = z;
        scale[i] = s;
        const v = y[i];
        if (Number.isFinite(v) && Math.abs(v - z) / s <= threshold) z = lambda * v + (1 - lambda) * z;
      }
      return scoreAgainst(y, centre, scale, threshold, "ewma", null);
    }
    default:
      throw new BackendError(`unknown anomaly method: ${method}`);
  }
}

// ------------------------------------------------------------- forecast ---

function interval(point: number[], sd: number, level: number | null, growth: (h: number) => number): [number[], number[]] {
  if (level === null) return [point.map(() => NaN), point.map(() => NaN)];
  const z = S.zForLevel(level);
  return [point.map((p, h) => p - z * sd * Math.sqrt(growth(h + 1))), point.map((p, h) => p + z * sd * Math.sqrt(growth(h + 1)))];
}

function residualSd(y: ArrayLike<number>, fitted: ArrayLike<number>): number {
  const r: number[] = [];
  for (let i = 0; i < y.length; i++) r.push(y[i] - fitted[i]);
  const sd = S.deviation(r);
  return Number.isFinite(sd) && sd > 0 ? sd : Number.EPSILON;
}

function resolvePeriod(y: Float64Array, given?: number): number | null {
  if (given !== undefined) return given >= 2 && y.length >= 2 * given ? given : null;
  return seasonality(y).periods.find((p) => p >= 2 && y.length >= 3 * p) ?? null;
}

function naive(y: Float64Array, horizon: number, level: number | null, drift: boolean): ForecastResult {
  const n = y.length;
  const last = y[n - 1];
  const slope = drift && n > 1 ? (last - y[0]) / (n - 1) : 0;
  const fitted = new Array<number>(n).fill(NaN);
  for (let i = 1; i < n; i++) fitted[i] = y[i - 1] + slope;
  const sd = residualSd(y, fitted);
  const point = Array.from({ length: horizon }, (_, h) => last + (h + 1) * slope);
  const [lower, upper] = interval(point, sd, level, (h) => (drift ? h * (1 + h / n) : h));
  return { point, lower, upper, fitted, level, method: drift ? "drift" : "naive", period: null };
}

function holtPass(y: Float64Array, alpha: number, beta: number): [number[], number, number, number] {
  const n = y.length;
  let l = y[0];
  let b = n > 1 ? y[1] - y[0] : 0;
  const fitted = new Array<number>(n).fill(NaN);
  let sse = 0;
  for (let i = 1; i < n; i++) {
    const f = l + b;
    fitted[i] = f;
    const e = y[i] - f;
    sse += e * e;
    const lNew = alpha * y[i] + (1 - alpha) * (l + b);
    b = beta * (lNew - l) + (1 - beta) * b;
    l = lNew;
  }
  return [fitted, l, b, sse];
}

function holt(y: Float64Array, horizon: number, level: number | null): ForecastResult {
  if (y.length < 3) return naive(y, horizon, level, false);
  const grid = [0.05, 0.15, 0.3, 0.5, 0.7, 0.9];
  let best: [number, number, number] = [Infinity, 0.3, 0.1];
  for (const a of grid) for (const b of grid) {
    if (b > a) continue;
    const sse = holtPass(y, a, b)[3];
    if (sse < best[0]) best = [sse, a, b];
  }
  const [, alpha, beta] = best;
  const [fitted, l, b] = holtPass(y, alpha, beta);
  const sd = residualSd(y, fitted);
  const point = Array.from({ length: horizon }, (_, h) => l + (h + 1) * b);
  const [lower, upper] = interval(point, sd, level, (h) => {
    let s = 1;
    for (let j = 1; j < h; j++) s += Math.pow(alpha + beta * j, 2);
    return s;
  });
  return { point, lower, upper, fitted, level, method: "holt", period: null };
}

function hwPass(y: Float64Array, m: number, alpha: number, beta: number, gamma: number, s0: number[]): [number[], number, number, number[], number] {
  const n = y.length;
  const s = s0.slice();
  let l = S.mean(y.subarray(0, m));
  let b = (S.mean(y.subarray(m, Math.min(2 * m, n))) - l) / m;
  const fitted = new Array<number>(n).fill(NaN);
  let sse = 0;
  for (let i = 0; i < n; i++) {
    const si = s[i % m];
    const f = l + b + si;
    if (i >= m) {
      fitted[i] = f;
      const e = y[i] - f;
      sse += e * e;
    }
    const lNew = alpha * (y[i] - si) + (1 - alpha) * (l + b);
    b = beta * (lNew - l) + (1 - beta) * b;
    s[i % m] = gamma * (y[i] - lNew) + (1 - gamma) * si;
    l = lNew;
  }
  return [fitted, l, b, s, sse];
}

function holtWinters(y: Float64Array, horizon: number, level: number | null, m: number): ForecastResult {
  const n = y.length;
  if (n < 2 * m || m < 2) throw new BackendError(`not enough data: needed ${2 * m}, got ${n}`);
  const d = decompose(y, m);
  const s0 = d.seasonal.slice(0, m);
  let best: [number, number, number, number] = [Infinity, 0.3, 0.05, 0.2];
  for (const a of [0.1, 0.3, 0.5, 0.7]) for (const b of [0.01, 0.05, 0.2]) for (const g of [0.05, 0.2, 0.5]) {
    const sse = hwPass(y, m, a, b, g, s0)[4];
    if (sse < best[0]) best = [sse, a, b, g];
  }
  const [, alpha, beta, gamma] = best;
  const [fitted, l, b, s] = hwPass(y, m, alpha, beta, gamma, s0);
  const sd = residualSd(y, fitted);
  const point = Array.from({ length: horizon }, (_, h) => l + (h + 1) * b + s[(n + h) % m]);
  const [lower, upper] = interval(point, sd, level, (h) => {
    let acc = 1;
    for (let j = 1; j < h; j++) acc += Math.pow(alpha + beta * j + (j % m === 0 ? gamma : 0), 2);
    return acc;
  });
  return { point, lower, upper, fitted, level, method: "holt-winters", period: m };
}

export function forecast(y: Float64Array, opts: ForecastOpts = {}): ForecastResult {
  const horizon = opts.horizon ?? 10;
  const level = opts.level === undefined ? 0.95 : opts.level === null || opts.level <= 0 ? null : opts.level;
  if (!(horizon >= 1)) throw new BackendError("horizon must be >= 1");
  if (level !== null && !(level > 0 && level < 1)) throw new BackendError("level must be in (0, 1)");
  if (S.count(y) < 2) throw new BackendError(`not enough data: needed 2, got ${S.count(y)}`);
  const filled = impute(y, "linear");
  const method = opts.method ?? "auto";
  switch (method) {
    case "naive":
      return naive(filled, horizon, level, false);
    case "drift":
      return naive(filled, horizon, level, true);
    case "holt":
    case "ets":
      return holt(filled, horizon, level);
    case "holt-winters":
    case "hw":
    case "mstl": {
      const p = resolvePeriod(filled, opts.period);
      if (p === null) throw new BackendError(`no seasonal period found for ${method}`);
      return holtWinters(filled, horizon, level, p);
    }
    case "auto": {
      if (filled.length < 10) return naive(filled, horizon, level, filled.length >= 3);
      const p = resolvePeriod(filled, opts.period);
      if (p !== null && filled.length >= 3 * p) {
        try {
          return holtWinters(filled, horizon, level, p);
        } catch {
          /* fall through */
        }
      }
      return holt(filled, horizon, level);
    }
    default:
      throw new BackendError(`unknown forecast method: ${method}`);
  }
}

// ---------------------------------------------------------- changepoint ---

export function binarySegmentation(y: Float64Array, minSegment: number, maxChangepoints: number, penalty: number, model: "mean" | "linear" = "linear"): number[] {
  const n = y.length;
  const linear = model === "linear";
  const minSeg = Math.max(linear ? 3 : 1, minSegment);
  if (n < 2 * minSeg) return [];
  const diffs: number[] = [];
  for (let i = 1; i < n; i++) diffs.push(y[i] - y[i - 1]);
  const sigma = Math.max(1e-12, (S.mad(diffs) * S.MAD_TO_SIGMA) / Math.SQRT2);
  const pen = Math.max(0, penalty) * 3 * (linear ? 2 : 1) * sigma * sigma * Math.log(n);
  const ps = new Float64Array(n + 1);
  const pss = new Float64Array(n + 1);
  const px = new Float64Array(n + 1);
  const pxx = new Float64Array(n + 1);
  const pxy = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) {
    ps[i + 1] = ps[i] + y[i];
    pss[i + 1] = pss[i] + y[i] * y[i];
    px[i + 1] = px[i] + i;
    pxx[i + 1] = pxx[i] + i * i;
    pxy[i + 1] = pxy[i] + i * y[i];
  }
  const cost = (a: number, b: number) => {
    const len = b - a;
    const sy = ps[b] - ps[a];
    const syy = pss[b] - pss[a] - (sy * sy) / len;
    if (!linear) return syy;
    const sx = px[b] - px[a];
    const sxx = pxx[b] - pxx[a] - (sx * sx) / len;
    const sxy = pxy[b] - pxy[a] - (sx * sy) / len;
    return sxx <= 0 ? syy : Math.max(0, syy - (sxy * sxy) / sxx);
  };
  const bestSplit = (a: number, b: number): [number, number] | null => {
    if (b - a < 2 * minSeg) return null;
    const base = cost(a, b);
    let best: [number, number] | null = null;
    for (let k = a + minSeg; k <= b - minSeg; k++) {
      const gain = base - cost(a, k) - cost(k, b);
      if (best === null || gain > best[1]) best = [k, gain];
    }
    return best;
  };
  const cps: number[] = [];
  const segments: [number, number][] = [[0, n]];
  while (cps.length < maxChangepoints) {
    let cand: [number, number, number] | null = null;
    segments.forEach(([a, b], si) => {
      const s = bestSplit(a, b);
      if (s && s[1] > pen && (cand === null || s[1] > cand[2])) cand = [si, s[0], s[1]];
    });
    if (cand === null) break;
    const [si, k] = cand as [number, number, number];
    const [a, b] = segments[si];
    segments[si] = [a, k];
    segments.push([k, b]);
    cps.push(k);
  }
  return cps.sort((a, b) => a - b);
}

export function changepoints(y: Float64Array, opts: ChangepointOpts = {}): ChangepointResult {
  const minSegment = opts.minSegment ?? 5;
  if (S.count(y) < 2 * Math.max(1, minSegment)) throw new BackendError(`not enough data: needed ${2 * minSegment}, got ${S.count(y)}`);
  const method = opts.method ?? "auto";
  if (!["auto", "binseg", "binary-segmentation", "argpcp", "normal-gamma"].includes(method)) throw new BackendError(`unknown changepoint method: ${method}`);
  const filled = impute(y, "linear");
  const model = opts.model ?? "linear";
  if (model !== "mean" && model !== "linear") throw new BackendError(`unknown changepoint model: ${model}`);
  const indices = binarySegmentation(filled, minSegment, opts.maxChangepoints ?? 10, opts.penalty ?? 1, model).filter((i) => i > 0 && i < filled.length);
  const segmentMeans: number[] = [];
  let start = 0;
  for (const c of [...indices, filled.length]) {
    segmentMeans.push(S.mean(filled.subarray(start, c)));
    start = c;
  }
  return { indices, segmentMeans, method: "binseg" };
}

// ---------------------------------------------------------------- trend ---

export function trend(x: Float64Array, y: Float64Array, method: string): TrendResult {
  if (x.length !== y.length) throw new BackendError(`length mismatch: expected ${x.length}, got ${y.length}`);
  let valid = 0;
  for (let i = 0; i < x.length; i++) if (Number.isFinite(x[i]) && Number.isFinite(y[i])) valid++;
  if (valid < 2) throw new BackendError(`not enough data: needed 2, got ${valid}`);
  let slope: number;
  let intercept: number;
  let name: string;
  switch (method) {
    case "ols":
    case "linear":
    case "auto":
      [slope, intercept] = S.ols(x, y);
      name = "ols";
      break;
    case "theil-sen":
    case "theilsen":
    case "robust": {
      const CAP = 2000;
      if (x.length > CAP) {
        const step = x.length / CAP;
        const xs = Float64Array.from({ length: CAP }, (_, i) => x[Math.floor(i * step)]);
        const ys = Float64Array.from({ length: CAP }, (_, i) => y[Math.floor(i * step)]);
        [slope, intercept] = S.theilSen(xs, ys);
      } else [slope, intercept] = S.theilSen(x, y);
      name = "theil-sen";
      break;
    }
    default:
      throw new BackendError(`unknown trend method: ${method}`);
  }
  const fitted = arr(x).map((xi) => (Number.isFinite(xi) ? slope * xi + intercept : NaN));
  const ybar = S.mean(y);
  let ssRes = 0;
  let ssTot = 0;
  for (let i = 0; i < y.length; i++) {
    if (Number.isFinite(y[i]) && Number.isFinite(fitted[i])) {
      ssRes += (y[i] - fitted[i]) ** 2;
      ssTot += (y[i] - ybar) ** 2;
    }
  }
  return { slope, intercept, fitted, r2: ssTot > 0 ? 1 - ssRes / ssTot : NaN, method: name };
}

// ------------------------------------------------------------- outliers ---

export function robustZ(values: ArrayLike<number>): number[] {
  const m = S.median(values);
  let s = S.mad(values) * S.MAD_TO_SIGMA;
  if (!(s > 0)) {
    const dev: number[] = [];
    for (let i = 0; i < values.length; i++) if (Number.isFinite(values[i])) dev.push(Math.abs(values[i] - m));
    s = S.mean(dev) * 1.2533;
  }
  return arr(values).map((v) => (!Number.isFinite(v) ? NaN : s > 0 ? (v - m) / s : 0));
}

export function frequencyOutliers(counts: Float64Array, sensitivity?: number, threshold?: number): FrequencyOutlierResult {
  const t = S.thresholdFromSensitivity(sensitivity, threshold ?? 2.5);
  const logs = arr(counts).map((c) => Math.log(Math.max(0, c) + 1));
  const scores = counts.length >= 3 ? robustZ(logs) : new Array<number>(counts.length).fill(0);
  const rare: number[] = [];
  const dominant: number[] = [];
  scores.forEach((z, i) => {
    if (z < -t) rare.push(i);
    if (z > t) dominant.push(i);
  });
  return { scores, rare, dominant, threshold: t };
}

export function categoryOutliers(
  codes: Int32Array,
  values: Float64Array,
  nGroups: number,
  reducer?: string,
  sensitivity?: number,
  threshold?: number,
): CategoryOutlierResult {
  if (codes.length !== values.length) throw new BackendError(`length mismatch: expected ${codes.length}, got ${values.length}`);
  const t = S.thresholdFromSensitivity(sensitivity, threshold ?? 3);
  const red = reducer && reducer !== "" ? reducer : "median";
  if (!parseReducer(red)) throw new BackendError(`unknown reducer: ${red}`);
  const aggregates = arr(aggregate(codes, values, nGroups, red));
  const scores = nGroups >= 3 ? robustZ(aggregates) : new Array<number>(nGroups).fill(0);
  const categories: number[] = [];
  scores.forEach((z, i) => Number.isFinite(z) && Math.abs(z) > t && categories.push(i));
  const buckets: number[][] = Array.from({ length: nGroups }, () => []);
  for (let i = 0; i < codes.length; i++) if (codes[i] >= 0 && codes[i] < nGroups) buckets[codes[i]].push(values[i]);
  const statsPer = buckets.map((b): [number, number] => {
    if (S.count(b) < 4) return [NaN, NaN];
    const m = S.median(b);
    let s = S.mad(b) * S.MAD_TO_SIGMA;
    if (!(s > 0)) s = S.mean(b.filter(Number.isFinite).map((v) => Math.abs(v - m))) * 1.2533;
    return [m, s];
  });
  const withinScores = arr(codes).map((c, i) => {
    const v = values[i];
    if (c < 0 || c >= nGroups || !Number.isFinite(v)) return NaN;
    const [m, s] = statsPer[c];
    if (!Number.isFinite(m)) return NaN;
    return s > 0 ? Math.abs(v - m) / s : 0;
  });
  const within: number[] = [];
  withinScores.forEach((z, i) => Number.isFinite(z) && z > t && within.push(i));
  return { aggregates, scores, categories, withinScores, within, threshold: t };
}

/**
 * Cross-series outliers without DBSCAN: at every timestamp, score each series
 * by its robust z against the median of all series; a series is outlying when
 * its mean score exceeds the threshold derived from `sensitivity`.
 */
export function seriesOutliers(series: Float64Array[], method: string, sensitivity?: number): SeriesOutlierResult {
  if (series.length === 0) throw new BackendError("not enough data: needed 1 series");
  const len = series[0].length;
  for (const s of series) if (s.length !== len) throw new BackendError(`length mismatch: expected ${len}, got ${s.length}`);
  if (!["dbscan", "mad", "auto"].includes(method)) throw new BackendError(`unknown series outlier method: ${method}`);
  const sens = Math.min(0.99, Math.max(0.01, sensitivity ?? 0.5));
  const t = 6 - 4 * sens; // same mapping as point anomalies
  const scores: number[][] = series.map(() => new Array<number>(len).fill(0));
  const bandMin = new Array<number>(len).fill(NaN);
  const bandMax = new Array<number>(len).fill(NaN);
  const column: number[] = [];
  for (let i = 0; i < len; i++) {
    column.length = 0;
    for (const s of series) column.push(s[i]);
    const m = S.median(column);
    let s = S.mad(column) * S.MAD_TO_SIGMA;
    // When most series agree exactly (MAD = 0) any deviation is significant:
    // fall back to half the mean absolute deviation rather than a normal-consistent scale.
    if (!(s > 0)) s = Math.abs(S.mean(column.filter(Number.isFinite).map((v) => Math.abs(v - m)))) * 0.5;
    if (S.count(column) >= 3) {
      bandMin[i] = m - t * s;
      bandMax[i] = m + t * s;
    }
    for (let k = 0; k < series.length; k++) {
      const v = column[k];
      scores[k][i] = Number.isFinite(v) && s > 0 ? Math.min(1, Math.abs(v - m) / s / t) : 0;
    }
  }
  const outlying: number[] = [];
  scores.forEach((sc, k) => {
    // Outlying when it sits beyond the threshold for at least 10% of the timestamps.
    const beyond = sc.filter((v) => v >= 1).length / Math.max(1, sc.length);
    if (series.length >= 3 && beyond >= 0.1) outlying.push(k);
  });
  return { outlying, scores, bandMin, bandMax, method: "mad" };
}
