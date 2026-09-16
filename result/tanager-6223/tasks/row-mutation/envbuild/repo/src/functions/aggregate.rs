//! The aggregate function registry and per-group accumulators.

use std::collections::HashSet;

use crate::error::{Error, Result};
use crate::types::{DataType, GroupKey, Value};

/// A built-in aggregate function.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum AggregateFn {
    Count,
    Sum,
    Avg,
    Min,
    Max,
    /// Concatenate text values with a comma separator, in input order.
    GroupConcat,
    /// Population variance.
    VarPop,
    /// Population standard deviation.
    StddevPop,
}

impl AggregateFn {
    pub fn from_name(name: &str) -> Option<AggregateFn> {
        let f = match name.to_ascii_uppercase().as_str() {
            "COUNT" => AggregateFn::Count,
            "SUM" => AggregateFn::Sum,
            "AVG" => AggregateFn::Avg,
            "MIN" => AggregateFn::Min,
            "MAX" => AggregateFn::Max,
            "GROUP_CONCAT" | "STRING_AGG" => AggregateFn::GroupConcat,
            "VAR_POP" | "VARIANCE" => AggregateFn::VarPop,
            "STDDEV_POP" | "STDDEV" => AggregateFn::StddevPop,
            _ => return None,
        };
        Some(f)
    }

    pub fn name(self) -> &'static str {
        match self {
            AggregateFn::Count => "COUNT",
            AggregateFn::Sum => "SUM",
            AggregateFn::Avg => "AVG",
            AggregateFn::Min => "MIN",
            AggregateFn::Max => "MAX",
            AggregateFn::GroupConcat => "GROUP_CONCAT",
            AggregateFn::VarPop => "VAR_POP",
            AggregateFn::StddevPop => "STDDEV_POP",
        }
    }

    /// The result type given the argument type (`None` for `COUNT(*)`).
    pub fn return_type(self, arg: Option<DataType>) -> Result<DataType> {
        match self {
            AggregateFn::Count => Ok(DataType::Integer),
            AggregateFn::Sum => match arg {
                Some(DataType::Integer) | Some(DataType::Null) => Ok(DataType::Integer),
                Some(DataType::Float) => Ok(DataType::Float),
                Some(other) => Err(Error::binder(format!(
                    "SUM expects a numeric argument, got {}",
                    other
                ))),
                None => Err(Error::binder("SUM requires an argument")),
            },
            AggregateFn::Avg => match arg {
                Some(dt) if dt.is_numeric() || dt == DataType::Null => Ok(DataType::Float),
                Some(other) => Err(Error::binder(format!(
                    "AVG expects a numeric argument, got {}",
                    other
                ))),
                None => Err(Error::binder("AVG requires an argument")),
            },
            AggregateFn::Min | AggregateFn::Max => match arg {
                Some(dt) => Ok(dt),
                None => Err(Error::binder(format!(
                    "{} requires an argument",
                    self.name()
                ))),
            },
            AggregateFn::GroupConcat => match arg {
                Some(_) => Ok(DataType::Text),
                None => Err(Error::binder("GROUP_CONCAT requires an argument")),
            },
            AggregateFn::VarPop | AggregateFn::StddevPop => match arg {
                Some(dt) if dt.is_numeric() || dt == DataType::Null => Ok(DataType::Float),
                Some(other) => Err(Error::binder(format!(
                    "{} expects a numeric argument, got {}",
                    self.name(),
                    other
                ))),
                None => Err(Error::binder(format!(
                    "{} requires an argument",
                    self.name()
                ))),
            },
        }
    }

    /// Whether this aggregate accepts the special `COUNT(*)` star form.
    pub fn allows_star(self) -> bool {
        matches!(self, AggregateFn::Count)
    }

    /// Create a fresh accumulator for this function.
    pub fn accumulator(self, distinct: bool) -> Accumulator {
        Accumulator {
            func: self,
            distinct,
            seen: HashSet::new(),
            count: 0,
            sum: None,
            sum_n: 0,
            extreme: None,
            parts: Vec::new(),
            f_sum: 0.0,
            f_sum_sq: 0.0,
        }
    }
}

/// A running aggregate state for one group.
#[derive(Debug, Clone)]
pub struct Accumulator {
    func: AggregateFn,
    distinct: bool,
    seen: HashSet<GroupKey>,
    count: i64,
    sum: Option<Value>,
    sum_n: i64,
    extreme: Option<Value>,
    parts: Vec<String>,
    f_sum: f64,
    f_sum_sq: f64,
}

