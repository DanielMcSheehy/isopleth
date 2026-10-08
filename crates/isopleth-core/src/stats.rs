//! Small, allocation-light descriptive statistics. All functions ignore `NaN`.

/// Iterate over finite values only.
#[inline]
pub fn finite(values: &[f64]) -> impl Iterator<Item = f64> + '_ {
    values.iter().copied().filter(|v| v.is_finite())
}

pub fn count(values: &[f64]) -> usize {
    finite(values).count()
}

pub fn sum(values: &[f64]) -> f64 {
    finite(values).sum()
}

pub fn mean(values: &[f64]) -> f64 {
    let (mut n, mut s) = (0usize, 0.0);
    for v in finite(values) {
        n += 1;
        s += v;
    }
    if n == 0 {
        f64::NAN
    } else {
        s / n as f64
    }
}

pub fn min(values: &[f64]) -> f64 {
    finite(values).fold(f64::NAN, |a, b| if a.is_nan() || b < a { b } else { a })
}

pub fn max(values: &[f64]) -> f64 {
    finite(values).fold(f64::NAN, |a, b| if a.is_nan() || b > a { b } else { a })
}

/// Sample variance (n - 1 denominator), matching d3's `deviation`/`variance`.
pub fn variance(values: &[f64]) -> f64 {
    let mut n = 0usize;
    let mut mean = 0.0;
    let mut m2 = 0.0;
    for v in finite(values) {
        n += 1;
        let delta = v - mean;
        mean += delta / n as f64;
        m2 += delta * (v - mean);
    }
    if n < 2 {
        f64::NAN
    } else {
        m2 / (n as f64 - 1.0)
    }
}

pub fn deviation(values: &[f64]) -> f64 {
    variance(values).sqrt()
}

/// Sorted copy of the finite values.
pub fn sorted_finite(values: &[f64]) -> Vec<f64> {
    let mut v: Vec<f64> = finite(values).collect();
    v.sort_by(|a, b| a.partial_cmp(b).unwrap());
    v
}

/// Quantile with linear interpolation (d3 `quantileSorted` / R type 7).
/// `sorted` must be ascending and free of NaN.
pub fn quantile_sorted(sorted: &[f64], p: f64) -> f64 {
    let n = sorted.len();
    if n == 0 {
        return f64::NAN;
    }
    if p <= 0.0 || n == 1 {
        return sorted[0];
    }
    if p >= 1.0 {
        return sorted[n - 1];
    }
    let i = (n as f64 - 1.0) * p;
    let i0 = i.floor() as usize;
    let v0 = sorted[i0];
    let v1 = sorted[(i0 + 1).min(n - 1)];
    v0 + (v1 - v0) * (i - i0 as f64)
}

pub fn quantile(values: &[f64], p: f64) -> f64 {
    quantile_sorted(&sorted_finite(values), p)
}

pub fn median(values: &[f64]) -> f64 {
    quantile(values, 0.5)
}

/// Median absolute deviation around the median (unscaled).
pub fn mad(values: &[f64]) -> f64 {
    let m = median(values);
    if m.is_nan() {
        return f64::NAN;
    }
    let dev: Vec<f64> = finite(values).map(|v| (v - m).abs()).collect();
    median(&dev)
}

/// 1.4826 scales MAD to be a consistent estimator of sigma for normal data.
pub const MAD_TO_SIGMA: f64 = 1.4826;

/// Most frequent finite value (ties resolve to the smallest value).
pub fn mode(values: &[f64]) -> f64 {
    let sorted = sorted_finite(values);
    if sorted.is_empty() {
        return f64::NAN;
    }
    let mut best = sorted[0];
    let mut best_n = 0usize;
    let mut i = 0;
    while i < sorted.len() {
        let mut j = i;
        while j < sorted.len() && sorted[j] == sorted[i] {
            j += 1;
        }
        if j - i > best_n {
            best_n = j - i;
            best = sorted[i];
        }
        i = j;
    }
    best
}

pub fn first(values: &[f64]) -> f64 {
    finite(values).next().unwrap_or(f64::NAN)
}

pub fn last(values: &[f64]) -> f64 {
    finite(values).last().unwrap_or(f64::NAN)
}

/// Number of distinct finite values.
pub fn distinct(values: &[f64]) -> f64 {
    let sorted = sorted_finite(values);
    if sorted.is_empty() {
        return 0.0;
    }
    let mut n = 1;
    for w in sorted.windows(2) {
        if w[0] != w[1] {
            n += 1;
        }
    }
    n as f64
}

/// Ordinary least squares fit of `y` against `x`. Returns `(slope, intercept)`.
/// Pairs with a NaN on either side are skipped.
pub fn ols(x: &[f64], y: &[f64]) -> (f64, f64) {
    let mut n = 0.0;
    let (mut sx, mut sy, mut sxx, mut sxy) = (0.0, 0.0, 0.0, 0.0);
    for (xi, yi) in x.iter().zip(y) {
        if xi.is_finite() && yi.is_finite() {
            n += 1.0;
            sx += xi;
            sy += yi;
            sxx += xi * xi;
            sxy += xi * yi;
        }
    }
    if n < 2.0 {
        return (f64::NAN, f64::NAN);
    }
    let denom = n * sxx - sx * sx;
    if denom.abs() < f64::EPSILON {
        return (0.0, sy / n);
    }
    let slope = (n * sxy - sx * sy) / denom;
    let intercept = (sy - slope * sx) / n;
    (slope, intercept)
}

