//! Point-anomaly detection on a single series. Every method produces a score
//! per point (robust z-score, higher = more anomalous), a boolean flag, and an
//! *expected band* `[lower, upper]` that the chart can draw behind the data.

use super::{decompose, seasonality, threshold_from_sensitivity};
use crate::stats::{self, MAD_TO_SIGMA};
use crate::{Error, Result};

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum AnomalyMethod {
    /// Rolling median ± k·MAD (default). Robust, local, no assumptions.
    Mad,
    /// Global mean ± k·sd.
    Zscore,
    /// Global Tukey fences: `[Q1 - k·IQR, Q3 + k·IQR]`.
    Iqr,
    /// Seasonal: decompose (trend + seasonal), then robust z on the remainder.
    Seasonal,
    /// EWMA control chart around a robust centre.
    Ewma,
}

impl AnomalyMethod {
    pub fn parse(s: &str) -> Option<Self> {
        Some(match s {
            "mad" | "auto" => AnomalyMethod::Mad,
            "zscore" | "z-score" => AnomalyMethod::Zscore,
            "iqr" => AnomalyMethod::Iqr,
            "seasonal" | "stl" => AnomalyMethod::Seasonal,
            "ewma" => AnomalyMethod::Ewma,
            _ => return None,
        })
    }
    pub fn name(&self) -> &'static str {
        match self {
            AnomalyMethod::Mad => "mad",
            AnomalyMethod::Zscore => "zscore",
            AnomalyMethod::Iqr => "iqr",
            AnomalyMethod::Seasonal => "seasonal",
            AnomalyMethod::Ewma => "ewma",
        }
    }
}

#[derive(Debug, Clone, Copy)]
pub struct AnomalyOptions {
    pub method: AnomalyMethod,
    /// Explicit robust-z threshold. Overridden by `sensitivity` when set.
    pub threshold: Option<f64>,
    /// `0` = very tolerant, `1` = very sensitive.
    pub sensitivity: Option<f64>,
    /// Rolling window for `Mad`/`Ewma` (`None` = auto).
    pub window: Option<usize>,
    /// Seasonal period for `Seasonal` (`None` = detect).
    pub period: Option<usize>,
    /// Smoothing factor for `Ewma`.
    pub lambda: f64,
}

impl Default for AnomalyOptions {
    fn default() -> Self {
        AnomalyOptions {
            method: AnomalyMethod::Mad,
            threshold: None,
            sensitivity: None,
            window: None,
            period: None,
            lambda: 0.3,
        }
    }
}

#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnomalyResult {
    /// Robust z-score per point (NaN for missing input).
    pub scores: Vec<f64>,
    /// 1 where the point is anomalous.
    pub flags: Vec<u8>,
    /// Expected lower bound per point.
    pub lower: Vec<f64>,
    /// Expected upper bound per point.
    pub upper: Vec<f64>,
    /// Indices of anomalous points, ascending.
    pub indices: Vec<u32>,
    pub threshold: f64,
    pub method: &'static str,
    /// Period used by the seasonal method, if any.
    pub period: Option<usize>,
}

fn finish(
    scores: Vec<f64>,
    lower: Vec<f64>,
    upper: Vec<f64>,
    threshold: f64,
    method: &'static str,
    period: Option<usize>,
) -> AnomalyResult {
    let flags: Vec<u8> = scores
        .iter()
        .map(|s| u8::from(s.is_finite() && *s > threshold))
        .collect();
    let indices = flags
        .iter()
        .enumerate()
        .filter(|(_, f)| **f == 1)
        .map(|(i, _)| i as u32)
        .collect();
    AnomalyResult {
        scores,
        flags,
        lower,
        upper,
        indices,
        threshold,
        method,
        period,
    }
}

/// Default rolling window: roughly a tenth of the series, at least 7, odd.
pub fn default_window(n: usize, period: Option<usize>) -> usize {
    let base = match period {
        Some(p) if p >= 4 => (2 * p).max(7),
        _ => (n / 10).max(7),
    };
    let w = base.min(n.max(1));
    if w % 2 == 0 {
        w + 1
    } else {
        w
    }
}

