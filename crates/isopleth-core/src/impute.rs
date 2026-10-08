//! Missing-value imputation. The JS side decides *where* gaps are (via the
//! `interval` transform); these kernels decide *what* goes in them.

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Impute {
    /// Linear interpolation between neighbouring finite values; leading/trailing
    /// gaps are filled with the nearest finite value.
    Linear,
    /// Carry the previous finite value forward.
    Previous,
    /// Carry the next finite value backward.
    Next,
    /// Replace with a constant.
    Constant(f64),
}

impl Impute {
    pub fn parse(name: &str) -> Option<Impute> {
        match name {
            "linear" | "interpolate" => Some(Impute::Linear),
            "previous" | "ffill" => Some(Impute::Previous),
            "next" | "bfill" => Some(Impute::Next),
            "zero" => Some(Impute::Constant(0.0)),
            _ => name.parse::<f64>().ok().map(Impute::Constant),
        }
    }
}

pub fn impute(values: &[f64], method: Impute) -> Vec<f64> {
    let n = values.len();
    let mut out = values.to_vec();
    match method {
        Impute::Constant(c) => {
            for v in out.iter_mut() {
                if !v.is_finite() {
                    *v = c;
                }
            }
        }
        Impute::Previous => {
            let mut last = f64::NAN;
            for v in out.iter_mut() {
                if v.is_finite() {
                    last = *v;
                } else {
                    *v = last;
                }
            }
        }
        Impute::Next => {
            let mut next = f64::NAN;
            for v in out.iter_mut().rev() {
                if v.is_finite() {
                    next = *v;
                } else {
                    *v = next;
                }
            }
        }
        Impute::Linear => {
            let mut i = 0;
            while i < n {
                if out[i].is_finite() {
                    i += 1;
                    continue;
                }
                let start = i;
                while i < n && !out[i].is_finite() {
                    i += 1;
                }
                let end = i; // exclusive
                let left = if start > 0 {
                    Some(out[start - 1])
                } else {
                    None
                };
                let right = if end < n { Some(out[end]) } else { None };
                for (j, slot) in out.iter_mut().enumerate().take(end).skip(start) {
                    *slot = match (left, right) {
                        (Some(l), Some(r)) => {
                            let t = (j - start + 1) as f64 / (end - start + 1) as f64;
                            l + (r - l) * t
                        }
                        (Some(l), None) => l,
                        (None, Some(r)) => r,
                        (None, None) => f64::NAN,
                    };
                }
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    const N: f64 = f64::NAN;

    #[test]
    fn linear_interpolates_interior_and_extends_edges() {
        assert_eq!(
            impute(&[N, 1.0, N, N, 4.0, N], Impute::Linear),
            vec![1.0, 1.0, 2.0, 3.0, 4.0, 4.0]
        );
        assert!(impute(&[N, N], Impute::Linear).iter().all(|v| v.is_nan()));
    }

    #[test]
    fn fills() {
        assert_eq!(impute(&[N, 1.0, N, 2.0], Impute::Previous)[2], 1.0);
        assert_eq!(impute(&[N, 1.0, N, 2.0], Impute::Next)[0], 1.0);
        assert_eq!(impute(&[N, 1.0], Impute::Constant(0.0)), vec![0.0, 1.0]);
        assert_eq!(Impute::parse("zero"), Some(Impute::Constant(0.0)));
        assert_eq!(Impute::parse("-1.5"), Some(Impute::Constant(-1.5)));
    }
}