impl Accumulator {
    /// Feed one argument value into the accumulator (for non-star aggregates).
    ///
    /// `NULL` values are ignored by every aggregate (SQL semantics). With
    /// `DISTINCT`, repeat values — including repeated `NULL`s — are collapsed
    /// before they reach the aggregate logic.
    pub fn update(&mut self, value: &Value) -> Result<()> {
        if self.distinct && !self.seen.insert(value.group_key()) {
            return Ok(());
        }
        if value.is_null() {
            return Ok(());
        }
        match self.func {
            AggregateFn::Count => self.count += 1,
            AggregateFn::Sum | AggregateFn::Avg => {
                self.sum = Some(match &self.sum {
                    None => value.clone(),
                    Some(acc) => acc.add(value)?,
                });
                self.sum_n += 1;
            }
            AggregateFn::Min => self.update_extreme(value, true)?,
            AggregateFn::Max => self.update_extreme(value, false)?,
            AggregateFn::GroupConcat => self.parts.push(value.to_string()),
            AggregateFn::VarPop | AggregateFn::StddevPop => {
                let x = value.as_f64()?;
                self.count += 1;
                self.f_sum += x;
                self.f_sum_sq += x * x;
            }
        }
        Ok(())
    }

    /// Count one row for the `COUNT(*)` form (counts regardless of nullness).
    pub fn update_count_star(&mut self) {
        self.count += 1;
    }

    fn update_extreme(&mut self, value: &Value, keep_min: bool) -> Result<()> {
        match &self.extreme {
            None => self.extreme = Some(value.clone()),
            Some(cur) => {
                if let Some(ord) = value.compare(cur)? {
                    let replace = if keep_min {
                        ord == std::cmp::Ordering::Less
                    } else {
                        ord == std::cmp::Ordering::Greater
                    };
                    if replace {
                        self.extreme = Some(value.clone());
                    }
                }
            }
        }
        Ok(())
    }

    /// Produce the final aggregate value for the group.
    pub fn finish(self) -> Result<Value> {
        match self.func {
            AggregateFn::Count => Ok(Value::Integer(self.count)),
            AggregateFn::Sum => Ok(self.sum.unwrap_or(Value::Null)),
            AggregateFn::Avg => {
                if self.sum_n == 0 {
                    Ok(Value::Null)
                } else {
                    let total = self.sum.as_ref().unwrap().as_f64()?;
                    Ok(Value::Float(total / self.sum_n as f64))
                }
            }
            AggregateFn::Min | AggregateFn::Max => Ok(self.extreme.unwrap_or(Value::Null)),
            AggregateFn::GroupConcat => {
                if self.parts.is_empty() {
                    Ok(Value::Null)
                } else {
                    Ok(Value::text(self.parts.join(",")))
                }
            }
            AggregateFn::VarPop | AggregateFn::StddevPop => {
                if self.count == 0 {
                    return Ok(Value::Null);
                }
                let n = self.count as f64;
                let mean = self.f_sum / n;
                // Population variance; clamp tiny negatives from float error.
                let variance = (self.f_sum_sq / n - mean * mean).max(0.0);
                Ok(Value::Float(
                    if matches!(self.func, AggregateFn::StddevPop) {
                        variance.sqrt()
                    } else {
                        variance
                    },
                ))
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn feed(func: AggregateFn, distinct: bool, values: &[Value]) -> Value {
        let mut acc = func.accumulator(distinct);
        for v in values {
            acc.update(v).unwrap();
        }
        acc.finish().unwrap()
    }

    #[test]
    fn sum_of_integers_stays_integer() {
        assert_eq!(
            feed(
                AggregateFn::Sum,
                false,
                &[Value::Integer(1), Value::Integer(2), Value::Null]
            ),
            Value::Integer(3)
        );
    }

    #[test]
    fn avg_is_float() {
        assert_eq!(
            feed(
                AggregateFn::Avg,
                false,
                &[Value::Integer(1), Value::Integer(2)]
            ),
            Value::Float(1.5)
        );
    }

    #[test]
    fn avg_of_empty_is_null() {
        assert!(feed(AggregateFn::Avg, false, &[Value::Null]).is_null());
    }

    #[test]
    fn count_ignores_nulls_but_star_does_not() {
        assert_eq!(
            feed(
                AggregateFn::Count,
                false,
                &[Value::Integer(1), Value::Null, Value::Integer(2)]
            ),
            Value::Integer(2)
        );
        let mut acc = AggregateFn::Count.accumulator(false);
        acc.update_count_star();
        acc.update_count_star();
        assert_eq!(acc.finish().unwrap(), Value::Integer(2));
    }

    #[test]
    fn distinct_collapses_repeats() {
        assert_eq!(
            feed(
                AggregateFn::Count,
                true,
                &[Value::Integer(1), Value::Integer(1), Value::Integer(2)]
            ),
            Value::Integer(2)
        );
    }

    #[test]
    fn min_and_max_ignore_nulls() {
        assert_eq!(
            feed(
                AggregateFn::Min,
                false,
                &[Value::Integer(3), Value::Null, Value::Integer(1)]
            ),
            Value::Integer(1)
        );
        assert_eq!(
            feed(
                AggregateFn::Max,
                false,
                &[Value::Integer(3), Value::Integer(9), Value::Integer(1)]
            ),
            Value::Integer(9)
        );
    }
}
