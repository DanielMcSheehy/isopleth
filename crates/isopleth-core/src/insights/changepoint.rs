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
    /// augurs' autoregressive Gaussian-process BOCPD (default `Auto` for n ≤ 2000).
    Argpcp,
    /// augurs' Normal–Gamma BOCPD.
    NormalGamma,
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

#[derive(Debug, Clone, Copy)]
pub struct ChangepointOptions {
    pub method: ChangepointMethod,
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
    let method = match opts.method {
        ChangepointMethod::Auto => {
            if n <= 2000 {
                ChangepointMethod::Argpcp
            } else {
                ChangepointMethod::BinarySegmentation
            }
        }
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

/// Greedy binary segmentation. Each split must reduce the within-segment sum of
/// squares by more than `penalty · σ² · log(n)`, with σ estimated robustly from
/// first differences so that the level shifts themselves don't inflate it.
pub fn binary_segmentation(y: &[f64], opts: ChangepointOptions) -> Vec<usize> {
    let n = y.len();
    let min_seg = opts.min_segment.max(1);
    if n < 2 * min_seg {
        return vec![];
    }
    let diffs: Vec<f64> = y.windows(2).map(|w| w[1] - w[0]).collect();
    let sigma = (stats::mad(&diffs) * stats::MAD_TO_SIGMA / std::f64::consts::SQRT_2).max(1e-12);
    // BIC-style penalty: 3·σ²·ln(n) per extra changepoint (conservative, like
    // ruptures' default) scaled by the user's `penalty`.
    let pen = opts.penalty.max(0.0) * 3.0 * sigma * sigma * (n as f64).ln();

    // Prefix sums for O(1) segment costs.
    let mut ps = vec![0.0; n + 1];
    let mut pss = vec![0.0; n + 1];
    for i in 0..n {
        ps[i + 1] = ps[i] + y[i];
        pss[i + 1] = pss[i] + y[i] * y[i];
    }
    let cost = |a: usize, b: usize| -> f64 {
        let len = (b - a) as f64;
        let s = ps[b] - ps[a];
        pss[b] - pss[a] - s * s / len
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
