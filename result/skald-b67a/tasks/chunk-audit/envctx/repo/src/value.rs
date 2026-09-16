//! Tagged runtime value — a faithful analogue of the C `Value` union.
//!
//! Object values carry a raw pointer to a heap-allocated [`SkObject`]. Copying
//! a `Value` copies the pointer only; ownership is tracked separately by the
//! reference-counting routines in [`crate::heap`].

use crate::heap::SkObject;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ValueType {
    Null,
    Int,
    Float,
    Object,
}

/// A dynamically typed value. `Obj` holds a borrowed raw pointer whose lifetime
/// is governed by the object's reference count.
#[derive(Clone, Copy)]
pub enum Value {
    Null,
    Int(i64),
    Float(f64),
    Obj(*mut SkObject),
}

impl Value {
    #[inline]
    pub fn type_of(&self) -> ValueType {
        match self {
            Value::Null => ValueType::Null,
            Value::Int(_) => ValueType::Int,
            Value::Float(_) => ValueType::Float,
            Value::Obj(_) => ValueType::Object,
        }
    }

    #[inline]
    pub fn is_null(&self) -> bool {
        matches!(self, Value::Null)
    }
    #[inline]
    pub fn is_int(&self) -> bool {
        matches!(self, Value::Int(_))
    }
    #[inline]
    pub fn is_float(&self) -> bool {
        matches!(self, Value::Float(_))
    }
    #[inline]
    pub fn is_obj(&self) -> bool {
        matches!(self, Value::Obj(_))
    }

    #[inline]
    pub fn as_int(&self) -> Option<i64> {
        match self {
            Value::Int(i) => Some(*i),
            _ => None,
        }
    }
    #[inline]
    pub fn as_float(&self) -> Option<f64> {
        match self {
            Value::Float(f) => Some(*f),
            Value::Int(i) => Some(*i as f64),
            _ => None,
        }
    }
    #[inline]
    pub fn as_obj(&self) -> Option<*mut SkObject> {
        match self {
            Value::Obj(o) => Some(*o),
            _ => None,
        }
    }

    #[inline]
    pub fn is_truthy(&self) -> bool {
        match self {
            Value::Null => false,
            Value::Int(i) => *i != 0,
            Value::Float(f) => *f != 0.0,
            Value::Obj(_) => true,
        }
    }
}

impl std::fmt::Debug for Value {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Value::Null => write!(f, "null"),
            Value::Int(i) => write!(f, "{i}"),
            Value::Float(x) => write!(f, "{x}"),
            Value::Obj(p) => write!(f, "obj@{p:p}"),
        }
    }
}

impl PartialEq for Value {
    fn eq(&self, other: &Self) -> bool {
        match (self, other) {
            (Value::Null, Value::Null) => true,
            (Value::Int(a), Value::Int(b)) => a == b,
            (Value::Float(a), Value::Float(b)) => a == b,
            (Value::Int(a), Value::Float(b)) => (*a as f64) == *b,
            (Value::Float(a), Value::Int(b)) => *a == (*b as f64),
            (Value::Obj(a), Value::Obj(b)) => a == b,
            _ => false,
        }
    }
}
