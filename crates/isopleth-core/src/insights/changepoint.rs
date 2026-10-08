//! Changepoint detection: where the level of a series shifts.
//! `augurs` provides Bayesian online detectors; the binary-segmentation
//! detector here is deterministic and cheap, and is what the JS fallback uses.

use crate::impute::{impute, Impute};
use crate::stats;
use crate::{Error, Result};
use augurs::changepoint::{DefaultArgpcpDetector, Detector as _, NormalGammaDetector};

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum ChangepointMethod {
    /// Binary segmentation on the mean with a BIC-style penalty.
    BinarySegmentation,
    /// augurs' autoregressive Gaussian-process BOCPD. Opt-in: O(n²), seconds for a few thousand points.
    Argpcp,
    /// augurs' Normal–Gamma BOCPD (opt-in).
    NormalGamma,
    /// Binary segmentation with the configured cost model (default).
    Auto,
}

impl ChangepointMethod {
    pub fn parse(s: &str) -> Option<Self> {
        Some(match s {
            "auto" => ChangepointMethod::Auto,
            "binseg" | "binary-segmentation" => ChangepointMethod::BinarySegmentation,
            "argpcp" => ChangepointMethod::Argpcp,
            "normal-gamma" => ChangepointMethod::NormalGamma,
            _ => return None,
        })
    }
}

/// Cost model for binary segmentation.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum CostModel {
    /// Piecewise-constant mean (classic; trends get chopped into steps).
    Mean,
    /// Piecewise-linear (default): a level shift on top of a trend is one changepoint.
    Linear,
}

impl CostModel {
    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "mean" => Some(CostModel::Mean),
            "linear" => Some(CostModel::Linear),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Copy)]
pub struct ChangepointOptions {
    pub method: ChangepointMethod,
    pub model: CostModel,
    /// Minimum segment length (binary segmentation).
    pub min_segment: usize,
    /// Upper bound on the number of changepoints (binary segmentation).
    pub max_changepoints: usize,
    /// Penalty multiplier; larger = fewer changepoints (binary segmentation).
    pub penalty: f64,
}

impl Default for ChangepointOptions {
    fn default() -> Self {
        ChangepointOptions {
            method: ChangepointMethod::Auto,
            model: CostModel::Linear,
            min_segment: 5,
            max_changepoints: 10,
            penalty: 1.0,
        }
    }
}

#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangepointResult {
    /// Index of the first observation of each new segment, ascending.
    pub indices: Vec<u32>,
    /// Mean of each segment (`indices.len() + 1` entries).
    pub segment_means: Vec<f64>,
    pub method: &'static str,
}

pub fn detect(y: &[f64], opts: ChangepointOptions) -> Result<ChangepointResult> {
    let n = y.len();
    if stats::count(y) < 2 * opts.min_segment.max(1) {
        return Err(Error::NotEnoughData {
            needed: 2 * opts.min_segment.max(1),
            got: stats::count(y),
        });
    }
    let filled = impute(y, Impute::Linear);
    // `Auto` is binary segmentation: the BOCPD detectors are O(n²) and take
    // seconds for a few thousand points, so they are opt-in.
    let method = match opts.method {
        ChangepointMethod::Auto => ChangepointMethod::BinarySegmentation,
        m => m,
    };
    let (mut indices, name): (Vec<usize>, &'static str) = match method {
        ChangepointMethod::BinarySegmentation | ChangepointMethod::Auto => {
            (binary_segmentation(&filled, opts), "binseg")
        }
        ChangepointMethod::Argpcp => {
            let cps = DefaultArgpcpDetector::default().detect_changepoints(&filled);
            // augurs reports the index *before* the change and always includes 0.
            (
                cps.into_iter()
                    .filter(|&i| i > 0)
                    .map(|i| (i + 1).min(n - 1))
                    .collect(),
                "argpcp",
            )
        }
        ChangepointMethod::NormalGamma => {
            let cps = NormalGammaDetector::default().detect_changepoints(&filled);
            (
                cps.into_iter()
                    .filter(|&i| i > 0)
                    .map(|i| (i + 1).min(n - 1))
                    .collect(),
                "normal-gamma",
            )
        }
    };
    indices.sort_unstable();
    indices.dedup();
    indices.retain(|&i| i > 0 && i < n);
    let segment_means = segment_means(&filled, &indices);
    Ok(ChangepointResult {
        indices: indices.into_iter().map(|i| i as u32).collect(),
        segment_means,
        method: name,
    })
}

fn segment_means(y: &[f64], cps: &[usize]) -> Vec<f64> {
    let mut out = Vec::with_capacity(cps.len() + 1);
    let mut start = 0;
    for &c in cps.iter().chain(std::iter::once(&y.len())) {
        out.push(stats::mean(&y[start..c]));
        start = c;
    }
    out
}

