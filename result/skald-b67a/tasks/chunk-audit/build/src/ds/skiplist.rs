//! Ordered string-keyed skip list — a faithful port of `ds/skiplist.c`.
//!
//! Keys are owned byte strings, values opaque `u64` tokens. Up to 32 levels,
//! probabilistic level selection with p = 0.5.

pub const HX_SL_MAX_LEVEL: usize = 32;

struct Node {
    key: Vec<u8>,
    value: u64,
    next: Vec<usize>, // indices into `nodes`; usize::MAX = nil
}

const NIL: usize = usize::MAX;

pub struct SkipList {
    nodes: Vec<Node>,
    head: usize,
    level: usize,
    size: usize,
    rng: u64,
}

impl Default for SkipList {
    fn default() -> Self {
        Self::new()
    }
}

impl SkipList {
    pub fn new() -> SkipList {
        let head = Node {
            key: Vec::new(),
            value: 0,
            next: vec![NIL; HX_SL_MAX_LEVEL],
        };
        SkipList {
            nodes: vec![head],
            head: 0,
            level: 1,
            size: 0,
            rng: 0x2545F4914F6CDD1D,
        }
    }

    pub fn size(&self) -> usize {
        self.size
    }
    pub fn is_empty(&self) -> bool {
        self.size == 0
    }

    fn random_level(&mut self) -> usize {
        // xorshift RNG, p = 0.5
        let mut lvl = 1;
        loop {
            self.rng ^= self.rng << 13;
            self.rng ^= self.rng >> 7;
            self.rng ^= self.rng << 17;
            if (self.rng & 1) == 1 && lvl < HX_SL_MAX_LEVEL {
                lvl += 1;
            } else {
                break;
            }
        }
        lvl
    }

    pub fn insert(&mut self, key: &[u8], value: u64) -> bool {
        let mut update = vec![self.head; HX_SL_MAX_LEVEL];
        let mut x = self.head;
        for i in (0..self.level).rev() {
            loop {
                let nxt = self.nodes[x].next[i];
                if nxt != NIL && self.nodes[nxt].key.as_slice() < key {
                    x = nxt;
                } else {
                    break;
                }
            }
            update[i] = x;
        }
        let nxt = self.nodes[x].next[0];
        if nxt != NIL && self.nodes[nxt].key == key {
            self.nodes[nxt].value = value;
            return true;
        }
        let lvl = self.random_level();
        if lvl > self.level {
            for u in update.iter_mut().take(lvl).skip(self.level) {
                *u = self.head;
            }
            self.level = lvl;
        }
        let new_idx = self.nodes.len();
        self.nodes.push(Node {
            key: key.to_vec(),
            value,
            next: vec![NIL; lvl],
        });
        for i in 0..lvl {
            let u = update[i];
            self.nodes[new_idx].next[i] = self.nodes[u].next[i];
            self.nodes[u].next[i] = new_idx;
        }
        self.size += 1;
        true
    }

    pub fn lookup(&self, key: &[u8]) -> Option<u64> {
        let mut x = self.head;
        for i in (0..self.level).rev() {
            loop {
                let nxt = self.nodes[x].next[i];
                if nxt != NIL && self.nodes[nxt].key.as_slice() < key {
                    x = nxt;
                } else {
                    break;
                }
            }
        }
        let nxt = self.nodes[x].next[0];
        if nxt != NIL && self.nodes[nxt].key == key {
            Some(self.nodes[nxt].value)
        } else {
            None
        }
    }

    pub fn contains(&self, key: &[u8]) -> bool {
        self.lookup(key).is_some()
    }

    pub fn floor_key(&self, query: &[u8]) -> Option<Vec<u8>> {
        let mut x = self.head;
        for i in (0..self.level).rev() {
            loop {
                let nxt = self.nodes[x].next[i];
                if nxt != NIL && self.nodes[nxt].key.as_slice() <= query {
                    x = nxt;
                } else {
                    break;
                }
            }
        }
        if x == self.head {
            None
        } else {
            Some(self.nodes[x].key.clone())
        }
    }

    pub fn nth(&self, n: usize) -> Option<(Vec<u8>, u64)> {
        let mut x = self.nodes[self.head].next[0];
        let mut i = 0;
        while x != NIL {
            if i == n {
                return Some((self.nodes[x].key.clone(), self.nodes[x].value));
            }
            x = self.nodes[x].next[0];
            i += 1;
        }
        None
    }
}
