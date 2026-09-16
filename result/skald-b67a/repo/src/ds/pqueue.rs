//! Binary min-heap priority queue — a faithful port of `ds/pqueue.c`.
//!
//! Elements are `(data: u64, priority: i64)`; smaller priority is served
//! first. Supports O(log n) priority update via linear position lookup.

#[derive(Clone, Copy)]
pub struct PqElem {
    pub data: u64,
    pub priority: i64,
}

pub struct PQueue {
    heap: Vec<PqElem>,
}

impl Default for PQueue {
    fn default() -> Self {
        Self::new(16)
    }
}

impl PQueue {
    pub fn new(initial_cap: usize) -> PQueue {
        PQueue {
            heap: Vec::with_capacity(if initial_cap == 0 { 16 } else { initial_cap }),
        }
    }
    pub fn size(&self) -> usize {
        self.heap.len()
    }
    pub fn is_empty(&self) -> bool {
        self.heap.is_empty()
    }

    fn sift_up(&mut self, mut i: usize) {
        while i > 0 {
            let parent = (i - 1) / 2;
            if self.heap[i].priority < self.heap[parent].priority {
                self.heap.swap(i, parent);
                i = parent;
            } else {
                break;
            }
        }
    }
    fn sift_down(&mut self, mut i: usize) {
        let n = self.heap.len();
        loop {
            let l = 2 * i + 1;
            let r = 2 * i + 2;
            let mut smallest = i;
            if l < n && self.heap[l].priority < self.heap[smallest].priority {
                smallest = l;
            }
            if r < n && self.heap[r].priority < self.heap[smallest].priority {
                smallest = r;
            }
            if smallest == i {
                break;
            }
            self.heap.swap(i, smallest);
            i = smallest;
        }
    }

    pub fn push(&mut self, data: u64, priority: i64) {
        self.heap.push(PqElem { data, priority });
        let last = self.heap.len() - 1;
        self.sift_up(last);
    }
    pub fn pop(&mut self) -> Option<PqElem> {
        if self.heap.is_empty() {
            return None;
        }
        let n = self.heap.len();
        self.heap.swap(0, n - 1);
        let out = self.heap.pop();
        if !self.heap.is_empty() {
            self.sift_down(0);
        }
        out
    }
    pub fn peek(&self) -> Option<PqElem> {
        self.heap.first().copied()
    }
    pub fn update_priority(&mut self, target: u64, new_priority: i64) -> bool {
        for i in 0..self.heap.len() {
            if self.heap[i].data == target {
                let old = self.heap[i].priority;
                self.heap[i].priority = new_priority;
                if new_priority < old {
                    self.sift_up(i);
                } else {
                    self.sift_down(i);
                }
                return true;
            }
        }
        false
    }
    pub fn contains(&self, target: u64) -> bool {
        self.heap.iter().any(|e| e.data == target)
    }
    pub fn to_sorted_vec(&self) -> Vec<PqElem> {
        let mut v = self.heap.clone();
        v.sort_by_key(|e| e.priority);
        v
    }
}
