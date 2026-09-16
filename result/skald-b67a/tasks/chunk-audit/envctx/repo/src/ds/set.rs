//! Byte-key hash set — a faithful port of `ds/set.c`.
//!
//! Open-addressing set over raw byte-buffer keys. The C original used
//! robin-hood probing; this port keeps the same public contract (insert,
//! remove, contains, load factor, resize, iteration) over a power-of-two slot
//! table.

fn fnv1a_64(data: &[u8]) -> u64 {
    let mut h: u64 = 0xcbf29ce484222325;
    for &b in data {
        h ^= b as u64;
        h = h.wrapping_mul(0x100000001b3);
    }
    h
}

#[derive(Clone)]
enum Slot {
    Empty,
    Tombstone,
    Full(Vec<u8>),
}

pub struct HxSet {
    slots: Vec<Slot>,
    size: usize,
    used: usize,
    mask: usize,
}

impl Default for HxSet {
    fn default() -> Self {
        Self::new(16)
    }
}

impl HxSet {
    pub fn new(initial_cap: usize) -> HxSet {
        let cap = initial_cap.max(16).next_power_of_two();
        HxSet {
            slots: vec![Slot::Empty; cap],
            size: 0,
            used: 0,
            mask: cap - 1,
        }
    }

    pub fn size(&self) -> usize {
        self.size
    }
    pub fn is_empty(&self) -> bool {
        self.size == 0
    }
    pub fn load_factor(&self) -> f64 {
        self.used as f64 / self.slots.len() as f64
    }

    fn probe(&self, key: &[u8]) -> Option<usize> {
        let mut i = (fnv1a_64(key) as usize) & self.mask;
        for _ in 0..self.slots.len() {
            match &self.slots[i] {
                Slot::Empty => return None,
                Slot::Full(k) if k == key => return Some(i),
                _ => {}
            }
            i = (i + 1) & self.mask;
        }
        None
    }

    pub fn contains(&self, key: &[u8]) -> bool {
        self.probe(key).is_some()
    }

    pub fn insert(&mut self, key: &[u8]) -> bool {
        if self.load_factor() > 0.7 {
            self.resize(self.slots.len() * 2);
        }
        if self.contains(key) {
            return true;
        }
        let mut i = (fnv1a_64(key) as usize) & self.mask;
        loop {
            match &self.slots[i] {
                Slot::Empty => {
                    self.slots[i] = Slot::Full(key.to_vec());
                    self.size += 1;
                    self.used += 1;
                    return true;
                }
                Slot::Tombstone => {
                    self.slots[i] = Slot::Full(key.to_vec());
                    self.size += 1;
                    return true;
                }
                _ => {}
            }
            i = (i + 1) & self.mask;
        }
    }

    pub fn remove(&mut self, key: &[u8]) -> bool {
        if let Some(i) = self.probe(key) {
            self.slots[i] = Slot::Tombstone;
            self.size -= 1;
            true
        } else {
            false
        }
    }

    pub fn clear(&mut self) {
        for s in self.slots.iter_mut() {
            *s = Slot::Empty;
        }
        self.size = 0;
        self.used = 0;
    }

    pub fn resize(&mut self, new_cap: usize) {
        let cap = new_cap.max(16).next_power_of_two();
        let old = std::mem::replace(&mut self.slots, vec![Slot::Empty; cap]);
        self.mask = cap - 1;
        self.size = 0;
        self.used = 0;
        for s in old {
            if let Slot::Full(k) = s {
                self.insert(&k);
            }
        }
    }

    pub fn iter(&self) -> impl Iterator<Item = &[u8]> {
        self.slots.iter().filter_map(|s| match s {
            Slot::Full(k) => Some(k.as_slice()),
            _ => None,
        })
    }
}
