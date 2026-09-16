//! Lightweight checksums — part of the `util` subsystem.
//!
//! Adler-32, Fletcher-16/32, and the Luhn check digit. All pure functions.

pub fn adler32(data: &[u8]) -> u32 {
    const MOD: u32 = 65521;
    let mut a: u32 = 1;
    let mut b: u32 = 0;
    for &byte in data {
        a = (a + byte as u32) % MOD;
        b = (b + a) % MOD;
    }
    (b << 16) | a
}

pub fn fletcher16(data: &[u8]) -> u16 {
    let mut sum1: u16 = 0;
    let mut sum2: u16 = 0;
    for &byte in data {
        sum1 = (sum1 + byte as u16) % 255;
        sum2 = (sum2 + sum1) % 255;
    }
    (sum2 << 8) | sum1
}

pub fn fletcher32(data: &[u8]) -> u32 {
    let mut sum1: u32 = 0xffff;
    let mut sum2: u32 = 0xffff;
    let mut i = 0;
    while i < data.len() {
        let mut tlen = std::cmp::min(data.len() - i, 359);
        while tlen > 0 {
            let word = if i + 1 < data.len() {
                (data[i] as u32) | ((data[i + 1] as u32) << 8)
            } else {
                data[i] as u32
            };
            sum1 = sum1.wrapping_add(word);
            sum2 = sum2.wrapping_add(sum1);
            i += 2;
            tlen -= 1;
            if i >= data.len() {
                break;
            }
        }
        sum1 = (sum1 & 0xffff).wrapping_add(sum1 >> 16);
        sum2 = (sum2 & 0xffff).wrapping_add(sum2 >> 16);
    }
    sum1 = (sum1 & 0xffff).wrapping_add(sum1 >> 16);
    sum2 = (sum2 & 0xffff).wrapping_add(sum2 >> 16);
    (sum2 << 16) | sum1
}

/// Compute the Luhn checksum of a slice of decimal digits; returns true if the
/// sequence (including its trailing check digit) is valid.
pub fn luhn_valid(digits: &[u8]) -> bool {
    if digits.is_empty() {
        return false;
    }
    let mut sum = 0u32;
    let mut alt = false;
    for &d in digits.iter().rev() {
        if !d.is_ascii_digit() {
            return false;
        }
        let mut n = (d - b'0') as u32;
        if alt {
            n *= 2;
            if n > 9 {
                n -= 9;
            }
        }
        sum += n;
        alt = !alt;
    }
    sum % 10 == 0
}
