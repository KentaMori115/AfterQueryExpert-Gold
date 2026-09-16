//! What a static read of a loaded chunk finds in the code the loader skipped:
//! bytes that are not opcodes, operands that run past the end, indices that
//! reach past the pool or the function table, calls the callee cannot take,
//! and jumps landing where no instruction begins.

use skald::bytecode::*;
use skald::verify::{chunk_verify, Flaw, FlawKind};

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

/// Pool: constant 0 is an integer, constant 1 a string, constant 2 null.
fn pool() -> Vec<(u8, Vec<u8>)> {
    let mut key = 3u16.to_le_bytes().to_vec();
    key.extend_from_slice(b"key");
    vec![
        (CONST_INT, 7i64.to_le_bytes().to_vec()),
        (CONST_STRING, key),
        (CONST_NULL, Vec::new()),
    ]
}

fn chunk(funcs: &[(i16, u8, u8, Vec<u8>)]) -> Chunk {
    chunk_load(&image(&pool(), funcs, 0)).expect("the loader takes this image")
}

/// A chunk whose entry function holds `code` over four local slots, beside a
/// second function that takes one argument and declares two locals.
fn entry(code: Vec<u8>) -> Chunk {
    chunk(&[
        (-1, 0, 4, code),
        (-1, 1, 2, vec![OP_PUSH_NULL, OP_RETURN]),
    ])
}

fn flaws(chunk: &Chunk) -> Vec<Flaw> {
    chunk_verify(chunk)
}

