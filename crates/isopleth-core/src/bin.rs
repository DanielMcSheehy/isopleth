//! Binning: threshold rules (a port of d3-array's `ticks`/`bin` behaviour so the
//! JS fallback and the Rust kernel agree bit-for-bit) and bin assignment.

use crate::stats;

/// How to choose bin thresholds.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum ThresholdRule {
    /// Scott's normal reference rule, capped at 200 bins (Observable Plot's `"auto"`).
    Auto,
    Sturges,
    Scott,
    FreedmanDiaconis,
    /// A tick-count hint (`d3.ticks(min, max, n)`), not an exact bin count.
    Count(usize),
}

/// The resolved edges of a binning: `edges[i] ..= edges[i+1]` is bin `i`.
#[derive(Debug, Clone, PartialEq)]
pub struct Edges {
    pub edges: Vec<f64>,
}

impl Edges {
    pub fn len(&self) -> usize {
        self.edges.len().saturating_sub(1)
    }
    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }
}

const E10: f64 = 7.0710678118654755; // sqrt(50)
const E5: f64 = 3.1622776601683795; // sqrt(10)
const E2: f64 = std::f64::consts::SQRT_2;

fn tick_spec(start: f64, stop: f64, count: f64) -> (f64, f64, f64) {
    let step = (stop - start) / count.max(0.0);
    let power = step.log10().floor();
    let error = step / 10f64.powf(power);
    let factor = if error >= E10 {
        10.0
    } else if error >= E5 {
        5.0
    } else if error >= E2 {
        2.0
    } else {
        1.0
    };
    let (i1, i2, inc);
    if power < 0.0 {
        let mut inc_ = 10f64.powf(-power) / factor;
        let mut a = (start * inc_).round();
        let mut b = (stop * inc_).round();
        if a / inc_ < start {
            a += 1.0;
        }
        if b / inc_ > stop {
            b -= 1.0;
        }
        inc_ = -inc_;
        i1 = a;
        i2 = b;
        inc = inc_;
    } else {
        let inc_ = 10f64.powf(power) * factor;
        let mut a = (start / inc_).round();
        let mut b = (stop / inc_).round();
        if a * inc_ < start {
            a += 1.0;
        }
        if b * inc_ > stop {
            b -= 1.0;
        }
        i1 = a;
        i2 = b;
        inc = inc_;
    }
    if i2 < i1 && (0.5..2.0).contains(&count) {
        return tick_spec(start, stop, count * 2.0);
    }
    (i1, i2, inc)
}

/// Port of `d3.tickIncrement`.
pub fn tick_increment(start: f64, stop: f64, count: f64) -> f64 {
    tick_spec(start, stop, count).2
}

/// Port of `d3.ticks`: "nice" round values between `start` and `stop`.
pub fn ticks(start: f64, stop: f64, count: f64) -> Vec<f64> {
    if count <= 0.0 || count.is_nan() || !start.is_finite() || !stop.is_finite() {
        return vec![];
    }
    if start == stop {
        return vec![start];
    }
    let reverse = stop < start;
    let (i1, i2, inc) = if reverse {
        tick_spec(stop, start, count)
    } else {
        tick_spec(start, stop, count)
    };
    if i2 < i1 || i2.is_nan() || i1.is_nan() {
        return vec![];
    }
    let n = (i2 - i1) as usize + 1;
    let mut out = Vec::with_capacity(n);
    for i in 0..n {
        let i = i as f64;
        let v = if reverse {
            if inc < 0.0 {
                (i2 - i) / -inc
            } else {
                (i2 - i) * inc
            }
        } else if inc < 0.0 {
            (i1 + i) / -inc
        } else {
            (i1 + i) * inc
        };
        out.push(v);
    }
    out
}

/// Port of `d3.nice`: extend `[start, stop]` to tick-aligned bounds.
pub fn nice(mut start: f64, mut stop: f64, count: f64) -> (f64, f64) {
    let mut prestep = 0.0;
    loop {
        let step = tick_increment(start, stop, count);
        if step == prestep || step == 0.0 || !step.is_finite() {
            return (start, stop);
        } else if step > 0.0 {
            start = (start / step).floor() * step;
            stop = (stop / step).ceil() * step;
        } else if step < 0.0 {
            start = (start * step).ceil() / step;
            stop = (stop * step).floor() / step;
        }
        prestep = step;
    }
}

/// Number of bins suggested by a rule, given the data (ignoring NaN).
pub fn suggested_count(values: &[f64], min: f64, max: f64, rule: ThresholdRule) -> usize {
    let n = stats::count(values);
    if n == 0 || max <= min || max.is_nan() || min.is_nan() {
        return 1;
    }
    let nf = n as f64;
    let c = match rule {
        ThresholdRule::Count(c) => c as f64,
        ThresholdRule::Sturges => (nf.log2().ceil() + 1.0).max(1.0),
        ThresholdRule::Scott | ThresholdRule::Auto => {
            let sd = stats::deviation(values);
            let c = if sd > 0.0 {
                ((max - min) / (3.49 * sd * nf.powf(-1.0 / 3.0))).ceil()
            } else {
                1.0
            };
            if rule == ThresholdRule::Auto {
                c.min(200.0)
            } else {
                c
            }
        }
        ThresholdRule::FreedmanDiaconis => {
            let sorted = stats::sorted_finite(values);
            let iqr = stats::quantile_sorted(&sorted, 0.75) - stats::quantile_sorted(&sorted, 0.25);
            if iqr > 0.0 {
                ((max - min) / (2.0 * iqr * nf.powf(-1.0 / 3.0))).ceil()
            } else {
                1.0
            }
        }
    };
    c.max(1.0) as usize
}

