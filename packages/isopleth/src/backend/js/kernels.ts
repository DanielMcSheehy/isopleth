/** Binning, grouping, windows, maps and imputation. Port of the matching `isopleth-core` modules. */

import * as S from "./stats.js";
import { BackendError } from "../types.js";

// ---------------------------------------------------------------- ticks ---

const E10 = Math.sqrt(50);
const E5 = Math.sqrt(10);
const E2 = Math.SQRT2;

function tickSpec(start: number, stop: number, count: number): [number, number, number] {
  const step = (stop - start) / Math.max(0, count);
  const power = Math.floor(Math.log10(step));
  const error = step / Math.pow(10, power);
  const factor = error >= E10 ? 10 : error >= E5 ? 5 : error >= E2 ? 2 : 1;
  let i1: number;
  let i2: number;
  let inc: number;
  if (power < 0) {
    inc = Math.pow(10, -power) / factor;
    i1 = Math.round(start * inc);
    i2 = Math.round(stop * inc);
    if (i1 / inc < start) ++i1;
    if (i2 / inc > stop) --i2;
    inc = -inc;
  } else {
    inc = Math.pow(10, power) * factor;
    i1 = Math.round(start / inc);
    i2 = Math.round(stop / inc);
    if (i1 * inc < start) ++i1;
    if (i2 * inc > stop) --i2;
  }
  if (i2 < i1 && 0.5 <= count && count < 2) return tickSpec(start, stop, count * 2);
  return [i1, i2, inc];
}

export function tickIncrement(start: number, stop: number, count: number): number {
  return tickSpec(start, stop, count)[2];
}

export function ticks(start: number, stop: number, count: number): number[] {
  if (!(count > 0) || !Number.isFinite(start) || !Number.isFinite(stop)) return [];
  if (start === stop) return [start];
  const reverse = stop < start;
  const [i1, i2, inc] = reverse ? tickSpec(stop, start, count) : tickSpec(start, stop, count);
  if (!(i2 >= i1)) return [];
  const n = i2 - i1 + 1;
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    out[i] = reverse ? (inc < 0 ? (i2 - i) / -inc : (i2 - i) * inc) : inc < 0 ? (i1 + i) / -inc : (i1 + i) * inc;
  }
  return out;
}

export function nice(start: number, stop: number, count: number): [number, number] {
  let prestep = 0;
  for (;;) {
    const step = tickIncrement(start, stop, count);
    if (step === prestep || step === 0 || !Number.isFinite(step)) return [start, stop];
    if (step > 0) {
      start = Math.floor(start / step) * step;
      stop = Math.ceil(stop / step) * step;
    } else {
      start = Math.ceil(start * step) / step;
      stop = Math.floor(stop * step) / step;
    }
    prestep = step;
  }
}

// -------------------------------------------------------------- binning ---

export function suggestedCount(values: ArrayLike<number>, min: number, max: number, rule: string, hint: number): number {
  const n = S.count(values);
  if (n === 0 || !(max > min)) return 1;
  let c: number;
  switch (rule) {
    case "count":
      c = hint;
      break;
    case "sturges":
      c = Math.max(1, Math.ceil(Math.log2(n)) + 1);
      break;
    case "freedman-diaconis":
    case "fd": {
      const s = S.sortedFinite(values);
      const iqr = S.quantileSorted(s, 0.75) - S.quantileSorted(s, 0.25);
      c = iqr > 0 ? Math.ceil((max - min) / (2 * iqr * Math.pow(n, -1 / 3))) : 1;
      break;
    }
    case "scott":
    case "auto":
    default: {
      const sd = S.deviation(values);
      c = sd > 0 ? Math.ceil((max - min) / (3.49 * sd * Math.pow(n, -1 / 3))) : 1;
      if (rule !== "scott") c = Math.min(c, 200);
    }
  }
  return Math.max(1, c);
}

export function binThresholds(values: Float64Array, rule: string, hint: number): Float64Array {
  const min = S.min(values);
  const max = S.max(values);
  return binThresholdsIn(values, min, max, rule, hint);
}

