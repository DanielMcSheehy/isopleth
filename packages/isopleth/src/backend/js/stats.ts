/** Descriptive statistics over `ArrayLike<number>`; NaN is ignored. Port of `isopleth-core::stats`. */

export const MAD_TO_SIGMA = 1.4826;

export function count(v: ArrayLike<number>): number {
  let n = 0;
  for (let i = 0; i < v.length; i++) if (Number.isFinite(v[i])) n++;
  return n;
}

export function sum(v: ArrayLike<number>): number {
  let s = 0;
  for (let i = 0; i < v.length; i++) if (Number.isFinite(v[i])) s += v[i];
  return s;
}

export function mean(v: ArrayLike<number>): number {
  let n = 0;
  let s = 0;
  for (let i = 0; i < v.length; i++) {
    if (Number.isFinite(v[i])) {
      n++;
      s += v[i];
    }
  }
  return n === 0 ? NaN : s / n;
}

export function min(v: ArrayLike<number>): number {
  let m = NaN;
  for (let i = 0; i < v.length; i++) {
    const x = v[i];
    if (Number.isFinite(x) && (Number.isNaN(m) || x < m)) m = x;
  }
  return m;
}

export function max(v: ArrayLike<number>): number {
  let m = NaN;
  for (let i = 0; i < v.length; i++) {
    const x = v[i];
    if (Number.isFinite(x) && (Number.isNaN(m) || x > m)) m = x;
  }
  return m;
}

export function variance(v: ArrayLike<number>): number {
  let n = 0;
  let m = 0;
  let m2 = 0;
  for (let i = 0; i < v.length; i++) {
    const x = v[i];
    if (!Number.isFinite(x)) continue;
    n++;
    const delta = x - m;
    m += delta / n;
    m2 += delta * (x - m);
  }
  return n < 2 ? NaN : m2 / (n - 1);
}

export function deviation(v: ArrayLike<number>): number {
  return Math.sqrt(variance(v));
}

export function sortedFinite(v: ArrayLike<number>): Float64Array {
  const out = new Float64Array(count(v));
  let j = 0;
  for (let i = 0; i < v.length; i++) if (Number.isFinite(v[i])) out[j++] = v[i];
  return out.sort();
}

export function quantileSorted(sorted: ArrayLike<number>, p: number): number {
  const n = sorted.length;
  if (n === 0) return NaN;
  if (p <= 0 || n === 1) return sorted[0];
  if (p >= 1) return sorted[n - 1];
  const i = (n - 1) * p;
  const i0 = Math.floor(i);
  const v0 = sorted[i0];
  const v1 = sorted[Math.min(i0 + 1, n - 1)];
  return v0 + (v1 - v0) * (i - i0);
}

export function quantile(v: ArrayLike<number>, p: number): number {
  return quantileSorted(sortedFinite(v), p);
}

export function median(v: ArrayLike<number>): number {
  return quantile(v, 0.5);
}

export function mad(v: ArrayLike<number>): number {
  const m = median(v);
  if (Number.isNaN(m)) return NaN;
  const dev: number[] = [];
  for (let i = 0; i < v.length; i++) if (Number.isFinite(v[i])) dev.push(Math.abs(v[i] - m));
  return median(dev);
}

export function mode(v: ArrayLike<number>): number {
  const s = sortedFinite(v);
  if (s.length === 0) return NaN;
  let best = s[0];
  let bestN = 0;
  let i = 0;
  while (i < s.length) {
    let j = i;
    while (j < s.length && s[j] === s[i]) j++;
    if (j - i > bestN) {
      bestN = j - i;
      best = s[i];
    }
    i = j;
  }
  return best;
}

export function first(v: ArrayLike<number>): number {
  for (let i = 0; i < v.length; i++) if (Number.isFinite(v[i])) return v[i];
  return NaN;
}

export function last(v: ArrayLike<number>): number {
  for (let i = v.length - 1; i >= 0; i--) if (Number.isFinite(v[i])) return v[i];
  return NaN;
}

export function distinct(v: ArrayLike<number>): number {
  const s = sortedFinite(v);
  if (s.length === 0) return 0;
  let n = 1;
  for (let i = 1; i < s.length; i++) if (s[i] !== s[i - 1]) n++;
  return n;
}

export function ols(x: ArrayLike<number>, y: ArrayLike<number>): [number, number] {
  let n = 0;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < x.length; i++) {
    const a = x[i];
    const b = y[i];
    if (Number.isFinite(a) && Number.isFinite(b)) {
      n++;
      sx += a;
      sy += b;
      sxx += a * a;
      sxy += a * b;
    }
  }
  if (n < 2) return [NaN, NaN];
  const denom = n * sxx - sx * sx;
  if (Math.abs(denom) < Number.EPSILON) return [0, sy / n];
  const slope = (n * sxy - sx * sy) / denom;
  return [slope, (sy - slope * sx) / n];
}

export function theilSen(x: ArrayLike<number>, y: ArrayLike<number>): [number, number] {
  const pts: [number, number][] = [];
  for (let i = 0; i < x.length; i++) if (Number.isFinite(x[i]) && Number.isFinite(y[i])) pts.push([x[i], y[i]]);
  if (pts.length < 2) return [NaN, NaN];
  const slopes: number[] = [];
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      const dx = pts[j][0] - pts[i][0];
      if (dx !== 0) slopes.push((pts[j][1] - pts[i][1]) / dx);
    }
  }
  if (slopes.length === 0) return [0, median(pts.map((p) => p[1]))];
  const slope = median(slopes);
  return [slope, median(pts.map(([a, b]) => b - slope * a))];
}

export function autocorrelation(v: ArrayLike<number>, lag: number): number {
  const n = v.length;
  if (lag >= n || n < 2) return NaN;
  const m = mean(v);
  const at = (i: number) => (Number.isFinite(v[i]) ? v[i] - m : 0);
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    const a = at(i);
    den += a * a;
    if (i + lag < n) num += a * at(i + lag);
  }
  return den === 0 ? NaN : num / den;
}

/** Acklam's inverse normal CDF. */
export function normalQuantile(p: number): number {
  if (!(p >= 0 && p <= 1)) return NaN;
  if (p === 0) return -Infinity;
  if (p === 1) return Infinity;
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const pLow = 0.02425;
  if (p < pLow) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p <= 1 - pLow) {
    const q = p - 0.5;
    const r = q * q;
    return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  }
  const q = Math.sqrt(-2 * Math.log(1 - p));
  return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
}

export function zForLevel(level: number): number {
  return normalQuantile(0.5 + level / 2);
}

export function thresholdFromSensitivity(sensitivity: number | undefined, dflt: number): number {
  if (sensitivity === undefined || sensitivity === null) return dflt;
  return 6 - 4 * Math.min(1, Math.max(0, sensitivity));
}
