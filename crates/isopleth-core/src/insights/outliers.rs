//! Outliers in categorical and multi-series data:
//!
//! * **frequency outliers** — categories that occur unusually rarely or often;
//! * **category outliers** — categories whose aggregate value stands out from
//!   the other categories, and points that stand out *within* their category;
//! * **series outliers** — among many series, the ones that behave differently
//!   (augurs' DBSCAN / MAD cross-series detectors).

use super::threshold_from_sensitivity;
use crate::group::{aggregate, Reducer};
use crate::stats::{self, MAD_TO_SIGMA};
use crate::{Error, Result};
use augurs::outlier::{DbscanDetector, MADDetector, OutlierDetector as _};

/// Robust z-scores of `values` against their own median/MAD. Falls back to the
/// mean absolute deviation when the MAD is zero; all-zero scale → all zeros.
pub fn robust_z(values: &[f64]) -> Vec<f64> {
    let m = stats::median(values);
    let mut s = stats::mad(values) * MAD_TO_SIGMA;
    if !(s > 0.0) {
        let dev: Vec<f64> = stats::finite(values).map(|v| (v - m).abs()).collect();
        s = stats::mean(&dev) * 1.2533; // mean abs dev → σ for normal data
    }
    values
        .iter()
        .map(|&v| {
            if !v.is_finite() {
                f64::NAN
            } else if s > 0.0 {
                (v - m) / s
            } else {
                0.0
            }
        })
        .collect()
}

#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FrequencyOutlierResult {
    /// Robust z-score of `log(count + 1)` per category.
    pub scores: Vec<f64>,
    /// Categories that are unusually rare.
    pub rare: Vec<u32>,
    /// Categories that are unusually dominant.
    pub dominant: Vec<u32>,
    pub threshold: f64,
}

/// `counts[i]` is the number of occurrences of category `i`.
pub fn frequency_outliers(
    counts: &[f64],
    sensitivity: Option<f64>,
    threshold: Option<f64>,
) -> FrequencyOutlierResult {
    let t = threshold_from_sensitivity(sensitivity, threshold.unwrap_or(2.5));
    let logs: Vec<f64> = counts.iter().map(|c| (c.max(0.0) + 1.0).ln()).collect();
    let scores = if counts.len() >= 3 {
        robust_z(&logs)
    } else {
        vec![0.0; counts.len()]
    };
    let rare = scores
        .iter()
        .enumerate()
        .filter(|(_, z)| **z < -t)
        .map(|(i, _)| i as u32)
        .collect();
    let dominant = scores
        .iter()
        .enumerate()
        .filter(|(_, z)| **z > t)
        .map(|(i, _)| i as u32)
        .collect();
    FrequencyOutlierResult {
        scores,
        rare,
        dominant,
        threshold: t,
    }
}

#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CategoryOutlierResult {
    /// Aggregate per category (e.g. the median value of each category).
    pub aggregates: Vec<f64>,
    /// Robust z-score of each category's aggregate among all categories.
    pub scores: Vec<f64>,
    /// Categories whose aggregate is an outlier.
    pub categories: Vec<u32>,
    /// Per-row robust z within the row's own category (NaN when excluded).
    pub within_scores: Vec<f64>,
    /// Rows that are outliers within their category.
    pub within: Vec<u32>,
    pub threshold: f64,
}