export function binThresholdsIn(values: ArrayLike<number>, min: number, max: number, rule: string, hint: number): Float64Array {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return new Float64Array(0);
  if (min === max) return Float64Array.of(min, min + 1);
  const count = suggestedCount(values, min, max, rule, hint);
  let [x0, x1] = nice(min, max, count);
  const tz = ticks(x0, x1, count);
  if (tz.length === 0) return Float64Array.of(min, max);
  if (tz[tz.length - 1] >= x1) {
    if (max >= x1) {
      const step = tickIncrement(x0, x1, count);
      if (Number.isFinite(step)) {
        if (step > 0) x1 = (Math.floor(x1 / step) + 1) * step;
        else if (step < 0) x1 = (Math.ceil(x1 * -step) + 1) / -step;
      }
    } else tz.pop();
  }
  const edges = [x0];
  for (const t of tz) if (t > x0 && t < x1) edges.push(t);
  edges.push(x1);
  return Float64Array.from(edges);
}

export function binThresholdsInterval(values: Float64Array, step: number): Float64Array {
  const min = S.min(values);
  const max = S.max(values);
  if (!(step > 0) || !Number.isFinite(min) || !Number.isFinite(max)) return new Float64Array(0);
  const start = Math.floor(min / step) * step;
  const stop = Math.floor(max / step) * step + step;
  const n = Math.round((stop - start) / step);
  const out = new Float64Array(n + 1);
  for (let i = 0; i <= n; i++) out[i] = start + i * step;
  return out;
}

export function binAssign(values: Float64Array, edges: Float64Array): Int32Array {
  const nb = edges.length - 1;
  const out = new Int32Array(values.length);
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (!Number.isFinite(v) || nb <= 0 || v < edges[0] || v > edges[nb]) {
      out[i] = -1;
      continue;
    }
    if (v === edges[nb]) {
      out[i] = nb - 1;
      continue;
    }
    let lo = 0;
    let hi = nb;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (edges[mid + 1] <= v) lo = mid + 1;
      else hi = mid;
    }
    out[i] = Math.min(lo, nb - 1);
  }
  return out;
}

// ------------------------------------------------------------- grouping ---

export function parseReducer(name: string): ((values: number[], indices: number[], total: number) => number) | null {
  switch (name) {
    case "count":
      return (v) => S.count(v);
    case "sum":
      return (v) => S.sum(v);
    case "mean":
      return (v) => S.mean(v);
    case "median":
      return (v) => S.median(v);
    case "min":
      return (v) => S.min(v);
    case "max":
      return (v) => S.max(v);
    case "mode":
      return (v) => S.mode(v);
    case "first":
      return (v) => S.first(v);
    case "last":
      return (v) => S.last(v);
    case "deviation":
      return (v) => S.deviation(v);
    case "variance":
      return (v) => S.variance(v);
    case "distinct":
      return (v) => S.distinct(v);
    case "proportion":
      return (v, _i, total) => (total === 0 ? NaN : S.sum(v) / total);
    case "min-index":
    case "max-index": {
      const isMin = name === "min-index";
      return (v, idx) => {
        let best = NaN;
        let bi = NaN;
        for (let i = 0; i < v.length; i++) {
          if (!Number.isFinite(v[i])) continue;
          if (Number.isNaN(best) || (isMin ? v[i] < best : v[i] > best)) {
            best = v[i];
            bi = idx[i];
          }
        }
        return bi;
      };
    }
    default: {
      const m = /^p(\d\d)$/.exec(name);
      if (!m) return null;
      const p = Number(m[1]) / 100;
      return (v) => S.quantile(v, p);
    }
  }
}

export function aggregate(codes: Int32Array, values: Float64Array, nGroups: number, reducer: string): Float64Array {
  const fn = parseReducer(reducer);
  if (!fn) throw new BackendError(`unknown reducer: ${reducer}`);
  const useOnes = values.length === 0;
  const buckets: number[][] = Array.from({ length: nGroups }, () => []);
  const idx: number[][] = Array.from({ length: nGroups }, () => []);
  for (let i = 0; i < codes.length; i++) {
    const c = codes[i];
    if (c < 0 || c >= nGroups) continue;
    buckets[c].push(useOnes ? 1 : values[i]);
    idx[c].push(i);
  }
  let total = 0;
  if (reducer === "proportion") for (const b of buckets) total += S.sum(b);
  const out = new Float64Array(nGroups);
  for (let g = 0; g < nGroups; g++) {
    if (buckets[g].length === 0) out[g] = reducer === "count" || reducer === "sum" ? 0 : NaN;
    else out[g] = fn(buckets[g], idx[g], total);
  }
  return out;
}

export function counts(codes: Int32Array, nGroups: number): Float64Array {
  const out = new Float64Array(nGroups);
  for (let i = 0; i < codes.length; i++) {
    const c = codes[i];
    if (c >= 0 && c < nGroups) out[c] += 1;
  }
  return out;
}

