//! What a static read says about the value stack: how deep it is at each
//! instruction of a function, where a body reads below the bottom or pushes
//! past the ceiling, and where two paths arrive holding different amounts.

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

/// Constant 0 is an integer, constant 1 the string a dictionary key needs.
fn pool() -> Vec<(u8, Vec<u8>)> {
    let mut key = 3u16.to_le_bytes().to_vec();
    key.extend_from_slice(b"key");
    vec![
        (CONST_INT, 7i64.to_le_bytes().to_vec()),
        (CONST_STRING, key),
    ]
}

fn chunk(funcs: &[(i16, u8, u8, Vec<u8>)]) -> Chunk {
    chunk_load(&image(&pool(), funcs, 0)).expect("the loader takes this image")
}

/// A chunk whose entry function holds `code`, beside a second function taking
/// one argument that a call or a closure can target.
fn entry(code: Vec<u8>) -> Chunk {
    chunk(&[
        (-1, 0, 2, code),
        (-1, 1, 2, vec![OP_PUSH_NULL, OP_RETURN]),
    ])
}

fn clean(code: Vec<u8>) {
    let found = chunk_verify(&entry(code));
    assert!(found.is_empty(), "expected nothing, got [{}]", shape(&found));
}

/// The one flaw a body raises.
fn only(code: Vec<u8>) -> Vec<Flaw> {
    let found = chunk_verify(&entry(code));
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

/// The offset a body's single depth flaw sits at, widened so that a case can
/// name an offset without also naming the width the field is stored in.
fn depth_at(code: Vec<u8>) -> u64 {
    let found = only(code);
    assert!(matches!(found[0].kind, FlawKind::Depth));
    found[0].offset as u64
}

fn jump(op: u8, offset: i16) -> Vec<u8> {
    let mut v = vec![op];
    v.extend_from_slice(&offset.to_le_bytes());
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

fn dict_set(key: u16) -> Vec<u8> {
    let mut v = vec![OP_DICT_SET];
    v.extend_from_slice(&key.to_le_bytes());
    v
}

fn dict_get(key: u16) -> Vec<u8> {
    let mut v = vec![OP_DICT_GET];
    v.extend_from_slice(&key.to_le_bytes());
    v
}

fn push_const(idx: u16) -> Vec<u8> {
    let mut v = vec![OP_PUSH_CONST];
    v.extend_from_slice(&idx.to_le_bytes());
    v
}

fn body(parts: &[Vec<u8>]) -> Vec<u8> {
    parts.iter().flat_map(|p| p.iter().copied()).collect()
}

// ── reading below the bottom ────────────────────────────────────────────

#[test]
fn a_body_that_pushes_before_it_pops_is_clean() {
    clean(vec![OP_PUSH_NULL, OP_POP, OP_HALT]);
}

#[test]
fn reading_a_value_that_is_not_there_is_reported() {
    assert_eq!(depth_at(vec![OP_POP, OP_HALT]), 0);
    assert_eq!(depth_at(vec![OP_STORE, 0, OP_HALT]), 0);
}

#[test]
fn an_addition_with_one_operand_under_it_is_reported() {
    assert_eq!(depth_at(vec![OP_PUSH_NULL, OP_ADD, OP_HALT]), 1);
}

#[test]
fn every_conditional_jump_reads_the_value_it_tests() {
    for op in [OP_JMP_TRUE, OP_JMP_FALSE, OP_JMP_NULL] {
        assert_eq!(depth_at(body(&[jump(op, 0), vec![OP_HALT]])), 0);
        clean(body(&[vec![OP_PUSH_NULL], jump(op, 0), vec![OP_HALT]]));
        let code = body(&[vec![OP_PUSH_NULL], jump(op, 0), vec![OP_POP, OP_HALT]]);
        assert_eq!(depth_at(code), 4, "the test value is gone either way");
    }
    // An unconditional jump reads nothing.
    clean(body(&[jump(OP_JMP, 0), vec![OP_HALT]]));
}

#[test]
fn a_reference_count_bump_reads_without_taking() {
    clean(vec![OP_PUSH_NULL, OP_INCREF, OP_POP, OP_HALT]);
    assert_eq!(depth_at(vec![OP_INCREF, OP_HALT]), 0);
}

#[test]
fn asking_a_value_for_its_type_leaves_one_behind() {
    clean(vec![OP_PUSH_NULL, OP_TYPE_OF, OP_POP, OP_HALT]);
    assert_eq!(depth_at(vec![OP_PUSH_NULL, OP_TYPE_OF, OP_POP, OP_POP, OP_HALT]), 3);
}

#[test]
fn appending_to_an_array_leaves_the_array_where_it_was() {
    clean(vec![OP_NEW_OBJ, 1, OP_PUSH_NULL, OP_ARRAY_PUSH, OP_POP, OP_HALT]);
    // The array is still there after the append, and only the array: a second
    // pop reads below the bottom.
    let twice = vec![OP_NEW_OBJ, 1, OP_PUSH_NULL, OP_ARRAY_PUSH, OP_POP, OP_POP, OP_HALT];
    assert_eq!(depth_at(twice), 5);
}

#[test]
fn appending_with_nothing_to_append_is_reported() {
    assert_eq!(depth_at(vec![OP_NEW_OBJ, 1, OP_ARRAY_PUSH, OP_HALT]), 2);
}

// ── what each opcode takes and leaves ───────────────────────────────────

#[test]
fn every_arithmetic_and_comparison_reads_two_and_leaves_one() {
    for op in [
        OP_ADD, OP_SUB, OP_MUL, OP_DIV, OP_MOD, OP_EQ, OP_LT, OP_LE, OP_CONCAT,
    ] {
        assert_eq!(depth_at(vec![OP_PUSH_NULL, op, OP_HALT]), 1, "one operand");
        clean(vec![OP_PUSH_NULL, OP_PUSH_NULL, op, OP_POP, OP_HALT]);
        let twice = vec![OP_PUSH_NULL, OP_PUSH_NULL, op, OP_POP, OP_POP, OP_HALT];
        assert_eq!(depth_at(twice), 4, "the result is the only thing left");
    }
}

#[test]
fn every_unary_operation_reads_one_and_leaves_one() {
    for op in [OP_NOT, OP_NEG, OP_ARRAY_LEN, OP_TYPE_OF] {
        assert_eq!(depth_at(vec![op, OP_HALT]), 0, "nothing to read");
        clean(vec![OP_PUSH_NULL, op, OP_POP, OP_HALT]);
        let twice = vec![OP_PUSH_NULL, op, OP_POP, OP_POP, OP_HALT];
        assert_eq!(depth_at(twice), 3, "one value in, one value out");
    }
}

#[test]
fn every_opcode_that_consumes_one_value_leaves_nothing() {
    for op in [OP_POP, OP_PRINT, OP_DECREF] {
        assert_eq!(depth_at(vec![op, OP_HALT]), 0, "nothing to consume");
        clean(vec![OP_PUSH_NULL, op, OP_HALT]);
        assert_eq!(depth_at(vec![OP_PUSH_NULL, op, OP_POP, OP_HALT]), 2);
    }
    // A store reads one value and puts it in a slot rather than back.
    assert_eq!(depth_at(vec![OP_STORE, 0, OP_HALT]), 0);
    clean(vec![OP_PUSH_NULL, OP_STORE, 0, OP_HALT]);
    assert_eq!(depth_at(vec![OP_PUSH_NULL, OP_STORE, 0, OP_POP, OP_HALT]), 3);
}

#[test]
fn every_opcode_that_only_pushes_leaves_one_more() {
    let mut pushes: Vec<Vec<u8>> = vec![
        vec![OP_PUSH_NULL],
        vec![OP_PUSH_INT, 1, 0, 0, 0],
        vec![OP_LOAD, 0],
        vec![OP_NEW_OBJ, 1],
    ];
    pushes.push(push_const(0));
    pushes.push(closure(1, 0));
    for op in pushes {
        clean(body(&[op.clone(), vec![OP_POP, OP_HALT]]));
        let code = body(&[op.clone(), vec![OP_POP, OP_POP, OP_HALT]]);
        assert_eq!(depth_at(code), op.len() as u64 + 1, "one value was pushed");
    }
}

#[test]
fn duplicating_reads_one_and_leaves_two() {
    assert_eq!(depth_at(vec![OP_DUP, OP_HALT]), 0);
    clean(vec![OP_PUSH_NULL, OP_DUP, OP_POP, OP_POP, OP_HALT]);
    let thrice = vec![OP_PUSH_NULL, OP_DUP, OP_POP, OP_POP, OP_POP, OP_HALT];
    assert_eq!(depth_at(thrice), 4);
}

#[test]
fn a_dictionary_write_keeps_the_dictionary_and_a_read_replaces_it() {
    let write = |tail: Vec<u8>| body(&[vec![OP_NEW_OBJ, 0, OP_PUSH_NULL], dict_set(1), tail]);
    assert_eq!(depth_at(body(&[vec![OP_NEW_OBJ, 0], dict_set(1), vec![OP_HALT]])), 2);
    clean(write(vec![OP_POP, OP_HALT]));
    assert_eq!(depth_at(write(vec![OP_POP, OP_POP, OP_HALT])), 7);

    assert_eq!(depth_at(body(&[dict_get(1), vec![OP_HALT]])), 0);
    clean(body(&[vec![OP_NEW_OBJ, 0], dict_get(1), vec![OP_POP, OP_HALT]]));
    let twice = body(&[vec![OP_NEW_OBJ, 0], dict_get(1), vec![OP_POP, OP_POP, OP_HALT]]);
    assert_eq!(depth_at(twice), 6);
}

#[test]
fn an_array_read_takes_the_index_and_the_array() {
    assert_eq!(depth_at(vec![OP_NEW_OBJ, 1, OP_ARRAY_GET, OP_HALT]), 2);
    clean(vec![OP_NEW_OBJ, 1, OP_PUSH_NULL, OP_ARRAY_GET, OP_POP, OP_HALT]);
    let twice = vec![OP_NEW_OBJ, 1, OP_PUSH_NULL, OP_ARRAY_GET, OP_POP, OP_POP, OP_HALT];
    assert_eq!(depth_at(twice), 5);
}

#[test]
fn an_opcode_that_reads_nothing_leaves_the_stack_as_it_found_it() {
    for op in [OP_NOP, OP_GC] {
        clean(vec![op, OP_HALT]);
        clean(vec![OP_PUSH_NULL, op, OP_POP, OP_HALT]);
        assert_eq!(depth_at(vec![OP_PUSH_NULL, op, OP_POP, OP_POP, OP_HALT]), 3);
    }
}

// ── pushing past the ceiling ────────────────────────────────────────────

#[test]
fn a_run_of_pushes_that_fills_the_stack_is_clean() {
    let mut code = vec![OP_PUSH_NULL; 512];
    code.push(OP_HALT);
    clean(code);
}

#[test]
fn one_push_more_than_the_stack_holds_is_reported() {
    let mut code = vec![OP_PUSH_NULL; 513];
    code.push(OP_HALT);
    assert_eq!(depth_at(code), 512);
}

// ── paths that disagree ─────────────────────────────────────────────────

#[test]
fn two_paths_leaving_the_same_depth_are_clean() {
    // The jump skips a push that the other path also skips.
    let code = body(&[vec![OP_PUSH_NULL], jump(OP_JMP_FALSE, 0), vec![OP_HALT]]);
    clean(code);
}

#[test]
fn one_branch_leaves_more_than_the_other() {
    // Taking the jump skips the second push, so the halt is reached holding
    // one value on one path and nothing on the other.
    let code = body(&[vec![OP_PUSH_NULL], jump(OP_JMP_FALSE, 1), vec![OP_PUSH_NULL, OP_HALT]]);
    assert_eq!(depth_at(code), 5);
}

#[test]
fn a_loop_that_keeps_its_depth_is_clean() {
    let code = body(&[vec![OP_NOP], jump(OP_JMP, -4)]);
    clean(code);
}

#[test]
fn a_loop_that_grows_the_stack_each_time_round_is_reported() {
    let code = body(&[vec![OP_PUSH_NULL], jump(OP_JMP, -4)]);
    assert_eq!(depth_at(code), 0);
}

#[test]
fn the_lowest_offset_that_is_wrong_is_the_one_reported() {
    // Both pops read an empty stack; the branch reaches the later one first.
    let tail = vec![OP_POP, OP_NOP, OP_NOP, OP_NOP, OP_POP, OP_HALT];
    let code = body(&[vec![OP_PUSH_NULL], jump(OP_JMP_TRUE, 4), tail]);
    assert_eq!(depth_at(code), 4);
}

// ── where a path ends ───────────────────────────────────────────────────

#[test]
fn nothing_after_a_halt_is_read() {
    clean(vec![OP_HALT, OP_POP, OP_POP]);
}

#[test]
fn nothing_after_a_return_is_read() {
    clean(vec![OP_PUSH_NULL, OP_RETURN, OP_POP, OP_ADD]);
}

#[test]
fn code_a_jump_steps_over_is_not_read() {
    let code = body(&[jump(OP_JMP, 1), vec![OP_POP, OP_HALT]]);
    clean(code);
}

#[test]
fn running_off_the_end_of_a_body_is_not_a_flaw() {
    clean(vec![OP_PUSH_NULL]);
}

#[test]
fn a_body_that_stopped_decoding_has_its_stack_left_alone() {
    // The pop reads an empty stack, but the byte after it is not an opcode,
    // so the walk ends there and the stack is never read.
    let found = only(vec![OP_POP, 0xF3]);
    assert!(matches!(found[0].kind, FlawKind::Opcode));
    assert_eq!(found[0].offset, 1);
}

// ── calls ───────────────────────────────────────────────────────────────

#[test]
fn arguments_have_to_be_there_to_pass() {
    let code = body(&[call(1, 1), vec![OP_HALT]]);
    assert_eq!(depth_at(code), 0);
}

#[test]
fn a_call_leaves_one_value_behind() {
    let code = body(&[vec![OP_PUSH_NULL], call(1, 1), vec![OP_POP, OP_HALT]]);
    clean(code);
}

#[test]
fn values_held_across_a_call_do_not_survive_it() {
    // Two values go on, one of them is the argument; the call answers with a
    // single value and nothing else is left, so the second pop is a read below
    // the bottom.
    let code = body(&[vec![OP_PUSH_NULL, OP_PUSH_NULL], call(1, 1), vec![OP_POP, OP_POP, OP_HALT]]);
    assert_eq!(depth_at(code), 7);
}

#[test]
fn an_invocation_reads_one_slot_beneath_its_arguments() {
    // The closure itself sits under the argument.
    let short = body(&[closure(1, 0), vec![OP_INVOKE, 1, OP_HALT]]);
    assert_eq!(depth_at(short), 4);
    let whole = body(&[closure(1, 0), vec![OP_PUSH_NULL, OP_INVOKE, 1, OP_POP, OP_HALT]]);
    clean(whole);
}

// ── where a function is entered from ────────────────────────────────────

#[test]
fn a_callee_is_entered_holding_what_the_caller_left() {
    // Two values go on, the call takes none of them, and the callee reads both.
    let caller = body(&[vec![OP_PUSH_NULL, OP_PUSH_NULL], call(1, 0), vec![OP_HALT]]);
    let fed = chunk(&[
        (-1, 0, 1, caller),
        (-1, 0, 0, vec![OP_POP, OP_POP, OP_RETURN]),
    ]);
    let found = chunk_verify(&fed);
    assert!(found.is_empty(), "expected nothing, got [{}]", shape(&found));

    // One value left, and the callee still reads two.
    let thin = body(&[vec![OP_PUSH_NULL], call(1, 0), vec![OP_HALT]]);
    let starved = chunk(&[
        (-1, 0, 1, thin),
        (-1, 0, 0, vec![OP_POP, OP_POP, OP_RETURN]),
    ]);
    let found = chunk_verify(&starved);
    assert_eq!(found.len(), 1, "[{}]", shape(&found));
    assert_eq!((found[0].func, found[0].offset), (1, 1));
    assert!(matches!(found[0].kind, FlawKind::Depth));
}

#[test]
fn arguments_come_off_before_the_callee_starts() {
    // Three values, two of them arguments: the callee begins holding one.
    let caller = body(&[
        vec![OP_PUSH_NULL, OP_PUSH_NULL, OP_PUSH_NULL],
        call(1, 2),
        vec![OP_HALT],
    ]);
    let fits = chunk(&[
        (-1, 0, 1, caller.clone()),
        (-1, 2, 0, vec![OP_POP, OP_RETURN]),
    ]);
    let found = chunk_verify(&fits);
    assert!(found.is_empty(), "expected nothing, got [{}]", shape(&found));

    let over = chunk(&[
        (-1, 0, 1, caller),
        (-1, 2, 0, vec![OP_POP, OP_POP, OP_RETURN]),
    ]);
    let found = chunk_verify(&over);
    assert_eq!(found.len(), 1, "[{}]", shape(&found));
    assert_eq!((found[0].func, found[0].offset), (1, 1));
}

#[test]
fn two_calls_reaching_one_function_differently_are_reported() {
    let caller = body(&[
        call(1, 0),
        vec![OP_PUSH_NULL],
        call(1, 0),
        vec![OP_HALT],
    ]);
    let chunk = chunk(&[(-1, 0, 1, caller), (-1, 0, 0, vec![OP_RETURN])]);
    let found = chunk_verify(&chunk);
    assert_eq!(found.len(), 1, "[{}]", shape(&found));
    assert_eq!((found[0].func, found[0].offset), (1, 0));
    assert!(matches!(found[0].kind, FlawKind::Depth));
}

#[test]
fn two_calls_agreeing_on_the_depth_are_clean() {
    // A call answers with one value, so the second call site is reached at the
    // same height as the first.
    let caller = body(&[call(1, 0), vec![OP_POP], call(1, 0), vec![OP_HALT]]);
    let chunk = chunk(&[(-1, 0, 1, caller), (-1, 0, 0, vec![OP_RETURN])]);
    let found = chunk_verify(&chunk);
    assert!(found.is_empty(), "expected nothing, got [{}]", shape(&found));
}

#[test]
fn a_function_no_call_reaches_is_read_from_empty() {
    let chunk = chunk(&[
        (-1, 0, 0, vec![OP_HALT]),
        (-1, 0, 0, vec![OP_POP, OP_RETURN]),
    ]);
    let found = chunk_verify(&chunk);
    assert_eq!(found.len(), 1, "[{}]", shape(&found));
    assert_eq!((found[0].func, found[0].offset), (1, 0));
}

#[test]
fn a_call_no_path_arrives_at_settles_nothing() {
    // The call sits after a halt, so nothing reaches it and the function it
    // names is read from empty like any other stranded function.
    let caller = body(&[
        vec![OP_PUSH_NULL, OP_PUSH_NULL, OP_HALT],
        call(1, 0),
    ]);
    let chunk = chunk(&[
        (-1, 0, 1, caller),
        (-1, 0, 0, vec![OP_POP, OP_RETURN]),
    ]);
    let found = chunk_verify(&chunk);
    assert_eq!(found.len(), 1, "[{}]", shape(&found));
    assert_eq!((found[0].func, found[0].offset), (1, 0));
}

#[test]
fn a_function_calling_itself_at_one_depth_is_clean() {
    let chunk = chunk(&[(-1, 0, 1, body(&[call(0, 0), vec![OP_POP, OP_HALT]]))]);
    let found = chunk_verify(&chunk);
    assert!(found.is_empty(), "expected nothing, got [{}]", shape(&found));
}

#[test]
fn a_function_calling_itself_from_a_deeper_stack_is_reported() {
    let chunk = chunk(&[(
        -1,
        0,
        1,
        body(&[vec![OP_PUSH_NULL], call(0, 0), vec![OP_POP, OP_HALT]]),
    )]);
    let found = chunk_verify(&chunk);
    assert_eq!(found.len(), 1, "[{}]", shape(&found));
    assert_eq!((found[0].func, found[0].offset), (0, 0));
    assert!(matches!(found[0].kind, FlawKind::Depth));
}

// ── one function at a time ──────────────────────────────────────────────

#[test]
fn a_function_is_read_as_if_it_were_entered_with_an_empty_stack() {
    // The second function takes two parameters, but they arrive in its locals,
    // not on the stack it starts from.
    let chunk = chunk(&[
        (-1, 0, 0, vec![OP_HALT]),
        (-1, 2, 0, vec![OP_POP, OP_RETURN]),
    ]);
    let found = chunk_verify(&chunk);
    assert_eq!(found.len(), 1, "[{}]", shape(&found));
    assert_eq!(found[0].func, 1);
    assert_eq!(found[0].offset, 0);
    assert!(matches!(found[0].kind, FlawKind::Depth));
}

#[test]
fn one_function_reading_below_the_bottom_leaves_the_others_clean() {
    let chunk = chunk(&[
        (-1, 0, 1, vec![OP_PUSH_NULL, OP_STORE, 0, OP_HALT]),
        (-1, 1, 1, vec![OP_POP, OP_POP, OP_RETURN]),
    ]);
    let found = chunk_verify(&chunk);
    assert_eq!(found.len(), 1, "[{}]", shape(&found));
    assert_eq!((found[0].func, found[0].offset), (1, 0));
}
