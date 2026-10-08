//! Rolling-window reducers (Plot's `windowY` / `mapY(window(k))`).

use crate::group::Reducer;
use crate::stats;
use crate::{Error, Result};
use std::collections::VecDeque;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Anchor {
    Start,
    Middle,
    End,
}

impl Anchor {
    pub fn parse(s: &str) -> Option<Anchor> {
        match s {
            "start" => Some(Anchor::Start),
            "middle" => Some(Anchor::Middle),
            "end" => Some(Anchor::End),
            _ => None,
        }
    }
    /// How many positions the window starts *before* the output index.
    fn shift(self, k: usize) -> usize {
        match self {
            Anchor::Start => 0,
            Anchor::Middle => (k - 1) / 2,
            Anchor::End => k - 1,
        }
    }
}

/// Window-only reducers that make no sense for groups.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum WindowReducer {
    Plain(Reducer),
    /// last - first
    Difference,
    /// last / first
    Ratio,
}

impl WindowReducer {
    pub fn parse(name: &str) -> Option<WindowReducer> {
        match name {
            "difference" => Some(WindowReducer::Difference),
            "ratio" => Some(WindowReducer::Ratio),
            _ => Reducer::parse(name).map(WindowReducer::Plain),
        }
    }
}

#[derive(Debug, Clone, Copy)]
pub struct WindowOptions {
    pub k: usize,
    pub anchor: Anchor,
    pub reduce: WindowReducer,
    /// When true, output is NaN unless the full window of `k` finite values exists.
    pub strict: bool,
}

impl Default for WindowOptions {
    fn default() -> Self {
        WindowOptions {
            k: 7,
            anchor: Anchor::Middle,
            reduce: WindowReducer::Plain(Reducer::Mean),
            strict: false,
        }
    }
}

/// Apply a rolling window over `values`. Output has the same length.
pub fn window(values: &[f64], opts: WindowOptions) -> Result<Vec<f64>> {
    let k = opts.k;
    if k == 0 {
        return Err(Error::InvalidArgument("window k must be >= 1".into()));
    }
    let n = values.len();
    let s = opts.anchor.shift(k) as isize;
    let bounds = |i: usize| -> (usize, usize, bool) {
        let lo = i as isize - s;
        let hi = lo + k as isize;
        let full = lo >= 0 && hi <= n as isize;
        (lo.max(0) as usize, (hi.max(0) as usize).min(n), full)
    };

    match opts.reduce {
        WindowReducer::Plain(Reducer::Sum)
        | WindowReducer::Plain(Reducer::Mean)
        | WindowReducer::Plain(Reducer::Count) => {
            Ok(sliding_sum(values, k, s, opts.strict, opts.reduce))
        }
        WindowReducer::Plain(Reducer::Min) | WindowReducer::Plain(Reducer::Max) => {
            Ok(sliding_extreme(
                values,
                k,
                s,
                opts.strict,
                matches!(opts.reduce, WindowReducer::Plain(Reducer::Max)),
            ))
        }
        other => {
            let mut out = Vec::with_capacity(n);
            let mut idx: Vec<usize> = Vec::with_capacity(k);
            for i in 0..n {
                let (lo, hi, full) = bounds(i);
                let w = &values[lo..hi];
                if opts.strict && (!full || w.iter().any(|v| !v.is_finite())) {
                    out.push(f64::NAN);
                    continue;
                }
                let v = match other {
                    WindowReducer::Difference => stats::last(w) - stats::first(w),
                    WindowReducer::Ratio => stats::last(w) / stats::first(w),
                    WindowReducer::Plain(r) => {
                        idx.clear();
                        idx.extend(lo..hi);
                        r.reduce(w, &idx, 0.0)
                    }
                };
                out.push(v);
            }
            Ok(out)
        }
    }
}

fn sliding_sum(
    values: &[f64],
    k: usize,
    s: isize,
    strict: bool,
    reduce: WindowReducer,
) -> Vec<f64> {
    let n = values.len();
    let mut out = vec![f64::NAN; n];
    // Prefix sums over finite values and finite counts.
    let mut ps = vec![0.0; n + 1];
    let mut pc = vec![0usize; n + 1];
    for i in 0..n {
        let v = values[i];
        ps[i + 1] = ps[i] + if v.is_finite() { v } else { 0.0 };
        pc[i + 1] = pc[i] + usize::from(v.is_finite());
    }
    for (i, slot) in out.iter_mut().enumerate() {
        let lo = i as isize - s;
        let hi = lo + k as isize;
        let full = lo >= 0 && hi <= n as isize;
        let lo = lo.max(0) as usize;
        let hi = (hi.max(0) as usize).min(n);
        if hi <= lo {
            continue;
        }
        let c = pc[hi] - pc[lo];
        if strict && (!full || c != k) {
            continue;
        }
        if c == 0 {
            *slot = if matches!(reduce, WindowReducer::Plain(Reducer::Count)) {
                0.0
            } else {
                f64::NAN
            };
            continue;
        }
        let sum = ps[hi] - ps[lo];
        *slot = match reduce {
            WindowReducer::Plain(Reducer::Sum) => sum,
            WindowReducer::Plain(Reducer::Mean) => sum / c as f64,
            _ => c as f64,
        };
    }
    out
}

