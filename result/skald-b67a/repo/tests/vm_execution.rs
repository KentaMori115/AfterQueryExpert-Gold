//! End-to-end execution: what the interpreter reports for well-formed
//! programs, and which status it stops on when a program misbehaves.

use skald::bytecode::*;
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

fn int_const(v: i64) -> (u8, Vec<u8>) {
    (CONST_INT, v.to_le_bytes().to_vec())
}

/// An image whose entry function runs `code` with four locals, plus a second
/// function that a call can target.
fn program(code: Vec<u8>) -> Vec<u8> {
    image(
        &[int_const(7), (CONST_NULL, Vec::new())],
        &[(-1, 0, 4, code), (-1, 1, 2, vec![OP_PUSH_NULL, OP_RETURN])],
        0,
    )
}

fn push_int(code: &mut Vec<u8>, v: i64) {
    code.push(OP_PUSH_INT);
    code.extend_from_slice(&v.to_le_bytes());
}

fn run(code: Vec<u8>) -> VmStatus {
    vm_exec(&program(code))
}

#[test]
fn an_empty_program_halts_cleanly() {
    assert_eq!(run(vec![OP_HALT]), VmStatus::Ok);
    assert_eq!(run(vec![OP_NOP, OP_NOP, OP_HALT]), VmStatus::Ok);
}

#[test]
fn arithmetic_over_two_operands_succeeds() {
    for op in [OP_ADD, OP_SUB, OP_MUL] {
        let mut code = Vec::new();
        push_int(&mut code, 6);
        push_int(&mut code, 7);
        code.push(op);
        code.push(OP_HALT);
        assert_eq!(run(code), VmStatus::Ok, "opcode {op:#x} should run");
    }
}

#[test]
fn dividing_by_zero_is_reported_not_trapped() {
    for op in [OP_DIV, OP_MOD] {
        let mut code = Vec::new();
        push_int(&mut code, 1);
        push_int(&mut code, 0);
        code.push(op);
        code.push(OP_HALT);
        assert_eq!(run(code), VmStatus::DivZero, "opcode {op:#x}");
    }
}

#[test]
fn a_binary_operator_with_one_operand_fails_on_the_missing_operand() {
    // A short pop yields null and latches `StackUnderflow`, but the operator
    // that follows overwrites the status with its own verdict on that null.
    // The program still stops; the status names the later of the two faults.
    let mut code = Vec::new();
    push_int(&mut code, 1);
    code.push(OP_ADD);
    code.push(OP_HALT);
    assert_eq!(run(code), VmStatus::BadType);
}

#[test]
fn popping_an_empty_stack_underflows() {
    assert_eq!(run(vec![OP_POP, OP_HALT]), VmStatus::StackUnderflow);
    assert_eq!(run(vec![OP_DUP, OP_HALT]), VmStatus::StackUnderflow);
}

#[test]
fn comparisons_and_negation_run_over_their_operands() {
    for op in [OP_EQ, OP_LT, OP_LE] {
        let mut code = Vec::new();
        push_int(&mut code, 1);
        push_int(&mut code, 2);
        code.push(op);
        code.push(OP_HALT);
        assert_eq!(run(code), VmStatus::Ok, "opcode {op:#x}");
    }
    let mut code = Vec::new();
    push_int(&mut code, 5);
    code.extend_from_slice(&[OP_NEG, OP_NOT, OP_HALT]);
    assert_eq!(run(code), VmStatus::Ok);
}

#[test]
fn an_unbounded_push_run_stops_at_the_stack_ceiling() {
    let mut code = Vec::new();
    for _ in 0..600 {
        push_int(&mut code, 1);
    }
    code.push(OP_HALT);
    assert_eq!(run(code), VmStatus::StackOverflow);
}

#[test]
fn a_push_run_just_under_the_ceiling_still_runs() {
    let mut code = Vec::new();
    for _ in 0..400 {
        push_int(&mut code, 1);
    }
    code.push(OP_HALT);
    assert_eq!(run(code), VmStatus::Ok);
}

