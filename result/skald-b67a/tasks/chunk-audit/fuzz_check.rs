use skald::bytecode::*;
use skald::verify::*;
use skald::vm::{vm_exec, VmStatus};

fn image(consts: &[(u8, Vec<u8>)], funcs: &[(i16, u8, u8, Vec<u8>)], entry: u16) -> Vec<u8> {
    let mut out = vec![MAGIC_0, MAGIC_1, MAGIC_2, MAGIC_3, VERSION];
    out.extend_from_slice(&(consts.len() as u16).to_le_bytes());
    out.extend_from_slice(&(funcs.len() as u16).to_le_bytes());
    out.extend_from_slice(&entry.to_le_bytes());
    for (tag, payload) in consts {
        out.push(*tag);
        out.extend_from_slice(payload);
    }
    for (name_idx, params, locals, code) in funcs {
        out.extend_from_slice(&name_idx.to_le_bytes());
        out.push(*params);
        out.push(*locals);
        out.extend_from_slice(&(code.len() as u16).to_le_bytes());
        out.extend_from_slice(code);
    }
    out
}

struct Rng(u64);
impl Rng {
    fn next(&mut self) -> u64 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        self.0
    }
    fn below(&mut self, n: u64) -> u64 {
        self.next() % n
    }
}

/// A clean audit must mean the interpreter never reports a structural fault.
#[test]
fn clean_images_never_fault_structurally() {
    let mut rng = Rng(0x2545F4914F6CDD1D);
    let mut clean = 0;
    let mut flawed = 0;
    for _ in 0..40000 {
        let n = 1 + rng.below(12) as usize;
        let mut code = Vec::new();
        for _ in 0..n {
            code.push(rng.below(0x28) as u8);
            for _ in 0..rng.below(4) {
                code.push(rng.below(256) as u8);
            }
        }
        let consts = vec![
            (CONST_INT, 7i64.to_le_bytes().to_vec()),
            (CONST_STRING, {
                let mut v = 3u16.to_le_bytes().to_vec();
                v.extend_from_slice(b"key");
                v
            }),
        ];
        let funcs = vec![
            (-1i16, 0u8, 4u8, code),
            (-1i16, 1u8, 1u8, vec![OP_PUSH_NULL, OP_RETURN]),
        ];
        let data = image(&consts, &funcs, 0);
        let Some(chunk) = chunk_load(&data) else {
            continue;
        };
        let flaws = chunk_verify(&chunk);
        let status = vm_exec(&data);
        if flaws.is_empty() {
            clean += 1;
            assert!(
                !matches!(
                    status,
                    VmStatus::BadOpcode | VmStatus::Undefined | VmStatus::BadFunc
                ),
                "audit found nothing but the vm answered {status:?} for {:?}",
                chunk.funcs[0].code
            );
            assert_ne!(status, VmStatus::StackUnderflow, "underflow in a clean image {:?}", chunk.funcs[0].code);
        } else {
            flawed += 1;
        }
    }
    println!("clean {clean}, flawed {flawed}");
    assert!(clean > 50, "only {clean} clean images, the sample says nothing");
}

/// Build a body out of instructions with sane operands, so the sample is
/// mostly clean rather than mostly noise.
fn sane_body(rng: &mut Rng, len: usize) -> Vec<u8> {
    let mut code: Vec<u8> = Vec::new();
    let ops: [u8; 18] = [
        OP_NOP, OP_PUSH_CONST, OP_PUSH_INT, OP_PUSH_NULL, OP_POP, OP_DUP, OP_LOAD, OP_STORE,
        OP_NEW_OBJ, OP_ARRAY_PUSH, OP_ARRAY_LEN, OP_DICT_SET, OP_CALL, OP_ADD, OP_JMP,
        OP_JMP_FALSE, OP_NEW_CLOSURE, OP_HALT,
    ];
    while code.len() < len {
        let op = ops[rng.below(ops.len() as u64) as usize];
        let here = code.len();
        code.push(op);
        match op {
            OP_PUSH_CONST | OP_DICT_SET => code.extend_from_slice(&(rng.below(2) as u16).to_le_bytes()),
            OP_PUSH_INT => code.extend_from_slice(&(rng.below(50) as i32).to_le_bytes()),
            OP_LOAD | OP_STORE => code.push(rng.below(4) as u8),
            OP_NEW_OBJ => code.push(rng.below(3) as u8),
            OP_CALL => {
                code.extend_from_slice(&1u16.to_le_bytes());
                code.push(1);
            }
            OP_NEW_CLOSURE => {
                code.extend_from_slice(&1u16.to_le_bytes());
                code.push(rng.below(4) as u8);
            }
            OP_JMP | OP_JMP_FALSE => {
                // Land on the start of some earlier instruction, or just past
                // the one that follows.
                let back = (here as i32) - ((code.len() + 2) as i32);
                code.extend_from_slice(&(back as i16).to_le_bytes());
            }
            _ => {}
        }
    }
    code
}

