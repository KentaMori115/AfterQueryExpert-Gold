//! Binary bytecode chunk format + loader — a faithful port of `bytecode.c`.
//!
//! A chunk is a little-endian binary blob: a magic/version header, a constant
//! pool, and a function table each carrying a raw bytecode body. The loader
//! validates the header and per-record sizes as it goes; any short read aborts
//! the load.
//!
//! ```text
//!   [0..3]   magic  SKLD
//!   [4]      version
//!   [5..6]   num_constants  (u16 LE)
//!   [7..8]   num_funcs      (u16 LE)
//!   [9..10]  entry_idx      (u16 LE)
//!   constant pool (num_constants entries):
//!     [0] type: 0=INT 1=FLOAT 2=STRING 3=NULL
//!     INT/FLOAT: 8 bytes; STRING: u16 len + bytes; NULL: none
//!   function table (num_funcs entries):
//!     [0..1] name_idx (i16, -1 = anonymous)
//!     [2] param_count  [3] local_count  [4..5] code_len (u16)  [6..] code
//! ```

pub const MAGIC_0: u8 = 0x53; // 'S'
pub const MAGIC_1: u8 = 0x4B; // 'K'
pub const MAGIC_2: u8 = 0x4C; // 'L'
pub const MAGIC_3: u8 = 0x44; // 'D'
pub const VERSION: u8 = 0x01;

pub const CONST_INT: u8 = 0;
pub const CONST_FLOAT: u8 = 1;
pub const CONST_STRING: u8 = 2;
pub const CONST_NULL: u8 = 3;

// ── opcodes ─────────────────────────────────────────────────────────────
pub const OP_NOP: u8 = 0x00;
pub const OP_HALT: u8 = 0x01;
pub const OP_PUSH_CONST: u8 = 0x02;
pub const OP_PUSH_INT: u8 = 0x03;
pub const OP_PUSH_NULL: u8 = 0x04;
pub const OP_POP: u8 = 0x05;
pub const OP_DUP: u8 = 0x06;
pub const OP_LOAD: u8 = 0x07;
pub const OP_STORE: u8 = 0x08;
pub const OP_NEW_OBJ: u8 = 0x09;
pub const OP_ARRAY_PUSH: u8 = 0x0A;
pub const OP_ARRAY_GET: u8 = 0x0B;
pub const OP_ARRAY_LEN: u8 = 0x0C;
pub const OP_DICT_SET: u8 = 0x0D;
pub const OP_DICT_GET: u8 = 0x0E;
pub const OP_CALL: u8 = 0x0F;
pub const OP_RETURN: u8 = 0x10;
pub const OP_NEW_CLOSURE: u8 = 0x11;
pub const OP_INVOKE: u8 = 0x12;
pub const OP_ADD: u8 = 0x13;
pub const OP_SUB: u8 = 0x14;
pub const OP_MUL: u8 = 0x15;
pub const OP_DIV: u8 = 0x16;
pub const OP_MOD: u8 = 0x17;
pub const OP_EQ: u8 = 0x18;
pub const OP_LT: u8 = 0x19;
pub const OP_LE: u8 = 0x1A;
pub const OP_NOT: u8 = 0x1B;
pub const OP_NEG: u8 = 0x1C;
pub const OP_JMP: u8 = 0x1D;
pub const OP_JMP_TRUE: u8 = 0x1E;
pub const OP_JMP_FALSE: u8 = 0x1F;
pub const OP_JMP_NULL: u8 = 0x20;
pub const OP_CONCAT: u8 = 0x21;
pub const OP_PRINT: u8 = 0x22;
pub const OP_TYPE_OF: u8 = 0x23;
pub const OP_INCREF: u8 = 0x24;
pub const OP_DECREF: u8 = 0x25;
pub const OP_GC: u8 = 0x26;

#[derive(Clone)]
pub enum Constant {
    Int(i64),
    Float(f64),
    Str(Vec<u8>),
    Null,
}

