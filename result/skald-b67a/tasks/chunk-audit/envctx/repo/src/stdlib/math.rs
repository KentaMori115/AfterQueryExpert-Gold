//! Math standard library — a faithful port of `lib/math_lib.c`.
//!
//! Native functions taking `&[Value]` and returning a `Value`. Numeric helpers
//! coerce ints/floats; results are `Int` where integral and `Float` otherwise.

use crate::heap::{array_push, heap_new_array, SkObject, ObjArray};
use crate::value::Value;

fn argf(argv: &[Value], i: usize) -> f64 {
    argv.get(i).and_then(|v| v.as_float()).unwrap_or(0.0)
}
fn argi(argv: &[Value], i: usize) -> i64 {
    argv.get(i).and_then(|v| v.as_int()).unwrap_or(0)
}

pub fn abs(argv: &[Value]) -> Value {
    match argv.first() {
        Some(Value::Int(i)) => Value::Int(i.wrapping_abs()),
        Some(Value::Float(f)) => Value::Float(f.abs()),
        _ => Value::Null,
    }
}
pub fn ceil(argv: &[Value]) -> Value {
    Value::Float(argf(argv, 0).ceil())
}
pub fn floor(argv: &[Value]) -> Value {
    Value::Float(argf(argv, 0).floor())
}
pub fn round(argv: &[Value]) -> Value {
    Value::Float(argf(argv, 0).round())
}
pub fn trunc(argv: &[Value]) -> Value {
    Value::Float(argf(argv, 0).trunc())
}
pub fn sign(argv: &[Value]) -> Value {
    let x = argf(argv, 0);
    Value::Int(if x > 0.0 {
        1
    } else if x < 0.0 {
        -1
    } else {
        0
    })
}
pub fn min(argv: &[Value]) -> Value {
    Value::Float(argf(argv, 0).min(argf(argv, 1)))
}
pub fn max(argv: &[Value]) -> Value {
    Value::Float(argf(argv, 0).max(argf(argv, 1)))
}
pub fn clamp(argv: &[Value]) -> Value {
    let x = argf(argv, 0);
    let lo = argf(argv, 1);
    let hi = argf(argv, 2);
    Value::Float(x.max(lo).min(hi))
}
pub fn sqrt(argv: &[Value]) -> Value {
    Value::Float(argf(argv, 0).sqrt())
}
pub fn cbrt(argv: &[Value]) -> Value {
    Value::Float(argf(argv, 0).cbrt())
}
pub fn pow(argv: &[Value]) -> Value {
    Value::Float(argf(argv, 0).powf(argf(argv, 1)))
}
pub fn exp(argv: &[Value]) -> Value {
    Value::Float(argf(argv, 0).exp())
}
pub fn exp2(argv: &[Value]) -> Value {
    Value::Float(argf(argv, 0).exp2())
}
pub fn log(argv: &[Value]) -> Value {
    Value::Float(argf(argv, 0).ln())
}
pub fn log2(argv: &[Value]) -> Value {
    Value::Float(argf(argv, 0).log2())
}
pub fn log10(argv: &[Value]) -> Value {
    Value::Float(argf(argv, 0).log10())
}
pub fn log_base(argv: &[Value]) -> Value {
    Value::Float(argf(argv, 0).log(argf(argv, 1)))
}
pub fn sin(argv: &[Value]) -> Value {
    Value::Float(argf(argv, 0).sin())
}
pub fn cos(argv: &[Value]) -> Value {
    Value::Float(argf(argv, 0).cos())
}
pub fn tan(argv: &[Value]) -> Value {
    Value::Float(argf(argv, 0).tan())
}
pub fn asin(argv: &[Value]) -> Value {
    Value::Float(argf(argv, 0).asin())
}
pub fn acos(argv: &[Value]) -> Value {
    Value::Float(argf(argv, 0).acos())
}
pub fn atan(argv: &[Value]) -> Value {
    Value::Float(argf(argv, 0).atan())
}
pub fn atan2(argv: &[Value]) -> Value {
    Value::Float(argf(argv, 0).atan2(argf(argv, 1)))
}
pub fn hypot(argv: &[Value]) -> Value {
    Value::Float(argf(argv, 0).hypot(argf(argv, 1)))
}
pub fn degrees(argv: &[Value]) -> Value {
    Value::Float(argf(argv, 0).to_degrees())
}
pub fn radians(argv: &[Value]) -> Value {
    Value::Float(argf(argv, 0).to_radians())
}