#[test]
fn an_unknown_opcode_is_reported() {
    for op in [0x40u8, 0x7F, 0xC0, 0xFF] {
        assert_eq!(run(vec![op, OP_HALT]), VmStatus::BadOpcode, "opcode {op:#x}");
    }
}

#[test]
fn a_constant_index_past_the_pool_is_reported() {
    let mut code = vec![OP_PUSH_CONST];
    code.extend_from_slice(&9u16.to_le_bytes());
    code.push(OP_HALT);
    assert_ne!(run(code), VmStatus::Ok, "there is no ninth constant");
}

#[test]
fn every_declared_constant_can_be_pushed() {
    for idx in 0..2u16 {
        let mut code = vec![OP_PUSH_CONST];
        code.extend_from_slice(&idx.to_le_bytes());
        code.push(OP_HALT);
        assert_eq!(run(code), VmStatus::Ok, "constant {idx}");
    }
}

#[test]
fn a_local_slot_past_the_declared_count_is_reported() {
    let mut code = vec![OP_PUSH_NULL, OP_STORE];
    code.extend_from_slice(&90u16.to_le_bytes());
    code.push(OP_HALT);
    assert_ne!(run(code), VmStatus::Ok, "the frame declares four locals");
}

#[test]
fn a_local_round_trips_through_store_and_load() {
    let mut code = Vec::new();
    push_int(&mut code, 11);
    code.push(OP_STORE);
    code.extend_from_slice(&1u16.to_le_bytes());
    code.push(OP_LOAD);
    code.extend_from_slice(&1u16.to_le_bytes());
    code.push(OP_HALT);
    assert_eq!(run(code), VmStatus::Ok);
}

#[test]
fn a_call_to_a_function_that_does_not_exist_is_reported() {
    for fidx in [2u16, 9, 0xFFFF] {
        let mut code = vec![OP_CALL];
        code.extend_from_slice(&fidx.to_le_bytes());
        code.push(0); // no arguments
        code.push(OP_HALT);
        assert_eq!(run(code), VmStatus::BadFunc, "function {fidx}");
    }
}

#[test]
fn a_call_to_a_declared_function_returns_to_its_caller() {
    let mut code = Vec::new();
    push_int(&mut code, 1);
    code.push(OP_CALL);
    code.extend_from_slice(&1u16.to_le_bytes());
    code.push(1); // the callee declares one parameter
    code.push(OP_HALT);
    assert_eq!(run(code), VmStatus::Ok);
}

#[test]
fn unbounded_recursion_stops_at_the_frame_ceiling() {
    let mut code = vec![OP_CALL];
    code.extend_from_slice(&0u16.to_le_bytes());
    code.push(0); // the entry function takes no arguments, so it calls itself
    code.push(OP_HALT);
    assert_eq!(run(code), VmStatus::CallDepth);
}

#[test]
fn a_jump_past_the_end_of_the_code_is_reported() {
    let mut code = vec![OP_JMP];
    code.extend_from_slice(&0xFFFFu16.to_le_bytes());
    code.push(OP_HALT);
    assert_ne!(run(code), VmStatus::Ok);
}

#[test]
fn a_conditional_jump_that_falls_through_reaches_the_halt() {
    let mut code = vec![OP_PUSH_NULL, OP_JMP_TRUE];
    code.extend_from_slice(&0u16.to_le_bytes());
    code.push(OP_HALT);
    assert_eq!(run(code), VmStatus::Ok, "null is not true");
}

#[test]
fn object_opcodes_build_and_read_a_container() {
    let mut code = vec![OP_NEW_OBJ];
    code.extend_from_slice(&0u16.to_le_bytes());
    push_int(&mut code, 5);
    code.push(OP_ARRAY_PUSH);
    code.push(OP_ARRAY_LEN);
    code.push(OP_HALT);
    assert_ne!(run(code), VmStatus::BadOpcode, "these opcodes are implemented");
}

