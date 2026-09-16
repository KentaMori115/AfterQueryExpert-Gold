//! Region / arena allocator — a faithful port of `util/arena.c`.
//!
//! Owns a list of blocks; allocation is O(1) bump-pointer. Individual
//! allocations cannot be freed — the whole arena (or a saved checkpoint) is
//! rewound at once. This Rust port models the same bump/checkpoint semantics
//! over owned byte blocks (returning offsets rather than raw pointers).

pub struct Arena {
    blocks: Vec<Vec<u8>>,
    default_block: usize,
    next_block_sz: usize,
    total_allocated: usize,
}

#[derive(Clone, Copy)]
pub struct ArenaCheckpoint {
    block: usize,
    used: usize,
    total: usize,
}

/// A location within the arena: which block, and the offset inside it.
#[derive(Clone, Copy)]
pub struct ArenaRef {
    pub block: usize,
    pub offset: usize,
    pub len: usize,
}

fn align_up(n: usize, align: usize) -> usize {
    (n + align - 1) & !(align - 1)
}

impl Arena {
    pub fn new(initial_block_size: usize) -> Arena {
        let sz = initial_block_size.max(64);
        Arena {
            blocks: vec![Vec::with_capacity(sz)],
            default_block: sz,
            next_block_sz: sz * 2,
            total_allocated: 0,
        }
    }

    fn cur(&self) -> usize {
        self.blocks.len() - 1
    }

    pub fn alloc(&mut self, size: usize) -> ArenaRef {
        self.push_align(size, 8)
    }

    pub fn alloc_zeroed(&mut self, size: usize) -> ArenaRef {
        let r = self.push_align(size, 8);
        for i in 0..size {
            self.blocks[r.block][r.offset + i] = 0;
        }
        r
    }

    pub fn push_align(&mut self, size: usize, align: usize) -> ArenaRef {
        let align = if align == 0 { 1 } else { align };
        let cur = self.cur();
        let used = self.blocks[cur].len();
        let aligned = align_up(used, align);
        if aligned + size > self.blocks[cur].capacity() {
            let block_sz = self.next_block_sz.max(size + align);
            self.blocks.push(Vec::with_capacity(block_sz));
            self.next_block_sz *= 2;
            return self.push_align(size, align);
        }
        let cur = self.cur();
        // pad to alignment
        while self.blocks[cur].len() < aligned {
            self.blocks[cur].push(0);
        }
        let offset = self.blocks[cur].len();
        for _ in 0..size {
            self.blocks[cur].push(0);
        }
        self.total_allocated += size;
        ArenaRef {
            block: cur,
            offset,
            len: size,
        }
    }

    pub fn strdup(&mut self, s: &[u8]) -> ArenaRef {
        let r = self.push_align(s.len() + 1, 1);
        let cur = r.block;
        for (i, &b) in s.iter().enumerate() {
            self.blocks[cur][r.offset + i] = b;
        }
        self.blocks[cur][r.offset + s.len()] = 0;
        r
    }

    pub fn write(&mut self, r: ArenaRef, data: &[u8]) {
        let n = data.len().min(r.len);
        for i in 0..n {
            self.blocks[r.block][r.offset + i] = data[i];
        }
    }
    pub fn read(&self, r: ArenaRef) -> &[u8] {
        &self.blocks[r.block][r.offset..r.offset + r.len]
    }

    pub fn checkpoint(&self) -> ArenaCheckpoint {
        let cur = self.cur();
        ArenaCheckpoint {
            block: cur,
            used: self.blocks[cur].len(),
            total: self.total_allocated,
        }
    }

    pub fn restore(&mut self, cp: ArenaCheckpoint) {
        self.blocks.truncate(cp.block + 1);
        self.blocks[cp.block].truncate(cp.used);
        self.total_allocated = cp.total;
    }

    pub fn reset(&mut self) {
        let first = std::mem::take(&mut self.blocks[0]);
        self.blocks.clear();
        let mut first = first;
        first.clear();
        self.blocks.push(first);
        self.total_allocated = 0;
        self.next_block_sz = self.default_block * 2;
    }

    pub fn usage(&self) -> usize {
        self.total_allocated
    }
    pub fn capacity(&self) -> usize {
        self.blocks.iter().map(|b| b.capacity()).sum()
    }
    pub fn num_blocks(&self) -> usize {
        self.blocks.len()
    }
}
