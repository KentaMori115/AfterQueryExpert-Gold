//! Bloom filter over byte keys — part of the `ds` subsystem.
//!
//! Two independent 64-bit hashes are combined into as many probe positions as
//! the filter was built for, the standard double-hashing construction. A
//! filter never reports a key it holds as absent; it may report a key it does
//! not hold as present, at a rate the constructor's sizing controls.

use crate::util::hash::{fnv1a_64, sdbm};

/// The largest number of probes a filter will use per key.
pub const MAX_PROBES: usize = 16;

pub struct Bloom {
    bits: Vec<u64>,
    num_bits: usize,
    probes: usize,
    inserted: u64,
}

fn words_for(num_bits: usize) -> usize {
    num_bits.div_ceil(64)
}

impl Bloom {
    /// Build a filter with `num_bits` bits and `probes` positions per key.
    ///
    /// Both arguments are clamped into a usable range: a filter always has at
    /// least one bit and between one and [`MAX_PROBES`] probes, so no
    /// combination of arguments produces a filter that cannot answer.
    pub fn new(num_bits: usize, probes: usize) -> Bloom {
        let num_bits = num_bits.max(1);
        let probes = probes.clamp(1, MAX_PROBES);
        Bloom {
            bits: vec![0; words_for(num_bits)],
            num_bits,
            probes,
            inserted: 0,
        }
    }

    /// Build a filter sized for `expected` keys at roughly `1 / 2^probes`
    /// false positives, using the usual ten-bits-per-key rule of thumb.
    pub fn for_capacity(expected: usize, probes: usize) -> Bloom {
        Bloom::new(expected.max(1) * 10, probes)
    }

    pub fn num_bits(&self) -> usize {
        self.num_bits
    }

    pub fn probes(&self) -> usize {
        self.probes
    }

    /// How many keys have been inserted, counting repeats.
    pub fn inserted(&self) -> u64 {
        self.inserted
    }

    fn positions(&self, key: &[u8]) -> [usize; MAX_PROBES] {
        let h1 = fnv1a_64(key);
        let h2 = (sdbm(key) as u64) | 1;
        let mut out = [0usize; MAX_PROBES];
        for (i, slot) in out.iter_mut().enumerate().take(self.probes) {
            let combined = h1.wrapping_add((i as u64).wrapping_mul(h2));
            *slot = (combined % self.num_bits as u64) as usize;
        }
        out
    }

    /// Record `key`. Returns true when at least one bit changed, which means
    /// the key was certainly absent before this call.
    pub fn insert(&mut self, key: &[u8]) -> bool {
        let positions = self.positions(key);
        let mut changed = false;
        for &p in positions.iter().take(self.probes) {
            let word = p / 64;
            let mask = 1u64 << (p % 64);
            if self.bits[word] & mask == 0 {
                self.bits[word] |= mask;
                changed = true;
            }
        }
        self.inserted += 1;
        changed
    }

    /// True when `key` may be present. False is a certainty; true is not.
    pub fn contains(&self, key: &[u8]) -> bool {
        let positions = self.positions(key);
        positions.iter().take(self.probes).all(|&p| {
            let word = p / 64;
            self.bits[word] & (1u64 << (p % 64)) != 0
        })
    }

    /// How many bits are set.
    pub fn bits_set(&self) -> usize {
        self.bits.iter().map(|w| w.count_ones() as usize).sum()
    }

    /// Fraction of bits set, in `[0, 1]`.
    pub fn load(&self) -> f64 {
        self.bits_set() as f64 / self.num_bits as f64
    }

    /// Estimated false-positive rate at the current load.
    pub fn false_positive_rate(&self) -> f64 {
        self.load().powi(self.probes as i32)
    }

    /// Union another filter into this one.
    ///
    /// Filters of different geometry cannot be merged — their probe positions
    /// mean different things — so a mismatch is refused.
    pub fn union(&mut self, other: &Bloom) -> bool {
        if self.num_bits != other.num_bits || self.probes != other.probes {
            return false;
        }
        for (word, &src) in self.bits.iter_mut().zip(other.bits.iter()) {
            *word |= src;
        }
        self.inserted += other.inserted;
        true
    }

    /// Clear every bit and the insertion count.
    pub fn clear(&mut self) {
        for word in self.bits.iter_mut() {
            *word = 0;
        }
        self.inserted = 0;
    }

    /// The raw bit words, for a caller that wants to persist a filter.
    pub fn words(&self) -> &[u64] {
        &self.bits
    }

    /// Rebuild a filter from a geometry and the words [`Bloom::words`]
    /// returned. A word count that does not match the geometry is refused.
    pub fn from_words(num_bits: usize, probes: usize, words: &[u64]) -> Option<Bloom> {
        if num_bits == 0 || words.len() != words_for(num_bits) {
            return None;
        }
        let probes = probes.clamp(1, MAX_PROBES);
        Some(Bloom {
            bits: words.to_vec(),
            num_bits,
            probes,
            inserted: 0,
        })
    }
}
