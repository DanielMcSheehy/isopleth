//! Forecasting. The heavy lifting (AutoETS, MSTL) comes from `augurs`; the
//! simple models (naive, drift, Holt, Holt–Winters) are implemented here so
//! that they are deterministic and byte-identical to the JS fallback.

use super::{decompose, seasonality, z_for_level};
use crate::impute::{impute, Impute};
use crate::stats;
use crate::{Error, Result};
use augurs::ets::AutoETS;
use augurs::forecaster::{transforms::LinearInterpolator, Forecaster, Transformer as _};
use augurs::mstl::MSTLModel;

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum ForecastMethod {
    /// Pick by series length and detected seasonality.
    Auto,
    /// augurs AutoETS (non-seasonal, model selected by AICc).
    Ets,
    /// augurs MSTL decomposition with an AutoETS trend model.
    Mstl,
    /// Repeat the last value.
    Naive,
    /// Last value plus the average historical slope.
    Drift,
    /// Holt's linear trend (double exponential smoothing).
    Holt,
    /// Holt–Winters additive seasonal.
    HoltWinters,
}

impl ForecastMethod {
    pub fn parse(s: &str) -> Option<Self> {
        Some(match s {
            "auto" => ForecastMethod::Auto,
            "ets" => ForecastMethod::Ets,
            "mstl" => ForecastMethod::Mstl,
            "naive" => ForecastMethod::Naive,
            "drift" => ForecastMethod::Drift,
            "holt" => ForecastMethod::Holt,
            "holt-winters" | "holtwinters" | "hw" => ForecastMethod::HoltWinters,
            _ => return None,
        })
    }
}

#[derive(Debug, Clone, Copy)]
pub struct ForecastOptions {
    pub method: ForecastMethod,
    pub horizon: usize,
    /// Confidence level for the interval, `(0, 1)`. `None` → no interval.
    pub level: Option<f64>,
    /// Seasonal period (`None` = detect when relevant).
    pub period: Option<usize>,
}

