//! Whole-series maps: `cumsum`, `rank`, `quantile`, `normalize` (Plot's `mapY`
//! and `normalizeY`).

use crate::stats;

/// Cumulative sum; NaN inputs are carried through as the running total so the
/// line keeps its level (Plot semantics: undefined contributes nothing).
pub fn cumsum(values: &[f64]) -> Vec<f64> {
    let mut acc = 0.0;
    values
        .iter()
        .map(|v| {
            if v.is_finite() {
                acc += v;
            }
            acc
        })
        .collect()
}

/// 0-based rank among finite values (ties share the lowest rank). NaN → NaN.
pub fn rank(values: &[f64]) -> Vec<f64> {
    let mut order: Vec<usize> = (0..values.len())
        .filter(|&i| values[i].is_finite())
        .collect();
    order.sort_by(|&a, &b| values[a].partial_cmp(&values[b]).unwrap());
    let mut out = vec![f64::NAN; values.len()];
    let mut r = 0usize;
    for (pos, &i) in order.iter().enumerate() {
        if pos > 0 && values[i] != values[order[pos - 1]] {
            r = pos;
        }
        out[i] = r as f64;
    }
    out
}

/// Rank scaled to `[0, 1]` (Plot's `"quantile"` map).
pub fn quantile_rank(values: &[f64]) -> Vec<f64> {
    let n = stats::count(values);
    let denom = if n > 1 { (n - 1) as f64 } else { 1.0 };
    rank(values).into_iter().map(|r| r / denom).collect()
}

/// Basis for [`normalize`].
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Basis {
    First,
    Last,
    Min,
    Max,
    Mean,
    Median,
    Sum,
    /// `(v - min) / (max - min)`
    Extent,
    Deviation,
    Quantile(f64),
}

impl Basis {
    pub fn parse(name: &str) -> Option<Basis> {
        Some(match name {
            "first" => Basis::First,
            "last" => Basis::Last,
            "min" => Basis::Min,
            "max" => Basis::Max,
            "mean" => Basis::Mean,
            "median" => Basis::Median,
            "sum" => Basis::Sum,
            "extent" => Basis::Extent,
            "deviation" => Basis::Deviation,
            _ => {
                let p = name.strip_prefix('p')?;
                Basis::Quantile(p.parse::<f64>().ok()? / 100.0)
            }
        })
    }
}

/// Divide each value by a series basis (Plot `normalizeY`).
pub fn normalize(values: &[f64], basis: Basis) -> Vec<f64> {
    if basis == Basis::Extent {
        let lo = stats::min(values);
        let hi = stats::max(values);
        let span = hi - lo;
        return values
            .iter()
            .map(|v| if span == 0.0 { 0.0 } else { (v - lo) / span })
            .collect();
    }
    if basis == Basis::Deviation {
        let m = stats::mean(values);
        let sd = stats::deviation(values);
        return values
            .iter()
            .map(|v| if sd == 0.0 { 0.0 } else { (v - m) / sd })
            .collect();
    }
    let b = match basis {
        Basis::First => stats::first(values),
        Basis::Last => stats::last(values),
        Basis::Min => stats::min(values),
        Basis::Max => stats::max(values),
        Basis::Mean => stats::mean(values),
        Basis::Median => stats::median(values),
        Basis::Sum => stats::sum(values),
        Basis::Quantile(p) => stats::quantile(values, p),
        Basis::Extent | Basis::Deviation => unreachable!(),
    };
    values.iter().map(|v| v / b).collect()
}

/// First differences: `v[i] - v[i-1]` (NaN for the first element and across gaps).
pub fn diff(values: &[f64]) -> Vec<f64> {
    let mut out = vec![f64::NAN; values.len()];
    for i in 1..values.len() {
        out[i] = values[i] - values[i - 1];
    }
    out
}

/// Percent change: `(v[i] - v[i-1]) / |v[i-1]|`.
pub fn pct_change(values: &[f64]) -> Vec<f64> {
    let mut out = vec![f64::NAN; values.len()];
    for i in 1..values.len() {
        let prev = values[i - 1];
        out[i] = if prev == 0.0 {
            f64::NAN
        } else {
            (values[i] - prev) / prev.abs()
        };
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps() {
        assert_eq!(cumsum(&[1.0, f64::NAN, 2.0]), vec![1.0, 1.0, 3.0]);
        assert_eq!(rank(&[30.0, 10.0, 20.0, 10.0]), vec![3.0, 0.0, 2.0, 0.0]);
        assert_eq!(quantile_rank(&[30.0, 10.0, 20.0]), vec![1.0, 0.0, 0.5]);
        assert_eq!(normalize(&[2.0, 4.0], Basis::First), vec![1.0, 2.0]);
        assert_eq!(
            normalize(&[2.0, 4.0, 6.0], Basis::Extent),
            vec![0.0, 0.5, 1.0]
        );
        assert_eq!(diff(&[1.0, 3.0, 6.0])[1..], [2.0, 3.0]);
        assert!((pct_change(&[2.0, 3.0])[1] - 0.5).abs() < 1e-12);
    }
}
