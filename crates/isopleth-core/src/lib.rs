//! # isopleth-core
//!
//! Numeric kernels behind the [isopleth](https://github.com/DanielMcSheehy/isopleth)
//! chart grammar. Everything here is plain Rust over `&[f64]` slices so it can be
//! used natively, compiled to WebAssembly (see `isopleth-wasm`), or unit tested
//! without a browser.
//!
//! Conventions:
//! * `NaN` means *missing*. Every kernel tolerates it and never panics on it.
//! * Inputs are never mutated; outputs are freshly allocated `Vec`s.
//! * Category/ordinal data is passed as integer *codes* (`&[u32]`) — the JS side
//!   owns the mapping back to labels.
//! * Time is never passed in; series are assumed regularly spaced, which the JS
//!   side guarantees via the `interval`/time-binning transforms.

#![allow(clippy::neg_cmp_op_on_partial_ord)]

pub mod bin;
pub mod group;
pub mod impute;
pub mod insights;
pub mod map;
pub mod stats;
pub mod window;

pub use insights::{
    anomaly::{self, AnomalyMethod, AnomalyOptions, AnomalyResult},
    changepoint::{self, ChangepointMethod, ChangepointOptions, ChangepointResult},
    forecast::{self, ForecastMethod, ForecastOptions, ForecastResult},
    outliers::{self, CategoryOutlierResult, FrequencyOutlierResult, SeriesOutlierResult},
    seasonality::{self, SeasonalityOptions, SeasonalityResult},
    trend::{self, TrendMethod, TrendResult},
};

/// Error type shared by all kernels.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Error {
    /// Not enough non-missing observations for the requested operation.
    NotEnoughData { needed: usize, got: usize },
    /// An argument was out of range (`k == 0`, `level` outside `(0, 1)`, ...).
    InvalidArgument(String),
    /// Inputs that must have equal length did not.
    LengthMismatch { expected: usize, got: usize },
    /// A downstream model failed (wraps the error message).
    Model(String),
}

impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Error::NotEnoughData { needed, got } => {
                write!(f, "not enough data: needed {needed}, got {got}")
            }
            Error::InvalidArgument(s) => write!(f, "invalid argument: {s}"),
            Error::LengthMismatch { expected, got } => {
                write!(f, "length mismatch: expected {expected}, got {got}")
            }
            Error::Model(s) => write!(f, "model error: {s}"),
        }
    }
}

impl std::error::Error for Error {}

pub type Result<T> = std::result::Result<T, Error>;
