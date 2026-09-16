//! Dynamic and fixed bitsets — a faithful port of `util/bitset.c`.

fn words_for(n: usize) -> usize {
    (n + 63) / 64
}

pub struct Bitset {
    words: Vec<u64>,
    num_bits: usize,
}

impl Bitset {
    pub fn new(num_bits: usize) -> Bitset {
        Bitset {
            words: vec![0u64; words_for(num_bits)],
            num_bits,
        }
    }

    pub fn clone_from(src: &Bitset) -> Bitset {
        Bitset {
            words: src.words.clone(),
            num_bits: src.num_bits,
        }
    }

    pub fn resize(&mut self, new_bits: usize) {
        self.words.resize(words_for(new_bits), 0);
        self.num_bits = new_bits;
    }

    pub fn num_bits(&self) -> usize {
        self.num_bits
    }

    pub fn set(&mut self, idx: usize) {
        if idx >= self.num_bits {
            return;
        }
        self.words[idx / 64] |= 1u64 << (idx % 64);
    }
    pub fn clear(&mut self, idx: usize) {
        if idx >= self.num_bits {
            return;
        }
        self.words[idx / 64] &= !(1u64 << (idx % 64));
    }
    pub fn toggle(&mut self, idx: usize) {
        if idx >= self.num_bits {
            return;
        }
        self.words[idx / 64] ^= 1u64 << (idx % 64);
    }
    pub fn get(&self, idx: usize) -> bool {
        if idx >= self.num_bits {
            return false;
        }
        (self.words[idx / 64] >> (idx % 64)) & 1 != 0
    }

    pub fn set_range(&mut self, start: usize, end: usize) {
        for i in start..end.min(self.num_bits) {
            self.set(i);
        }
    }
    pub fn clear_range(&mut self, start: usize, end: usize) {
        for i in start..end.min(self.num_bits) {
            self.clear(i);
        }
    }
    pub fn toggle_range(&mut self, start: usize, end: usize) {
        for i in start..end.min(self.num_bits) {
            self.toggle(i);
        }
    }

    pub fn and_into(a: &Bitset, b: &Bitset, out: &mut Bitset) {
        for i in 0..out.words.len() {
            let av = a.words.get(i).copied().unwrap_or(0);
            let bv = b.words.get(i).copied().unwrap_or(0);
            out.words[i] = av & bv;
        }
    }
    pub fn or_into(a: &Bitset, b: &Bitset, out: &mut Bitset) {
        for i in 0..out.words.len() {
            let av = a.words.get(i).copied().unwrap_or(0);
            let bv = b.words.get(i).copied().unwrap_or(0);
            out.words[i] = av | bv;
        }
    }
    pub fn xor_into(a: &Bitset, b: &Bitset, out: &mut Bitset) {
        for i in 0..out.words.len() {
            let av = a.words.get(i).copied().unwrap_or(0);
            let bv = b.words.get(i).copied().unwrap_or(0);
            out.words[i] = av ^ bv;
        }
    }
    pub fn not_into(a: &Bitset, out: &mut Bitset) {
        for i in 0..out.words.len() {
            out.words[i] = !a.words.get(i).copied().unwrap_or(0);
        }
        out.mask_tail();
    }

    fn mask_tail(&mut self) {
        let rem = self.num_bits % 64;
        if rem != 0 {
            if let Some(last) = self.words.last_mut() {
                *last &= (1u64 << rem) - 1;
            }
        }
    }

    pub fn popcount(&self) -> usize {
        self.words.iter().map(|w| w.count_ones() as usize).sum()
    }

    pub fn find_first_set(&self) -> Option<usize> {
        for (wi, w) in self.words.iter().enumerate() {
            if *w != 0 {
                return Some(wi * 64 + w.trailing_zeros() as usize);
            }
        }
        None
    }
    pub fn find_next_set(&self, from: usize) -> Option<usize> {
        for i in from..self.num_bits {
            if self.get(i) {
                return Some(i);
            }
        }
        None
    }
    pub fn find_first_clear(&self) -> Option<usize> {
        for i in 0..self.num_bits {
            if !self.get(i) {
                return Some(i);
            }
        }
        None
    }

    pub fn is_subset(&self, b: &Bitset) -> bool {
        for i in 0..self.num_bits {
            if self.get(i) && !b.get(i) {
                return false;
            }
        }
        true
    }
    pub fn equals(&self, b: &Bitset) -> bool {
        if self.num_bits != b.num_bits {
            return false;
        }
        self.words == b.words
    }

    pub fn to_string(&self) -> String {
        let mut s = String::with_capacity(self.num_bits);
        for i in 0..self.num_bits {
            s.push(if self.get(i) { '1' } else { '0' });
        }
        s
    }
}

pub const BITSET_MAX_FIXED: usize = 256;

pub struct FixedBitset {
    words: [u64; BITSET_MAX_FIXED / 64],
    num_bits: usize,
}

impl FixedBitset {
    pub fn new(num_bits: usize) -> FixedBitset {
        FixedBitset {
            words: [0; BITSET_MAX_FIXED / 64],
            num_bits: num_bits.min(BITSET_MAX_FIXED),
        }
    }
    pub fn set(&mut self, idx: usize) {
        if idx < self.num_bits {
            self.words[idx / 64] |= 1u64 << (idx % 64);
        }
    }
    pub fn clear(&mut self, idx: usize) {
        if idx < self.num_bits {
            self.words[idx / 64] &= !(1u64 << (idx % 64));
        }
    }
    pub fn toggle(&mut self, idx: usize) {
        if idx < self.num_bits {
            self.words[idx / 64] ^= 1u64 << (idx % 64);
        }
    }
    pub fn get(&self, idx: usize) -> bool {
        idx < self.num_bits && (self.words[idx / 64] >> (idx % 64)) & 1 != 0
    }
    pub fn popcount(&self) -> usize {
        self.words.iter().map(|w| w.count_ones() as usize).sum()
    }
    pub fn find_first_set(&self) -> Option<usize> {
        for (wi, w) in self.words.iter().enumerate() {
            if *w != 0 {
                return Some(wi * 64 + w.trailing_zeros() as usize);
            }
        }
        None
    }
}
