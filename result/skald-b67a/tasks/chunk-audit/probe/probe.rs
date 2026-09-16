//! Ask every build the same questions and print what it answers.
//!
//! Nothing here asserts. The point is to find where independently written
//! implementations disagree, because a question they all answer the same way
//! measures nothing, and a question whose answer is not derivable from the
//! engine cannot fairly be graded either way.

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

fn pool() -> Vec<(u8, Vec<u8>)> {
    let mut key = 3u16.to_le_bytes().to_vec();
    key.extend_from_slice(b"key");
    vec![(CONST_INT, 7i64.to_le_bytes().to_vec()), (CONST_STRING, key)]
}

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

fn render(flaws: &[Flaw]) -> String {
    if flaws.is_empty() {
        return "clean".to_string();
    }
    flaws
        .iter()
        .map(|f| format!("{}:{}:{}", f.func, f.offset, kind_of(&f.kind)))
        .collect::<Vec<_>>()
        .join(" ")
}

fn ask(name: &str, funcs: &[(i16, u8, u8, Vec<u8>)], entry: u16) {
    let data = image(&pool(), funcs, entry);
    match chunk_load(&data) {
        Some(chunk) => println!("{name} = {}", render(&chunk_verify(&chunk))),
        None => println!("{name} = the loader refused this image"),
    }
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

fn body(parts: &[Vec<u8>]) -> Vec<u8> {
    parts.iter().flat_map(|p| p.iter().copied()).collect()
}

#[test]
fn probe() {
    // control: everyone should agree on these two
    ask("c1_truncated_push_int", &[(-1, 0, 1, vec![OP_PUSH_INT, 0, 0])], 0);
    ask("c2_dict_key_is_an_int", &[(-1, 0, 1, body(&[vec![OP_NEW_OBJ, 0, OP_PUSH_NULL, OP_DICT_SET, 0, 0, OP_HALT]]))], 0);

    // 1. a frame the interpreter cannot build: 32 params + 64 locals is 96,
    //    and a captured value makes 97 against a 96 slot frame.
    ask("s1_frame_of_97_slots",
        &[(-1, 0, 1, body(&[closure(1, 0), vec![OP_POP, OP_HALT]])), (-1, 32, 64, vec![OP_RETURN])], 0);
    ask("s1b_frame_of_96_slots",
        &[(-1, 0, 1, body(&[closure(1, 0), vec![OP_POP, OP_HALT]])), (-1, 31, 64, vec![OP_RETURN])], 0);

    // 2. the entry function is entered with no arguments at all
    ask("s2_entry_declares_a_parameter", &[(-1, 1, 0, vec![OP_HALT])], 0);

    // 3. a callee is entered holding what its caller left
    ask("s3_callee_reads_the_callers_leftovers",
        &[(-1, 0, 1, body(&[vec![OP_PUSH_NULL, OP_PUSH_NULL], call(1, 0), vec![OP_HALT]])),
          (-1, 0, 0, vec![OP_POP, OP_POP, OP_RETURN])], 0);

    // 4. two call sites reach one callee at different depths
    ask("s4_two_call_sites_disagree",
        &[(-1, 0, 1, body(&[call(1, 0), vec![OP_PUSH_NULL, OP_PUSH_NULL], call(1, 0), vec![OP_HALT]])),
          (-1, 0, 0, vec![OP_PUSH_NULL, OP_RETURN])], 0);

    // 5. an invocation whose closure was made two instructions earlier
    ask("s5_invocation_of_a_known_closure_with_wrong_arity",
        &[(-1, 0, 1, body(&[closure(1, 0), vec![OP_PUSH_NULL, OP_INVOKE, 1, OP_POP, OP_HALT]])),
          (-1, 0, 0, vec![OP_PUSH_NULL, OP_RETURN])], 0);

    // 6. a function both called and captured: 1 param + 1 local, slot 2 is the
    //    capture slot on one path and past the frame on the other
    ask("s6_called_and_captured",
        &[(-1, 0, 1, body(&[vec![OP_PUSH_NULL], call(1, 1), vec![OP_POP], closure(1, 0), vec![OP_POP, OP_HALT]])),
          (-1, 1, 1, vec![OP_LOAD, 2, OP_RETURN])], 0);

    // 7. two things wrong at one offset: a call to nothing, on an empty stack
    ask("s7_two_flaws_at_one_offset",
        &[(-1, 0, 1, body(&[call(9, 2), vec![OP_HALT]]))], 0);

    // 8. a jump onto the first byte of the body
    ask("s8_jump_to_offset_zero",
        &[(-1, 0, 1, body(&[vec![OP_NOP], vec![OP_JMP, 0xFB, 0xFF], vec![OP_HALT]]))], 0);

    // 9. a self call, with a push before it
    ask("s9_self_call_after_a_push",
        &[(-1, 0, 1, body(&[vec![OP_PUSH_NULL], call(0, 0), vec![OP_HALT]]))], 0);

    // 10. a closure over a function that does not fit a frame
    ask("s10_capture_slot_read_in_the_captured_function",
        &[(-1, 0, 1, body(&[closure(1, 0), vec![OP_POP, OP_HALT]])), (-1, 0, 0, vec![OP_LOAD, 0, OP_RETURN])], 0);

    // 11. an empty body that a call passes arguments to
    ask("s11_empty_body_with_parameters",
        &[(-1, 0, 1, body(&[vec![OP_PUSH_NULL], call(1, 1), vec![OP_HALT]])), (-1, 1, 0, Vec::new())], 0);

    // 12. the stack ceiling reached through a call
    ask("s12_ceiling_then_a_call",
        &[(-1, 0, 1, body(&[vec![OP_PUSH_NULL; 512], call(1, 0), vec![OP_HALT]])), (-1, 0, 0, vec![OP_RETURN])], 0);

    // 13. an invocation whose closure identity depends on the branch taken
    ask("s13_two_closures_meet_at_one_invoke",
        &[(-1, 0, 2, body(&[closure(1, 0), vec![OP_JMP_FALSE, 4, 0], vec![OP_POP], closure(2, 0),
                            vec![OP_PUSH_NULL, OP_INVOKE, 1, OP_POP, OP_HALT]])),
          (-1, 1, 0, vec![OP_PUSH_NULL, OP_RETURN]), (-1, 0, 0, vec![OP_PUSH_NULL, OP_RETURN])], 0);

    // 14. a function nothing reaches, holding a fault
    ask("s14_unreached_function_with_a_fault",
        &[(-1, 0, 1, vec![OP_HALT]), (-1, 0, 0, vec![OP_POP, OP_RETURN])], 0);
}
