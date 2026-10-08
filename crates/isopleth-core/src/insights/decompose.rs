//! Classical additive decomposition `y = trend + seasonal + remainder`.
//! Deliberately simple (centred moving average + seasonal means) so that it is
//! deterministic, fast, and identical in the JS fallback.

use crate::impute::{impute, Impute};
use crate::stats;
use crate::{Error, Result};

#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Decomposition {
    pub trend: Vec<f64>,
    pub seasonal: Vec<f64>,
    pub remainder: Vec<f64>,
    pub period: usize,
}

/// Centred moving *median* of width `period` (rounded up to odd), with shrinking
/// windows at the edges so no NaNs are produced. Robust to spikes, which is what
/// makes the remainder usable for anomaly detection.
pub fn centred_moving_median(y: &[f64], period: usize) -> Vec<f64> {
    let n = y.len();
    let width = if period.is_multiple_of(2) {
        period + 1
    } else {
        period
    }
    .max(1);
    let half = width / 2;
    let mut buf: Vec<f64> = Vec::with_capacity(width);
    (0..n)
        .map(|i| {
            buf.clear();
            buf.extend(
                y[i.saturating_sub(half)..(i + half + 1).min(n)]
                    .iter()
                    .copied()
                    .filter(|v| v.is_finite()),
            );
            buf.sort_by(|a, b| a.partial_cmp(b).unwrap());
            stats::quantile_sorted(&buf, 0.5)
        })
        .collect()
}

/// Centred moving average of width `period` (2×MA when `period` is even), with
/// shrinking windows at the edges so no NaNs are produced.
pub fn centred_moving_average(y: &[f64], period: usize) -> Vec<f64> {
    let n = y.len();
    let half = period / 2;
    if period % 2 == 1 || period == 0 {
        return (0..n)
            .map(|i| stats::mean(&y[i.saturating_sub(half)..(i + half + 1).min(n)]))
            .collect();
    }
    // Even period: 2×MA. Window A is centred at i-½, window B at i+½; their mean is centred at i.
    (0..n)
        .map(|i| {
            let a = stats::mean(&y[i.saturating_sub(half)..(i + half).min(n)]);
            let b = stats::mean(&y[(i + 1).saturating_sub(half)..(i + half + 1).min(n)]);
            (a + b) / 2.0
        })
        .collect()
}

pub fn decompose(y: &[f64], period: usize) -> Result<Decomposition> {
    let n = y.len();
    if period < 2 {
        return Err(Error::InvalidArgument("period must be >= 2".into()));
    }
    if n < 2 * period {
        return Err(Error::NotEnoughData {
            needed: 2 * period,
            got: n,
        });
    }
    let filled = impute(y, Impute::Linear);
    // Smooth twice: a moving median kills spikes, the moving average that
    // follows removes the median's staircase so the trend stays smooth.
    let trend = centred_moving_average(&centred_moving_median(&filled, period), period);
    let detrended: Vec<f64> = filled.iter().zip(&trend).map(|(a, b)| a - b).collect();
    let mut by_phase: Vec<Vec<f64>> = vec![Vec::new(); period];
    for (i, v) in detrended.iter().enumerate() {
        if v.is_finite() {
            by_phase[i % period].push(*v);
        }
    }
    // Median per phase, so a single spike cannot bias a whole phase.
    let mut phase: Vec<f64> = by_phase
        .iter()
        .map(|b| if b.is_empty() { 0.0 } else { stats::median(b) })
        .collect();
    let mean_phase = stats::mean(&phase);
    for p in phase.iter_mut() {
        *p -= mean_phase;
    }
    let seasonal: Vec<f64> = (0..n).map(|i| phase[i % period]).collect();
    let remainder: Vec<f64> = (0..n)
        .map(|i| {
            if y[i].is_finite() {
                y[i] - trend[i] - seasonal[i]
            } else {
                f64::NAN
            }
        })
        .collect();
    Ok(Decomposition {
        trend,
        seasonal,
        remainder,
        period,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recovers_seasonal_pattern() {
        let period = 4;
        let pattern = [2.0, -1.0, -2.0, 1.0];
        let y: Vec<f64> = (0..40)
            .map(|i| 10.0 + 0.1 * i as f64 + pattern[i % period])
            .collect();
        let d = decompose(&y, period).unwrap();
        for (i, s) in d.seasonal.iter().enumerate().take(8) {
            assert!((s - pattern[i % period]).abs() < 0.3, "phase {i}: {s}");
        }
        let resid_abs: f64 = d.remainder[4..36].iter().map(|r| r.abs()).sum::<f64>() / 32.0;
        assert!(resid_abs < 0.3, "{resid_abs}");
        assert!(decompose(&y[..6], period).is_err());
    }
}
