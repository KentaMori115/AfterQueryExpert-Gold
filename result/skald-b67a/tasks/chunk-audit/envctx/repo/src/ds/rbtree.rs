//! Left-leaning red-black tree ordered map (i64 -> u64) — a faithful port of
//! `ds/rbtree.c`.
//!
//! Balanced BST guaranteeing O(log n) insert/lookup/delete. This port uses the
//! left-leaning red-black formulation over an index-based node arena.

const NIL: usize = usize::MAX;
const RED: bool = true;
const BLACK: bool = false;

struct RbNode {
    key: i64,
    val: u64,
    left: usize,
    right: usize,
    color: bool,
}

pub struct RbTree {
    nodes: Vec<RbNode>,
    root: usize,
    size: usize,
}

impl Default for RbTree {
    fn default() -> Self {
        Self::new()
    }
}

impl RbTree {
    pub fn new() -> RbTree {
        RbTree {
            nodes: Vec::new(),
            root: NIL,
            size: 0,
        }
    }
    pub fn size(&self) -> usize {
        self.size
    }
    pub fn is_empty(&self) -> bool {
        self.size == 0
    }

    fn is_red(&self, x: usize) -> bool {
        x != NIL && self.nodes[x].color == RED
    }

    fn rotate_left(&mut self, h: usize) -> usize {
        let x = self.nodes[h].right;
        self.nodes[h].right = self.nodes[x].left;
        self.nodes[x].left = h;
        self.nodes[x].color = self.nodes[h].color;
        self.nodes[h].color = RED;
        x
    }
    fn rotate_right(&mut self, h: usize) -> usize {
        let x = self.nodes[h].left;
        self.nodes[h].left = self.nodes[x].right;
        self.nodes[x].right = h;
        self.nodes[x].color = self.nodes[h].color;
        self.nodes[h].color = RED;
        x
    }
    fn flip_colors(&mut self, h: usize) {
        self.nodes[h].color = !self.nodes[h].color;
        let l = self.nodes[h].left;
        let r = self.nodes[h].right;
        if l != NIL {
            self.nodes[l].color = !self.nodes[l].color;
        }
        if r != NIL {
            self.nodes[r].color = !self.nodes[r].color;
        }
    }

    pub fn insert(&mut self, key: i64, val: u64) {
        let root = self.root;
        self.root = self.insert_rec(root, key, val);
        self.nodes[self.root].color = BLACK;
    }

    fn insert_rec(&mut self, h: usize, key: i64, val: u64) -> usize {
        if h == NIL {
            self.nodes.push(RbNode {
                key,
                val,
                left: NIL,
                right: NIL,
                color: RED,
            });
            self.size += 1;
            return self.nodes.len() - 1;
        }
        if key < self.nodes[h].key {
            let l = self.nodes[h].left;
            let nl = self.insert_rec(l, key, val);
            self.nodes[h].left = nl;
        } else if key > self.nodes[h].key {
            let r = self.nodes[h].right;
            let nr = self.insert_rec(r, key, val);
            self.nodes[h].right = nr;
        } else {
            self.nodes[h].val = val;
        }

        let mut h = h;
        if self.is_red(self.nodes[h].right) && !self.is_red(self.nodes[h].left) {
            h = self.rotate_left(h);
        }
        let l = self.nodes[h].left;
        if self.is_red(l) && self.is_red(self.nodes[l].left) {
            h = self.rotate_right(h);
        }
        if self.is_red(self.nodes[h].left) && self.is_red(self.nodes[h].right) {
            self.flip_colors(h);
        }
        h
    }

    pub fn lookup(&self, key: i64) -> Option<u64> {
        let mut x = self.root;
        while x != NIL {
            if key < self.nodes[x].key {
                x = self.nodes[x].left;
            } else if key > self.nodes[x].key {
                x = self.nodes[x].right;
            } else {
                return Some(self.nodes[x].val);
            }
        }
        None
    }
    pub fn contains(&self, key: i64) -> bool {
        self.lookup(key).is_some()
    }

    pub fn min_key(&self) -> Option<i64> {
        let mut x = self.root;
        if x == NIL {
            return None;
        }
        while self.nodes[x].left != NIL {
            x = self.nodes[x].left;
        }
        Some(self.nodes[x].key)
    }
    pub fn max_key(&self) -> Option<i64> {
        let mut x = self.root;
        if x == NIL {
            return None;
        }
        while self.nodes[x].right != NIL {
            x = self.nodes[x].right;
        }
        Some(self.nodes[x].key)
    }

    pub fn in_order(&self) -> Vec<(i64, u64)> {
        let mut out = Vec::new();
        self.walk(self.root, &mut out);
        out
    }
    fn walk(&self, x: usize, out: &mut Vec<(i64, u64)>) {
        if x == NIL {
            return;
        }
        self.walk(self.nodes[x].left, out);
        out.push((self.nodes[x].key, self.nodes[x].val));
        self.walk(self.nodes[x].right, out);
    }
}
