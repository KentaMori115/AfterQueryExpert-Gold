//! Stack shape — what the value stack holds at each instruction of a function.
//!
//! The interpreter meets a stack fault only on the path it happens to take: a
//! pop below an empty stack answers null with `StackUnderflow` latched, a push
//! past [`VM_STACK_MAX`] stops with `StackOverflow`. Reading the same body
//! ahead of time means following every path instead of one.
//!
//! Each function is read on its own, entered with an empty stack, because a
//! chunk says which functions exist and not which ones call which with what
//! left over. Depths propagate along every edge a body has, so an instruction
//! two branches reach carries both of their depths, and the two disagreeing is
//! itself worth reporting: it means the body's shape depends on which way
//! control went, which is not something a compiler emits on purpose.

use crate::bytecode::*;
use crate::verify::decode::{is_boundary, Body, Insn};
use crate::vm::VM_STACK_MAX;

/// What one instruction does to the depth of the value stack.
enum Effect {
    /// Reads `needs` slots, removes `pops` of them, and leaves `pushes` behind.
    Shape {
        needs: u16,
        pops: u16,
        pushes: u16,
    },
    /// Enters another function with `needs` slots beneath it. A frame returns
    /// by draining the value stack and pushing its result, so whatever the
    /// caller had is gone and the depth afterwards is one.
    Call { needs: u16 },
    /// Control does not continue past this instruction.
    End,
}

fn effect(body: &Body, insn: &Insn) -> Effect {
    let shape = |needs: u16, pops: u16, pushes: u16| Effect::Shape {
        needs,
        pops,
        pushes,
    };
    match insn.op {
        OP_NOP | OP_GC | OP_JMP => shape(0, 0, 0),
        OP_HALT | OP_RETURN => Effect::End,
        OP_PUSH_CONST | OP_PUSH_INT | OP_PUSH_NULL | OP_LOAD => shape(0, 0, 1),
        OP_NEW_OBJ | OP_NEW_CLOSURE => shape(0, 0, 1),
        OP_DUP => shape(1, 0, 1),
        OP_POP | OP_STORE | OP_PRINT | OP_DECREF => shape(1, 1, 0),
        OP_JMP_TRUE | OP_JMP_FALSE | OP_JMP_NULL => shape(1, 1, 0),
        OP_NOT | OP_NEG | OP_ARRAY_LEN | OP_TYPE_OF => shape(1, 1, 1),
        OP_INCREF => shape(1, 0, 0),
        OP_DICT_GET => shape(1, 1, 1),
        // Both of these read the container underneath and leave it there.
        OP_ARRAY_PUSH | OP_DICT_SET => shape(2, 1, 0),
        OP_ARRAY_GET => shape(2, 2, 1),
        OP_ADD | OP_SUB | OP_MUL | OP_DIV | OP_MOD => shape(2, 2, 1),
        OP_EQ | OP_LT | OP_LE | OP_CONCAT => shape(2, 2, 1),
        OP_CALL => Effect::Call {
            needs: body.u8_at(insn, 2) as u16,
        },
        // A closure sits under its arguments, so an invocation reads one slot
        // more than it passes.
        OP_INVOKE => Effect::Call {
            needs: body.u8_at(insn, 0) as u16 + 1,
        },
        _ => shape(0, 0, 0),
    }
}

