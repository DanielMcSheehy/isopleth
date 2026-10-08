/**
 * WebAssembly backend: wraps the wasm-bindgen output of `crates/isopleth-wasm`
 * (published as `@isopleth/wasm`) behind the `Backend` interface.
 *
 * ```ts
 * import * as ip from "isopleth";
 * import { loadWasm } from "isopleth/wasm";
 * await ip.init(loadWasm());
 * ```
 *
 * The import is dynamic so that apps that never call `loadWasm()` do not ship
 * the `.wasm` file.
 */

import type { Backend } from "./types.js";
import { BackendError } from "./types.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
type WasmModule = Record<string, any> & { default?: (input?: unknown) => Promise<unknown>; initSync?: (opts: unknown) => unknown };

export interface LoadWasmOptions {
  /** URL / Response / bytes / compiled module for the `.wasm` file (passed to wasm-bindgen's `init`). */
  module?: unknown;
  /** Supply an already-imported `@isopleth/wasm` module (e.g. from a custom path or `initSync`). */
  bindings?: WasmModule;
}

/** Load and initialise the WebAssembly backend. */
export async function loadWasm(options: LoadWasmOptions = {}): Promise<Backend> {
  let mod: WasmModule;
  if (options.bindings) {
    mod = options.bindings;
  } else {
    // The specifier is built at runtime so bundlers that cannot resolve the
    // optional dependency still bundle the rest of the library.
    const specifier = "@isopleth/wasm";
    mod = (await import(/* @vite-ignore */ specifier)) as WasmModule;
  }
  if (typeof mod.default === "function") {
    await mod.default(options.module === undefined ? undefined : { module_or_path: options.module });
  }
  return wrapWasm(mod);
}

/** Wrap an initialised `@isopleth/wasm` module as a `Backend`. */
export function wrapWasm(w: WasmModule): Backend {
  const call = <T>(fn: string, ...args: unknown[]): T => {
    try {
      return w[fn](...args) as T;
    } catch (err) {
      throw new BackendError(err instanceof Error ? err.message : String(err));
    }
  };
  return {
    name: "wasm",
    capabilities: { ets: true, mstl: true, periodogram: true, bocpd: true, dbscan: true },

    ticks: (start, stop, count) => Array.from(call<Float64Array>("ticks", start, stop, count)),
    binThresholds: (values, rule, count) => call("binThresholds", values, rule, count),
    binThresholdsInterval: (values, step) => call("binThresholdsInterval", values, step),
    binAssign: (values, edges) => call("binAssign", values, edges),
    aggregate: (codes, values, nGroups, reducer) => call("aggregate", codes, values, nGroups, reducer),
    counts: (codes, nGroups) => call("counts", codes, nGroups),
    combineCodes: (a, na, b, nb) => call("combineCodes", a, na, b, nb),
    window: (values, k, anchor, reduce, strict) => call("window", values, k, anchor, reduce, strict),
    cumsum: (values) => call("cumsum", values),
    rank: (values) => call("rank", values),
    quantileRank: (values) => call("quantileRank", values),
    normalize: (values, basis) => call("normalize", values, basis),
    diff: (values) => call("diff", values),
    pctChange: (values) => call("pctChange", values),
    impute: (values, method) => call("impute", values, method),

    anomalies: (y, opts) => call("anomalies", y, opts ?? {}),
    forecast: (y, opts) => {
      const o = { ...(opts ?? {}) };
      if (o.level === null) o.level = 0;
      return call("forecast", y, o);
    },
    changepoints: (y, opts) => call("changepoints", y, opts ?? {}),
    seasonality: (y, opts) => call("seasonality", y, opts ?? {}),
    trend: (x, y, method) => call("trend", x, y, method),
    decompose: (y, period) => call("decompose", y, period),
    frequencyOutliers: (counts, sensitivity, threshold) => call("frequencyOutliers", counts, sensitivity, threshold),
    categoryOutliers: (codes, values, nGroups, reducer, sensitivity, threshold) =>
      call("categoryOutliers", codes, values, nGroups, reducer, sensitivity, threshold),
    seriesOutliers: (series, method, sensitivity) => {
      const len = series[0]?.length ?? 0;
      const flat = new Float64Array(series.length * len);
      series.forEach((s, i) => flat.set(s, i * len));
      return call("seriesOutliers", flat, series.length, method, sensitivity);
    },
  };
}