export function combineCodes(a: Int32Array, _na: number, b: Int32Array, nb: number): Int32Array {
  const out = new Int32Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = a[i] < 0 || b[i] < 0 ? -1 : a[i] * nb + b[i];
  return out;
}

// -------------------------------------------------------------- windows ---

function shift(anchor: string, k: number): number {
  switch (anchor) {
    case "start":
      return 0;
    case "end":
      return k - 1;
    case "middle":
      return Math.floor((k - 1) / 2);
    default:
      throw new BackendError(`unknown anchor: ${anchor}`);
  }
}

export function window(values: Float64Array, k: number, anchor: string, reduce: string, strict: boolean): Float64Array {
  if (!(k >= 1)) throw new BackendError("window k must be >= 1");
  k = Math.floor(k);
  const n = values.length;
  const s = shift(anchor, k);
  const out = new Float64Array(n).fill(NaN);
  if (reduce === "sum" || reduce === "mean" || reduce === "count") {
    const ps = new Float64Array(n + 1);
    const pc = new Int32Array(n + 1);
    for (let i = 0; i < n; i++) {
      const v = values[i];
      const f = Number.isFinite(v);
      ps[i + 1] = ps[i] + (f ? v : 0);
      pc[i + 1] = pc[i] + (f ? 1 : 0);
    }
    for (let i = 0; i < n; i++) {
      const lo0 = i - s;
      const hi0 = lo0 + k;
      const full = lo0 >= 0 && hi0 <= n;
      const lo = Math.max(0, lo0);
      const hi = Math.min(n, Math.max(0, hi0));
      if (hi <= lo) continue;
      const c = pc[hi] - pc[lo];
      if (strict && (!full || c !== k)) continue;
      if (c === 0) {
        out[i] = reduce === "count" ? 0 : NaN;
        continue;
      }
      const sum = ps[hi] - ps[lo];
      out[i] = reduce === "sum" ? sum : reduce === "mean" ? sum / c : c;
    }
    return out;
  }
  if (reduce === "min" || reduce === "max") {
    const isMax = reduce === "max";
    const dq: number[] = [];
    let head = 0;
    let nextJ = 0;
    const nanPrefix = new Int32Array(n + 1);
    for (let i = 0; i < n; i++) nanPrefix[i + 1] = nanPrefix[i] + (Number.isFinite(values[i]) ? 0 : 1);
    for (let i = 0; i < n; i++) {
      const lo0 = i - s;
      const hi0 = lo0 + k;
      const full = lo0 >= 0 && hi0 <= n;
      const lo = Math.max(0, lo0);
      const hi = Math.min(n, Math.max(0, hi0));
      while (nextJ < hi) {
        const v = values[nextJ];
        if (Number.isFinite(v)) {
          while (dq.length > head && (isMax ? v >= values[dq[dq.length - 1]] : v <= values[dq[dq.length - 1]])) dq.pop();
          dq.push(nextJ);
        }
        nextJ++;
      }
      while (dq.length > head && dq[head] < lo) head++;
      if (hi <= lo) continue;
      if (strict && (!full || nanPrefix[hi] - nanPrefix[lo] > 0)) continue;
      if (dq.length > head) out[i] = values[dq[head]];
    }
    return out;
  }
  let fn: (w: number[], idx: number[]) => number;
  if (reduce === "difference") fn = (w) => S.last(w) - S.first(w);
  else if (reduce === "ratio") fn = (w) => S.last(w) / S.first(w);
  else {
    const r = parseReducer(reduce);
    if (!r) throw new BackendError(`unknown reducer: ${reduce}`);
    fn = (w, idx) => r(w, idx, 0);
  }
  for (let i = 0; i < n; i++) {
    const lo0 = i - s;
    const hi0 = lo0 + k;
    const full = lo0 >= 0 && hi0 <= n;
    const lo = Math.max(0, lo0);
    const hi = Math.min(n, Math.max(0, hi0));
    if (hi <= lo) continue;
    const w: number[] = [];
    const idx: number[] = [];
    let anyNaN = false;
    for (let j = lo; j < hi; j++) {
      w.push(values[j]);
      idx.push(j);
      if (!Number.isFinite(values[j])) anyNaN = true;
    }
    if (strict && (!full || anyNaN)) continue;
    out[i] = fn(w, idx);
  }
  return out;
}

// ----------------------------------------------------------------- maps ---

export function cumsum(values: Float64Array): Float64Array {
  const out = new Float64Array(values.length);
  let acc = 0;
  for (let i = 0; i < values.length; i++) {
    if (Number.isFinite(values[i])) acc += values[i];
    out[i] = acc;
  }
  return out;
}

