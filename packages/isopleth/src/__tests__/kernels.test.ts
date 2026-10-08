import { describe, expect, it } from "vitest";
import { kernels as K, insights as I } from "../backend/js/index.js";

const N = NaN;

describe("ticks / bins", () => {
  it("matches d3.ticks", () => {
    expect(K.ticks(0, 10, 5)).toEqual([0, 2, 4, 6, 8, 10]);
    expect(K.ticks(0, 1, 4)).toEqual([0, 0.2, 0.4, 0.6, 0.8, 1]);
    expect(K.ticks(1, 1, 5)).toEqual([1]);
    expect(K.tickIncrement(0, 10, 5)).toBe(2);
  });
  it("sturges bins cover data with uniform width", () => {
    const values = Float64Array.from({ length: 100 }, (_, i) => i * 0.37);
    const edges = K.binThresholds(values, "sturges", 0);
    const w = Array.from(edges.slice(1)).map((e, i) => e - edges[i]);
    for (const x of w) expect(Math.abs(x - w[0])).toBeLessThan(1e-9);
    const idx = K.binAssign(values, edges);
    expect(Array.from(idx).every((i) => i >= 0)).toBe(true);
    expect(idx[idx.length - 1]).toBe(edges.length - 2);
  });
  it("interval thresholds", () => {
    const edges = K.binThresholdsInterval(Float64Array.of(1.5, 7.2, 3), 2);
    expect(Array.from(edges)).toEqual([0, 2, 4, 6, 8]);
    expect(Array.from(K.binAssign(Float64Array.of(1.5, 7.2, 3, N, 8, 9), edges))).toEqual([0, 3, 1, -1, 3, -1]);
  });
});

describe("aggregate / window / maps", () => {
  it("aggregates by code", () => {
    const codes = Int32Array.of(0, 1, 0, -1, 2, 1);
    const values = Float64Array.of(1, 10, 3, 99, N, 30);
    expect(Array.from(K.aggregate(codes, values, 3, "sum"))).toEqual([4, 40, 0]);
    expect(Array.from(K.aggregate(codes, values, 3, "count"))).toEqual([2, 2, 0]);
    expect(Array.from(K.aggregate(codes, new Float64Array(0), 3, "count"))).toEqual([2, 2, 1]);
    expect(K.aggregate(codes, values, 3, "mean")[1]).toBe(20);
    expect(K.aggregate(codes, values, 3, "max-index")[1]).toBe(5);
    expect(K.aggregate(codes, values, 3, "p50")[0]).toBe(2);
    expect(() => K.aggregate(codes, values, 3, "nope")).toThrow();
  });
  it("windows", () => {
    const v = Float64Array.of(1, 2, 3, 4, 5);
    expect(Array.from(K.window(v, 3, "end", "mean", false))).toEqual([1, 1.5, 2, 3, 4]);
    const strict = K.window(v, 3, "end", "mean", true);
    expect(Number.isNaN(strict[0]) && Number.isNaN(strict[1])).toBe(true);
    expect(Array.from(strict.slice(2))).toEqual([2, 3, 4]);
    const vn = Float64Array.of(1, N, 3, 4, 5);
    expect(Array.from(K.window(vn, 3, "middle", "sum", false))).toEqual([1, 4, 7, 12, 9]);
    expect(Array.from(K.window(Float64Array.of(2, 4, 8, 16), 2, "end", "difference", false))).toEqual([0, 2, 4, 8]);
    expect(Array.from(K.window(Float64Array.of(2, 4, 8, 16), 3, "middle", "median", false))).toEqual([3, 4, 8, 12]);
  });
  it("min/max deque matches naive", () => {
    const v = Float64Array.from({ length: 200 }, (_, i) => ((i * 7919) % 101) * (i % 13 === 0 ? N : 1));
    for (const anchor of ["start", "middle", "end"]) {
      for (const k of [1, 2, 5, 17]) {
        const fast = K.window(v, k, anchor, "max", false);
        const s = anchor === "start" ? 0 : anchor === "end" ? k - 1 : Math.floor((k - 1) / 2);
        for (let i = 0; i < v.length; i++) {
          const lo = Math.max(0, i - s);
          const hi = Math.min(v.length, i - s + k);
          let m = N;
          for (let j = lo; j < hi; j++) if (Number.isFinite(v[j]) && (Number.isNaN(m) || v[j] > m)) m = v[j];
          expect(Object.is(fast[i], m) || fast[i] === m).toBe(true);
        }
      }
    }
  });
  it("maps", () => {
    expect(Array.from(K.cumsum(Float64Array.of(1, N, 2)))).toEqual([1, 1, 3]);
    expect(Array.from(K.rank(Float64Array.of(30, 10, 20, 10)))).toEqual([3, 0, 2, 0]);
    expect(Array.from(K.normalize(Float64Array.of(2, 4, 6), "extent"))).toEqual([0, 0.5, 1]);
    expect(Array.from(K.impute(Float64Array.of(N, 1, N, N, 4, N), "linear"))).toEqual([1, 1, 2, 3, 4, 4]);
    expect(Array.from(K.impute(Float64Array.of(N, 1), "zero"))).toEqual([0, 1]);
  });
});

function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