pub fn detect(y: &[f64], opts: AnomalyOptions) -> Result<AnomalyResult> {
    let n = y.len();
    if stats::count(y) < 3 {
        return Err(Error::NotEnoughData {
            needed: 3,
            got: stats::count(y),
        });
    }
    match opts.method {
        AnomalyMethod::Mad => {
            let threshold =
                threshold_from_sensitivity(opts.sensitivity, opts.threshold.unwrap_or(3.5));
            let k = opts
                .window
                .unwrap_or_else(|| default_window(n, opts.period));
            let (centre, scale) = rolling_median_mad(y, k);
            Ok(score_against(y, &centre, &scale, threshold, "mad", None))
        }
        AnomalyMethod::Zscore => {
            let threshold =
                threshold_from_sensitivity(opts.sensitivity, opts.threshold.unwrap_or(3.0));
            let m = stats::mean(y);
            let sd = stats::deviation(y);
            let centre = vec![m; n];
            let scale = vec![sd; n];
            Ok(score_against(y, &centre, &scale, threshold, "zscore", None))
        }
        AnomalyMethod::Iqr => {
            // Tukey's k: 1.5 by default; sensitivity maps onto [2.25, 0.75].
            let k = match opts.sensitivity {
                Some(s) => 2.25 - 1.5 * s.clamp(0.0, 1.0),
                None => opts.threshold.unwrap_or(1.5),
            };
            let sorted = stats::sorted_finite(y);
            let q1 = stats::quantile_sorted(&sorted, 0.25);
            let q3 = stats::quantile_sorted(&sorted, 0.75);
            let iqr = q3 - q1;
            let lo = q1 - k * iqr;
            let hi = q3 + k * iqr;
            let scores: Vec<f64> = y
                .iter()
                .map(|&v| {
                    if !v.is_finite() {
                        f64::NAN
                    } else if iqr == 0.0 {
                        if v < lo || v > hi {
                            f64::INFINITY
                        } else {
                            0.0
                        }
                    } else if v > q3 {
                        (v - q3) / iqr
                    } else if v < q1 {
                        (q1 - v) / iqr
                    } else {
                        0.0
                    }
                })
                .collect();
            Ok(finish(scores, vec![lo; n], vec![hi; n], k, "iqr", None))
        }
        AnomalyMethod::Seasonal => {
            let threshold =
                threshold_from_sensitivity(opts.sensitivity, opts.threshold.unwrap_or(3.5));
            let period = match opts.period {
                Some(p) => p,
                None => seasonality::detect(y, Default::default())
                    .periods
                    .first()
                    .copied()
                    .map(|p| p as usize)
                    .unwrap_or(0),
            };
            if period < 2 || n < 2 * period {
                // No usable seasonality: degrade gracefully to rolling MAD.
                return detect(
                    y,
                    AnomalyOptions {
                        method: AnomalyMethod::Mad,
                        ..opts
                    },
                );
            }
            let d = decompose::decompose(y, period)?;
            let k = opts
                .window
                .unwrap_or_else(|| default_window(n, Some(period)));
            let (rc, rs) = rolling_median_mad(&d.remainder, k);
            let centre: Vec<f64> = (0..n).map(|i| d.trend[i] + d.seasonal[i] + rc[i]).collect();
            Ok(score_against(
                y,
                &centre,
                &rs,
                threshold,
                "seasonal",
                Some(period),
            ))
        }
        AnomalyMethod::Ewma => {
            let threshold =
                threshold_from_sensitivity(opts.sensitivity, opts.threshold.unwrap_or(3.0));
            let lambda = opts.lambda.clamp(0.01, 1.0);
            let sigma = (stats::mad(y) * MAD_TO_SIGMA).max(f64::EPSILON);
            let mut centre = Vec::with_capacity(n);
            let mut scale = Vec::with_capacity(n);
            let mut z = stats::median(y);
            for (i, &v) in y.iter().enumerate() {
                // The control limit widens from the start, then stabilises.
                let t = (i + 1) as f64;
                let s = (sigma
                    * (lambda / (2.0 - lambda) * (1.0 - (1.0 - lambda).powf(2.0 * t))).sqrt())
                .max(f64::EPSILON);
                centre.push(z);
                scale.push(s);
                // Robust update: a point beyond the limit does not drag the centre
                // with it, otherwise the points right after a spike get flagged too.
                if v.is_finite() && (v - z).abs() / s <= threshold {
                    z = lambda * v + (1.0 - lambda) * z;
                }
            }
            Ok(score_against(y, &centre, &scale, threshold, "ewma", None))
        }
    }
}

