//! wasm-bindgen surface over `isopleth-core`. Every export takes typed arrays
//! (`Float64Array` / `Int32Array`) and returns either a typed array or a plain
//! camelCase object (via `serde-wasm-bindgen`), matching the `Backend`
//! interface in `packages/isopleth/src/backend/types.ts`.
//!
//! Options arrive as JS objects and are deserialised into the small `*Opts`
//! structs below; unknown fields are ignored so the JS side can pass its full
//! insight config through unchanged.

use isopleth_core as core;
use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;

fn js_err(e: impl std::fmt::Display) -> JsError {
    JsError::new(&e.to_string())
}

fn to_js<T: Serialize>(v: &T) -> Result<JsValue, JsError> {
    let ser = serde_wasm_bindgen::Serializer::json_compatible();
    v.serialize(&ser).map_err(|e| JsError::new(&e.to_string()))
}

fn from_js<T: for<'de> Deserialize<'de> + Default>(v: JsValue) -> Result<T, JsError> {
    if v.is_undefined() || v.is_null() {
        return Ok(T::default());
    }
    serde_wasm_bindgen::from_value(v).map_err(|e| JsError::new(&e.to_string()))
}

#[wasm_bindgen(start)]
pub fn start() {
    #[cfg(feature = "console_error_panic_hook")]
    console_error_panic_hook::set_once();
}

#[wasm_bindgen]
pub fn version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

// ---------------------------------------------------------------- binning ---

/// Bin edges for `values`. `rule` is one of `auto`, `sturges`, `scott`,
/// `freedman-diaconis`, or `count` (then `count` is the tick-count hint).
#[wasm_bindgen(js_name = binThresholds)]
pub fn bin_thresholds(values: &[f64], rule: &str, count: u32) -> Result<Vec<f64>, JsError> {
    let rule = match rule {
        "auto" => core::bin::ThresholdRule::Auto,
        "sturges" => core::bin::ThresholdRule::Sturges,
        "scott" => core::bin::ThresholdRule::Scott,
        "freedman-diaconis" | "fd" => core::bin::ThresholdRule::FreedmanDiaconis,
        "count" => core::bin::ThresholdRule::Count(count.max(1) as usize),
        other => return Err(JsError::new(&format!("unknown threshold rule: {other}"))),
    };
    Ok(core::bin::thresholds(values, rule).edges)
}

/// Bin edges at every multiple of `step` spanning the data.
#[wasm_bindgen(js_name = binThresholdsInterval)]
pub fn bin_thresholds_interval(values: &[f64], step: f64) -> Vec<f64> {
    core::bin::thresholds_interval(values, step).edges
}

/// Bin index per value (`-1` = NaN / out of domain).
#[wasm_bindgen(js_name = binAssign)]
pub fn bin_assign(values: &[f64], edges: &[f64]) -> Vec<i32> {
    core::bin::assign(
        values,
        &core::bin::Edges {
            edges: edges.to_vec(),
        },
    )
}

/// `d3.ticks` port, exposed so axes and bins agree.
#[wasm_bindgen]
pub fn ticks(start: f64, stop: f64, count: f64) -> Vec<f64> {
    core::bin::ticks(start, stop, count)
}

// --------------------------------------------------------------- grouping ---

/// Aggregate `values` by integer `codes` (`< 0` excluded) into `nGroups`
/// buckets with a Plot-style reducer name (`count`, `sum`, `mean`, `p90`, ...).
/// Pass an empty `values` array to reduce over a constant 1 (counts).
#[wasm_bindgen]
pub fn aggregate(
    codes: &[i32],
    values: &[f64],
    n_groups: u32,
    reducer: &str,
) -> Result<Vec<f64>, JsError> {
    let r = core::group::Reducer::parse(reducer)
        .ok_or_else(|| JsError::new(&format!("unknown reducer: {reducer}")))?;
    Ok(core::group::aggregate(codes, values, n_groups as usize, r))
}

#[wasm_bindgen]
pub fn counts(codes: &[i32], n_groups: u32) -> Vec<f64> {
    core::group::counts(codes, n_groups as usize)
}

#[wasm_bindgen(js_name = combineCodes)]
pub fn combine_codes(a: &[i32], na: u32, b: &[i32], nb: u32) -> Vec<i32> {
    core::group::combine_codes(a, na as usize, b, nb as usize).0
}

// ---------------------------------------------------------------- windows ---