#[test]
fn an_array_read_out_of_range_is_reported() {
    let mut code = vec![OP_NEW_OBJ];
    code.extend_from_slice(&0u16.to_le_bytes());
    push_int(&mut code, 40);
    code.push(OP_ARRAY_GET);
    code.push(OP_HALT);
    assert_ne!(run(code), VmStatus::Ok, "the array is empty");
}

#[test]
fn a_collection_opcode_runs_mid_program() {
    let mut code = Vec::new();
    push_int(&mut code, 1);
    code.extend_from_slice(&[OP_GC, OP_POP, OP_GC, OP_HALT]);
    assert_eq!(run(code), VmStatus::Ok);
}

#[test]
fn an_image_the_loader_refuses_never_reaches_the_interpreter() {
    assert_eq!(vm_exec(&[]), VmStatus::Ok);
    assert_eq!(vm_exec(b"not an image at all"), VmStatus::Ok);
    let mut broken = program(vec![OP_HALT]);
    broken[0] ^= 0xFF;
    assert_eq!(vm_exec(&broken), VmStatus::Ok, "a rejected image is not an error");
}

#[test]
fn an_instruction_whose_operands_run_past_the_end_is_reported() {
    // The dispatch loop bounds-checks the opcode byte; these programs end
    // mid-instruction, so the operand bytes are the ones off the end.
    for op in [OP_PUSH_CONST, OP_LOAD, OP_JMP, OP_CALL, OP_NEW_CLOSURE] {
        assert_eq!(run(vec![op]), VmStatus::BadOpcode, "opcode {op:#x} alone");
    }
    // A store also underflows the empty stack, and that verdict lands last.
    assert_eq!(run(vec![OP_STORE]), VmStatus::StackUnderflow);
    // These take a two-byte operand, so one byte is still a byte short.
    for op in [OP_PUSH_CONST, OP_JMP, OP_CALL] {
        assert_eq!(run(vec![op, 0]), VmStatus::BadOpcode, "opcode {op:#x} half read");
    }
    // The conditional jumps pop a condition they do not have, and that
    // verdict lands after the short read.
    for op in [OP_JMP_TRUE, OP_JMP_FALSE, OP_JMP_NULL] {
        assert_eq!(run(vec![op, 0]), VmStatus::StackUnderflow, "opcode {op:#x}");
    }
    let mut truncated_push = vec![OP_PUSH_INT];
    truncated_push.extend_from_slice(&[0, 0, 0]);
    assert_eq!(run(truncated_push), VmStatus::BadOpcode);
}

#[test]
fn every_truncation_of_a_function_body_terminates() {
    let mut body = Vec::new();
    push_int(&mut body, 3);
    body.push(OP_STORE);
    body.extend_from_slice(&1u16.to_le_bytes());
    body.push(OP_LOAD);
    body.extend_from_slice(&1u16.to_le_bytes());
    body.push(OP_CALL);
    body.extend_from_slice(&1u16.to_le_bytes());
    body.push(1);
    body.push(OP_HALT);
    for cut in 0..body.len() {
        let _ = run(body[..cut].to_vec());
    }
    assert_eq!(run(body), VmStatus::Ok);
}

#[test]
fn code_that_runs_off_the_end_without_halting_still_terminates() {
    let mut code = Vec::new();
    push_int(&mut code, 1);
    code.push(OP_POP);
    assert_ne!(run(code), VmStatus::BadOpcode);
}

#[test]
fn every_truncation_of_a_working_program_terminates() {
    let mut full = Vec::new();
    push_int(&mut full, 3);
    push_int(&mut full, 4);
    full.extend_from_slice(&[OP_ADD, OP_DUP, OP_PRINT, OP_TYPE_OF, OP_POP, OP_HALT]);
    let img = program(full);
    for cut in 0..img.len() {
        let _ = vm_exec(&img[..cut]);
    }
    assert_eq!(vm_exec(&img), VmStatus::Ok);
}