pub fn gcd(argv: &[Value]) -> Value {
    let mut a = argi(argv, 0).unsigned_abs();
    let mut b = argi(argv, 1).unsigned_abs();
    while b != 0 {
        let t = b;
        b = a % b;
        a = t;
    }
    Value::Int(a as i64)
}
pub fn lcm(argv: &[Value]) -> Value {
    let a = argi(argv, 0).unsigned_abs();
    let b = argi(argv, 1).unsigned_abs();
    if a == 0 || b == 0 {
        return Value::Int(0);
    }
    let mut x = a;
    let mut y = b;
    while y != 0 {
        let t = y;
        y = x % y;
        x = t;
    }
    Value::Int((a / x * b) as i64)
}
pub fn factorial(argv: &[Value]) -> Value {
    let n = argi(argv, 0);
    if n < 0 {
        return Value::Null;
    }
    let mut r: i64 = 1;
    for k in 2..=n {
        r = r.wrapping_mul(k);
    }
    Value::Int(r)
}
pub fn is_prime(argv: &[Value]) -> Value {
    let n = argi(argv, 0);
    Value::Int(prime_check(n) as i64)
}
fn prime_check(n: i64) -> bool {
    if n < 2 {
        return false;
    }
    if n % 2 == 0 {
        return n == 2;
    }
    let mut i = 3;
    while i * i <= n {
        if n % i == 0 {
            return false;
        }
        i += 2;
    }
    true
}
pub fn next_prime(argv: &[Value]) -> Value {
    let mut n = argi(argv, 0) + 1;
    while !prime_check(n) {
        n += 1;
    }
    Value::Int(n)
}
pub fn fibonacci(argv: &[Value]) -> Value {
    let n = argi(argv, 0);
    let (mut a, mut b): (i64, i64) = (0, 1);
    for _ in 0..n {
        let t = a.wrapping_add(b);
        a = b;
        b = t;
    }
    Value::Int(a)
}
pub fn choose(argv: &[Value]) -> Value {
    let n = argi(argv, 0);
    let mut k = argi(argv, 1);
    if k < 0 || k > n {
        return Value::Int(0);
    }
    if k > n - k {
        k = n - k;
    }
    let mut r: i64 = 1;
    for i in 0..k {
        r = r.wrapping_mul(n - i) / (i + 1);
    }
    Value::Int(r)
}
pub fn imod(argv: &[Value]) -> Value {
    let b = argi(argv, 1);
    if b == 0 {
        return Value::Null;
    }
    Value::Int(argi(argv, 0).rem_euclid(b))
}
pub fn bit_count(argv: &[Value]) -> Value {
    Value::Int(argi(argv, 0).count_ones() as i64)
}
pub fn leading_zeros(argv: &[Value]) -> Value {
    Value::Int(argi(argv, 0).leading_zeros() as i64)
}
pub fn trailing_zeros(argv: &[Value]) -> Value {
    Value::Int(argi(argv, 0).trailing_zeros() as i64)
}
pub fn isnan(argv: &[Value]) -> Value {
    Value::Int(argf(argv, 0).is_nan() as i64)
}
pub fn isinf(argv: &[Value]) -> Value {
    Value::Int(argf(argv, 0).is_infinite() as i64)
}
pub fn isfinite(argv: &[Value]) -> Value {
    Value::Int(argf(argv, 0).is_finite() as i64)
}
pub fn pi(_argv: &[Value]) -> Value {
    Value::Float(std::f64::consts::PI)
}
pub fn e(_argv: &[Value]) -> Value {
    Value::Float(std::f64::consts::E)
}
pub fn phi(_argv: &[Value]) -> Value {
    Value::Float(1.618033988749895)
}
pub fn tau(_argv: &[Value]) -> Value {
    Value::Float(std::f64::consts::TAU)
}
pub fn lerp(argv: &[Value]) -> Value {
    let a = argf(argv, 0);
    let b = argf(argv, 1);
    let t = argf(argv, 2);
    Value::Float(a + (b - a) * t)
}
pub fn smoothstep(argv: &[Value]) -> Value {
    let e0 = argf(argv, 0);
    let e1 = argf(argv, 1);
    let x = ((argf(argv, 2) - e0) / (e1 - e0)).clamp(0.0, 1.0);
    Value::Float(x * x * (3.0 - 2.0 * x))
}
pub fn int_sqrt(argv: &[Value]) -> Value {
    let n = argi(argv, 0);
    if n < 0 {
        return Value::Null;
    }
    Value::Int((n as f64).sqrt() as i64)
}