/// Compute bin edges from a rule, following d3-array's `bin()` so the first and
/// last bins have the same width as the others.
pub fn thresholds(values: &[f64], rule: ThresholdRule) -> Edges {
    let min = stats::min(values);
    let max = stats::max(values);
    thresholds_in(values, min, max, rule)
}

/// Like [`thresholds`] but with an explicit `[min, max]` domain.
pub fn thresholds_in(values: &[f64], min: f64, max: f64, rule: ThresholdRule) -> Edges {
    if !min.is_finite() || !max.is_finite() {
        return Edges { edges: vec![] };
    }
    if min == max {
        // Degenerate: a single unit bin around the value.
        return Edges {
            edges: vec![min, min + 1.0],
        };
    }
    let count = suggested_count(values, min, max, rule) as f64;
    let (x0, mut x1) = nice(min, max, count);
    let mut tz = ticks(x0, x1, count);
    if tz.is_empty() {
        return Edges {
            edges: vec![min, max],
        };
    }
    // Guarantee a full-width last bin (d3 extends the niced upper bound by one step).
    if *tz.last().unwrap() >= x1 {
        if max >= x1 {
            let step = tick_increment(x0, x1, count);
            if step.is_finite() {
                if step > 0.0 {
                    x1 = ((x1 / step).floor() + 1.0) * step;
                } else if step < 0.0 {
                    x1 = ((x1 * -step).ceil() + 1.0) / -step;
                }
            }
        } else {
            tz.pop();
        }
    }
    let mut edges = Vec::with_capacity(tz.len() + 2);
    edges.push(x0);
    for t in tz {
        if t > x0 && t < x1 {
            edges.push(t);
        }
    }
    edges.push(x1);
    Edges { edges }
}

/// Edges at every multiple of `step` spanning the data (Plot's numeric `interval`).
pub fn thresholds_interval(values: &[f64], step: f64) -> Edges {
    let min = stats::min(values);
    let max = stats::max(values);
    if step <= 0.0 || step.is_nan() || !min.is_finite() || !max.is_finite() {
        return Edges { edges: vec![] };
    }
    let start = (min / step).floor() * step;
    let stop = (max / step).floor() * step + step;
    let n = ((stop - start) / step).round() as usize;
    let edges = (0..=n).map(|i| start + i as f64 * step).collect();
    Edges { edges }
}

/// Assign each value to a bin index (`-1` for NaN or out-of-domain values).
/// Bins are half-open `[lo, hi)` except the last, which is closed.
pub fn assign(values: &[f64], edges: &Edges) -> Vec<i32> {
    let e = &edges.edges;
    let nb = edges.len();
    values
        .iter()
        .map(|&v| {
            if !v.is_finite() || nb == 0 || v < e[0] || v > e[nb] {
                return -1;
            }
            if v == e[nb] {
                return (nb - 1) as i32;
            }
            // Binary search for the last edge <= v.
            let idx = match e.binary_search_by(|p| p.partial_cmp(&v).unwrap()) {
                Ok(i) => i,
                Err(i) => i - 1,
            };
            idx.min(nb - 1) as i32
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ticks_match_d3() {
        assert_eq!(ticks(0.0, 10.0, 5.0), vec![0.0, 2.0, 4.0, 6.0, 8.0, 10.0]);
        assert_eq!(ticks(0.0, 1.0, 4.0), vec![0.0, 0.2, 0.4, 0.6, 0.8, 1.0]);
        assert_eq!(ticks(1.0, 1.0, 5.0), vec![1.0]);
        assert_eq!(tick_increment(0.0, 10.0, 5.0), 2.0);
    }

    #[test]
    fn sturges_bins_cover_data_with_uniform_width() {
        let values: Vec<f64> = (0..100).map(|i| i as f64 * 0.37).collect();
        let edges = thresholds(&values, ThresholdRule::Sturges);
        let w: Vec<f64> = edges.edges.windows(2).map(|p| p[1] - p[0]).collect();
        assert!(
            w.iter().all(|x| (x - w[0]).abs() < 1e-9),
            "uniform widths: {w:?}"
        );
        let idx = assign(&values, &edges);
        assert!(idx.iter().all(|&i| i >= 0), "all values binned");
        assert_eq!(*idx.last().unwrap() as usize, edges.len() - 1);
    }

    #[test]
    fn interval_thresholds() {
        let edges = thresholds_interval(&[1.5, 7.2, 3.0], 2.0);
        assert_eq!(edges.edges, vec![0.0, 2.0, 4.0, 6.0, 8.0]);
        assert_eq!(
            assign(&[1.5, 7.2, 3.0, f64::NAN, 8.0, 9.0], &edges),
            vec![0, 3, 1, -1, 3, -1]
        );
    }

    #[test]
    fn degenerate_and_empty() {
        assert_eq!(
            thresholds(&[5.0, 5.0], ThresholdRule::Auto).edges,
            vec![5.0, 6.0]
        );
        assert!(thresholds(&[f64::NAN], ThresholdRule::Auto)
            .edges
            .is_empty());
        assert_eq!(assign(&[1.0], &Edges { edges: vec![] }), vec![-1]);
    }
}