/// `codes[i] < 0` excludes row `i`. `reducer` summarises each category
/// (default `Median`) before categories are compared with one another.
pub fn category_outliers(
    codes: &[i32],
    values: &[f64],
    n_groups: usize,
    reducer: Option<Reducer>,
    sensitivity: Option<f64>,
    threshold: Option<f64>,
) -> Result<CategoryOutlierResult> {
    if codes.len() != values.len() {
        return Err(Error::LengthMismatch {
            expected: codes.len(),
            got: values.len(),
        });
    }
    let t = threshold_from_sensitivity(sensitivity, threshold.unwrap_or(3.0));
    let aggregates = aggregate(codes, values, n_groups, reducer.unwrap_or(Reducer::Median));
    let scores = if n_groups >= 3 {
        robust_z(&aggregates)
    } else {
        vec![0.0; n_groups]
    };
    let categories = scores
        .iter()
        .enumerate()
        .filter(|(_, z)| z.is_finite() && z.abs() > t)
        .map(|(i, _)| i as u32)
        .collect();

    // Within-category: robust z of each row against its own group.
    let mut buckets: Vec<Vec<f64>> = vec![Vec::new(); n_groups];
    for (i, &c) in codes.iter().enumerate() {
        if c >= 0 && (c as usize) < n_groups {
            buckets[c as usize].push(values[i]);
        }
    }
    let stats_per: Vec<(f64, f64)> = buckets
        .iter()
        .map(|b| {
            if stats::count(b) < 4 {
                (f64::NAN, f64::NAN)
            } else {
                let m = stats::median(b);
                let mut s = stats::mad(b) * MAD_TO_SIGMA;
                if !(s > 0.0) {
                    let dev: Vec<f64> = stats::finite(b).map(|v| (v - m).abs()).collect();
                    s = stats::mean(&dev) * 1.2533;
                }
                (m, s)
            }
        })
        .collect();
    let within_scores: Vec<f64> = codes
        .iter()
        .zip(values)
        .map(|(&c, &v)| {
            if c < 0 || (c as usize) >= n_groups || !v.is_finite() {
                return f64::NAN;
            }
            let (m, s) = stats_per[c as usize];
            if !m.is_finite() {
                f64::NAN
            } else if s > 0.0 {
                (v - m).abs() / s
            } else {
                0.0
            }
        })
        .collect();
    let within = within_scores
        .iter()
        .enumerate()
        .filter(|(_, z)| z.is_finite() && **z > t)
        .map(|(i, _)| i as u32)
        .collect();
    Ok(CategoryOutlierResult {
        aggregates,
        scores,
        categories,
        within_scores,
        within,
        threshold: t,
    })
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum SeriesOutlierMethod {
    Dbscan,
    Mad,
}

impl SeriesOutlierMethod {
    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "dbscan" | "auto" => Some(SeriesOutlierMethod::Dbscan),
            "mad" => Some(SeriesOutlierMethod::Mad),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SeriesOutlierResult {
    /// Indices of outlying series.
    pub outlying: Vec<u32>,
    /// Per-series, per-timestamp outlier scores.
    pub scores: Vec<Vec<f64>>,
    /// Lower edge of the "normal" cluster band per timestamp (NaN when unknown).
    pub band_min: Vec<f64>,
    /// Upper edge of the "normal" cluster band per timestamp.
    pub band_max: Vec<f64>,
    pub method: &'static str,
}

/// Which of several equal-length series are outliers. `sensitivity` must be
/// strictly inside `(0, 1)`; the default is `0.5`.
pub fn series_outliers(
    series: &[Vec<f64>],
    method: SeriesOutlierMethod,
    sensitivity: Option<f64>,
) -> Result<SeriesOutlierResult> {
    if series.is_empty() {
        return Err(Error::NotEnoughData { needed: 1, got: 0 });
    }
    let len = series[0].len();
    for s in series {
        if s.len() != len {
            return Err(Error::LengthMismatch {
                expected: len,
                got: s.len(),
            });
        }
    }
    let sens = sensitivity.unwrap_or(0.5).clamp(0.01, 0.99);
    let refs: Vec<&[f64]> = series.iter().map(|s| s.as_slice()).collect();
    let (out, name) = match method {
        SeriesOutlierMethod::Dbscan => {
            let det =
                DbscanDetector::with_sensitivity(sens).map_err(|e| Error::Model(e.to_string()))?;
            let pre = det
                .preprocess(&refs)
                .map_err(|e| Error::Model(e.to_string()))?;
            (
                det.detect(&pre).map_err(|e| Error::Model(e.to_string()))?,
                "dbscan",
            )
        }
        SeriesOutlierMethod::Mad => {
            let det =
                MADDetector::with_sensitivity(sens).map_err(|e| Error::Model(e.to_string()))?;
            let pre = det
                .preprocess(&refs)
                .map_err(|e| Error::Model(e.to_string()))?;
            (
                det.detect(&pre).map_err(|e| Error::Model(e.to_string()))?,
                "mad",
            )
        }
    };
    let (band_min, band_max) = match out.cluster_band {
        Some(b) => (b.min, b.max),
        None => (vec![f64::NAN; len], vec![f64::NAN; len]),
    };
    Ok(SeriesOutlierResult {
        outlying: out.outlying_series.iter().map(|&i| i as u32).collect(),
        scores: out.series_results.into_iter().map(|s| s.scores).collect(),
        band_min,
        band_max,
        method: name,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn frequency() {
        let counts = [100.0, 95.0, 110.0, 102.0, 98.0, 3.0, 105.0, 900.0];
        let r = frequency_outliers(&counts, None, None);
        assert_eq!(r.rare, vec![5]);
        assert_eq!(r.dominant, vec![7]);
        assert!(frequency_outliers(&[1.0, 2.0], None, None).rare.is_empty());
    }

    #[test]
    fn category() {
        // 6 categories × 8 rows; category 3 has a much higher level; row 7 is a within-outlier.
        let mut codes = Vec::new();
        let mut values = Vec::new();
        for c in 0..6i32 {
            for r in 0..8 {
                codes.push(c);
                let base = if c == 3 { 100.0 } else { 10.0 };
                values.push(base + ((r * 7 + c) % 5) as f64 * 0.5);
            }
        }
        values[7] = 60.0;
        let r = category_outliers(&codes, &values, 6, None, None, None).unwrap();
        assert_eq!(r.categories, vec![3], "{:?}", r.scores);
        assert_eq!(r.within, vec![7], "{:?}", r.within);
        assert!(r.within_scores[7] > 3.0);
    }

    #[test]
    fn series() {
        let normal = |phase: f64| -> Vec<f64> {
            (0..60)
                .map(|i| 10.0 + (i as f64 * 0.2 + phase).sin())
                .collect()
        };
        let mut series = vec![normal(0.0), normal(0.1), normal(0.2), normal(0.3)];
        series.push(
            (0..60)
                .map(|i| 10.0 + if i > 30 { 15.0 } else { 0.0 })
                .collect(),
        );
        let r = series_outliers(&series, SeriesOutlierMethod::Dbscan, None).unwrap();
        assert_eq!(r.outlying, vec![4]);
        assert_eq!(r.scores.len(), 5);
        assert!(r.band_min[0].is_finite());
        let m = series_outliers(&series, SeriesOutlierMethod::Mad, None).unwrap();
        assert!(m.outlying.contains(&4));
        assert!(series_outliers(
            &[vec![1.0], vec![1.0, 2.0]],
            SeriesOutlierMethod::Dbscan,
            None
        )
        .is_err());
    }
}