/// The lowest offset in `body` whose stack shape is wrong, if any is, reading
/// it from the depth its callers leave.
///
/// Reachable depths are collected first and read afterwards, so the answer is
/// the earliest offset in the body rather than the first one some traversal
/// happened to reach.
pub fn first_flaw(body: &Body, entry: u16) -> Option<u16> {
    if body.insns.is_empty() {
        return None;
    }
    let ceiling = VM_STACK_MAX as u16;
    let mut at: Vec<usize> = vec![usize::MAX; body.starts.len()];
    for (i, insn) in body.insns.iter().enumerate() {
        at[insn.offset as usize] = i;
    }

    // reached[i][d] records that instruction i can be entered with depth d.
    let mut reached: Vec<Vec<bool>> = vec![vec![false; ceiling as usize + 1]; body.insns.len()];
    let mut work: Vec<(usize, u16)> = vec![(0, entry)];
    reached[0][entry as usize] = true;

    while let Some((i, depth)) = work.pop() {
        let insn = body.insns[i];
        let go = |work: &mut Vec<(usize, u16)>, reached: &mut Vec<Vec<bool>>, target: i32, d: u16| {
            if !is_boundary(body, target) || d > ceiling {
                return;
            }
            let j = at[target as usize];
            if j == usize::MAX || reached[j][d as usize] {
                return;
            }
            reached[j][d as usize] = true;
            work.push((j, d));
        };
        match effect(body, &insn) {
            Effect::End => {}
            Effect::Call { needs } => {
                if depth >= needs {
                    go(&mut work, &mut reached, body.next_offset(&insn) as i32, 1);
                }
            }
            Effect::Shape {
                needs,
                pops,
                pushes,
            } => {
                if depth < needs {
                    continue;
                }
                let after = depth - pops + pushes;
                if after > ceiling {
                    continue;
                }
                if insn.op != OP_JMP {
                    go(&mut work, &mut reached, body.next_offset(&insn) as i32, after);
                }
                if matches!(
                    insn.op,
                    OP_JMP | OP_JMP_TRUE | OP_JMP_FALSE | OP_JMP_NULL
                ) {
                    let off = body.i16_at(&insn, 0) as i32;
                    go(
                        &mut work,
                        &mut reached,
                        body.next_offset(&insn) as i32 + off,
                        after,
                    );
                }
            }
        }
    }

    for (i, insn) in body.insns.iter().enumerate() {
        let depths: Vec<u16> = (0..=ceiling).filter(|d| reached[i][*d as usize]).collect();
        if depths.is_empty() {
            continue;
        }
        if depths.len() > 1 {
            return Some(insn.offset);
        }
        let depth = depths[0];
        match effect(body, insn) {
            Effect::End => {}
            Effect::Call { needs } => {
                if depth < needs {
                    return Some(insn.offset);
                }
            }
            Effect::Shape {
                needs,
                pops,
                pushes,
            } => {
                if depth < needs || depth - pops + pushes > ceiling {
                    return Some(insn.offset);
                }
            }
        }
    }
    None
}

// ── where a function is entered from ────────────────────────────────────

/// Every `CALL` this body reaches, as (function named, depth the callee is
/// entered with). The value stack is one stack for the whole program, so a
/// callee begins holding whatever the caller had left once its arguments have
/// been taken off.
pub fn call_sites(body: &Body, entry: u16) -> Vec<(u16, u16)> {
    let ceiling = VM_STACK_MAX as u16;
    let mut at: Vec<usize> = vec![usize::MAX; body.starts.len()];
    for (i, insn) in body.insns.iter().enumerate() {
        at[insn.offset as usize] = i;
    }
    if body.insns.is_empty() {
        return Vec::new();
    }
    let mut reached: Vec<Vec<bool>> = vec![vec![false; ceiling as usize + 1]; body.insns.len()];
    let mut work: Vec<(usize, u16)> = vec![(0, entry)];
    reached[0][entry as usize] = true;
    let mut sites: Vec<(u16, u16)> = Vec::new();

    while let Some((i, depth)) = work.pop() {
        let insn = body.insns[i];
        let go = |work: &mut Vec<(usize, u16)>, reached: &mut Vec<Vec<bool>>, target: i32, d: u16| {
            if !is_boundary(body, target) || d > ceiling {
                return;
            }
            let j = at[target as usize];
            if j == usize::MAX || reached[j][d as usize] {
                return;
            }
            reached[j][d as usize] = true;
            work.push((j, d));
        };
        match effect(body, &insn) {
            Effect::End => {}
            Effect::Call { needs } => {
                if depth < needs {
                    continue;
                }
                if insn.op == OP_CALL {
                    sites.push((body.u16_at(&insn, 0), depth - needs));
                }
                go(&mut work, &mut reached, body.next_offset(&insn) as i32, 1);
            }
            Effect::Shape {
                needs,
                pops,
                pushes,
            } => {
                if depth < needs {
                    continue;
                }
                let after = depth - pops + pushes;
                if after > ceiling {
                    continue;
                }
                if insn.op != OP_JMP {
                    go(&mut work, &mut reached, body.next_offset(&insn) as i32, after);
                }
                if matches!(insn.op, OP_JMP | OP_JMP_TRUE | OP_JMP_FALSE | OP_JMP_NULL) {
                    let off = body.i16_at(&insn, 0) as i32;
                    go(
                        &mut work,
                        &mut reached,
                        body.next_offset(&insn) as i32 + off,
                        after,
                    );
                }
            }
        }
    }
    sites.sort_unstable();
    sites.dedup();
    sites
}
