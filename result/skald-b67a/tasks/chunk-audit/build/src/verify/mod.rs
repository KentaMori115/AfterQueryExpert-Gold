//! Static audit of a loaded chunk — the reading the loader does not do.
//!
//! [`chunk_load`](crate::bytecode::chunk_load) reads a chunk's shape: magic,
//! version, the constant pool, and one descriptor per function. It never looks
//! at the code those descriptors carry, so an image that loads cleanly can
//! still hold a byte that is not an opcode, a jump landing between two
//! instructions, a call passing three arguments to a function that declares
//! two, or a body whose stack shape depends on which branch ran. The
//! interpreter meets those one at a time, at run time, on whichever path
//! happens to reach them, and reports a status without saying where.
//!
//! [`chunk_verify`] reads the whole image instead, before anything runs, and
//! reports what it finds as a list of [`Flaw`]s.

mod decode;
mod depth;

use crate::bytecode::*;
use decode::{is_boundary, Body, Insn, Stop};
use std::collections::BTreeSet;

/// What is wrong at one place in a chunk.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FlawKind {
    /// The byte is not an opcode the interpreter knows.
    Opcode,
    /// The opcode's operands run past the end of the function's code.
    Truncated,
    /// A constant index reaches past the pool, or a dictionary key index names
    /// a constant that is not a string.
    Constant,
    /// A local slot at or past the count the frame will hold.
    Local,
    /// A function index reaching past the function table.
    Function,
    /// A call passing a number of arguments the callee does not declare.
    Arity,
    /// A jump landing outside the body, or between two instructions.
    Jump,
    /// The value stack under- or overflows, or two paths reach one instruction
    /// with different depths.
    Depth,
}

/// One thing the audit found, at one instruction of one function.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Flaw {
    /// Index of the function in the chunk's function table.
    pub func: u16,
    /// Offset of the opcode byte inside that function's code.
    pub offset: u16,
    pub kind: FlawKind,
}

/// How many local slots a frame for `func` will hold.
///
/// A frame carries its parameters and its declared locals, and one slot more
/// when it is entered through a closure, because the captured value lands in
/// slot zero and pushes everything else up. So the ceiling a `LOAD` has to
/// respect depends on whether any function in the chunk makes a closure over
/// this one, which is a fact about the whole image rather than about the body
/// being read.
fn slot_counts(chunk: &Chunk, bodies: &[Body]) -> Vec<u16> {
    let mut captured = vec![false; chunk.funcs.len()];
    for body in bodies {
        for insn in &body.insns {
            if insn.op != OP_NEW_CLOSURE {
                continue;
            }
            let target = body.u16_at(insn, 0) as usize;
            if target < captured.len() {
                captured[target] = true;
            }
        }
    }
    chunk
        .funcs
        .iter()
        .zip(captured)
        .map(|(f, over)| f.param_count as u16 + f.local_count as u16 + u16::from(over))
        .collect()
}

/// The constant at `idx`, if the pool holds one there.
fn constant<'a>(chunk: &'a Chunk, idx: u16) -> Option<&'a Constant> {
    chunk.constants.get(idx as usize)
}


/// The depth a function's frame is entered with.
enum Entry {
    /// Every call that reaches it leaves the stack the same height.
    At(u16),
    /// Two calls reach it holding different amounts.
    Conflict,
}

/// Work out what each function is entered holding.
///
/// The value stack belongs to the program rather than to a frame: entering a
/// function takes its arguments off whatever the caller had, and leaves the
/// rest where it was. So a body cannot be read on its own, and what a call
/// site leaves depends on reading the caller first, which is why this settles
/// by iteration rather than in one pass.
///
/// A function no reachable call names is read from an empty stack, which is
/// what the interpreter does with the entry function and the only reading
/// available for one nothing arrives at.
fn entry_depths(chunk: &Chunk, bodies: &[Body]) -> Vec<Entry> {
    let count = chunk.funcs.len();
    let mut depths: Vec<BTreeSet<u16>> = vec![BTreeSet::new(); count];
    let mut called = vec![false; count];
    for body in bodies {
        for insn in &body.insns {
            if insn.op == OP_CALL {
                let target = body.u16_at(insn, 0) as usize;
                if target < count {
                    called[target] = true;
                }
            }
        }
    }
    depths[chunk.entry_idx as usize].insert(0);
    for (func, names) in called.iter().enumerate() {
        if !names {
            depths[func].insert(0);
        }
    }

    loop {
        loop {
            let mut moved = false;
            for func in 0..count {
                if depths[func].len() != 1 || bodies[func].stop.is_some() {
                    continue;
                }
                let from = *depths[func].iter().next().unwrap();
                for (target, entry) in depth::call_sites(&bodies[func], from) {
                    let target = target as usize;
                    if target < count && depths[target].insert(entry) {
                        moved = true;
                    }
                }
            }
            if !moved {
                break;
            }
        }
        // A function only ever called from code nothing reaches has no depth
        // to inherit. Every one of those is read from empty, together, so the
        // answer does not depend on which was looked at first.
        let stranded: Vec<usize> = (0..count).filter(|f| depths[*f].is_empty()).collect();
        if stranded.is_empty() {
            break;
        }
        for func in stranded {
            depths[func].insert(0);
        }
    }

    depths
        .into_iter()
        .map(|set| {
            if set.len() == 1 {
                Entry::At(*set.iter().next().unwrap())
            } else {
                Entry::Conflict
            }
        })
        .collect()
}

