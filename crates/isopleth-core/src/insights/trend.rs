//! Linear trend lines.

use crate::stats;
use crate::{Error, Result};

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum TrendMethod {
    /// Ordinary least squares.
    Ols,
    /// Theil–Sen (median of slopes). Robust; sub-sampled above 2000 points.
    TheilSen,
}

impl TrendMethod {
    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "ols" | "linear" | "auto" => Some(TrendMethod::Ols),
            "theil-sen" | "theilsen" | "robust" => Some(TrendMethod::TheilSen),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrendResult {
    pub slope: f64,
    pub intercept: f64,
    /// `slope * x + intercept` for every input `x`.
    pub fitted: Vec<f64>,
    /// Coefficient of determination of the fit.
    pub r2: f64,
    pub method: &'static str,
}

pub fn trend(x: &[f64], y: &[f64], method: TrendMethod) -> Result<TrendResult> {
    if x.len() != y.len() {
        return Err(Error::LengthMismatch {
            expected: x.len(),
            got: y.len(),
        });
    }
    let valid = x
        .iter()
        .zip(y)
        .filter(|(a, b)| a.is_finite() && b.is_finite())
        .count();
    if valid < 2 {
        return Err(Error::NotEnoughData {
            needed: 2,
            got: valid,
        });
    }
    let (slope, intercept, name) = match method {
        TrendMethod::Ols => {
            let (s, b) = stats::ols(x, y);
            (s, b, "ols")
        }
        TrendMethod::TheilSen => {
            const CAP: usize = 2000;
            let (s, b) = if x.len() > CAP {
                let step = x.len() as f64 / CAP as f64;
                let xs: Vec<f64> = (0..CAP).map(|i| x[(i as f64 * step) as usize]).collect();
                let ys: Vec<f64> = (0..CAP).map(|i| y[(i as f64 * step) as usize]).collect();
                stats::theil_sen(&xs, &ys)
            } else {
                stats::theil_sen(x, y)
            };
            (s, b, "theil-sen")
        }
    };
    let fitted: Vec<f64> = x
        .iter()
        .map(|xi| {
            if xi.is_finite() {
                slope * xi + intercept
            } else {
                f64::NAN
            }
        })
        .collect();
    let ybar = stats::mean(y);
    let (mut ss_res, mut ss_tot) = (0.0, 0.0);
    for (yi, fi) in y.iter().zip(&fitted) {
        if yi.is_finite() && fi.is_finite() {
            ss_res += (yi - fi).powi(2);
            ss_tot += (yi - ybar).powi(2);
        }
    }
    let r2 = if ss_tot > 0.0 {
        1.0 - ss_res / ss_tot
    } else {
        f64::NAN
    };
    Ok(TrendResult {
        slope,
        intercept,
        fitted,
        r2,
        method: name,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fits_line() {
        let x: Vec<f64> = (0..10).map(|i| i as f64).collect();
        let y: Vec<f64> = x.iter().map(|v| 3.0 * v + 2.0).collect();
        let r = trend(&x, &y, TrendMethod::Ols).unwrap();
        assert!((r.slope - 3.0).abs() < 1e-12 && (r.r2 - 1.0).abs() < 1e-12);
        let mut y2 = y.clone();
        y2[5] = 100.0;
        let r2 = trend(&x, &y2, TrendMethod::TheilSen).unwrap();
        assert!((r2.slope - 3.0).abs() < 1e-9);
        assert!(trend(&x, &y[..5], TrendMethod::Ols).is_err());
    }
}
