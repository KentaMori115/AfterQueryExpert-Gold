//! Static audit of a loaded chunk, written to the same contract from a
//! different shape: one file, no submodules, a table driven decoder, and a
//! depth walk that keeps its state in a map instead of a matrix. Nothing here
//! shares a private name with the reference.

use crate::bytecode::*;
use crate::vm::VM_STACK_MAX;
use std::collections::{BTreeMap, BTreeSet};


#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FlawKind {
    Opcode,
    Truncated,
    Constant,
    Local,
    Function,
    Arity,
    Jump,
    Depth,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Flaw {
    pub func: u16,
    pub offset: u16,
    pub kind: FlawKind,
}

fn width(op: u8) -> Option<usize> {
    Some(match op {
        OP_LOAD | OP_STORE | OP_NEW_OBJ | OP_INVOKE => 1,
        OP_PUSH_CONST | OP_DICT_SET | OP_DICT_GET => 2,
        OP_JMP | OP_JMP_TRUE | OP_JMP_FALSE | OP_JMP_NULL => 2,
        OP_CALL | OP_NEW_CLOSURE => 3,
        OP_PUSH_INT => 4,
        OP_NOP | OP_HALT | OP_PUSH_NULL | OP_POP | OP_DUP => 0,
        OP_ARRAY_PUSH | OP_ARRAY_GET | OP_ARRAY_LEN | OP_RETURN => 0,
        OP_ADD | OP_SUB | OP_MUL | OP_DIV | OP_MOD | OP_EQ | OP_LT | OP_LE => 0,
        OP_NOT | OP_NEG | OP_CONCAT | OP_PRINT | OP_TYPE_OF => 0,
        OP_INCREF | OP_DECREF | OP_GC => 0,
        _ => return None,
    })
}

/// offset -> length, plus the offset the walk gave up at.
type Walk = (BTreeMap<usize, usize>, Option<(usize, FlawKind)>);

fn walk(code: &[u8]) -> Walk {
    let mut seen = BTreeMap::new();
    let mut at = 0usize;
    while at < code.len() {
        let Some(w) = width(code[at]) else {
            return (seen, Some((at, FlawKind::Opcode)));
        };
        if at + 1 + w > code.len() {
            return (seen, Some((at, FlawKind::Truncated)));
        }
        seen.insert(at, 1 + w);
        at += 1 + w;
    }
    (seen, None)
}

fn u16_at(code: &[u8], at: usize) -> u16 {
    code[at] as u16 | ((code[at + 1] as u16) << 8)
}

fn takes_and_leaves(code: &[u8], at: usize) -> (u16, i32, bool, bool) {
    // (reads, delta, ends the path, resets to one)
    match code[at] {
        OP_HALT | OP_RETURN => (0, 0, true, false),
        OP_PUSH_CONST | OP_PUSH_INT | OP_PUSH_NULL | OP_LOAD => (0, 1, false, false),
        OP_NEW_OBJ | OP_NEW_CLOSURE => (0, 1, false, false),
        OP_DUP => (1, 1, false, false),
        OP_POP | OP_STORE | OP_PRINT | OP_DECREF => (1, -1, false, false),
        OP_JMP_TRUE | OP_JMP_FALSE | OP_JMP_NULL => (1, -1, false, false),
        OP_NOT | OP_NEG | OP_ARRAY_LEN | OP_TYPE_OF | OP_DICT_GET => (1, 0, false, false),
        OP_INCREF => (1, 0, false, false),
        OP_ARRAY_PUSH | OP_DICT_SET => (2, -1, false, false),
        OP_ARRAY_GET => (2, -1, false, false),
        OP_ADD | OP_SUB | OP_MUL | OP_DIV | OP_MOD => (2, -1, false, false),
        OP_EQ | OP_LT | OP_LE | OP_CONCAT => (2, -1, false, false),
        OP_CALL => (code[at + 3] as u16, 0, false, true),
        OP_INVOKE => (code[at + 1] as u16 + 1, 0, false, true),
        _ => (0, 0, false, false),
    }
}

