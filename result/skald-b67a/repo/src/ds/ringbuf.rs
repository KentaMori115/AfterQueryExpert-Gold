//! Fixed-capacity ring buffer over engine values — part of the `ds`
//! subsystem.
//!
//! Unlike [`crate::ds::deque::Deque`], which grows on demand, a ring buffer is
//! created at a capacity it never exceeds. Pushing into a full ring either
//! refuses or overwrites the oldest entry, depending on the policy the ring
//! was built with, which makes it usable as a bounded trace buffer.

use crate::value::Value;

/// What a push into a full ring does.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Overflow {
    /// Refuse the push and leave the ring untouched.
    Reject,
    /// Drop the oldest entry to make room.
    Overwrite,
}

/// The outcome of a push.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PushResult {
    /// The value went in and nothing was displaced.
    Stored,
    /// The value went in and the oldest entry was dropped.
    Evicted,
    /// The ring was full and the policy is [`Overflow::Reject`].
    Rejected,
}

pub struct RingBuf {
    slots: Vec<Value>,
    head: usize,
    len: usize,
    policy: Overflow,
    evicted: u64,
}

impl RingBuf {
    /// Build a ring holding at most `capacity` values. A zero capacity is
    /// legal and rejects or discards every push, depending on the policy.
    pub fn new(capacity: usize, policy: Overflow) -> RingBuf {
        RingBuf {
            slots: vec![Value::Null; capacity],
            head: 0,
            len: 0,
            policy,
            evicted: 0,
        }
    }

    pub fn capacity(&self) -> usize {
        self.slots.len()
    }

    pub fn len(&self) -> usize {
        self.len
    }

    pub fn is_empty(&self) -> bool {
        self.len == 0
    }

    pub fn is_full(&self) -> bool {
        self.len == self.slots.len()
    }

    pub fn policy(&self) -> Overflow {
        self.policy
    }

    /// How many values this ring has dropped to make room since it was built.
    pub fn evicted(&self) -> u64 {
        self.evicted
    }

    fn slot_of(&self, index: usize) -> usize {
        (self.head + index) % self.slots.len()
    }

    /// Append a value at the back.
    pub fn push(&mut self, value: Value) -> PushResult {
        if self.slots.is_empty() {
            if self.policy == Overflow::Reject {
                return PushResult::Rejected;
            }
            self.evicted += 1;
            return PushResult::Evicted;
        }
        if self.is_full() {
            match self.policy {
                Overflow::Reject => return PushResult::Rejected,
                Overflow::Overwrite => {
                    let slot = self.head;
                    self.slots[slot] = value;
                    self.head = (self.head + 1) % self.slots.len();
                    self.evicted += 1;
                    return PushResult::Evicted;
                }
            }
        }
        let slot = self.slot_of(self.len);
        self.slots[slot] = value;
        self.len += 1;
        PushResult::Stored
    }

    /// Remove and return the oldest value.
    pub fn pop(&mut self) -> Option<Value> {
        if self.len == 0 {
            return None;
        }
        let slot = self.head;
        let out = self.slots[slot];
        self.slots[slot] = Value::Null;
        self.head = (self.head + 1) % self.slots.len();
        self.len -= 1;
        Some(out)
    }

    /// The oldest value, without removing it.
    pub fn front(&self) -> Option<Value> {
        if self.len == 0 {
            None
        } else {
            Some(self.slots[self.head])
        }
    }

    /// The newest value, without removing it.
    pub fn back(&self) -> Option<Value> {
        if self.len == 0 {
            None
        } else {
            Some(self.slots[self.slot_of(self.len - 1)])
        }
    }

    /// Value at `index` counting from the oldest.
    pub fn get(&self, index: usize) -> Option<Value> {
        if index >= self.len {
            None
        } else {
            Some(self.slots[self.slot_of(index)])
        }
    }

    /// Forget every value without changing the capacity or the eviction count.
    pub fn clear(&mut self) {
        for slot in self.slots.iter_mut() {
            *slot = Value::Null;
        }
        self.head = 0;
        self.len = 0;
    }

    /// Copy the live contents out, oldest first.
    pub fn to_vec(&self) -> Vec<Value> {
        let mut out = Vec::with_capacity(self.len);
        for i in 0..self.len {
            out.push(self.slots[self.slot_of(i)]);
        }
        out
    }

    /// Drop the `n` oldest values, returning how many actually went.
    pub fn drop_front(&mut self, n: usize) -> usize {
        let take = n.min(self.len);
        for _ in 0..take {
            self.pop();
        }
        take
    }

    /// Rebuild at a new capacity, keeping the newest values that still fit.
    ///
    /// Values dropped by a shrink count as evictions, so the running total
    /// stays a truthful record of what the ring has discarded.
    pub fn resize(&mut self, capacity: usize) {
        let live = self.to_vec();
        let keep = live.len().min(capacity);
        let dropped = live.len() - keep;
        self.slots = vec![Value::Null; capacity];
        self.head = 0;
        self.len = keep;
        for (i, v) in live[live.len() - keep..].iter().enumerate() {
            self.slots[i] = *v;
        }
        self.evicted += dropped as u64;
    }
}
