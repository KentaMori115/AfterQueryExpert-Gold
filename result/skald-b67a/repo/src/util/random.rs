//! Deterministic pseudo-random number generators — part of the `util`
//! subsystem. No global state; seeded explicitly so the build is reproducible.

/// SplitMix64 — a fast, well-distributed seed/stream generator.
pub struct SplitMix64 {
    state: u64,
}

impl SplitMix64 {
    pub fn new(seed: u64) -> SplitMix64 {
        SplitMix64 { state: seed }
    }
    pub fn next_u64(&mut self) -> u64 {
        self.state = self.state.wrapping_add(0x9E3779B97F4A7C15);
        let mut z = self.state;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58476D1CE4E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D049BB133111EB);
        z ^ (z >> 31)
    }
}

/// xoshiro256** — the main PRNG, seeded from a SplitMix64 stream.
pub struct Xoshiro256 {
    s: [u64; 4],
}

impl Xoshiro256 {
    pub fn new(seed: u64) -> Xoshiro256 {
        let mut sm = SplitMix64::new(seed);
        Xoshiro256 {
            s: [
                sm.next_u64(),
                sm.next_u64(),
                sm.next_u64(),
                sm.next_u64(),
            ],
        }
    }

    pub fn next_u64(&mut self) -> u64 {
        let result = self.s[1]
            .wrapping_mul(5)
            .rotate_left(7)
            .wrapping_mul(9);
        let t = self.s[1] << 17;
        self.s[2] ^= self.s[0];
        self.s[3] ^= self.s[1];
        self.s[1] ^= self.s[2];
        self.s[0] ^= self.s[3];
        self.s[2] ^= t;
        self.s[3] = self.s[3].rotate_left(45);
        result
    }

    /// Uniform integer in `[0, bound)` via Lemire's method.
    pub fn below(&mut self, bound: u64) -> u64 {
        if bound == 0 {
            return 0;
        }
        let mut x = self.next_u64();
        let mut m = (x as u128) * (bound as u128);
        let mut low = m as u64;
        if low < bound {
            let threshold = bound.wrapping_neg() % bound;
            while low < threshold {
                x = self.next_u64();
                m = (x as u128) * (bound as u128);
                low = m as u64;
            }
        }
        (m >> 64) as u64
    }

    /// Uniform float in `[0, 1)`.
    pub fn next_f64(&mut self) -> f64 {
        (self.next_u64() >> 11) as f64 * (1.0 / (1u64 << 53) as f64)
    }

    /// Fisher–Yates shuffle of an index slice.
    pub fn shuffle(&mut self, items: &mut [u32]) {
        let n = items.len();
        for i in (1..n).rev() {
            let j = self.below((i + 1) as u64) as usize;
            items.swap(i, j);
        }
    }
}