/// A structural fault the interpreter reports must have been reported by the
/// audit as well: the audit reads every path, the interpreter only its own.
#[test]
fn every_structural_fault_the_vm_meets_was_reported() {
    let mut rng = Rng(0x9E3779B97F4A7C15);
    let mut clean = 0;
    let mut caught = 0;
    for _ in 0..40000 {
        let want = 1 + rng.below(24) as usize;
        let mut code = sane_body(&mut rng, want);
        // Mutate a byte a third of the time, which is how a bad image is
        // usually born.
        if rng.below(3) == 0 && !code.is_empty() {
            let at = rng.below(code.len() as u64) as usize;
            code[at] = rng.below(256) as u8;
        }
        let consts = vec![
            (CONST_INT, 7i64.to_le_bytes().to_vec()),
            (CONST_STRING, {
                let mut v = 3u16.to_le_bytes().to_vec();
                v.extend_from_slice(b"key");
                v
            }),
        ];
        let funcs = vec![
            (-1i16, 0u8, 4u8, code),
            (-1i16, 1u8, 1u8, vec![OP_PUSH_NULL, OP_RETURN]),
        ];
        let data = image(&consts, &funcs, 0);
        let Some(chunk) = chunk_load(&data) else { continue };
        let flaws = chunk_verify(&chunk);
        if may_loop(&chunk.funcs[0].code) {
            continue;
        }
        let status = vm_exec(&data);
        let structural = matches!(
            status,
            VmStatus::BadOpcode | VmStatus::Undefined | VmStatus::BadFunc | VmStatus::StackUnderflow
        );
        if flaws.is_empty() {
            clean += 1;
            assert!(!structural, "clean audit, vm said {status:?}: {:?}", chunk.funcs[0].code);
        } else if structural {
            caught += 1;
        }
    }
    println!("clean {clean}, faults caught {caught}");
    assert!(clean > 2000, "only {clean} clean images");
}

/// Widths, duplicated here on purpose: a scratch check should not read the
/// table it is checking.
fn width(op: u8) -> Option<usize> {
    Some(match op {
        0x00..=0x06 => 0,
        0x07..=0x09 => 1,
        0x0A..=0x0C => 0,
        0x0D | 0x0E => 2,
        0x0F => 3,
        0x10 => 0,
        0x11 => 3,
        0x12 => 1,
        0x13..=0x1C => 0,
        0x1D..=0x20 => 2,
        0x21..=0x26 => 0,
        0x02 => 2,
        _ => return None,
    })
}

/// True when the body might not terminate, which is any backward jump.
fn may_loop(code: &[u8]) -> bool {
    let mut pos = 0usize;
    while pos < code.len() {
        let op = code[pos];
        let Some(w) = (if op == 0x02 { Some(2) } else if op == 0x03 { Some(4) } else { width(op) }) else {
            return true;
        };
        if pos + 1 + w > code.len() {
            return true;
        }
        if (0x1D..=0x20).contains(&op) {
            let off = i16::from_le_bytes([code[pos + 1], code[pos + 2]]);
            if off <= 0 {
                return true;
            }
        }
        pos += 1 + w;
    }
    false
}