impl Default for ForecastOptions {
    fn default() -> Self {
        ForecastOptions {
            method: ForecastMethod::Auto,
            horizon: 10,
            level: Some(0.95),
            period: None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ForecastResult {
    pub point: Vec<f64>,
    pub lower: Vec<f64>,
    pub upper: Vec<f64>,
    /// In-sample one-step-ahead fit (same length as the input; NaN where unknown).
    pub fitted: Vec<f64>,
    pub level: Option<f64>,
    pub method: &'static str,
    pub period: Option<usize>,
}

pub fn forecast(y: &[f64], opts: ForecastOptions) -> Result<ForecastResult> {
    let n = stats::count(y);
    if opts.horizon == 0 {
        return Err(Error::InvalidArgument("horizon must be >= 1".into()));
    }
    if let Some(l) = opts.level {
        if !(l > 0.0 && l < 1.0) {
            return Err(Error::InvalidArgument("level must be in (0, 1)".into()));
        }
    }
    if n < 2 {
        return Err(Error::NotEnoughData { needed: 2, got: n });
    }
    let filled = impute(y, Impute::Linear);
    match opts.method {
        ForecastMethod::Naive => naive(&filled, opts, false),
        ForecastMethod::Drift => naive(&filled, opts, true),
        ForecastMethod::Holt => holt(&filled, opts),
        ForecastMethod::HoltWinters => {
            let period = resolve_period(&filled, opts.period).ok_or(Error::InvalidArgument(
                "no seasonal period found for holt-winters".into(),
            ))?;
            holt_winters(&filled, opts, period)
        }
        ForecastMethod::Ets => ets(&filled, opts),
        ForecastMethod::Mstl => {
            let period = resolve_period(&filled, opts.period).ok_or(Error::InvalidArgument(
                "no seasonal period found for mstl".into(),
            ))?;
            mstl(&filled, opts, period)
        }
        ForecastMethod::Auto => {
            if filled.len() < 10 {
                return naive(&filled, opts, filled.len() >= 3);
            }
            if let Some(p) = resolve_period(&filled, opts.period) {
                if filled.len() >= 3 * p {
                    if let Ok(r) = mstl(&filled, opts, p) {
                        return Ok(r);
                    }
                    if let Ok(r) = holt_winters(&filled, opts, p) {
                        return Ok(r);
                    }
                }
            }
            ets(&filled, opts).or_else(|_| holt(&filled, opts))
        }
    }
}

fn resolve_period(y: &[f64], given: Option<usize>) -> Option<usize> {
    match given {
        Some(p) if p >= 2 && y.len() >= 2 * p => Some(p),
        Some(_) => None,
        None => seasonality::detect(y, Default::default())
            .periods
            .iter()
            .map(|&p| p as usize)
            .find(|&p| p >= 2 && y.len() >= 3 * p),
    }
}

fn interval(
    point: &[f64],
    sd: f64,
    level: Option<f64>,
    growth: impl Fn(usize) -> f64,
) -> (Vec<f64>, Vec<f64>) {
    match level {
        None => (vec![f64::NAN; point.len()], vec![f64::NAN; point.len()]),
        Some(l) => {
            let z = z_for_level(l);
            let lower = point
                .iter()
                .enumerate()
                .map(|(h, p)| p - z * sd * growth(h + 1).sqrt())
                .collect();
            let upper = point
                .iter()
                .enumerate()
                .map(|(h, p)| p + z * sd * growth(h + 1).sqrt())
                .collect();
            (lower, upper)
        }
    }
}

fn residual_sd(y: &[f64], fitted: &[f64]) -> f64 {
    let r: Vec<f64> = y.iter().zip(fitted).map(|(a, b)| a - b).collect();
    let sd = stats::deviation(&r);
    if sd.is_finite() && sd > 0.0 {
        sd
    } else {
        f64::EPSILON
    }
}

fn naive(y: &[f64], opts: ForecastOptions, drift: bool) -> Result<ForecastResult> {
    let n = y.len();
    let last = y[n - 1];
    let slope = if drift && n > 1 {
        (last - y[0]) / (n as f64 - 1.0)
    } else {
        0.0
    };
    let mut fitted = vec![f64::NAN; n];
    for i in 1..n {
        fitted[i] = y[i - 1] + slope;
    }
    let sd = residual_sd(y, &fitted);
    let point: Vec<f64> = (1..=opts.horizon)
        .map(|h| last + h as f64 * slope)
        .collect();
    let nf = n as f64;
    let (lower, upper) = interval(&point, sd, opts.level, |h| {
        if drift {
            h as f64 * (1.0 + h as f64 / nf)
        } else {
            h as f64
        }
    });
    Ok(ForecastResult {
        point,
        lower,
        upper,
        fitted,
        level: opts.level,
        method: if drift { "drift" } else { "naive" },
        period: None,
    })
}

/// One pass of Holt's linear method; returns (fitted, final level, final trend, sse).
fn holt_pass(y: &[f64], alpha: f64, beta: f64) -> (Vec<f64>, f64, f64, f64) {
    let n = y.len();
    let mut l = y[0];
    let mut b = if n > 1 { y[1] - y[0] } else { 0.0 };
    let mut fitted = vec![f64::NAN; n];
    let mut sse = 0.0;
    for i in 1..n {
        let f = l + b;
        fitted[i] = f;
        let e = y[i] - f;
        sse += e * e;
        let l_new = alpha * y[i] + (1.0 - alpha) * (l + b);
        b = beta * (l_new - l) + (1.0 - beta) * b;
        l = l_new;
    }
    (fitted, l, b, sse)
}

fn holt(y: &[f64], opts: ForecastOptions) -> Result<ForecastResult> {
    let n = y.len();
    if n < 3 {
        return naive(y, opts, false);
    }
    let grid = [0.05, 0.15, 0.3, 0.5, 0.7, 0.9];
    let mut best = (f64::INFINITY, 0.3, 0.1);
    for &a in &grid {
        for &b in &grid {
            if b > a {
                continue;
            }
            let (_, _, _, sse) = holt_pass(y, a, b);
            if sse < best.0 {
                best = (sse, a, b);
            }
        }
    }
    let (alpha, beta) = (best.1, best.2);
    let (fitted, l, b, _) = holt_pass(y, alpha, beta);
    let sd = residual_sd(y, &fitted);
    let point: Vec<f64> = (1..=opts.horizon).map(|h| l + h as f64 * b).collect();
    let (lower, upper) = interval(&point, sd, opts.level, |h| {
        1.0 + (1..h)
            .map(|j| (alpha + beta * j as f64).powi(2))
            .sum::<f64>()
    });
    Ok(ForecastResult {
        point,
        lower,
        upper,
        fitted,
        level: opts.level,
        method: "holt",
        period: None,
    })
}

fn hw_pass(
    y: &[f64],
    m: usize,
    alpha: f64,
    beta: f64,
    gamma: f64,
    s0: &[f64],
) -> (Vec<f64>, f64, f64, Vec<f64>, f64) {
    let n = y.len();
    let mut s: Vec<f64> = s0.to_vec();
    let mut l = stats::mean(&y[..m]);
    let mut b = (stats::mean(&y[m..(2 * m).min(n)]) - l) / m as f64;
    let mut fitted = vec![f64::NAN; n];
    let mut sse = 0.0;
    for i in 0..n {
        let si = s[i % m];
        let f = l + b + si;
        if i >= m {
            fitted[i] = f;
            let e = y[i] - f;
            sse += e * e;
        }
        let l_new = alpha * (y[i] - si) + (1.0 - alpha) * (l + b);
        b = beta * (l_new - l) + (1.0 - beta) * b;
        s[i % m] = gamma * (y[i] - l_new) + (1.0 - gamma) * si;
        l = l_new;
    }
    (fitted, l, b, s, sse)
}

fn holt_winters(y: &[f64], opts: ForecastOptions, m: usize) -> Result<ForecastResult> {
    let n = y.len();
    if n < 2 * m || m < 2 {
        return Err(Error::NotEnoughData {
            needed: 2 * m,
            got: n,
        });
    }
    let d = decompose::decompose(y, m)?;
    let s0: Vec<f64> = d.seasonal[..m].to_vec();
    let grid_a = [0.1, 0.3, 0.5, 0.7];
    let grid_b = [0.01, 0.05, 0.2];
    let grid_g = [0.05, 0.2, 0.5];
    let mut best = (f64::INFINITY, 0.3, 0.05, 0.2);
    for &a in &grid_a {
        for &b in &grid_b {
            for &g in &grid_g {
                let (_, _, _, _, sse) = hw_pass(y, m, a, b, g, &s0);
                if sse < best.0 {
                    best = (sse, a, b, g);
                }
            }
        }
    }
    let (_, alpha, beta, gamma) = best;
    let (fitted, l, b, s, _) = hw_pass(y, m, alpha, beta, gamma, &s0);
    let sd = residual_sd(y, &fitted);
    let point: Vec<f64> = (1..=opts.horizon)
        .map(|h| l + h as f64 * b + s[(n + h - 1) % m])
        .collect();
    let (lower, upper) = interval(&point, sd, opts.level, |h| {
        1.0 + (1..h)
            .map(|j| (alpha + beta * j as f64 + if j % m == 0 { gamma } else { 0.0 }).powi(2))
            .sum::<f64>()
    });
    Ok(ForecastResult {
        point,
        lower,
        upper,
        fitted,
        level: opts.level,
        method: "holt-winters",
        period: Some(m),
    })
}

fn from_augurs(
    y: &[f64],
    f: augurs::Forecast,
    fitted: Option<augurs::Forecast>,
    opts: ForecastOptions,
    method: &'static str,
    period: Option<usize>,
) -> ForecastResult {
    let n = y.len();
    let (lower, upper) = match f.intervals {
        Some(iv) => (iv.lower, iv.upper),
        None => (vec![f64::NAN; f.point.len()], vec![f64::NAN; f.point.len()]),
    };
    let mut fit = vec![f64::NAN; n];
    if let Some(fs) = fitted {
        for (i, v) in fs.point.into_iter().enumerate().take(n) {
            fit[i] = v;
        }
    }
    ForecastResult {
        point: f.point,
        lower,
        upper,
        fitted: fit,
        level: opts.level,
        method,
        period,
    }
}

fn ets(y: &[f64], opts: ForecastOptions) -> Result<ForecastResult> {
    if y.len() < 10 {
        return Err(Error::NotEnoughData {
            needed: 10,
            got: y.len(),
        });
    }
    let mut fc = Forecaster::new(AutoETS::non_seasonal())
        .with_transformers(vec![LinearInterpolator::new().boxed()]);
    fc.fit(y).map_err(|e| Error::Model(e.to_string()))?;
    let f = fc
        .predict(opts.horizon, opts.level)
        .map_err(|e| Error::Model(e.to_string()))?;
    let fitted = fc.predict_in_sample(None).ok();
    Ok(from_augurs(y, f, fitted, opts, "ets", None))
}

fn mstl(y: &[f64], opts: ForecastOptions, period: usize) -> Result<ForecastResult> {
    if y.len() < 2 * period + 1 {
        return Err(Error::NotEnoughData {
            needed: 2 * period + 1,
            got: y.len(),
        });
    }
    let model = MSTLModel::new(vec![period], AutoETS::non_seasonal().into_trend_model());
    let mut fc = Forecaster::new(model).with_transformers(vec![LinearInterpolator::new().boxed()]);
    fc.fit(y).map_err(|e| Error::Model(e.to_string()))?;
    let f = fc
        .predict(opts.horizon, opts.level)
        .map_err(|e| Error::Model(e.to_string()))?;
    let fitted = fc.predict_in_sample(None).ok();
    Ok(from_augurs(y, f, fitted, opts, "mstl", Some(period)))
}

#[cfg(test)]
mod tests {
    use super::*;

    use rand::{rngs::StdRng, Rng, SeedableRng};

    fn trend_series(n: usize) -> Vec<f64> {
        let mut rng = StdRng::seed_from_u64(7);
        (0..n)
            .map(|i| 10.0 + 0.5 * i as f64 + rng.gen_range(-0.2..0.2))
            .collect()
    }

    fn seasonal_series(n: usize) -> Vec<f64> {
        let pat = [5.0, 0.0, -5.0, 0.0, 3.0, -3.0, 0.0];
        (0..n).map(|i| 50.0 + 0.2 * i as f64 + pat[i % 7]).collect()
    }

    #[test]
    fn simple_methods_extrapolate_trend() {
        let y = trend_series(40);
        for m in [ForecastMethod::Drift, ForecastMethod::Holt] {
            let r = forecast(
                &y,
                ForecastOptions {
                    method: m,
                    horizon: 5,
                    ..Default::default()
                },
            )
            .unwrap();
            assert_eq!(r.point.len(), 5);
            let expected = 10.0 + 0.5 * 44.0;
            assert!(
                (r.point[4] - expected).abs() < 1.5,
                "{m:?}: {} vs {expected}",
                r.point[4]
            );
            assert!(r.lower[4] < r.point[4] && r.point[4] < r.upper[4]);
            assert!(
                r.upper[4] - r.lower[4] >= r.upper[0] - r.lower[0],
                "intervals widen"
            );
        }
        let n = forecast(
            &y,
            ForecastOptions {
                method: ForecastMethod::Naive,
                horizon: 2,
                level: None,
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(n.point, vec![y[39], y[39]]);
        assert!(n.lower[0].is_nan());
    }

    #[test]
    fn holt_winters_keeps_season() {
        let y = seasonal_series(70);
        let r = forecast(
            &y,
            ForecastOptions {
                method: ForecastMethod::HoltWinters,
                horizon: 7,
                period: Some(7),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(r.period, Some(7));
        // Next cycle should keep the within-week shape: index 70 → phase 0 (+5), 72 → phase 2 (-5).
        assert!(r.point[0] - r.point[2] > 6.0, "{:?}", r.point);
    }

    #[test]
    fn augurs_models_run() {
        let y = seasonal_series(84);
        let r = forecast(
            &y,
            ForecastOptions {
                method: ForecastMethod::Mstl,
                horizon: 14,
                period: Some(7),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(r.method, "mstl");
        assert_eq!(r.point.len(), 14);
        assert!(r.point.iter().all(|v| v.is_finite()));
        assert!(r.fitted[20].is_finite());
        let e = forecast(
            &trend_series(50),
            ForecastOptions {
                method: ForecastMethod::Ets,
                horizon: 3,
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(e.method, "ets");
        assert!(e.point[2] > 30.0);
    }

    #[test]
    fn auto_picks_sensibly() {
        let short = forecast(&trend_series(5), ForecastOptions::default()).unwrap();
        assert_eq!(short.method, "drift");
        let seasonal = forecast(&seasonal_series(84), ForecastOptions::default()).unwrap();
        assert!(seasonal.period == Some(7), "{:?}", seasonal.method);
        let plain = forecast(&trend_series(40), ForecastOptions::default()).unwrap();
        assert!(plain.method == "ets" || plain.method == "holt");
    }

    #[test]
    fn validates_args() {
        assert!(forecast(
            &[1.0, 2.0, 3.0],
            ForecastOptions {
                horizon: 0,
                ..Default::default()
            }
        )
        .is_err());
        assert!(forecast(
            &[1.0, 2.0, 3.0],
            ForecastOptions {
                level: Some(1.5),
                ..Default::default()
            }
        )
        .is_err());
        assert!(forecast(&[1.0], ForecastOptions::default()).is_err());
    }
}
