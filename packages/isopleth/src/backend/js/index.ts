import type { Backend } from "../types.js";
import * as K from "./kernels.js";
import * as I from "./insights.js";

/** The pure-TypeScript backend. Always available; no WebAssembly required. */
export const jsBackend: Backend = {
  name: "js",
  capabilities: { ets: false, mstl: false, periodogram: false, bocpd: false, dbscan: false },

  ticks: K.ticks,
  binThresholds: K.binThresholds,
  binThresholdsInterval: K.binThresholdsInterval,
  binAssign: K.binAssign,
  aggregate: K.aggregate,
  counts: K.counts,
  combineCodes: K.combineCodes,
  window: K.window,
  cumsum: K.cumsum,
  rank: K.rank,
  quantileRank: K.quantileRank,
  normalize: K.normalize,
  diff: K.diff,
  pctChange: K.pctChange,
  impute: K.impute,

  anomalies: I.anomalies,
  forecast: I.forecast,
  changepoints: I.changepoints,
  seasonality: I.seasonality,
  trend: I.trend,
  decompose: I.decompose,
  frequencyOutliers: I.frequencyOutliers,
  categoryOutliers: I.categoryOutliers,
  seriesOutliers: I.seriesOutliers,
};

export { K as kernels, I as insights };
