//! Instruction decoding — turning a function body into the instructions the
//! interpreter would actually execute.
//!
//! The loader hands back a `Vec<u8>` per function and says nothing about what
//! is in it. Every check in this subsystem needs the same thing first: where
//! each instruction starts and how far it runs. The VM answers that one byte
//! at a time as it executes (`Vm::read_u8` and friends), so the widths here
//! are the same widths the dispatch loop reads, in the same order:
//!
//! ```text
//!   0 bytes   NOP HALT PUSH_NULL POP DUP ARRAY_PUSH ARRAY_GET ARRAY_LEN
//!             RETURN ADD SUB MUL DIV MOD EQ LT LE NOT NEG CONCAT PRINT
//!             TYPE_OF INCREF DECREF GC
//!   1 byte    LOAD STORE NEW_OBJ INVOKE
//!   2 bytes   PUSH_CONST DICT_SET DICT_GET JMP JMP_TRUE JMP_FALSE JMP_NULL
//!   3 bytes   CALL NEW_CLOSURE
//!   4 bytes   PUSH_INT
//! ```
//!
//! A byte outside that set is not an opcode, and an opcode whose operands do
//! not fit in what is left of the body is the end of the readable part: the
//! bytes after it belong to an instruction that was never finished, so calling
//! them code would be a guess.

use crate::bytecode::*;

/// One decoded instruction: the opcode, where its byte sits in the function's
/// code, and how many bytes it occupies including its operands.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Insn {
    pub offset: u16,
    pub op: u8,
    pub len: u16,
}

/// Why a linear walk stopped before the end of a function body.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Stop {
    /// The byte at this offset is not an opcode the interpreter knows.
    Unknown,
    /// The opcode is known but its operands run past the end of the code.
    Truncated,
}

/// A decoded function body.
pub struct Body {
    /// Instructions in the order a linear walk from offset zero meets them.
    pub insns: Vec<Insn>,
    /// `starts[o]` is true when offset `o` begins a decoded instruction. The
    /// vector has one extra entry, for `code.len()`, because falling off the
    /// end of a body is how the interpreter returns from a frame and is
    /// therefore a place a jump may legitimately land.
    pub starts: Vec<bool>,
    /// The offset the walk stopped at, and what stopped it.
    pub stop: Option<(u16, Stop)>,
    /// The body's own bytes, kept so operand readers do not need them passed
    /// alongside every call.
    pub code: Vec<u8>,
}

impl Body {
    /// The unsigned 16-bit operand `n` bytes past an instruction's opcode.
    pub fn u16_at(&self, insn: &Insn, n: u16) -> u16 {
        let p = (insn.offset + 1 + n) as usize;
        self.code[p] as u16 | ((self.code[p + 1] as u16) << 8)
    }

    /// The signed 16-bit operand `n` bytes past an instruction's opcode.
    pub fn i16_at(&self, insn: &Insn, n: u16) -> i16 {
        self.u16_at(insn, n) as i16
    }

    /// The single byte operand `n` bytes past an instruction's opcode.
    pub fn u8_at(&self, insn: &Insn, n: u16) -> u8 {
        self.code[(insn.offset + 1 + n) as usize]
    }

    /// Where the instruction after this one begins.
    pub fn next_offset(&self, insn: &Insn) -> u16 {
        insn.offset + insn.len
    }
}

/// How many operand bytes an opcode carries, or `None` when the byte is not an
/// opcode at all. Mirrors the reads the dispatch loop makes for each case.
pub fn operand_width(op: u8) -> Option<u16> {
    let w = match op {
        OP_NOP | OP_HALT | OP_PUSH_NULL | OP_POP | OP_DUP => 0,
        OP_ARRAY_PUSH | OP_ARRAY_GET | OP_ARRAY_LEN => 0,
        OP_RETURN => 0,
        OP_ADD | OP_SUB | OP_MUL | OP_DIV | OP_MOD => 0,
        OP_EQ | OP_LT | OP_LE | OP_NOT | OP_NEG => 0,
        OP_CONCAT | OP_PRINT | OP_TYPE_OF => 0,
        OP_INCREF | OP_DECREF | OP_GC => 0,
        OP_LOAD | OP_STORE | OP_NEW_OBJ | OP_INVOKE => 1,
        OP_PUSH_CONST | OP_DICT_SET | OP_DICT_GET => 2,
        OP_JMP | OP_JMP_TRUE | OP_JMP_FALSE | OP_JMP_NULL => 2,
        OP_CALL | OP_NEW_CLOSURE => 3,
        OP_PUSH_INT => 4,
        _ => return None,
    };
    Some(w)
}

/// Walk a function body from its first byte, decoding one instruction after
/// another until the bytes run out or a byte cannot be decoded.
pub fn decode(code: &[u8]) -> Body {
    let len = code.len() as u16;
    let mut insns = Vec::new();
    let mut starts = vec![false; code.len() + 1];
    starts[code.len()] = true;
    let mut stop = None;

    let mut pos: u16 = 0;
    while (pos as usize) < code.len() {
        let op = code[pos as usize];
        let Some(width) = operand_width(op) else {
            stop = Some((pos, Stop::Unknown));
            break;
        };
        // An instruction whose operands reach past the last byte is one the
        // interpreter would read as zeroes with a bad-opcode status latched,
        // so nothing after it is code and the walk cannot continue.
        if pos as u32 + 1 + width as u32 > len as u32 {
            stop = Some((pos, Stop::Truncated));
            break;
        }
        starts[pos as usize] = true;
        insns.push(Insn {
            offset: pos,
            op,
            len: 1 + width,
        });
        pos += 1 + width;
    }

    Body {
        insns,
        starts,
        stop,
        code: code.to_vec(),
    }
}

/// True when an offset begins a decoded instruction, or is the one-past-the-end
/// offset a body returns from.
pub fn is_boundary(body: &Body, target: i32) -> bool {
    if target < 0 || target as usize >= body.starts.len() {
        return false;
    }
    body.starts[target as usize]
}
