//! Insight kernels: the analytics behind the `insights` configuration of a chart.
//! Each module is self-contained and returns plain data (indices, scores, bands)
//! that the JS layer turns into marks.

pub mod anomaly;
pub mod changepoint;
pub mod decompose;
pub mod forecast;
pub mod outliers;
pub mod seasonality;
pub mod trend;

#[allow(clippy::excessive_precision)]
/// Inverse of the standard normal CDF (Acklam's rational approximation,
/// relative error < 1.15e-9). Used to turn a confidence `level` into a z-score.
pub fn normal_quantile(p: f64) -> f64 {
    if !(0.0..=1.0).contains(&p) || p.is_nan() {
        return f64::NAN;
    }
    if p == 0.0 {
        return f64::NEG_INFINITY;
    }
    if p == 1.0 {
        return f64::INFINITY;
    }
    const A: [f64; 6] = [
        -3.969683028665376e+01,
        2.209460984245205e+02,
        -2.759285104469687e+02,
        1.38357751867269e+02,
        -3.066479806614716e+01,
        2.506628277459239e+00,
    ];
    const B: [f64; 5] = [
        -5.447609879822406e+01,
        1.615858368580409e+02,
        -1.556989798598866e+02,
        6.680131188771972e+01,
        -1.328068155288572e+01,
    ];
    const C: [f64; 6] = [
        -7.784894002430293e-03,
        -3.223964580411365e-01,
        -2.400758277161838e+00,
        -2.549732539343734e+00,
        4.374664141464968e+00,
        2.938163982698783e+00,
    ];
    const D: [f64; 4] = [
        7.784695709041462e-03,
        3.224671290700398e-01,
        2.445134137142996e+00,
        3.754408661907416e+00,
    ];
    let p_low = 0.02425;
    let p_high = 1.0 - p_low;
    if p < p_low {
        let q = (-2.0 * p.ln()).sqrt();
        (((((C[0] * q + C[1]) * q + C[2]) * q + C[3]) * q + C[4]) * q + C[5])
            / ((((D[0] * q + D[1]) * q + D[2]) * q + D[3]) * q + 1.0)
    } else if p <= p_high {
        let q = p - 0.5;
        let r = q * q;
        (((((A[0] * r + A[1]) * r + A[2]) * r + A[3]) * r + A[4]) * r + A[5]) * q
            / (((((B[0] * r + B[1]) * r + B[2]) * r + B[3]) * r + B[4]) * r + 1.0)
    } else {
        let q = (-2.0 * (1.0 - p).ln()).sqrt();
        -(((((C[0] * q + C[1]) * q + C[2]) * q + C[3]) * q + C[4]) * q + C[5])
            / ((((D[0] * q + D[1]) * q + D[2]) * q + D[3]) * q + 1.0)
    }
}

/// z-score for a two-sided interval at `level` (e.g. 0.95 → 1.96).
pub fn z_for_level(level: f64) -> f64 {
    normal_quantile(0.5 + level / 2.0)
}

/// Map a `sensitivity` in `[0, 1]` onto a robust-z threshold in `[6, 2]`.
/// `None` keeps the method's default.
pub fn threshold_from_sensitivity(sensitivity: Option<f64>, default: f64) -> f64 {
    match sensitivity {
        Some(s) => 6.0 - 4.0 * s.clamp(0.0, 1.0),
        None => default,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normal_quantiles() {
        assert!((normal_quantile(0.975) - 1.959964).abs() < 1e-5);
        assert!((normal_quantile(0.5)).abs() < 1e-12);
        assert!((normal_quantile(0.01) + 2.326348).abs() < 1e-5);
        assert!((z_for_level(0.8) - 1.281552).abs() < 1e-5);
        assert_eq!(threshold_from_sensitivity(Some(0.5), 3.5), 4.0);
        assert_eq!(threshold_from_sensitivity(None, 3.5), 3.5);
    }
}