/// Rolling (centred) median and MAD·1.4826. When the local MAD collapses to zero
/// the global scale is used so flat stretches don't flag every tiny wiggle.
pub fn rolling_median_mad(y: &[f64], k: usize) -> (Vec<f64>, Vec<f64>) {
    let n = y.len();
    let k = k.max(1).min(n.max(1));
    let half = (k - 1) / 2;
    let global = (stats::mad(y) * MAD_TO_SIGMA).max(f64::EPSILON);
    let mut centre = Vec::with_capacity(n);
    let mut scale = Vec::with_capacity(n);
    let mut buf: Vec<f64> = Vec::with_capacity(k);
    for i in 0..n {
        let lo = i.saturating_sub(half);
        let hi = (lo + k).min(n);
        let lo = hi.saturating_sub(k).min(lo);
        buf.clear();
        buf.extend(y[lo..hi].iter().copied().filter(|v| v.is_finite()));
        buf.sort_by(|a, b| a.partial_cmp(b).unwrap());
        let m = stats::quantile_sorted(&buf, 0.5);
        let mut dev: Vec<f64> = buf.iter().map(|v| (v - m).abs()).collect();
        dev.sort_by(|a, b| a.partial_cmp(b).unwrap());
        let s = stats::quantile_sorted(&dev, 0.5) * MAD_TO_SIGMA;
        centre.push(m);
        scale.push(if s > 0.0 && s.is_finite() { s } else { global });
    }
    (centre, scale)
}

fn score_against(
    y: &[f64],
    centre: &[f64],
    scale: &[f64],
    threshold: f64,
    method: &'static str,
    period: Option<usize>,
) -> AnomalyResult {
    let n = y.len();
    let mut scores = Vec::with_capacity(n);
    let mut lower = Vec::with_capacity(n);
    let mut upper = Vec::with_capacity(n);
    for i in 0..n {
        let s = if scale[i].is_finite() && scale[i] > 0.0 {
            scale[i]
        } else {
            f64::EPSILON
        };
        lower.push(centre[i] - threshold * s);
        upper.push(centre[i] + threshold * s);
        scores.push(if y[i].is_finite() {
            (y[i] - centre[i]).abs() / s
        } else {
            f64::NAN
        });
    }
    finish(scores, lower, upper, threshold, method, period)
}

#[cfg(test)]
mod tests {
    use super::*;

    use rand::{rngs::StdRng, Rng, SeedableRng};

    fn series_with_spikes() -> Vec<f64> {
        let mut rng = StdRng::seed_from_u64(3);
        let mut y: Vec<f64> = (0..200)
            .map(|i| {
                50.0 + 5.0 * (std::f64::consts::TAU * i as f64 / 7.0).sin()
                    + rng.gen_range(-1.0..1.0)
            })
            .collect();
        y[60] = 120.0;
        y[150] = -10.0;
        y[90] = f64::NAN;
        y
    }

    #[test]
    fn mad_finds_spikes_only() {
        let y = series_with_spikes();
        let r = detect(&y, AnomalyOptions::default()).unwrap();
        assert_eq!(r.indices, vec![60, 150], "{:?}", r.indices);
        assert!(r.scores[90].is_nan());
        assert!(r.lower[10] < y[10] && y[10] < r.upper[10]);
    }

    #[test]
    fn all_methods_run() {
        let y = series_with_spikes();
        for m in [
            AnomalyMethod::Zscore,
            AnomalyMethod::Iqr,
            AnomalyMethod::Ewma,
            AnomalyMethod::Seasonal,
        ] {
            let r = detect(
                &y,
                AnomalyOptions {
                    method: m,
                    period: Some(7),
                    ..Default::default()
                },
            )
            .unwrap();
            assert!(
                r.indices.contains(&60),
                "{m:?} missed the big spike: {:?}",
                r.indices
            );
            assert!(r.indices.len() <= 6, "{m:?} over-flagged: {:?}", r.indices);
        }
    }

    #[test]
    fn sensitivity_moves_threshold() {
        let y = series_with_spikes();
        let loose = detect(
            &y,
            AnomalyOptions {
                sensitivity: Some(0.0),
                ..Default::default()
            },
        )
        .unwrap();
        let tight = detect(
            &y,
            AnomalyOptions {
                sensitivity: Some(1.0),
                ..Default::default()
            },
        )
        .unwrap();
        assert!(loose.indices.len() <= tight.indices.len());
        assert_eq!(loose.threshold, 6.0);
        assert_eq!(tight.threshold, 2.0);
    }

    #[test]
    fn too_short() {
        assert!(detect(&[1.0, f64::NAN], AnomalyOptions::default()).is_err());
    }
}