/// Theil–Sen estimator: median of pairwise slopes, intercept = median(y - slope*x).
/// O(n²) pairs; the JS side caps n before calling. Robust to outliers.
pub fn theil_sen(x: &[f64], y: &[f64]) -> (f64, f64) {
    let pts: Vec<(f64, f64)> = x
        .iter()
        .zip(y)
        .filter(|(a, b)| a.is_finite() && b.is_finite())
        .map(|(a, b)| (*a, *b))
        .collect();
    if pts.len() < 2 {
        return (f64::NAN, f64::NAN);
    }
    let mut slopes = Vec::with_capacity(pts.len() * (pts.len() - 1) / 2);
    for i in 0..pts.len() {
        for j in (i + 1)..pts.len() {
            let dx = pts[j].0 - pts[i].0;
            if dx != 0.0 {
                slopes.push((pts[j].1 - pts[i].1) / dx);
            }
        }
    }
    if slopes.is_empty() {
        return (0.0, median(&pts.iter().map(|p| p.1).collect::<Vec<_>>()));
    }
    let slope = median(&slopes);
    let resid: Vec<f64> = pts.iter().map(|(a, b)| b - slope * a).collect();
    (slope, median(&resid))
}

/// Pearson correlation of two equal-length series (NaN pairs skipped).
pub fn pearson(x: &[f64], y: &[f64]) -> f64 {
    let mut n = 0.0;
    let (mut sx, mut sy, mut sxx, mut syy, mut sxy) = (0.0, 0.0, 0.0, 0.0, 0.0);
    for (a, b) in x.iter().zip(y) {
        if a.is_finite() && b.is_finite() {
            n += 1.0;
            sx += a;
            sy += b;
            sxx += a * a;
            syy += b * b;
            sxy += a * b;
        }
    }
    if n < 2.0 {
        return f64::NAN;
    }
    let cov = sxy - sx * sy / n;
    let vx = sxx - sx * sx / n;
    let vy = syy - sy * sy / n;
    if vx <= 0.0 || vy <= 0.0 {
        return f64::NAN;
    }
    cov / (vx * vy).sqrt()
}

/// Autocorrelation at `lag` of the (mean-centred) series. NaN treated as mean.
pub fn autocorrelation(values: &[f64], lag: usize) -> f64 {
    let n = values.len();
    if lag >= n || n < 2 {
        return f64::NAN;
    }
    let m = mean(values);
    let v = |i: usize| {
        if values[i].is_finite() {
            values[i] - m
        } else {
            0.0
        }
    };
    let mut num = 0.0;
    let mut den = 0.0;
    for i in 0..n {
        let a = v(i);
        den += a * a;
        if i + lag < n {
            num += a * v(i + lag);
        }
    }
    if den == 0.0 {
        f64::NAN
    } else {
        num / den
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn basic_moments_ignore_nan() {
        let v = [1.0, 2.0, f64::NAN, 3.0, 4.0];
        assert_eq!(count(&v), 4);
        assert_eq!(sum(&v), 10.0);
        assert_eq!(mean(&v), 2.5);
        assert_eq!(min(&v), 1.0);
        assert_eq!(max(&v), 4.0);
        assert!((variance(&v) - 1.6666666).abs() < 1e-6);
        assert_eq!(median(&v), 2.5);
        assert_eq!(first(&v), 1.0);
        assert_eq!(last(&v), 4.0);
        assert_eq!(distinct(&v), 4.0);
    }

    #[test]
    fn quantiles_match_d3() {
        let v = [3.0, 1.0, 2.0, 4.0];
        assert_eq!(quantile(&v, 0.0), 1.0);
        assert_eq!(quantile(&v, 0.25), 1.75);
        assert_eq!(quantile(&v, 0.5), 2.5);
        assert_eq!(quantile(&v, 1.0), 4.0);
        assert!(quantile(&[], 0.5).is_nan());
    }

    #[test]
    fn mad_and_mode() {
        let v = [1.0, 1.0, 2.0, 2.0, 2.0, 9.0];
        assert_eq!(mode(&v), 2.0);
        assert_eq!(mad(&[1.0, 2.0, 3.0, 4.0, 100.0]), 1.0);
    }

    #[test]
    fn regressions() {
        let x = [0.0, 1.0, 2.0, 3.0];
        let y = [1.0, 3.0, 5.0, 7.0];
        let (s, b) = ols(&x, &y);
        assert!((s - 2.0).abs() < 1e-12 && (b - 1.0).abs() < 1e-12);
        let x10: Vec<f64> = (0..10).map(|i| i as f64).collect();
        let mut y10: Vec<f64> = x10.iter().map(|v| 2.0 * v + 1.0).collect();
        y10[4] = 500.0;
        let (s2, b2) = theil_sen(&x10, &y10);
        assert!(
            (s2 - 2.0).abs() < 1e-12,
            "theil-sen slope robust to outlier: {s2}"
        );
        assert!((b2 - 1.0).abs() < 1e-12, "{b2}");
        assert!((pearson(&x, &y) - 1.0).abs() < 1e-12);
    }

    #[test]
    fn autocorrelation_of_periodic() {
        let v: Vec<f64> = (0..40)
            .map(|i| if i % 4 == 0 { 1.0 } else { 0.0 })
            .collect();
        assert!(autocorrelation(&v, 4) > 0.8);
        assert!(autocorrelation(&v, 2) < 0.0);
    }
}