/// Greedy binary segmentation. Each split must reduce the within-segment
/// residual sum of squares by more than a BIC-style penalty (`3·σ²·ln(n)` per
/// parameter, scaled by `penalty`), with σ estimated robustly from first
/// differences so that the level shifts themselves don't inflate it.
pub fn binary_segmentation(y: &[f64], opts: ChangepointOptions) -> Vec<usize> {
    let n = y.len();
    let linear = opts.model == CostModel::Linear;
    let min_seg = opts.min_segment.max(if linear { 3 } else { 1 });
    if n < 2 * min_seg {
        return vec![];
    }
    let diffs: Vec<f64> = y.windows(2).map(|w| w[1] - w[0]).collect();
    let sigma = (stats::mad(&diffs) * stats::MAD_TO_SIGMA / std::f64::consts::SQRT_2).max(1e-12);
    let params = if linear { 2.0 } else { 1.0 };
    let pen = opts.penalty.max(0.0) * 3.0 * params * sigma * sigma * (n as f64).ln();

    // Prefix sums for O(1) segment costs (x = index).
    let mut ps = vec![0.0; n + 1];
    let mut pss = vec![0.0; n + 1];
    let mut px = vec![0.0; n + 1];
    let mut pxx = vec![0.0; n + 1];
    let mut pxy = vec![0.0; n + 1];
    for i in 0..n {
        let x = i as f64;
        ps[i + 1] = ps[i] + y[i];
        pss[i + 1] = pss[i] + y[i] * y[i];
        px[i + 1] = px[i] + x;
        pxx[i + 1] = pxx[i] + x * x;
        pxy[i + 1] = pxy[i] + x * y[i];
    }
    let cost = |a: usize, b: usize| -> f64 {
        let len = (b - a) as f64;
        let sy = ps[b] - ps[a];
        let syy = pss[b] - pss[a] - sy * sy / len;
        if !linear {
            return syy;
        }
        let sx = px[b] - px[a];
        let sxx = pxx[b] - pxx[a] - sx * sx / len;
        let sxy = pxy[b] - pxy[a] - sx * sy / len;
        if sxx <= 0.0 {
            syy
        } else {
            (syy - sxy * sxy / sxx).max(0.0)
        }
    };
    let best_split = |a: usize, b: usize| -> Option<(usize, f64)> {
        if b - a < 2 * min_seg {
            return None;
        }
        let base = cost(a, b);
        let mut best: Option<(usize, f64)> = None;
        for k in (a + min_seg)..=(b - min_seg) {
            let gain = base - cost(a, k) - cost(k, b);
            if best.is_none_or(|(_, g)| gain > g) {
                best = Some((k, gain));
            }
        }
        best
    };

    let mut cps: Vec<usize> = Vec::new();
    let mut segments: Vec<(usize, usize)> = vec![(0, n)];
    while cps.len() < opts.max_changepoints {
        let mut candidate: Option<(usize, usize, f64)> = None; // (segment idx, split, gain)
        for (si, &(a, b)) in segments.iter().enumerate() {
            if let Some((k, g)) = best_split(a, b) {
                if g > pen && candidate.is_none_or(|(_, _, cg)| g > cg) {
                    candidate = Some((si, k, g));
                }
            }
        }
        match candidate {
            None => break,
            Some((si, k, _)) => {
                let (a, b) = segments[si];
                segments[si] = (a, k);
                segments.push((k, b));
                cps.push(k);
            }
        }
    }
    cps.sort_unstable();
    cps
}

#[cfg(test)]
mod tests {
    use super::*;

    use rand::{rngs::StdRng, Rng, SeedableRng};

    fn noise(n: usize, sd: f64, seed: u64) -> Vec<f64> {
        let mut rng = StdRng::seed_from_u64(seed);
        // Sum of 12 uniforms ≈ normal; deterministic and dependency-light.
        (0..n)
            .map(|_| ((0..12).map(|_| rng.gen::<f64>()).sum::<f64>() - 6.0) * sd)
            .collect()
    }

    fn steps() -> Vec<f64> {
        noise(150, 0.5, 1)
            .into_iter()
            .enumerate()
            .map(|(i, e)| {
                let level = if i < 50 {
                    10.0
                } else if i < 100 {
                    20.0
                } else {
                    5.0
                };
                level + e
            })
            .collect()
    }

    #[test]
    fn binseg_finds_both_steps() {
        let r = detect(
            &steps(),
            ChangepointOptions {
                method: ChangepointMethod::BinarySegmentation,
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(r.indices, vec![50, 100], "{:?}", r.indices);
        assert_eq!(r.segment_means.len(), 3);
        assert!((r.segment_means[1] - 20.0).abs() < 0.5);
    }

    #[test]
    fn binseg_linear_model_handles_trends() {
        let y: Vec<f64> = noise(200, 0.5, 4)
            .into_iter()
            .enumerate()
            .map(|(i, e)| 10.0 + 0.3 * i as f64 + if i >= 120 { 25.0 } else { 0.0 } + e)
            .collect();
        let r = detect(
            &y,
            ChangepointOptions {
                method: ChangepointMethod::BinarySegmentation,
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(r.indices, vec![120], "{:?}", r.indices);
        let mean_model = detect(
            &y,
            ChangepointOptions {
                method: ChangepointMethod::BinarySegmentation,
                model: CostModel::Mean,
                ..Default::default()
            },
        )
        .unwrap();
        assert!(
            mean_model.indices.len() > 1,
            "mean model chops trends: {:?}",
            mean_model.indices
        );
    }

    #[test]
    fn binseg_ignores_noise() {
        for seed in 0..5 {
            let y = noise(200, 3.0, seed);
            let r = detect(
                &y,
                ChangepointOptions {
                    method: ChangepointMethod::BinarySegmentation,
                    ..Default::default()
                },
            )
            .unwrap();
            assert!(r.indices.is_empty(), "seed {seed}: {:?}", r.indices);
        }
    }

    #[test]
    fn augurs_detectors_run() {
        for m in [
            ChangepointMethod::Argpcp,
            ChangepointMethod::NormalGamma,
            ChangepointMethod::Auto,
        ] {
            let r = detect(
                &steps(),
                ChangepointOptions {
                    method: m,
                    ..Default::default()
                },
            )
            .unwrap();
            assert!(
                r.indices.iter().any(|&i| (45..=55).contains(&i)),
                "{m:?}: {:?}",
                r.indices
            );
            assert!(r.indices.iter().all(|&i| i > 0 && (i as usize) < 150));
        }
    }
}
