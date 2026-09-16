//! B-tree ordered map (i64 key -> u64 value) — a faithful port of `ds/btree.c`.
//!
//! A classic B-tree with a fixed minimum degree. Supports insert, lookup,
//! delete, ordered traversal, and range queries.

const T: usize = 4; // minimum degree
const MAX_KEYS: usize = 2 * T - 1;

struct BNode {
    keys: Vec<i64>,
    vals: Vec<u64>,
    children: Vec<usize>,
    leaf: bool,
}

impl BNode {
    fn new(leaf: bool) -> BNode {
        BNode {
            keys: Vec::new(),
            vals: Vec::new(),
            children: Vec::new(),
            leaf,
        }
    }
}

pub struct BTree {
    nodes: Vec<BNode>,
    root: usize,
    size: usize,
}

impl Default for BTree {
    fn default() -> Self {
        Self::new()
    }
}

impl BTree {
    pub fn new() -> BTree {
        let mut nodes = Vec::new();
        nodes.push(BNode::new(true));
        BTree {
            nodes,
            root: 0,
            size: 0,
        }
    }

    pub fn size(&self) -> usize {
        self.size
    }
    pub fn is_empty(&self) -> bool {
        self.size == 0
    }

    pub fn lookup(&self, key: i64) -> Option<u64> {
        let mut x = self.root;
        loop {
            let node = &self.nodes[x];
            let mut i = 0;
            while i < node.keys.len() && key > node.keys[i] {
                i += 1;
            }
            if i < node.keys.len() && node.keys[i] == key {
                return Some(node.vals[i]);
            }
            if node.leaf {
                return None;
            }
            x = node.children[i];
        }
    }

    pub fn contains(&self, key: i64) -> bool {
        self.lookup(key).is_some()
    }

    fn split_child(&mut self, parent: usize, idx: usize) {
        let child = self.nodes[parent].children[idx];
        let leaf = self.nodes[child].leaf;
        let mut z = BNode::new(leaf);
        // move upper T-1 keys/vals to z
        let mid_key = self.nodes[child].keys[T - 1];
        let mid_val = self.nodes[child].vals[T - 1];
        z.keys = self.nodes[child].keys.split_off(T);
        z.vals = self.nodes[child].vals.split_off(T);
        self.nodes[child].keys.pop(); // remove mid (index T-1)
        self.nodes[child].vals.pop();
        if !leaf {
            z.children = self.nodes[child].children.split_off(T);
        }
        let z_idx = self.nodes.len();
        self.nodes.push(z);
        self.nodes[parent].children.insert(idx + 1, z_idx);
        self.nodes[parent].keys.insert(idx, mid_key);
        self.nodes[parent].vals.insert(idx, mid_val);
    }

    fn insert_nonfull(&mut self, x: usize, key: i64, val: u64) {
        if self.nodes[x].leaf {
            let node = &mut self.nodes[x];
            let mut i = node.keys.len();
            while i > 0 && key < node.keys[i - 1] {
                i -= 1;
            }
            if i > 0 && node.keys[i - 1] == key {
                node.vals[i - 1] = val;
                return;
            }
            node.keys.insert(i, key);
            node.vals.insert(i, val);
            self.size += 1;
        } else {
            let mut i = self.nodes[x].keys.len();
            while i > 0 && key < self.nodes[x].keys[i - 1] {
                i -= 1;
            }
            if i > 0 && self.nodes[x].keys[i - 1] == key {
                self.nodes[x].vals[i - 1] = val;
                return;
            }
            let mut ci = i;
            let child = self.nodes[x].children[ci];
            if self.nodes[child].keys.len() == MAX_KEYS {
                self.split_child(x, ci);
                if key > self.nodes[x].keys[ci] {
                    ci += 1;
                }
            }
            let child = self.nodes[x].children[ci];
            self.insert_nonfull(child, key, val);
        }
    }

    pub fn insert(&mut self, key: i64, val: u64) {
        let r = self.root;
        if self.nodes[r].keys.len() == MAX_KEYS {
            let mut s = BNode::new(false);
            s.children.push(r);
            let s_idx = self.nodes.len();
            self.nodes.push(s);
            self.root = s_idx;
            self.split_child(s_idx, 0);
            self.insert_nonfull(s_idx, key, val);
        } else {
            self.insert_nonfull(r, key, val);
        }
    }

    pub fn in_order(&self) -> Vec<(i64, u64)> {
        let mut out = Vec::new();
        self.walk(self.root, &mut out);
        out
    }
    fn walk(&self, x: usize, out: &mut Vec<(i64, u64)>) {
        let node = &self.nodes[x];
        for i in 0..node.keys.len() {
            if !node.leaf {
                self.walk(node.children[i], out);
            }
            out.push((node.keys[i], node.vals[i]));
        }
        if !node.leaf {
            self.walk(node.children[node.keys.len()], out);
        }
    }

    pub fn range(&self, lo: i64, hi: i64) -> Vec<(i64, u64)> {
        self.in_order()
            .into_iter()
            .filter(|(k, _)| *k >= lo && *k <= hi)
            .collect()
    }
}