export function rank(values: Float64Array): Float64Array {
  const order: number[] = [];
  for (let i = 0; i < values.length; i++) if (Number.isFinite(values[i])) order.push(i);
  order.sort((a, b) => values[a] - values[b]);
  const out = new Float64Array(values.length).fill(NaN);
  let r = 0;
  for (let pos = 0; pos < order.length; pos++) {
    if (pos > 0 && values[order[pos]] !== values[order[pos - 1]]) r = pos;
    out[order[pos]] = r;
  }
  return out;
}

export function quantileRank(values: Float64Array): Float64Array {
  const n = S.count(values);
  const denom = n > 1 ? n - 1 : 1;
  const r = rank(values);
  for (let i = 0; i < r.length; i++) r[i] /= denom;
  return r;
}

export function normalize(values: Float64Array, basis: string): Float64Array {
  const out = new Float64Array(values.length);
  if (basis === "extent") {
    const lo = S.min(values);
    const span = S.max(values) - lo;
    for (let i = 0; i < values.length; i++) out[i] = span === 0 ? 0 : (values[i] - lo) / span;
    return out;
  }
  if (basis === "deviation") {
    const m = S.mean(values);
    const sd = S.deviation(values);
    for (let i = 0; i < values.length; i++) out[i] = sd === 0 ? 0 : (values[i] - m) / sd;
    return out;
  }
  let b: number;
  switch (basis) {
    case "first":
      b = S.first(values);
      break;
    case "last":
      b = S.last(values);
      break;
    case "min":
      b = S.min(values);
      break;
    case "max":
      b = S.max(values);
      break;
    case "mean":
      b = S.mean(values);
      break;
    case "median":
      b = S.median(values);
      break;
    case "sum":
      b = S.sum(values);
      break;
    default: {
      const m = /^p(\d\d)$/.exec(basis);
      if (!m) throw new BackendError(`unknown basis: ${basis}`);
      b = S.quantile(values, Number(m[1]) / 100);
    }
  }
  for (let i = 0; i < values.length; i++) out[i] = values[i] / b;
  return out;
}

export function diff(values: Float64Array): Float64Array {
  const out = new Float64Array(values.length).fill(NaN);
  for (let i = 1; i < values.length; i++) out[i] = values[i] - values[i - 1];
  return out;
}

export function pctChange(values: Float64Array): Float64Array {
  const out = new Float64Array(values.length).fill(NaN);
  for (let i = 1; i < values.length; i++) {
    const prev = values[i - 1];
    out[i] = prev === 0 ? NaN : (values[i] - prev) / Math.abs(prev);
  }
  return out;
}

// ---------------------------------------------------------------- impute ---

export function impute(values: Float64Array, method: string): Float64Array {
  const n = values.length;
  const out = Float64Array.from(values);
  let constant: number | null = null;
  switch (method) {
    case "linear":
    case "interpolate": {
      let i = 0;
      while (i < n) {
        if (Number.isFinite(out[i])) {
          i++;
          continue;
        }
        const start = i;
        while (i < n && !Number.isFinite(out[i])) i++;
        const end = i;
        const left = start > 0 ? out[start - 1] : NaN;
        const right = end < n ? out[end] : NaN;
        for (let j = start; j < end; j++) {
          if (Number.isFinite(left) && Number.isFinite(right)) out[j] = left + ((right - left) * (j - start + 1)) / (end - start + 1);
          else if (Number.isFinite(left)) out[j] = left;
          else if (Number.isFinite(right)) out[j] = right;
          else out[j] = NaN;
        }
      }
      return out;
    }
    case "previous":
    case "ffill": {
      let lastV = NaN;
      for (let i = 0; i < n; i++) {
        if (Number.isFinite(out[i])) lastV = out[i];
        else out[i] = lastV;
      }
      return out;
    }
    case "next":
    case "bfill": {
      let nextV = NaN;
      for (let i = n - 1; i >= 0; i--) {
        if (Number.isFinite(out[i])) nextV = out[i];
        else out[i] = nextV;
      }
      return out;
    }
    case "zero":
      constant = 0;
      break;
    default: {
      const c = Number(method);
      if (!Number.isFinite(c)) throw new BackendError(`unknown impute method: ${method}`);
      constant = c;
    }
  }
  for (let i = 0; i < n; i++) if (!Number.isFinite(out[i])) out[i] = constant;
  return out;
}
