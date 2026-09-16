//! LRU cache with a bounded capacity — part of the `ds` subsystem.
//!
//! Byte-string keys mapped to `u64` values. Recency is tracked with a monotonic
//! clock stamped on each access; eviction removes the least-recently-used entry
//! when the cache is over capacity.

struct Entry {
    key: Vec<u8>,
    value: u64,
    stamp: u64,
}

pub struct LruCache {
    entries: Vec<Entry>,
    capacity: usize,
    clock: u64,
    hits: u64,
    misses: u64,
}

impl LruCache {
    pub fn new(capacity: usize) -> LruCache {
        LruCache {
            entries: Vec::new(),
            capacity: capacity.max(1),
            clock: 0,
            hits: 0,
            misses: 0,
        }
    }

    pub fn len(&self) -> usize {
        self.entries.len()
    }
    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }
    pub fn hits(&self) -> u64 {
        self.hits
    }
    pub fn misses(&self) -> u64 {
        self.misses
    }

    fn tick(&mut self) -> u64 {
        self.clock += 1;
        self.clock
    }

    fn find(&self, key: &[u8]) -> Option<usize> {
        self.entries.iter().position(|e| e.key == key)
    }

    pub fn get(&mut self, key: &[u8]) -> Option<u64> {
        match self.find(key) {
            Some(i) => {
                let stamp = self.tick();
                self.entries[i].stamp = stamp;
                self.hits += 1;
                Some(self.entries[i].value)
            }
            None => {
                self.misses += 1;
                None
            }
        }
    }

    pub fn put(&mut self, key: &[u8], value: u64) {
        let stamp = self.tick();
        if let Some(i) = self.find(key) {
            self.entries[i].value = value;
            self.entries[i].stamp = stamp;
            return;
        }
        self.entries.push(Entry {
            key: key.to_vec(),
            value,
            stamp,
        });
        if self.entries.len() > self.capacity {
            self.evict_lru();
        }
    }

    fn evict_lru(&mut self) {
        if let Some((idx, _)) = self
            .entries
            .iter()
            .enumerate()
            .min_by_key(|(_, e)| e.stamp)
        {
            self.entries.swap_remove(idx);
        }
    }

    pub fn contains(&self, key: &[u8]) -> bool {
        self.find(key).is_some()
    }

    pub fn clear(&mut self) {
        self.entries.clear();
    }
}
