//! Grouped aggregation over integer group codes. This is the kernel behind
//! both `group*` and `bin*` transforms (a bin is just a group whose code came
//! from [`crate::bin::assign`]).

use crate::stats;

/// Reducers supported by `bin`/`group`/`window`. Mirrors Observable Plot's names.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Reducer {
    Count,
    Sum,
    Mean,
    Median,
    Min,
    Max,
    Mode,
    First,
    Last,
    Deviation,
    Variance,
    Distinct,
    /// Share of the overall total (count-based when no values are supplied).
    Proportion,
    /// `p` in `0..=1`; e.g. `Quantile(0.9)` is Plot's `"p90"`.
    Quantile(f64),
    /// Index of the minimum value within the group.
    MinIndex,
    /// Index of the maximum value within the group.
    MaxIndex,
}

impl Reducer {
    /// Parse Plot-style reducer names: `"count"`, `"sum"`, `"p25"`, ...
    pub fn parse(name: &str) -> Option<Reducer> {
        Some(match name {
            "count" => Reducer::Count,
            "sum" => Reducer::Sum,
            "mean" => Reducer::Mean,
            "median" => Reducer::Median,
            "min" => Reducer::Min,
            "max" => Reducer::Max,
            "mode" => Reducer::Mode,
            "first" => Reducer::First,
            "last" => Reducer::Last,
            "deviation" => Reducer::Deviation,
            "variance" => Reducer::Variance,
            "distinct" => Reducer::Distinct,
            "proportion" => Reducer::Proportion,
            "min-index" => Reducer::MinIndex,
            "max-index" => Reducer::MaxIndex,
            _ => {
                let p = name.strip_prefix('p')?;
                if p.len() != 2 {
                    return None;
                }
                let n: f64 = p.parse().ok()?;
                Reducer::Quantile(n / 100.0)
            }
        })
    }

    /// Reduce a slice of values (and their original indices for `*-index`).
    pub fn reduce(&self, values: &[f64], indices: &[usize], total: f64) -> f64 {
        match self {
            Reducer::Count => stats::count(values) as f64,
            Reducer::Sum => stats::sum(values),
            Reducer::Mean => stats::mean(values),
            Reducer::Median => stats::median(values),
            Reducer::Min => stats::min(values),
            Reducer::Max => stats::max(values),
            Reducer::Mode => stats::mode(values),
            Reducer::First => stats::first(values),
            Reducer::Last => stats::last(values),
            Reducer::Deviation => stats::deviation(values),
            Reducer::Variance => stats::variance(values),
            Reducer::Distinct => stats::distinct(values),
            Reducer::Proportion => {
                if total == 0.0 {
                    f64::NAN
                } else {
                    stats::sum(values) / total
                }
            }
            Reducer::Quantile(p) => stats::quantile(values, *p),
            Reducer::MinIndex | Reducer::MaxIndex => {
                let mut best: Option<(f64, usize)> = None;
                for (v, &i) in values.iter().zip(indices) {
                    if !v.is_finite() {
                        continue;
                    }
                    let better = match best {
                        None => true,
                        Some((b, _)) => {
                            if *self == Reducer::MinIndex {
                                *v < b
                            } else {
                                *v > b
                            }
                        }
                    };
                    if better {
                        best = Some((*v, i));
                    }
                }
                best.map(|(_, i)| i as f64).unwrap_or(f64::NAN)
            }
        }
    }
}

/// Aggregate `values` by `codes`. `codes[i] < 0` excludes row `i`. The result has
/// `n_groups` entries (groups with no rows get `NaN`, or `0` for `Count`/`Sum`
/// so empty bins can be kept as zeros when desired).
///
/// When `values` is empty the reducer runs over a constant `1` per row, which is
/// how `sum`/`mean`/... degrade to `count` like Plot.
pub fn aggregate(codes: &[i32], values: &[f64], n_groups: usize, reducer: Reducer) -> Vec<f64> {
    let use_ones = values.is_empty();
    let mut buckets: Vec<Vec<f64>> = vec![Vec::new(); n_groups];
    let mut idx: Vec<Vec<usize>> = vec![Vec::new(); n_groups];
    for (i, &c) in codes.iter().enumerate() {
        if c < 0 {
            continue;
        }
        let g = c as usize;
        if g >= n_groups {
            continue;
        }
        let v = if use_ones { 1.0 } else { values[i] };
        buckets[g].push(v);
        idx[g].push(i);
    }
    let total: f64 = if matches!(reducer, Reducer::Proportion) {
        buckets.iter().map(|b| stats::sum(b)).sum()
    } else {
        0.0
    };
    buckets
        .iter()
        .zip(&idx)
        .map(|(b, ix)| {
            if b.is_empty() {
                match reducer {
                    Reducer::Count | Reducer::Sum => 0.0,
                    _ => f64::NAN,
                }
            } else {
                reducer.reduce(b, ix, total)
            }
        })
        .collect()
}

/// Counts per group — the fast path for histograms.
pub fn counts(codes: &[i32], n_groups: usize) -> Vec<f64> {
    let mut out = vec![0.0; n_groups];
    for &c in codes {
        if c >= 0 && (c as usize) < n_groups {
            out[c as usize] += 1.0;
        }
    }
    out
}

/// Combine two code columns into one (row-major), for 2-D bins/groups and for
/// "group by x *and* fill". Returns the combined codes and the group count.
pub fn combine_codes(a: &[i32], na: usize, b: &[i32], nb: usize) -> (Vec<i32>, usize) {
    let codes = a
        .iter()
        .zip(b)
        .map(|(&x, &y)| {
            if x < 0 || y < 0 {
                -1
            } else {
                x * nb as i32 + y
            }
        })
        .collect();
    (codes, na * nb)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn aggregates_by_code() {
        let codes = [0, 1, 0, -1, 2, 1];
        let values = [1.0, 10.0, 3.0, 99.0, f64::NAN, 30.0];
        assert_eq!(
            aggregate(&codes, &values, 3, Reducer::Sum),
            vec![4.0, 40.0, 0.0]
        );
        assert_eq!(
            aggregate(&codes, &values, 3, Reducer::Count),
            vec![2.0, 2.0, 0.0]
        );
        assert_eq!(
            aggregate(&codes, &[], 3, Reducer::Count),
            vec![2.0, 2.0, 1.0]
        );
        assert_eq!(aggregate(&codes, &values, 3, Reducer::Mean)[1], 20.0);
        assert_eq!(aggregate(&codes, &values, 3, Reducer::MaxIndex)[1], 5.0);
        let p = aggregate(&codes, &values, 3, Reducer::Proportion);
        assert!((p[0] - 4.0 / 44.0).abs() < 1e-12);
        assert_eq!(counts(&codes, 3), vec![2.0, 2.0, 1.0]);
    }

    #[test]
    fn parses_reducers() {
        assert_eq!(Reducer::parse("p90"), Some(Reducer::Quantile(0.9)));
        assert_eq!(Reducer::parse("median"), Some(Reducer::Median));
        assert_eq!(Reducer::parse("nope"), None);
    }

    #[test]
    fn combine() {
        let (c, n) = combine_codes(&[0, 1, -1], 2, &[1, 1, 0], 2);
        assert_eq!(c, vec![1, 3, -1]);
        assert_eq!(n, 4);
    }
}