fn stack_flaw(code: &[u8], steps: &BTreeMap<usize, usize>, entry: i32) -> Option<u16> {
    let ceiling = VM_STACK_MAX as i32;
    let mut arrivals: BTreeMap<usize, BTreeSet<i32>> = BTreeMap::new();
    let Some(first) = steps.keys().next().copied() else {
        return None;
    };
    let mut queue = vec![(first, entry)];
    arrivals.entry(first).or_default().insert(entry);
    while let Some((at, depth)) = queue.pop() {
        let Some(len) = steps.get(&at).copied() else {
            continue;
        };
        let (reads, delta, ends, resets) = takes_and_leaves(code, at);
        if ends || depth < reads as i32 {
            continue;
        }
        let after = if resets { 1 } else { depth + delta };
        if after > ceiling {
            continue;
        }
        let mut go = |target: i64, queue: &mut Vec<(usize, i32)>, arrivals: &mut BTreeMap<usize, BTreeSet<i32>>| {
            if target < 0 || target as usize == code.len() {
                return;
            }
            let target = target as usize;
            if !steps.contains_key(&target) {
                return;
            }
            if arrivals.entry(target).or_default().insert(after) {
                queue.push((target, after));
            }
        };
        let next = at + len;
        if code[at] != OP_JMP {
            go(next as i64, &mut queue, &mut arrivals);
        }
        if matches!(code[at], OP_JMP | OP_JMP_TRUE | OP_JMP_FALSE | OP_JMP_NULL) {
            let hop = u16_at(code, at + 1) as i16 as i64;
            go(next as i64 + hop, &mut queue, &mut arrivals);
        }
    }
    for (at, depths) in arrivals.iter() {
        if depths.len() > 1 {
            return Some(*at as u16);
        }
        let depth = *depths.iter().next().unwrap();
        let (reads, delta, ends, resets) = takes_and_leaves(code, *at);
        if ends {
            continue;
        }
        if depth < reads as i32 {
            return Some(*at as u16);
        }
        if !resets && depth + delta > ceiling {
            return Some(*at as u16);
        }
    }
    None
}


/// Slots each frame holds, widened by one wherever a closure names it.
fn slots(chunk: &Chunk, walks: &[Walk]) -> Vec<u16> {
    let mut out: Vec<u16> = chunk
        .funcs
        .iter()
        .map(|f| f.param_count as u16 + f.local_count as u16)
        .collect();
    let mut widened = vec![false; out.len()];
    for (i, (steps, _)) in walks.iter().enumerate() {
        let code = &chunk.funcs[i].code;
        for at in steps.keys() {
            if code[*at] == OP_NEW_CLOSURE {
                let target = u16_at(code, at + 1) as usize;
                if target < widened.len() {
                    widened[target] = true;
                }
            }
        }
    }
    for (i, wide) in widened.into_iter().enumerate() {
        if wide {
            out[i] += 1;
        }
    }
    out
}

/// Every call this body reaches, as (function, depth the callee starts at).
fn reachable_calls(code: &[u8], steps: &BTreeMap<usize, usize>, entry: i32) -> Vec<(usize, i32)> {
    let mut seen: BTreeMap<usize, BTreeSet<i32>> = BTreeMap::new();
    let Some(first) = steps.keys().next().copied() else {
        return Vec::new();
    };
    let mut queue = vec![(first, entry)];
    seen.entry(first).or_default().insert(entry);
    let mut out = Vec::new();
    while let Some((at, depth)) = queue.pop() {
        let Some(len) = steps.get(&at).copied() else { continue };
        let (reads, delta, ends, resets) = takes_and_leaves(code, at);
        if ends || depth < reads as i32 {
            continue;
        }
        if code[at] == OP_CALL {
            out.push((u16_at(code, at + 1) as usize, depth - reads as i32));
        }
        let after = if resets { 1 } else { depth + delta };
        if after > VM_STACK_MAX as i32 {
            continue;
        }
        let mut hand = |target: i64, queue: &mut Vec<(usize, i32)>, seen: &mut BTreeMap<usize, BTreeSet<i32>>| {
            if target < 0 || !steps.contains_key(&(target as usize)) {
                return;
            }
            if seen.entry(target as usize).or_default().insert(after) {
                queue.push((target as usize, after));
            }
        };
        let next = at + len;
        if code[at] != OP_JMP {
            hand(next as i64, &mut queue, &mut seen);
        }
        if matches!(code[at], OP_JMP | OP_JMP_TRUE | OP_JMP_FALSE | OP_JMP_NULL) {
            let hop = u16_at(code, at + 1) as i16 as i64;
            hand(next as i64 + hop, &mut queue, &mut seen);
        }
    }
    out.sort_unstable();
    out.dedup();
    out
}