/// Rolling window. `anchor` ∈ `start|middle|end`; `reduce` is a reducer name or
/// `difference` / `ratio`.
#[wasm_bindgen]
pub fn window(
    values: &[f64],
    k: u32,
    anchor: &str,
    reduce: &str,
    strict: bool,
) -> Result<Vec<f64>, JsError> {
    let anchor = core::window::Anchor::parse(anchor)
        .ok_or_else(|| JsError::new(&format!("unknown anchor: {anchor}")))?;
    let reduce = core::window::WindowReducer::parse(reduce)
        .ok_or_else(|| JsError::new(&format!("unknown reducer: {reduce}")))?;
    core::window::window(
        values,
        core::window::WindowOptions {
            k: k as usize,
            anchor,
            reduce,
            strict,
        },
    )
    .map_err(js_err)
}

// ------------------------------------------------------------------- maps ---

#[wasm_bindgen]
pub fn cumsum(values: &[f64]) -> Vec<f64> {
    core::map::cumsum(values)
}

#[wasm_bindgen]
pub fn rank(values: &[f64]) -> Vec<f64> {
    core::map::rank(values)
}

#[wasm_bindgen(js_name = quantileRank)]
pub fn quantile_rank(values: &[f64]) -> Vec<f64> {
    core::map::quantile_rank(values)
}

#[wasm_bindgen]
pub fn normalize(values: &[f64], basis: &str) -> Result<Vec<f64>, JsError> {
    let b = core::map::Basis::parse(basis)
        .ok_or_else(|| JsError::new(&format!("unknown basis: {basis}")))?;
    Ok(core::map::normalize(values, b))
}

#[wasm_bindgen]
pub fn diff(values: &[f64]) -> Vec<f64> {
    core::map::diff(values)
}

#[wasm_bindgen(js_name = pctChange)]
pub fn pct_change(values: &[f64]) -> Vec<f64> {
    core::map::pct_change(values)
}

#[wasm_bindgen]
pub fn impute(values: &[f64], method: &str) -> Result<Vec<f64>, JsError> {
    let m = core::impute::Impute::parse(method)
        .ok_or_else(|| JsError::new(&format!("unknown impute method: {method}")))?;
    Ok(core::impute::impute(values, m))
}

// --------------------------------------------------------------- insights ---

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct AnomalyOpts {
    method: Option<String>,
    threshold: Option<f64>,
    sensitivity: Option<f64>,
    window: Option<usize>,
    period: Option<usize>,
    lambda: Option<f64>,
}

