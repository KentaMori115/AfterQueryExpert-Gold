//! Byte-keyed prefix tree (trie) — part of the `ds` subsystem.
//!
//! Maps byte-string keys to `u64` values with prefix queries. Nodes live in an
//! index-based arena; each node holds a sparse list of `(byte, child)` edges.

struct TrieNode {
    edges: Vec<(u8, usize)>,
    value: Option<u64>,
}

impl TrieNode {
    fn new() -> TrieNode {
        TrieNode {
            edges: Vec::new(),
            value: None,
        }
    }
    fn child(&self, b: u8) -> Option<usize> {
        self.edges.iter().find(|(k, _)| *k == b).map(|(_, i)| *i)
    }
}

pub struct Trie {
    nodes: Vec<TrieNode>,
    size: usize,
}

impl Default for Trie {
    fn default() -> Self {
        Self::new()
    }
}

impl Trie {
    pub fn new() -> Trie {
        Trie {
            nodes: vec![TrieNode::new()],
            size: 0,
        }
    }

    pub fn len(&self) -> usize {
        self.size
    }
    pub fn is_empty(&self) -> bool {
        self.size == 0
    }

    pub fn insert(&mut self, key: &[u8], value: u64) {
        let mut cur = 0;
        for &b in key {
            match self.nodes[cur].child(b) {
                Some(next) => cur = next,
                None => {
                    let next = self.nodes.len();
                    self.nodes.push(TrieNode::new());
                    self.nodes[cur].edges.push((b, next));
                    cur = next;
                }
            }
        }
        if self.nodes[cur].value.is_none() {
            self.size += 1;
        }
        self.nodes[cur].value = Some(value);
    }

    fn find_node(&self, key: &[u8]) -> Option<usize> {
        let mut cur = 0;
        for &b in key {
            cur = self.nodes[cur].child(b)?;
        }
        Some(cur)
    }

    pub fn get(&self, key: &[u8]) -> Option<u64> {
        self.find_node(key).and_then(|n| self.nodes[n].value)
    }

    pub fn contains(&self, key: &[u8]) -> bool {
        self.get(key).is_some()
    }

    /// True if any key with the given prefix exists.
    pub fn has_prefix(&self, prefix: &[u8]) -> bool {
        self.find_node(prefix).is_some()
    }

    /// Collect all keys sharing `prefix` (in arbitrary edge order).
    pub fn keys_with_prefix(&self, prefix: &[u8]) -> Vec<Vec<u8>> {
        let mut out = Vec::new();
        if let Some(start) = self.find_node(prefix) {
            let mut path = prefix.to_vec();
            self.collect(start, &mut path, &mut out);
        }
        out
    }

    fn collect(&self, node: usize, path: &mut Vec<u8>, out: &mut Vec<Vec<u8>>) {
        if self.nodes[node].value.is_some() {
            out.push(path.clone());
        }
        for &(b, child) in &self.nodes[node].edges {
            path.push(b);
            self.collect(child, path, out);
            path.pop();
        }
    }
}