#[derive(Clone)]
pub struct FuncDef {
    pub name_idx: i16,
    pub param_count: u8,
    pub local_count: u8,
    pub code: Vec<u8>,
}

pub struct Chunk {
    pub entry_idx: u16,
    pub constants: Vec<Constant>,
    pub funcs: Vec<FuncDef>,
}

/// Byte reader that latches an error flag on any short read, matching the C
/// `Reader` struct's behaviour.
struct Reader<'a> {
    data: &'a [u8],
    pos: usize,
    error: bool,
}

impl<'a> Reader<'a> {
    fn new(data: &'a [u8]) -> Reader<'a> {
        Reader {
            data,
            pos: 0,
            error: false,
        }
    }
    fn u8(&mut self) -> u8 {
        if self.pos >= self.data.len() {
            self.error = true;
            return 0;
        }
        let b = self.data[self.pos];
        self.pos += 1;
        b
    }
    fn u16(&mut self) -> u16 {
        let lo = self.u8() as u16;
        let hi = self.u8() as u16;
        lo | (hi << 8)
    }
    fn i16(&mut self) -> i16 {
        self.u16() as i16
    }
    fn i64(&mut self) -> i64 {
        let mut v: u64 = 0;
        for i in 0..8 {
            v |= (self.u8() as u64) << (i * 8);
        }
        v as i64
    }
    fn f64(&mut self) -> f64 {
        f64::from_bits(self.i64() as u64)
    }
    fn bytes(&mut self, n: usize) -> Option<&'a [u8]> {
        if self.pos + n > self.data.len() {
            self.error = true;
            return None;
        }
        let p = &self.data[self.pos..self.pos + n];
        self.pos += n;
        Some(p)
    }
}

/// Parse a binary chunk. Returns `None` on any malformed or truncated input.
pub fn chunk_load(data: &[u8]) -> Option<Chunk> {
    if data.len() < 11 {
        return None;
    }
    let mut rd = Reader::new(data);

    if rd.u8() != MAGIC_0 || rd.u8() != MAGIC_1 || rd.u8() != MAGIC_2 || rd.u8() != MAGIC_3 {
        return None;
    }
    if rd.u8() != VERSION {
        return None;
    }

    let num_consts = rd.u16();
    let num_funcs = rd.u16();
    let entry_idx = rd.u16();

    if rd.error {
        return None;
    }
    if num_funcs == 0 {
        return None;
    }
    if entry_idx >= num_funcs {
        return None;
    }

    let mut constants: Vec<Constant> = Vec::with_capacity(num_consts as usize);
    for _ in 0..num_consts {
        if rd.error {
            return None;
        }
        let ty = rd.u8();
        let c = match ty {
            CONST_INT => Constant::Int(rd.i64()),
            CONST_FLOAT => Constant::Float(rd.f64()),
            CONST_NULL => Constant::Null,
            CONST_STRING => {
                let slen = rd.u16();
                if slen > 4096 {
                    return None;
                }
                match rd.bytes(slen as usize) {
                    Some(b) => Constant::Str(b.to_vec()),
                    None => return None,
                }
            }
            _ => return None,
        };
        constants.push(c);
    }
    if rd.error {
        return None;
    }

    let mut funcs: Vec<FuncDef> = Vec::with_capacity(num_funcs as usize);
    for _ in 0..num_funcs {
        if rd.error {
            return None;
        }
        let name_idx = rd.i16();
        let param_count = rd.u8();
        let local_count = rd.u8();
        let code_len = rd.u16();

        if param_count > 32 || local_count > 64 {
            return None;
        }
        let code = if code_len > 0 {
            match rd.bytes(code_len as usize) {
                Some(b) => b.to_vec(),
                None => return None,
            }
        } else {
            Vec::new()
        };
        funcs.push(FuncDef {
            name_idx,
            param_count,
            local_count,
            code,
        });
    }
    if rd.error {
        return None;
    }

    Some(Chunk {
        entry_idx,
        constants,
        funcs,
    })
}
