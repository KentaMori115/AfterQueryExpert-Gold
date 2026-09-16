//! Fenwick (binary indexed) tree for prefix sums with point updates — part of
//! the `ds` subsystem.

pub struct Fenwick {
    tree: Vec<i64>,
}

impl Fenwick {
    pub fn new(n: usize) -> Fenwick {
        Fenwick {
            tree: vec![0; n + 1],
        }
    }

    pub fn len(&self) -> usize {
        self.tree.len() - 1
    }
    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    /// Add `delta` at index `i` (0-based).
    pub fn add(&mut self, i: usize, delta: i64) {
        let mut idx = i + 1;
        while idx < self.tree.len() {
            self.tree[idx] += delta;
            idx += idx & idx.wrapping_neg();
        }
    }

    /// Prefix sum over `[0, i]` (0-based, inclusive).
    pub fn prefix_sum(&self, i: usize) -> i64 {
        let mut idx = i + 1;
        let mut sum = 0;
        while idx > 0 {
            sum += self.tree[idx];
            idx -= idx & idx.wrapping_neg();
        }
        sum
    }

    /// Range sum over `[lo, hi]` (0-based, inclusive).
    pub fn range_sum(&self, lo: usize, hi: usize) -> i64 {
        if lo == 0 {
            self.prefix_sum(hi)
        } else {
            self.prefix_sum(hi) - self.prefix_sum(lo - 1)
        }
    }
}
