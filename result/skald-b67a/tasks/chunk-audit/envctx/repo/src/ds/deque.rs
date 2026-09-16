//! Double-ended queue over a circular buffer — a faithful port of `ds/deque.c`.
//!
//! Elements are opaque `u64` tokens (the C version stored `void*`). The buffer
//! grows automatically when full.

pub struct Deque {
    buf: Vec<u64>,
    head: usize,
    size: usize,
    cap: usize,
}

impl Default for Deque {
    fn default() -> Self {
        Self::new(0)
    }
}

impl Deque {
    pub fn new(initial_cap: usize) -> Deque {
        let cap = if initial_cap == 0 { 8 } else { initial_cap };
        Deque {
            buf: vec![0; cap],
            head: 0,
            size: 0,
            cap,
        }
    }

    pub fn len(&self) -> usize {
        self.size
    }
    pub fn is_empty(&self) -> bool {
        self.size == 0
    }
    pub fn clear(&mut self) {
        self.head = 0;
        self.size = 0;
    }

    fn grow(&mut self) {
        let ncap = self.cap * 2;
        let mut nbuf = vec![0u64; ncap];
        for i in 0..self.size {
            nbuf[i] = self.buf[(self.head + i) % self.cap];
        }
        self.buf = nbuf;
        self.head = 0;
        self.cap = ncap;
    }

    pub fn push_front(&mut self, elem: u64) {
        if self.size == self.cap {
            self.grow();
        }
        self.head = (self.head + self.cap - 1) % self.cap;
        self.buf[self.head] = elem;
        self.size += 1;
    }
    pub fn push_back(&mut self, elem: u64) {
        if self.size == self.cap {
            self.grow();
        }
        let tail = (self.head + self.size) % self.cap;
        self.buf[tail] = elem;
        self.size += 1;
    }
    pub fn pop_front(&mut self) -> Option<u64> {
        if self.size == 0 {
            return None;
        }
        let v = self.buf[self.head];
        self.head = (self.head + 1) % self.cap;
        self.size -= 1;
        Some(v)
    }
    pub fn pop_back(&mut self) -> Option<u64> {
        if self.size == 0 {
            return None;
        }
        let tail = (self.head + self.size - 1) % self.cap;
        self.size -= 1;
        Some(self.buf[tail])
    }
    pub fn peek_front(&self) -> Option<u64> {
        if self.size == 0 {
            None
        } else {
            Some(self.buf[self.head])
        }
    }
    pub fn peek_back(&self) -> Option<u64> {
        if self.size == 0 {
            None
        } else {
            Some(self.buf[(self.head + self.size - 1) % self.cap])
        }
    }
    pub fn get(&self, idx: usize) -> Option<u64> {
        if idx >= self.size {
            None
        } else {
            Some(self.buf[(self.head + idx) % self.cap])
        }
    }
    pub fn set(&mut self, idx: usize, elem: u64) -> bool {
        if idx >= self.size {
            return false;
        }
        let p = (self.head + idx) % self.cap;
        self.buf[p] = elem;
        true
    }
    pub fn rotate_left(&mut self, n: usize) {
        if self.size == 0 {
            return;
        }
        let n = n % self.size;
        self.head = (self.head + n) % self.cap;
    }
    pub fn rotate_right(&mut self, n: usize) {
        if self.size == 0 {
            return;
        }
        let n = n % self.size;
        self.head = (self.head + self.cap - n) % self.cap;
    }
    pub fn to_vec(&self) -> Vec<u64> {
        (0..self.size).map(|i| self.buf[(self.head + i) % self.cap]).collect()
    }
}
