/* tslint:disable */
/* eslint-disable */

/**
 * Aggregate `values` by integer `codes` (`< 0` excluded) into `nGroups`
 * buckets with a Plot-style reducer name (`count`, `sum`, `mean`, `p90`, ...).
 * Pass an empty `values` array to reduce over a constant 1 (counts).
 */
export function aggregate(codes: Int32Array, values: Float64Array, n_groups: number, reducer: string): Float64Array;

export function anomalies(y: Float64Array, opts: any): any;

/**
 * Bin index per value (`-1` = NaN / out of domain).
 */
export function binAssign(values: Float64Array, edges: Float64Array): Int32Array;

/**
 * Bin edges for `values`. `rule` is one of `auto`, `sturges`, `scott`,
 * `freedman-diaconis`, or `count` (then `count` is the tick-count hint).
 */
export function binThresholds(values: Float64Array, rule: string, count: number): Float64Array;

/**
 * Bin edges at every multiple of `step` spanning the data.
 */
export function binThresholdsInterval(values: Float64Array, step: number): Float64Array;

export function categoryOutliers(codes: Int32Array, values: Float64Array, n_groups: number, reducer?: string | null, sensitivity?: number | null, threshold?: number | null): any;

export function changepoints(y: Float64Array, opts: any): any;

export function combineCodes(a: Int32Array, na: number, b: Int32Array, nb: number): Int32Array;

export function counts(codes: Int32Array, n_groups: number): Float64Array;

export function cumsum(values: Float64Array): Float64Array;

export function decompose(y: Float64Array, period: number): any;

export function diff(values: Float64Array): Float64Array;

export function forecast(y: Float64Array, opts: any): any;

export function frequencyOutliers(counts: Float64Array, sensitivity?: number | null, threshold?: number | null): any;

export function impute(values: Float64Array, method: string): Float64Array;

export function normalize(values: Float64Array, basis: string): Float64Array;

export function pctChange(values: Float64Array): Float64Array;

export function quantileRank(values: Float64Array): Float64Array;

export function rank(values: Float64Array): Float64Array;

export function seasonality(y: Float64Array, opts: any): any;

/**
 * `series` is a flat row-major `Float64Array` of `nSeries × len` values.
 */
export function seriesOutliers(series: Float64Array, n_series: number, method: string, sensitivity?: number | null): any;

export function start(): void;

/**
 * `d3.ticks` port, exposed so axes and bins agree.
 */
export function ticks(start: number, stop: number, count: number): Float64Array;

export function trend(x: Float64Array, y: Float64Array, method: string): any;

export function version(): string;

/**
 * Rolling window. `anchor` ∈ `start|middle|end`; `reduce` is a reducer name or
 * `difference` / `ratio`.
 */
declare function window2(values: Float64Array, k: number, anchor: string, reduce: string, strict: boolean): Float64Array;
export { window2 as window }

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly aggregate: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => void;
    readonly anomalies: (a: number, b: number, c: number, d: number) => void;
    readonly binAssign: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly binThresholds: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly binThresholdsInterval: (a: number, b: number, c: number, d: number) => void;
    readonly categoryOutliers: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number) => void;
    readonly changepoints: (a: number, b: number, c: number, d: number) => void;
    readonly combineCodes: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => void;
    readonly counts: (a: number, b: number, c: number, d: number) => void;
    readonly cumsum: (a: number, b: number, c: number) => void;
    readonly decompose: (a: number, b: number, c: number, d: number) => void;
    readonly diff: (a: number, b: number, c: number) => void;
    readonly forecast: (a: number, b: number, c: number, d: number) => void;
    readonly frequencyOutliers: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => void;
    readonly impute: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly normalize: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly pctChange: (a: number, b: number, c: number) => void;
    readonly quantileRank: (a: number, b: number, c: number) => void;
    readonly rank: (a: number, b: number, c: number) => void;
    readonly seasonality: (a: number, b: number, c: number, d: number) => void;
    readonly seriesOutliers: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => void;
    readonly start: () => void;
    readonly ticks: (a: number, b: number, c: number, d: number) => void;
    readonly trend: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => void;
    readonly version: (a: number) => void;
    readonly window: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number) => void;
    readonly __wbindgen_export: (a: number, b: number) => number;
    readonly __wbindgen_export2: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_export3: (a: number) => void;
    readonly __wbindgen_export4: (a: number, b: number, c: number) => void;
    readonly __wbindgen_add_to_stack_pointer: (a: number) => number;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
