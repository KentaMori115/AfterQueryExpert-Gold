//! Interval tree for overlap queries over closed integer intervals — part of
//! the `ds` subsystem.
//!
//! Intervals are stored in a balanced-by-insertion-order BST augmented with the
//! maximum endpoint in each subtree, giving O(log n + k) stabbing queries.

const NIL: usize = usize::MAX;

struct INode {
    lo: i64,
    hi: i64,
    max: i64,
    data: u64,
    left: usize,
    right: usize,
}

pub struct IntervalTree {
    nodes: Vec<INode>,
    root: usize,
}

impl Default for IntervalTree {
    fn default() -> Self {
        Self::new()
    }
}

impl IntervalTree {
    pub fn new() -> IntervalTree {
        IntervalTree {
            nodes: Vec::new(),
            root: NIL,
        }
    }

    pub fn len(&self) -> usize {
        self.nodes.len()
    }
    pub fn is_empty(&self) -> bool {
        self.nodes.is_empty()
    }

    pub fn insert(&mut self, lo: i64, hi: i64, data: u64) {
        let idx = self.nodes.len();
        self.nodes.push(INode {
            lo,
            hi,
            max: hi,
            data,
            left: NIL,
            right: NIL,
        });
        if self.root == NIL {
            self.root = idx;
            return;
        }
        let mut cur = self.root;
        loop {
            if hi > self.nodes[cur].max {
                self.nodes[cur].max = hi;
            }
            if lo < self.nodes[cur].lo {
                if self.nodes[cur].left == NIL {
                    self.nodes[cur].left = idx;
                    break;
                }
                cur = self.nodes[cur].left;
            } else {
                if self.nodes[cur].right == NIL {
                    self.nodes[cur].right = idx;
                    break;
                }
                cur = self.nodes[cur].right;
            }
        }
    }

    /// Collect the data of every interval containing `point`.
    pub fn stab(&self, point: i64) -> Vec<u64> {
        let mut out = Vec::new();
        self.stab_rec(self.root, point, &mut out);
        out
    }
    fn stab_rec(&self, node: usize, point: i64, out: &mut Vec<u64>) {
        if node == NIL {
            return;
        }
        let n = &self.nodes[node];
        if point > n.max {
            return;
        }
        self.stab_rec(n.left, point, out);
        if n.lo <= point && point <= n.hi {
            out.push(n.data);
        }
        if point >= n.lo {
            self.stab_rec(n.right, point, out);
        }
    }

    /// True if any stored interval overlaps `[lo, hi]`.
    pub fn overlaps(&self, lo: i64, hi: i64) -> bool {
        let mut cur = self.root;
        while cur != NIL {
            let n = &self.nodes[cur];
            if n.lo <= hi && lo <= n.hi {
                return true;
            }
            if n.left != NIL && self.nodes[n.left].max >= lo {
                cur = n.left;
            } else {
                cur = n.right;
            }
        }
        false
    }
}