/// The single flaw a body is expected to raise.
fn only(chunk: &Chunk) -> Vec<Flaw> {
    let found = flaws(chunk);
    assert_eq!(found.len(), 1, "expected one flaw, got [{}]", shape(&found));
    found
}
/// A flaw's kind as a word, so a case can name what it expects without asking
/// the type to carry any particular trait.
fn kind_of(kind: &FlawKind) -> &'static str {
    match kind {
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

/// Every flaw as `func:offset:kind`, for the message when a count is wrong.
fn shape(flaws: &[Flaw]) -> String {
    flaws
        .iter()
        .map(|f| format!("{}:{}:{}", f.func, f.offset, kind_of(&f.kind)))
        .collect::<Vec<_>>()
        .join(" ")
}

fn push_const(idx: u16) -> Vec<u8> {
    let mut v = vec![OP_PUSH_CONST];
    v.extend_from_slice(&idx.to_le_bytes());
    v
}

fn call(func: u16, args: u8) -> Vec<u8> {
    let mut v = vec![OP_CALL];
    v.extend_from_slice(&func.to_le_bytes());
    v.push(args);
    v
}

fn closure(func: u16, slot: u8) -> Vec<u8> {
    let mut v = vec![OP_NEW_CLOSURE];
    v.extend_from_slice(&func.to_le_bytes());
    v.push(slot);
    v
}

fn jump(op: u8, offset: i16) -> Vec<u8> {
    let mut v = vec![op];
    v.extend_from_slice(&offset.to_le_bytes());
    v
}

fn body(parts: &[Vec<u8>]) -> Vec<u8> {
    parts.iter().flat_map(|p| p.iter().copied()).collect()
}

// ── bodies with nothing wrong ───────────────────────────────────────────

#[test]
fn a_function_with_no_code_reports_nothing() {
    assert!(flaws(&entry(Vec::new())).is_empty());
}

#[test]
fn a_body_that_pushes_a_constant_and_halts_reports_nothing() {
    let code = body(&[push_const(0), vec![OP_POP, OP_HALT]]);
    assert!(flaws(&entry(code)).is_empty());
}

// ── bytes that are not instructions ─────────────────────────────────────

#[test]
fn a_byte_that_is_not_an_opcode_is_reported() {
    let code = vec![OP_NOP, 0x27, OP_HALT];
    let found = only(&entry(code));
    let flaw = &found[0];
    assert!(matches!(flaw.kind, FlawKind::Opcode));
    assert_eq!(flaw.offset, 1);
    assert_eq!(flaw.func, 0);
}

#[test]
fn the_walk_ends_at_a_byte_that_is_not_an_opcode() {
    // The constant index after the unknown byte is past the pool, and is never
    // reached: nothing beyond an undecodable byte is known to be code.
    let code = body(&[vec![0xFF], push_const(9)]);
    assert!(matches!(only(&entry(code))[0].kind, FlawKind::Opcode));
}

#[test]
fn every_object_kind_the_heap_builds_is_accepted() {
    for kind in 0..=2u8 {
        let code = vec![OP_NEW_OBJ, kind, OP_POP, OP_HALT];
        assert!(flaws(&entry(code)).is_empty(), "kind {kind} was refused");
    }
}

#[test]
fn an_instruction_the_body_is_too_short_for() {
    let code = vec![OP_PUSH_CONST, 0];
    let found = only(&entry(code));
    let flaw = &found[0];
    assert!(matches!(flaw.kind, FlawKind::Truncated));
    assert_eq!(flaw.offset, 0);
}

#[test]
fn a_call_that_lost_its_argument_count_is_truncated() {
    let code = body(&[vec![OP_NOP, OP_CALL, 1, 0]]);
    let found = only(&entry(code));
    let flaw = &found[0];
    assert!(matches!(flaw.kind, FlawKind::Truncated));
    assert_eq!(flaw.offset, 1);
}

#[test]
fn instructions_before_a_truncated_one_are_still_read() {
    let code = body(&[push_const(9), vec![OP_PUSH_INT, 1, 2]]);
    let found = flaws(&entry(code));
    assert_eq!(found.len(), 2, "[{}]", shape(&found));
    assert!(matches!(found[0].kind, FlawKind::Constant));
    assert_eq!(found[0].offset, 0);
    assert!(matches!(found[1].kind, FlawKind::Truncated));
    assert_eq!(found[1].offset, 3);
}

#[test]
fn every_instruction_that_carries_operands_needs_all_of_them() {
    let widths: [(u8, usize); 12] = [
        (OP_LOAD, 1),
        (OP_STORE, 1),
        (OP_NEW_OBJ, 1),
        (OP_INVOKE, 1),
        (OP_PUSH_CONST, 2),
        (OP_DICT_SET, 2),
        (OP_DICT_GET, 2),
        (OP_JMP, 2),
        (OP_JMP_TRUE, 2),
        (OP_CALL, 3),
        (OP_NEW_CLOSURE, 3),
        (OP_PUSH_INT, 4),
    ];
    for (op, width) in widths {
        // One byte short of what the interpreter would read.
        let mut code = vec![op];
        code.extend(std::iter::repeat(0).take(width - 1));
        let found = only(&entry(code));
        assert!(
            matches!(found[0].kind, FlawKind::Truncated),
            "opcode {op:#04x} short by one"
        );
        assert_eq!(found[0].offset, 0);
    }
}

// ── the constant pool ───────────────────────────────────────────────────

#[test]
fn pushing_a_constant_nobody_declared() {
    let code = body(&[push_const(3), vec![OP_POP, OP_HALT]]);
    let found = only(&entry(code));
    let flaw = &found[0];
    assert!(matches!(flaw.kind, FlawKind::Constant));
    assert_eq!(flaw.offset, 0);
}

#[test]
fn a_dictionary_key_that_is_not_a_string_is_reported() {
    let mut code = vec![OP_NEW_OBJ, 0];
    code.extend_from_slice(&push_const(0));
    code.push(OP_DICT_SET);
    code.extend_from_slice(&0u16.to_le_bytes());
    code.push(OP_HALT);
    let found = only(&entry(code));
    let flaw = &found[0];
    assert!(matches!(flaw.kind, FlawKind::Constant));
    assert_eq!(flaw.offset, 5);
}

#[test]
fn a_key_the_pool_holds_as_text_is_fine() {
    let mut code = vec![OP_NEW_OBJ, 0];
    code.extend_from_slice(&push_const(0));
    code.push(OP_DICT_SET);
    code.extend_from_slice(&1u16.to_le_bytes());
    code.push(OP_HALT);
    assert!(flaws(&entry(code)).is_empty());
}

// ── local slots ─────────────────────────────────────────────────────────

#[test]
fn reading_a_slot_the_frame_never_holds() {
    let code = vec![OP_LOAD, 4, OP_POP, OP_HALT];
    let found = only(&entry(code));
    let flaw = &found[0];
    assert!(matches!(flaw.kind, FlawKind::Local));
    assert_eq!(flaw.offset, 0);
}

#[test]
fn the_last_slot_of_a_frame_is_reachable() {
    let code = vec![OP_LOAD, 3, OP_POP, OP_HALT];
    assert!(flaws(&entry(code)).is_empty());
    let store = body(&[push_const(0), vec![OP_STORE, 9, OP_HALT]]);
    assert!(matches!(only(&entry(store))[0].kind, FlawKind::Local));
}

#[test]
fn parameters_count_towards_the_slots_a_frame_holds() {
    // Two parameters and one local: slot 2 is the declared local, slot 3 is
    // past the end.
    let good = chunk(&[(-1, 2, 1, vec![OP_LOAD, 2, OP_POP, OP_HALT])]);
    assert!(flaws(&good).is_empty());
    let bad = chunk(&[(-1, 2, 1, vec![OP_LOAD, 3, OP_POP, OP_HALT])]);
    assert!(matches!(only(&bad)[0].kind, FlawKind::Local));
}

#[test]
fn a_function_a_closure_names_holds_one_slot_more() {
    let reads_past = vec![OP_LOAD, 3, OP_RETURN];
    let alone = chunk(&[(-1, 1, 2, reads_past.clone())]);
    assert!(matches!(only(&alone)[0].kind, FlawKind::Local), "no closure names it");

    let captured = chunk(&[
        (-1, 0, 1, body(&[closure(1, 0), vec![OP_POP, OP_HALT]])),
        (-1, 1, 2, reads_past),
    ]);
    assert!(
        flaws(&captured).is_empty(),
        "a closure over it widens the frame by one"
    );
}

#[test]
fn two_closures_over_one_function_do_not_widen_it_twice() {
    let code = body(&[closure(1, 0), vec![OP_POP], closure(1, 0), vec![OP_POP, OP_HALT]]);
    let reads_past = vec![OP_LOAD, 4, OP_RETURN];
    let chunk = chunk(&[(-1, 0, 1, code), (-1, 1, 2, reads_past)]);
    let found = flaws(&chunk);
    assert_eq!(found.len(), 1, "[{}]", shape(&found));
    assert_eq!(found[0].func, 1);
    assert!(matches!(found[0].kind, FlawKind::Local));
}

#[test]
fn the_extra_slot_belongs_to_the_function_the_closure_names() {
    // Function 0 makes the closure; its own frame is not the one that widens.
    let code = body(&[closure(1, 0), vec![OP_POP, OP_LOAD, 1, OP_HALT]]);
    let chunk = chunk(&[(-1, 0, 1, code), (-1, 1, 2, vec![OP_PUSH_NULL, OP_RETURN])]);
    let found = only(&chunk);
    let flaw = &found[0];
    assert_eq!(flaw.func, 0);
    assert!(matches!(flaw.kind, FlawKind::Local));
}

// ── the function table ──────────────────────────────────────────────────

#[test]
fn calling_something_the_table_does_not_hold() {
    let code = body(&[call(4, 0), vec![OP_HALT]]);
    let found = only(&entry(code));
    let flaw = &found[0];
    assert!(matches!(flaw.kind, FlawKind::Function));
    assert_eq!(flaw.offset, 0);
}

#[test]
fn a_closure_over_a_function_past_the_table_is_reported() {
    let code = body(&[closure(6, 0), vec![OP_POP, OP_HALT]]);
    let found = only(&entry(code));
    let flaw = &found[0];
    assert!(matches!(flaw.kind, FlawKind::Function));
}

#[test]
fn a_closure_reports_its_slot_before_the_function_it_names() {
    let code = body(&[closure(6, 9), vec![OP_POP, OP_HALT]]);
    assert!(matches!(only(&entry(code))[0].kind, FlawKind::Local));
}

// ── argument counts ─────────────────────────────────────────────────────

#[test]
fn a_call_passing_fewer_arguments_than_the_callee_declares_is_reported() {
    let code = body(&[call(1, 0), vec![OP_HALT]]);
    let found = only(&entry(code));
    let flaw = &found[0];
    assert!(matches!(flaw.kind, FlawKind::Arity));
    assert_eq!(flaw.offset, 0);
}

#[test]
fn a_call_passing_more_arguments_than_the_callee_declares_is_reported() {
    let code = body(&[push_const(0), push_const(0), call(1, 2), vec![OP_HALT]]);
    let found = only(&entry(code));
    let flaw = &found[0];
    assert!(matches!(flaw.kind, FlawKind::Arity));
    assert_eq!(flaw.offset, 6);
}

#[test]
fn a_call_matching_the_callee_is_accepted() {
    let code = body(&[push_const(0), call(1, 1), vec![OP_HALT]]);
    assert!(flaws(&entry(code)).is_empty());
}

#[test]
fn a_call_with_no_function_to_check_against_reports_the_function() {
    // Three arguments are on the stack, so the only thing left to weigh them
    // against is a callee that is not there.
    let three = body(&[push_const(0), push_const(0), push_const(0)]);
    let code = body(&[three, call(9, 3), vec![OP_HALT]]);
    assert!(matches!(only(&entry(code))[0].kind, FlawKind::Function));
}

// ── jumps ───────────────────────────────────────────────────────────────

#[test]
fn a_jump_onto_an_instruction_is_accepted() {
    let code = body(&[jump(OP_JMP, 2), vec![OP_NOP, OP_NOP, OP_HALT]]);
    assert!(flaws(&entry(code)).is_empty());
}

#[test]
fn where_an_offset_of_zero_lands() {
    // Offset zero is the instruction that follows the jump.
    let code = body(&[jump(OP_JMP, 0), vec![OP_HALT]]);
    assert!(flaws(&entry(code)).is_empty());
}

#[test]
fn a_jump_between_two_instructions_is_reported() {
    // One byte into the two-byte NEW_OBJ that follows.
    let code = body(&[jump(OP_JMP, 1), vec![OP_NEW_OBJ, 1, OP_POP, OP_HALT]]);
    let found = only(&entry(code));
    let flaw = &found[0];
    assert!(matches!(flaw.kind, FlawKind::Jump));
    assert_eq!(flaw.offset, 0);
}

#[test]
fn a_jump_onto_the_end_of_the_body_is_accepted() {
    // Falling off the end returns from the frame, so it is a place to land.
    let code = body(&[jump(OP_JMP, 1), vec![OP_NOP]]);
    assert!(flaws(&entry(code)).is_empty());
}

#[test]
fn a_jump_past_the_end_of_the_body_is_reported() {
    let code = body(&[jump(OP_JMP, 40), vec![OP_HALT]]);
    assert!(matches!(only(&entry(code))[0].kind, FlawKind::Jump));
}

#[test]
fn a_jump_before_the_first_byte_is_reported() {
    let code = body(&[vec![OP_NOP], jump(OP_JMP, -9), vec![OP_HALT]]);
    let found = only(&entry(code));
    let flaw = &found[0];
    assert!(matches!(flaw.kind, FlawKind::Jump));
    assert_eq!(flaw.offset, 1);
}

#[test]
fn a_backward_jump_onto_an_instruction_is_accepted() {
    let code = body(&[vec![OP_NOP], jump(OP_JMP, -4), vec![OP_HALT]]);
    assert!(flaws(&entry(code)).is_empty());
}

#[test]
fn a_conditional_jump_is_read_the_same_way() {
    let clean = body(&[push_const(0), jump(OP_JMP_FALSE, 1), vec![OP_NOP, OP_HALT]]);
    assert!(flaws(&entry(clean)).is_empty());
    let wide = vec![OP_PUSH_INT, 0, 0, 0, 0, OP_POP, OP_HALT];
    let ragged = body(&[push_const(0), jump(OP_JMP_TRUE, 2), wide]);
    assert!(matches!(only(&entry(ragged))[0].kind, FlawKind::Jump));
}

// ── one flaw at one offset ──────────────────────────────────────────────

#[test]
fn an_instruction_that_is_wrong_twice_reports_the_earlier_kind() {
    // The jump lands between two instructions and has nothing to test, so both
    // a jump flaw and a stack flaw would fall on offset 0. `Jump` comes first.
    let code = body(&[jump(OP_JMP_FALSE, 1), vec![OP_NEW_OBJ, 1, OP_POP, OP_HALT]]);
    let found = only(&entry(code));
    assert!(matches!(found[0].kind, FlawKind::Jump));
    assert_eq!(found[0].offset, 0);
}

#[test]
fn a_call_to_nothing_from_an_empty_stack_reports_the_function() {
    // The function does not exist and the two arguments are not there either.
    let code = body(&[call(9, 2), vec![OP_HALT]]);
    let found = only(&entry(code));
    assert!(matches!(found[0].kind, FlawKind::Function));
    assert_eq!(found[0].offset, 0);
}

#[test]
fn a_stack_flaw_elsewhere_in_the_body_is_still_reported() {
    // The constant index is wrong at offset 0 and the stack is wrong at 3, so
    // both are reported: the precedence only settles one offset at a time.
    let code = body(&[push_const(9), vec![OP_POP, OP_POP, OP_HALT]]);
    let found = flaws(&entry(code));
    assert_eq!(found.len(), 2, "[{}]", shape(&found));
    assert!(matches!(found[0].kind, FlawKind::Constant));
    assert_eq!(found[0].offset, 0);
    assert!(matches!(found[1].kind, FlawKind::Depth));
    assert_eq!(found[1].offset, 4);
}

// ── order of the report ─────────────────────────────────────────────────

#[test]
fn flaws_come_out_by_function_and_then_by_offset() {
    let first = body(&[push_const(8), vec![OP_POP, OP_LOAD, 7, OP_POP, OP_HALT]]);
    // The pop reads an empty stack, which is read after the rest of the body
    // and still belongs at the front of what its function reports.
    let second = body(&[vec![OP_POP], call(4, 0), vec![OP_HALT]]);
    let chunk = chunk(&[(-1, 0, 4, first), (-1, 0, 0, second)]);
    let found = flaws(&chunk);
    assert_eq!(found.len(), 4, "[{}]", shape(&found));
    assert_eq!(
        shape(&found),
        "0:0:constant 0:4:local 1:0:depth 1:1:function"
    );
}