/// The depth every function starts from, or `None` where calls disagree.
fn starting_depths(chunk: &Chunk, walks: &[Walk]) -> Vec<Option<i32>> {
    let count = chunk.funcs.len();
    let mut named = vec![false; count];
    for (i, (steps, _)) in walks.iter().enumerate() {
        let code = &chunk.funcs[i].code;
        for at in steps.keys() {
            if code[*at] == OP_CALL {
                let target = u16_at(code, at + 1) as usize;
                if target < count {
                    named[target] = true;
                }
            }
        }
    }
    let mut found: Vec<BTreeSet<i32>> = vec![BTreeSet::new(); count];
    found[chunk.entry_idx as usize].insert(0);
    for (i, is_named) in named.iter().enumerate() {
        if !is_named {
            found[i].insert(0);
        }
    }
    loop {
        loop {
            let mut moved = false;
            for i in 0..count {
                if found[i].len() != 1 || walks[i].1.is_some() {
                    continue;
                }
                let from = *found[i].iter().next().unwrap();
                for (target, depth) in reachable_calls(&chunk.funcs[i].code, &walks[i].0, from) {
                    if target < count && found[target].insert(depth) {
                        moved = true;
                    }
                }
            }
            if !moved {
                break;
            }
        }
        let stranded: Vec<usize> = (0..count).filter(|i| found[*i].is_empty()).collect();
        if stranded.is_empty() {
            break;
        }
        for i in stranded {
            found[i].insert(0);
        }
    }
    found
        .into_iter()
        .map(|set| if set.len() == 1 { Some(*set.iter().next().unwrap()) } else { None })
        .collect()
}

/// Audit every function of a loaded chunk.
pub fn chunk_verify(chunk: &Chunk) -> Vec<Flaw> {
    let walks: Vec<Walk> = chunk.funcs.iter().map(|f| walk(&f.code)).collect();
    let room = slots(chunk, &walks);
    let starts = starting_depths(chunk, &walks);
    let mut out = Vec::new();
    for (i, (steps, stopped)) in walks.iter().enumerate() {
        let code = &chunk.funcs[i].code;
        let mut here: Vec<Flaw> = Vec::new();
        let mut note = |at: usize, kind: FlawKind, here: &mut Vec<Flaw>| {
            here.push(Flaw {
                func: i as u16,
                offset: at as u16,
                kind,
            })
        };
        for (at, len) in steps.iter() {
            let at = *at;
            match code[at] {
                OP_NEW_OBJ if code[at + 1] > 2 => note(at, FlawKind::Opcode, &mut here),
                OP_PUSH_CONST if u16_at(code, at + 1) as usize >= chunk.constants.len() => {
                    note(at, FlawKind::Constant, &mut here)
                }
                OP_DICT_SET | OP_DICT_GET => {
                    let key = u16_at(code, at + 1) as usize;
                    if !matches!(chunk.constants.get(key), Some(Constant::Str(_))) {
                        note(at, FlawKind::Constant, &mut here);
                    }
                }
                OP_LOAD | OP_STORE if code[at + 1] as u16 >= room[i] => {
                    note(at, FlawKind::Local, &mut here)
                }
                OP_NEW_CLOSURE => {
                    if code[at + 3] as u16 >= room[i] {
                        note(at, FlawKind::Local, &mut here);
                    } else if u16_at(code, at + 1) as usize >= chunk.funcs.len() {
                        note(at, FlawKind::Function, &mut here);
                    }
                }
                OP_CALL => match chunk.funcs.get(u16_at(code, at + 1) as usize) {
                    None => note(at, FlawKind::Function, &mut here),
                    Some(callee) if code[at + 3] != callee.param_count => {
                        note(at, FlawKind::Arity, &mut here)
                    }
                    Some(_) => {}
                },
                OP_JMP | OP_JMP_TRUE | OP_JMP_FALSE | OP_JMP_NULL => {
                    let hop = u16_at(code, at + 1) as i16 as i64;
                    let target = (at + len) as i64 + hop;
                    let ok = target >= 0
                        && (target as usize == code.len()
                            || steps.contains_key(&(target as usize)));
                    if !ok {
                        note(at, FlawKind::Jump, &mut here);
                    }
                }
                _ => {}
            }
        }
        match stopped {
            Some((at, kind)) => note(*at, *kind, &mut here),
            None => {
                // A stack flaw is the last kind taken, so an offset that has
                // already answered keeps the answer it gave.
                let at = match starts[i] {
                    None => Some(0),
                    Some(entry) => stack_flaw(code, steps, entry).map(|o| o as usize),
                };
                if let Some(at) = at {
                    if !here.iter().any(|f: &Flaw| f.offset == at as u16) {
                        note(at, FlawKind::Depth, &mut here);
                    }
                }
            }
        }
        here.sort_by_key(|f| f.offset);
        out.extend(here);
    }
    out
}
