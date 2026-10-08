//! Seasonal period detection. Two detectors: augurs' Welch periodogram (the
//! default) and an autocorrelation scan that is also what the JS fallback uses.

use crate::impute::{impute, Impute};
use crate::stats;
use augurs::seasons::{Detector as _, PeriodogramDetector};

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum SeasonalityMethod {
    /// Union of both detectors, ranked by autocorrelation strength (default).
    Auto,
    Periodogram,
    Autocorrelation,
}

impl SeasonalityMethod {
    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "auto" => Some(SeasonalityMethod::Auto),
            "periodogram" => Some(SeasonalityMethod::Periodogram),
            "autocorrelation" | "acf" => Some(SeasonalityMethod::Autocorrelation),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Copy)]
pub struct SeasonalityOptions {
    pub method: SeasonalityMethod,
    pub min_period: usize,
    /// `None` → `min(n / 3, 512)`.
    pub max_period: Option<usize>,
    /// Periodogram power threshold (0..1) or minimum autocorrelation peak.
    pub threshold: Option<f64>,
    /// Minimum autocorrelation (of the detrended series) at the period for it
    /// to be reported. `None` → 0.3.
    pub min_strength: Option<f64>,
}

impl Default for SeasonalityOptions {
    fn default() -> Self {
        SeasonalityOptions {
            method: SeasonalityMethod::Auto,
            min_period: 4,
            max_period: None,
            threshold: None,
            min_strength: None,
        }
    }
}

/// Remove the least-squares linear trend.
pub fn detrend(y: &[f64]) -> Vec<f64> {
    let x: Vec<f64> = (0..y.len()).map(|i| i as f64).collect();
    let (slope, intercept) = stats::ols(&x, y);
    if !slope.is_finite() {
        return y.to_vec();
    }
    y.iter()
        .zip(&x)
        .map(|(v, xi)| v - (slope * xi + intercept))
        .collect()
}

#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SeasonalityResult {
    /// Candidate periods, strongest first.
    pub periods: Vec<u32>,
    /// Strength per period (autocorrelation at that lag, in `[-1, 1]`).
    pub strengths: Vec<f64>,
    pub method: &'static str,
}

pub fn detect(y: &[f64], opts: SeasonalityOptions) -> SeasonalityResult {
    let n = y.len();
    let max_period = opts
        .max_period
        .unwrap_or((n / 3).min(512))
        .max(opts.min_period);
    if n < 3 * opts.min_period.max(2) {
        return SeasonalityResult {
            periods: vec![],
            strengths: vec![],
            method: "none",
        };
    }
    // Detrend first: a trend concentrates spectral power at low frequencies and
    // masquerades as a long period.
    let filled = detrend(&impute(y, Impute::Linear));
    let min_strength = opts.min_strength.unwrap_or(0.3);
    let mut periods: Vec<u32> = Vec::new();
    if matches!(
        opts.method,
        SeasonalityMethod::Periodogram | SeasonalityMethod::Auto
    ) {
        let threshold = opts.threshold.unwrap_or(0.9).clamp(0.01, 0.99);
        let det = PeriodogramDetector::builder()
            .min_period(opts.min_period as u32)
            .max_period(max_period as u32)
            .threshold(threshold)
            .build();
        periods.extend(det.detect(&filled));
    }
    if matches!(
        opts.method,
        SeasonalityMethod::Autocorrelation | SeasonalityMethod::Auto
    ) {
        let threshold = if opts.method == SeasonalityMethod::Auto {
            0.3
        } else {
            opts.threshold.unwrap_or(0.3)
        };
        periods.extend(autocorrelation_periods(
            &filled,
            opts.min_period,
            max_period,
            threshold,
        ));
    }
    periods.sort_unstable();
    periods.dedup();
    periods.retain(|&p| (p as usize) >= opts.min_period && (p as usize) <= max_period);
    let mut scored: Vec<(u32, f64)> = periods
        .iter()
        .map(|&p| (p, stats::autocorrelation(&filled, p as usize)))
        .collect();
    scored.retain(|(_, s)| s.is_finite() && *s >= min_strength);
    // Drop harmonics: a period that is a multiple of a shorter, (nearly) as
    // strong period is the same seasonality seen twice.
    let keep: Vec<(u32, f64)> = scored
        .iter()
        .filter(|(p, s)| {
            !scored
                .iter()
                .any(|(q, t)| q < p && p.is_multiple_of(*q) && *t >= s - 0.05)
        })
        .copied()
        .collect();
    scored = keep;
    scored.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap());
    let periods: Vec<u32> = scored.iter().map(|(p, _)| *p).collect();
    let strengths: Vec<f64> = scored.iter().map(|(_, s)| *s).collect();
    SeasonalityResult {
        periods,
        strengths,
        method: match opts.method {
            SeasonalityMethod::Auto => "auto",
            SeasonalityMethod::Periodogram => "periodogram",
            SeasonalityMethod::Autocorrelation => "autocorrelation",
        },
    }
}

/// Local maxima of the autocorrelation function above `threshold`, strongest
/// first; harmonics of an already-found period are dropped.
pub fn autocorrelation_periods(
    y: &[f64],
    min_period: usize,
    max_period: usize,
    threshold: f64,
) -> Vec<u32> {
    let n = y.len();
    if n < 4 || max_period < min_period {
        return vec![];
    }
    let hi = max_period.min(n - 2);
    let acf: Vec<f64> = (0..=hi + 1)
        .map(|lag| stats::autocorrelation(y, lag))
        .collect();
    let mut cands: Vec<(usize, f64)> = (min_period.max(2)..=hi)
        .filter(|&lag| acf[lag] > threshold && acf[lag] >= acf[lag - 1] && acf[lag] >= acf[lag + 1])
        .map(|lag| (lag, acf[lag]))
        .collect();
    cands.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap());
    let mut out: Vec<u32> = Vec::new();
    for (lag, _) in cands {
        if out
            .iter()
            .any(|&p| lag.is_multiple_of(p as usize) || (p as usize).is_multiple_of(lag))
        {
            continue;
        }
        out.push(lag as u32);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn weekly(n: usize) -> Vec<f64> {
        (0..n)
            .map(|i| 100.0 + 20.0 * (i % 7) as f64 + ((i * 13) % 5) as f64)
            .collect()
    }

    #[test]
    fn periodogram_finds_weekly() {
        let r = detect(
            &weekly(140),
            SeasonalityOptions {
                method: SeasonalityMethod::Periodogram,
                ..Default::default()
            },
        );
        assert_eq!(r.periods.first(), Some(&7), "{:?}", r.periods);
        assert!(r.strengths[0] > 0.5);
        let auto = detect(&weekly(140), SeasonalityOptions::default());
        assert_eq!(auto.periods.first(), Some(&7), "{:?}", auto.periods);
    }

    #[test]
    fn autocorrelation_finds_weekly() {
        let r = detect(
            &weekly(140),
            SeasonalityOptions {
                method: SeasonalityMethod::Autocorrelation,
                ..Default::default()
            },
        );
        assert_eq!(r.periods.first(), Some(&7), "{:?}", r.periods);
    }

    #[test]
    fn short_or_flat_series_have_no_season() {
        assert!(detect(&weekly(8), SeasonalityOptions::default())
            .periods
            .is_empty());
        let flat = vec![1.0; 100];
        assert!(detect(
            &flat,
            SeasonalityOptions {
                method: SeasonalityMethod::Autocorrelation,
                ..Default::default()
            }
        )
        .periods
        .is_empty());
    }
}