describe("insights", () => {
  const r = rng(3);
  const y = Float64Array.from({ length: 200 }, (_, i) => 50 + 5 * Math.sin((2 * Math.PI * i) / 7) + (r() * 2 - 1));
  y[60] = 120;
  y[150] = -10;
  y[90] = N;

  it("anomalies: mad finds the spikes only", () => {
    const res = I.anomalies(y);
    expect(res.indices).toEqual([60, 150]);
    expect(Number.isNaN(res.scores[90])).toBe(true);
    expect(res.lower[10] < y[10] && y[10] < res.upper[10]).toBe(true);
  });
  it("anomalies: every method flags the big spike without over-flagging", () => {
    for (const method of ["zscore", "iqr", "ewma", "seasonal"]) {
      const res = I.anomalies(y, { method, period: 7 });
      expect(res.indices, method).toContain(60);
      expect(res.indices.length, method).toBeLessThanOrEqual(6);
    }
    expect(I.anomalies(y, { sensitivity: 0 }).threshold).toBe(6);
    expect(() => I.anomalies(Float64Array.of(1, N))).toThrow();
  });
  it("forecast: simple methods extrapolate and auto picks sensibly", () => {
    const r2 = rng(7);
    const t = Float64Array.from({ length: 40 }, (_, i) => 10 + 0.5 * i + (r2() * 0.4 - 0.2));
    for (const method of ["drift", "holt"]) {
      const f = I.forecast(t, { method, horizon: 5 });
      expect(f.point.length).toBe(5);
      expect(Math.abs(f.point[4] - (10 + 0.5 * 44))).toBeLessThan(1.5);
      expect(f.lower[4] < f.point[4] && f.point[4] < f.upper[4]).toBe(true);
    }
    const pat = [5, 0, -5, 0, 3, -3, 0];
    const s = Float64Array.from({ length: 84 }, (_, i) => 50 + 0.2 * i + pat[i % 7]);
    const hw = I.forecast(s, { method: "holt-winters", horizon: 7, period: 7 });
    expect(hw.point[0] - hw.point[2]).toBeGreaterThan(6);
    const auto = I.forecast(s);
    expect(auto.period).toBe(7);
    expect(I.forecast(t.subarray(0, 5)).method).toBe("drift");
    expect(I.forecast(t, { level: null }).lower.every(Number.isNaN)).toBe(true);
    expect(() => I.forecast(t, { horizon: 0 })).toThrow();
  });
  it("changepoints: binary segmentation finds steps and ignores noise", () => {
    const r3 = rng(1);
    const noise = () => (Array.from({ length: 12 }, () => r3()).reduce((a, b) => a + b, 0) - 6) * 0.5;
    const steps = Float64Array.from({ length: 150 }, (_, i) => (i < 50 ? 10 : i < 100 ? 20 : 5) + noise());
    const res = I.changepoints(steps);
    expect(res.indices).toEqual([50, 100]);
    expect(res.segmentMeans.length).toBe(3);
    const flat = Float64Array.from({ length: 200 }, () => noise() * 6);
    expect(I.changepoints(flat).indices).toEqual([]);
    const trendStep = Float64Array.from({ length: 200 }, (_, i) => 10 + 0.3 * i + (i >= 120 ? 25 : 0) + noise());
    expect(I.changepoints(trendStep).indices).toEqual([120]);
    expect(I.changepoints(trendStep, { model: "mean" }).indices.length).toBeGreaterThan(1);
  });
  it("seasonality + decompose + trend", () => {
    const weekly = Float64Array.from({ length: 140 }, (_, i) => 100 + 20 * (i % 7) + ((i * 13) % 5));
    expect(I.seasonality(weekly).periods[0]).toBe(7);
    expect(I.seasonality(weekly.subarray(0, 8)).periods).toEqual([]);
    const d = I.decompose(Float64Array.from({ length: 40 }, (_, i) => 10 + 0.1 * i + [2, -1, -2, 1][i % 4]), 4);
    expect(Math.abs(d.seasonal[0] - 2)).toBeLessThan(0.3);
    const x = Float64Array.from({ length: 10 }, (_, i) => i);
    const yy = Float64Array.from(x, (v) => 3 * v + 2);
    yy[5] = 100;
    expect(Math.abs(I.trend(x, yy, "theil-sen").slope - 3)).toBeLessThan(1e-9);
    expect(Math.abs(I.trend(x, Float64Array.from(x, (v) => 3 * v + 2), "ols").r2 - 1)).toBeLessThan(1e-12);
  });
  it("outliers", () => {
    const f = I.frequencyOutliers(Float64Array.of(100, 95, 110, 102, 98, 3, 105, 900));
    expect(f.rare).toEqual([5]);
    expect(f.dominant).toEqual([7]);
    const codes: number[] = [];
    const values: number[] = [];
    for (let c = 0; c < 6; c++) for (let r = 0; r < 8; r++) {
      codes.push(c);
      values.push((c === 3 ? 100 : 10) + ((r * 7 + c) % 5) * 0.5);
    }
    values[7] = 60;
    const c = I.categoryOutliers(Int32Array.from(codes), Float64Array.from(values), 6);
    expect(c.categories).toEqual([3]);
    expect(c.within).toEqual([7]);
    const normal = (phase: number) => Float64Array.from({ length: 60 }, (_, i) => 10 + Math.sin(i * 0.2 + phase));
    const series = [normal(0), normal(0.1), normal(0.2), normal(0.3), Float64Array.from({ length: 60 }, (_, i) => 10 + (i > 30 ? 15 : 0))];
    const s = I.seriesOutliers(series, "mad");
    expect(s.outlying).toEqual([4]);
    expect(Number.isFinite(s.bandMin[0])).toBe(true);
  });
});