/// Return an array of the divisors of the first integer argument.
pub fn divisors(argv: &[Value]) -> Value {
    let n = argi(argv, 0).abs();
    let ao = heap_new_array();
    if n > 0 {
        let mut i = 1;
        while i <= n {
            if n % i == 0 {
                unsafe {
                    let a = SkObject::as_array_mut(ao).unwrap() as *mut ObjArray;
                    array_push(a, Value::Int(i));
                }
            }
            i += 1;
        }
    }
    Value::Obj(ao)
}

/// Return an array of all primes up to (and including) n.
pub fn primes_up_to(argv: &[Value]) -> Value {
    let n = argi(argv, 0);
    let ao = heap_new_array();
    let mut k = 2;
    while k <= n {
        if prime_check(k) {
            unsafe {
                let a = SkObject::as_array_mut(ao).unwrap() as *mut ObjArray;
                array_push(a, Value::Int(k));
            }
        }
        k += 1;
    }
    Value::Obj(ao)
}

pub fn exp10(argv: &[Value]) -> Value {
    Value::Float(10f64.powf(argf(argv, 0)))
}
pub fn sinh(argv: &[Value]) -> Value {
    Value::Float(argf(argv, 0).sinh())
}
pub fn cosh(argv: &[Value]) -> Value {
    Value::Float(argf(argv, 0).cosh())
}
pub fn tanh(argv: &[Value]) -> Value {
    Value::Float(argf(argv, 0).tanh())
}
pub fn asinh(argv: &[Value]) -> Value {
    Value::Float(argf(argv, 0).asinh())
}
pub fn acosh(argv: &[Value]) -> Value {
    Value::Float(argf(argv, 0).acosh())
}
pub fn atanh(argv: &[Value]) -> Value {
    Value::Float(argf(argv, 0).atanh())
}
pub fn int_log2(argv: &[Value]) -> Value {
    let n = argi(argv, 0);
    if n <= 0 {
        return Value::Null;
    }
    Value::Int(63 - n.leading_zeros() as i64)
}
pub fn permutations(argv: &[Value]) -> Value {
    let n = argi(argv, 0);
    let k = argi(argv, 1);
    if k < 0 || k > n {
        return Value::Int(0);
    }
    let mut r: i64 = 1;
    for i in 0..k {
        r = r.wrapping_mul(n - i);
    }
    Value::Int(r)
}
pub fn is_perfect(argv: &[Value]) -> Value {
    let n = argi(argv, 0);
    if n < 2 {
        return Value::Int(0);
    }
    let mut sum = 1i64;
    let mut i = 2;
    while i * i <= n {
        if n % i == 0 {
            sum += i;
            if i != n / i {
                sum += n / i;
            }
        }
        i += 1;
    }
    Value::Int((sum == n) as i64)
}
pub fn divmod(argv: &[Value]) -> Value {
    let a = argi(argv, 0);
    let b = argi(argv, 1);
    if b == 0 {
        return Value::Null;
    }
    // Returns the quotient; callers reading the remainder use `imod`.
    Value::Int(a.div_euclid(b))
}
pub fn cubic_bezier_t(argv: &[Value]) -> Value {
    // Evaluate a 1-D cubic Bézier at parameter t with control points p0..p3.
    let t = argf(argv, 0);
    let p0 = argf(argv, 1);
    let p1 = argf(argv, 2);
    let p2 = argf(argv, 3);
    let p3 = argf(argv, 4);
    let mt = 1.0 - t;
    Value::Float(
        mt * mt * mt * p0
            + 3.0 * mt * mt * t * p1
            + 3.0 * mt * t * t * p2
            + t * t * t * p3,
    )
}
pub fn hypot3(argv: &[Value]) -> Value {
    let x = argf(argv, 0);
    let y = argf(argv, 1);
    let z = argf(argv, 2);
    Value::Float((x * x + y * y + z * z).sqrt())
}