/// The checks that read one decoded instruction, in the order the audit takes
/// them. The first that answers is the one reported, so a call naming a
/// function that does not exist is a `Function` flaw and its argument count is
/// never weighed against a callee there is no way to find.
fn instruction_flaw(
    chunk: &Chunk,
    slots: &[u16],
    body: &Body,
    func: usize,
    insn: &Insn,
) -> Option<FlawKind> {
    match insn.op {
        OP_PUSH_CONST => {
            if constant(chunk, body.u16_at(insn, 0)).is_none() {
                return Some(FlawKind::Constant);
            }
        }
        OP_DICT_SET | OP_DICT_GET => {
            match constant(chunk, body.u16_at(insn, 0)) {
                Some(Constant::Str(_)) => {}
                _ => return Some(FlawKind::Constant),
            }
        }
        OP_LOAD | OP_STORE => {
            if body.u8_at(insn, 0) as u16 >= slots[func] {
                return Some(FlawKind::Local);
            }
        }
        OP_NEW_CLOSURE => {
            if body.u8_at(insn, 2) as u16 >= slots[func] {
                return Some(FlawKind::Local);
            }
            if body.u16_at(insn, 0) as usize >= chunk.funcs.len() {
                return Some(FlawKind::Function);
            }
        }
        OP_CALL => {
            let target = body.u16_at(insn, 0) as usize;
            let Some(callee) = chunk.funcs.get(target) else {
                return Some(FlawKind::Function);
            };
            if body.u8_at(insn, 2) != callee.param_count {
                return Some(FlawKind::Arity);
            }
        }
        OP_JMP | OP_JMP_TRUE | OP_JMP_FALSE | OP_JMP_NULL => {
            // Offsets are relative to the instruction after the jump, which is
            // where the interpreter's instruction pointer sits once it has read
            // the operand.
            let target = body.next_offset(insn) as i32 + body.i16_at(insn, 0) as i32;
            if !is_boundary(body, target) {
                return Some(FlawKind::Jump);
            }
        }
        _ => {}
    }
    None
}

/// Audit every function of a loaded chunk.
///
/// Flaws come out ordered by function index, and by offset within a function.
/// That is a report order, not the order the checks run in: instructions are
/// read one at a time from the first byte forward, while the stack shape of a
/// body is only known once the whole body has been walked, so a flaw belonging
/// to the first instruction can be the last one found.
///
/// A body is read from its first byte: an unknown or truncated instruction
/// ends that body's walk, because nothing after it can be known to be code,
/// and the stack shape of a body that stopped is not read at all. Everything
/// else is read whether execution could reach it or not, dead code included,
/// with one exception: an instruction no path arrives at has no depth to
/// disagree about, so it is only the stack reading that skips it.
pub fn chunk_verify(chunk: &Chunk) -> Vec<Flaw> {
    let bodies: Vec<Body> = chunk.funcs.iter().map(|f| decode::decode(&f.code)).collect();
    let slots = slot_counts(chunk, &bodies);
    let entries = entry_depths(chunk, &bodies);
    let mut flaws = Vec::new();

    for (func, body) in bodies.iter().enumerate() {
        let mut found: Vec<Flaw> = Vec::new();
        for insn in &body.insns {
            if let Some(kind) = instruction_flaw(chunk, &slots, body, func, insn) {
                found.push(Flaw {
                    func: func as u16,
                    offset: insn.offset,
                    kind,
                });
            }
        }
        match body.stop {
            Some((offset, stop)) => found.push(Flaw {
                func: func as u16,
                offset,
                kind: match stop {
                    Stop::Unknown => FlawKind::Opcode,
                    Stop::Truncated => FlawKind::Truncated,
                },
            }),
            // `Depth` comes last in the order the checks are taken, so where
            // the offset it lands on already carries an instruction's flaw,
            // that one is what the instruction reports.
            None => {
                if let Some(offset) = entry_flaw(body, &entries[func]) {
                    if !found.iter().any(|f| f.offset == offset) {
                        found.push(Flaw {
                            func: func as u16,
                            offset,
                            kind: FlawKind::Depth,
                        });
                    }
                }
            }
        }
        found.sort_by_key(|f| f.offset);
        flaws.extend(found);
    }
    flaws
}

/// The depth flaw a body carries, if it has one. A function two calls reach
/// holding different amounts is reported at its first byte, which is as early
/// as an offset goes, so nothing inside it can come first.
fn entry_flaw(body: &Body, entry: &Entry) -> Option<u16> {
    match entry {
        Entry::Conflict => Some(0),
        Entry::At(depth) => depth::first_flaw(body, *depth),
    }
}

/// True when an audit found nothing to report.
pub fn chunk_is_clean(chunk: &Chunk) -> bool {
    chunk_verify(chunk).is_empty()
}

/// Load a chunk and audit it in one step, for a host holding bytes rather than
/// a parsed image. `None` means the bytes are not a chunk at all, which is the
/// loader's answer and not the audit's.
pub fn verify_bytes(data: &[u8]) -> Option<Vec<Flaw>> {
    chunk_load(data).map(|chunk| chunk_verify(&chunk))
}

impl FlawKind {
    /// The one-word name this kind renders under.
    pub fn label(&self) -> &'static str {
        match self {
            FlawKind::Opcode => "opcode",
            FlawKind::Truncated => "truncated",
            FlawKind::Constant => "constant",
            FlawKind::Local => "local",
            FlawKind::Function => "function",
            FlawKind::Arity => "arity",
            FlawKind::Jump => "jump",
            FlawKind::Depth => "depth",
        }
    }
}

impl std::fmt::Display for FlawKind {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.label())
    }
}

impl std::fmt::Display for Flaw {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{} {} {}", self.func, self.offset, self.kind)
    }
}

/// One line per flaw, in the order [`chunk_verify`] returns them.
pub fn render(flaws: &[Flaw]) -> String {
    let mut out = String::new();
    for flaw in flaws {
        out.push_str(&flaw.to_string());
        out.push('\n');
    }
    out
}