#[wasm_bindgen]
pub fn anomalies(y: &[f64], opts: JsValue) -> Result<JsValue, JsError> {
    let o: AnomalyOpts = from_js(opts)?;
    let method = match o.method.as_deref() {
        None => core::AnomalyMethod::Mad,
        Some(m) => core::AnomalyMethod::parse(m)
            .ok_or_else(|| JsError::new(&format!("unknown anomaly method: {m}")))?,
    };
    let r = core::anomaly::detect(
        y,
        core::AnomalyOptions {
            method,
            threshold: o.threshold,
            sensitivity: o.sensitivity,
            window: o.window,
            period: o.period,
            lambda: o.lambda.unwrap_or(0.3),
        },
    )
    .map_err(js_err)?;
    to_js(&r)
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct ForecastOpts {
    method: Option<String>,
    horizon: Option<usize>,
    level: Option<f64>,
    period: Option<usize>,
}

#[wasm_bindgen]
pub fn forecast(y: &[f64], opts: JsValue) -> Result<JsValue, JsError> {
    let o: ForecastOpts = from_js(opts)?;
    let method = match o.method.as_deref() {
        None => core::ForecastMethod::Auto,
        Some(m) => core::ForecastMethod::parse(m)
            .ok_or_else(|| JsError::new(&format!("unknown forecast method: {m}")))?,
    };
    let r = core::forecast::forecast(
        y,
        core::ForecastOptions {
            method,
            horizon: o.horizon.unwrap_or(10),
            level: Some(o.level.unwrap_or(0.95)).filter(|l| *l > 0.0),
            period: o.period,
        },
    )
    .map_err(js_err)?;
    to_js(&r)
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct ChangepointOpts {
    method: Option<String>,
    min_segment: Option<usize>,
    max_changepoints: Option<usize>,
    penalty: Option<f64>,
}

#[wasm_bindgen]
pub fn changepoints(y: &[f64], opts: JsValue) -> Result<JsValue, JsError> {
    let o: ChangepointOpts = from_js(opts)?;
    let d = core::ChangepointOptions::default();
    let method = match o.method.as_deref() {
        None => d.method,
        Some(m) => core::ChangepointMethod::parse(m)
            .ok_or_else(|| JsError::new(&format!("unknown changepoint method: {m}")))?,
    };
    let r = core::changepoint::detect(
        y,
        core::ChangepointOptions {
            method,
            min_segment: o.min_segment.unwrap_or(d.min_segment),
            max_changepoints: o.max_changepoints.unwrap_or(d.max_changepoints),
            penalty: o.penalty.unwrap_or(d.penalty),
        },
    )
    .map_err(js_err)?;
    to_js(&r)
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct SeasonalityOpts {
    method: Option<String>,
    min_period: Option<usize>,
    max_period: Option<usize>,
    threshold: Option<f64>,
    min_strength: Option<f64>,
}

#[wasm_bindgen]
pub fn seasonality(y: &[f64], opts: JsValue) -> Result<JsValue, JsError> {
    let o: SeasonalityOpts = from_js(opts)?;
    let d = core::SeasonalityOptions::default();
    let method = match o.method.as_deref() {
        None => core::seasonality::SeasonalityMethod::Auto,
        Some(m) => core::seasonality::SeasonalityMethod::parse(m)
            .ok_or_else(|| JsError::new(&format!("unknown seasonality method: {m}")))?,
    };
    let r = core::seasonality::detect(
        y,
        core::SeasonalityOptions {
            method,
            min_period: o.min_period.unwrap_or(d.min_period),
            max_period: o.max_period,
            threshold: o.threshold,
            min_strength: o.min_strength,
        },
    );
    to_js(&r)
}

#[wasm_bindgen]
pub fn trend(x: &[f64], y: &[f64], method: &str) -> Result<JsValue, JsError> {
    let m = core::TrendMethod::parse(method)
        .ok_or_else(|| JsError::new(&format!("unknown trend method: {method}")))?;
    to_js(&core::trend::trend(x, y, m).map_err(js_err)?)
}

#[wasm_bindgen]
pub fn decompose(y: &[f64], period: u32) -> Result<JsValue, JsError> {
    to_js(&core::insights::decompose::decompose(y, period as usize).map_err(js_err)?)
}

#[wasm_bindgen(js_name = frequencyOutliers)]
pub fn frequency_outliers(
    counts: &[f64],
    sensitivity: Option<f64>,
    threshold: Option<f64>,
) -> Result<JsValue, JsError> {
    to_js(&core::outliers::frequency_outliers(
        counts,
        sensitivity,
        threshold,
    ))
}

#[wasm_bindgen(js_name = categoryOutliers)]
pub fn category_outliers(
    codes: &[i32],
    values: &[f64],
    n_groups: u32,
    reducer: Option<String>,
    sensitivity: Option<f64>,
    threshold: Option<f64>,
) -> Result<JsValue, JsError> {
    let r = match reducer.as_deref() {
        None | Some("") => None,
        Some(name) => Some(
            core::group::Reducer::parse(name)
                .ok_or_else(|| JsError::new(&format!("unknown reducer: {name}")))?,
        ),
    };
    to_js(
        &core::outliers::category_outliers(
            codes,
            values,
            n_groups as usize,
            r,
            sensitivity,
            threshold,
        )
        .map_err(js_err)?,
    )
}

/// `series` is a flat row-major `Float64Array` of `nSeries × len` values.
#[wasm_bindgen(js_name = seriesOutliers)]
pub fn series_outliers(
    series: &[f64],
    n_series: u32,
    method: &str,
    sensitivity: Option<f64>,
) -> Result<JsValue, JsError> {
    let n = n_series as usize;
    if n == 0 || !series.len().is_multiple_of(n) {
        return Err(JsError::new("series length must be a multiple of nSeries"));
    }
    let len = series.len() / n;
    let rows: Vec<Vec<f64>> = (0..n)
        .map(|i| series[i * len..(i + 1) * len].to_vec())
        .collect();
    let m = core::outliers::SeriesOutlierMethod::parse(method)
        .ok_or_else(|| JsError::new(&format!("unknown series outlier method: {method}")))?;
    to_js(&core::outliers::series_outliers(&rows, m, sensitivity).map_err(js_err)?)
}