/// Monotonic-deque sliding min/max, O(n).
fn sliding_extreme(values: &[f64], k: usize, s: isize, strict: bool, is_max: bool) -> Vec<f64> {
    let n = values.len();
    let mut out = vec![f64::NAN; n];
    let better = |a: f64, b: f64| if is_max { a >= b } else { a <= b };
    let mut dq: VecDeque<usize> = VecDeque::new();
    // Window for output i is [i - s, i - s + k). Process end index j = i - s + k - 1.
    let mut nan_prefix = vec![0usize; n + 1];
    for i in 0..n {
        nan_prefix[i + 1] = nan_prefix[i] + usize::from(!values[i].is_finite());
    }
    let mut next_j = 0usize; // next value index to push
    for (i, slot) in out.iter_mut().enumerate() {
        let lo_i = i as isize - s;
        let hi_i = lo_i + k as isize; // exclusive
        let full = lo_i >= 0 && hi_i <= n as isize;
        let lo = lo_i.max(0) as usize;
        let hi = (hi_i.max(0) as usize).min(n);
        while next_j < hi {
            let v = values[next_j];
            if v.is_finite() {
                while let Some(&b) = dq.back() {
                    if better(v, values[b]) {
                        dq.pop_back();
                    } else {
                        break;
                    }
                }
                dq.push_back(next_j);
            }
            next_j += 1;
        }
        while let Some(&f) = dq.front() {
            if f < lo {
                dq.pop_front();
            } else {
                break;
            }
        }
        if hi <= lo {
            continue;
        }
        if strict && (!full || nan_prefix[hi] - nan_prefix[lo] > 0) {
            continue;
        }
        if let Some(&f) = dq.front() {
            *slot = values[f];
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn opts(k: usize, anchor: Anchor, reduce: &str, strict: bool) -> WindowOptions {
        WindowOptions {
            k,
            anchor,
            reduce: WindowReducer::parse(reduce).unwrap(),
            strict,
        }
    }

    #[test]
    fn trailing_mean_truncates_at_start() {
        let v = [1.0, 2.0, 3.0, 4.0, 5.0];
        let out = window(&v, opts(3, Anchor::End, "mean", false)).unwrap();
        assert_eq!(out, vec![1.0, 1.5, 2.0, 3.0, 4.0]);
        let strict = window(&v, opts(3, Anchor::End, "mean", true)).unwrap();
        assert!(strict[0].is_nan() && strict[1].is_nan());
        assert_eq!(&strict[2..], &[2.0, 3.0, 4.0]);
    }

    #[test]
    fn centered_window_and_nan() {
        let v = [1.0, f64::NAN, 3.0, 4.0, 5.0];
        let out = window(&v, opts(3, Anchor::Middle, "sum", false)).unwrap();
        assert_eq!(out, vec![1.0, 4.0, 7.0, 12.0, 9.0]);
        let strict = window(&v, opts(3, Anchor::Middle, "sum", true)).unwrap();
        assert!(
            strict[0].is_nan() && strict[1].is_nan() && strict[2].is_nan() && strict[4].is_nan()
        );
        assert_eq!(strict[3], 12.0);
    }

    #[test]
    fn min_max_deque_matches_naive() {
        let v: Vec<f64> = (0..200)
            .map(|i| ((i * 7919) % 101) as f64 * if i % 13 == 0 { f64::NAN } else { 1.0 })
            .collect();
        for &anchor in &[Anchor::Start, Anchor::Middle, Anchor::End] {
            for &k in &[1usize, 2, 5, 17] {
                let fast = window(&v, opts(k, anchor, "max", false)).unwrap();
                let fastmin = window(&v, opts(k, anchor, "min", false)).unwrap();
                let s = anchor.shift(k) as isize;
                for i in 0..v.len() {
                    let lo = (i as isize - s).max(0) as usize;
                    let hi = ((i as isize - s + k as isize).max(0) as usize).min(v.len());
                    let naive_max = stats::max(&v[lo..hi]);
                    let naive_min = stats::min(&v[lo..hi]);
                    assert!(
                        fast[i] == naive_max || (fast[i].is_nan() && naive_max.is_nan()),
                        "k={k} i={i} {} vs {}",
                        fast[i],
                        naive_max
                    );
                    assert!(fastmin[i] == naive_min || (fastmin[i].is_nan() && naive_min.is_nan()));
                }
            }
        }
    }

    #[test]
    fn difference_ratio_median() {
        let v = [2.0, 4.0, 8.0, 16.0];
        assert_eq!(
            window(&v, opts(2, Anchor::End, "difference", false)).unwrap(),
            vec![0.0, 2.0, 4.0, 8.0]
        );
        assert_eq!(
            window(&v, opts(2, Anchor::End, "ratio", false)).unwrap(),
            vec![1.0, 2.0, 2.0, 2.0]
        );
        assert_eq!(
            window(&v, opts(3, Anchor::Middle, "median", false)).unwrap(),
            vec![3.0, 4.0, 8.0, 12.0]
        );
        assert!(window(&v, opts(0, Anchor::Middle, "mean", false)).is_err());
    }
}
