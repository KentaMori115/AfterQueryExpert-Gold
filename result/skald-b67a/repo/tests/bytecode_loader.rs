//! What the chunk loader accepts and, more importantly, what it refuses.
//!
//! Every image here is built by the same helper, so a test names exactly the
//! one field it is changing.

use skald::bytecode::*;

/// Build an image in the loader's format: magic, version, constant and
/// function counts, the entry index, then the constants and the functions.
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

fn string_const(text: &[u8]) -> (u8, Vec<u8>) {
    let mut payload = (text.len() as u16).to_le_bytes().to_vec();
    payload.extend_from_slice(text);
    (CONST_STRING, payload)
}

fn minimal() -> Vec<u8> {
    image(&[], &[(-1, 0, 0, vec![OP_HALT])], 0)
}

#[test]
fn a_minimal_image_loads() {
    let chunk = chunk_load(&minimal()).expect("a well-formed image loads");
    assert_eq!(chunk.entry_idx, 0);
    assert_eq!(chunk.funcs.len(), 1);
    assert_eq!(chunk.constants.len(), 0);
    assert_eq!(chunk.funcs[0].code, vec![OP_HALT]);
}

#[test]
fn every_constant_kind_round_trips() {
    let img = image(
        &[
            (CONST_INT, (-42i64).to_le_bytes().to_vec()),
            (CONST_FLOAT, 1.5f64.to_bits().to_le_bytes().to_vec()),
            string_const(b"skald"),
            (CONST_NULL, Vec::new()),
        ],
        &[(-1, 0, 0, vec![OP_HALT])],
        0,
    );
    let chunk = chunk_load(&img).expect("every kind is known");
    assert_eq!(chunk.constants.len(), 4);
    assert!(matches!(chunk.constants[0], Constant::Int(-42)));
    assert!(matches!(chunk.constants[1], Constant::Float(f) if f == 1.5));
    match &chunk.constants[2] {
        Constant::Str(s) => assert_eq!(s, b"skald"),
        _ => panic!("expected a string constant"),
    }
    assert!(matches!(chunk.constants[3], Constant::Null));
}

#[test]
fn an_empty_input_is_refused() {
    assert!(chunk_load(&[]).is_none());
}

#[test]
fn every_truncation_of_a_good_image_is_refused() {
    let good = image(
        &[(CONST_INT, 1i64.to_le_bytes().to_vec()), string_const(b"ab")],
        &[(-1, 1, 2, vec![OP_PUSH_NULL, OP_HALT])],
        0,
    );
    for cut in 0..good.len() {
        assert!(
            chunk_load(&good[..cut]).is_none(),
            "a {cut}-byte prefix should not load"
        );
    }
    assert!(chunk_load(&good).is_some(), "the whole image still loads");
}

#[test]
fn a_wrong_magic_byte_is_refused() {
    for i in 0..4 {
        let mut img = minimal();
        img[i] ^= 0xFF;
        assert!(chunk_load(&img).is_none(), "byte {i} of the magic is checked");
    }
}

#[test]
fn an_unknown_version_is_refused() {
    let mut img = minimal();
    img[4] = VERSION.wrapping_add(1);
    assert!(chunk_load(&img).is_none());
}

#[test]
fn an_image_with_no_functions_is_refused() {
    let img = image(&[], &[], 0);
    assert!(chunk_load(&img).is_none(), "there is nothing to enter");
}

#[test]
fn an_entry_index_past_the_function_count_is_refused() {
    let funcs = vec![
        (-1i16, 0u8, 0u8, vec![OP_HALT]),
        (-1, 0, 0, vec![OP_HALT]),
    ];
    assert!(chunk_load(&image(&[], &funcs, 0)).is_some());
    assert!(chunk_load(&image(&[], &funcs, 1)).is_some());
    assert!(chunk_load(&image(&[], &funcs, 2)).is_none());
    assert!(chunk_load(&image(&[], &funcs, 0xFFFF)).is_none());
}

#[test]
fn an_unknown_constant_tag_is_refused() {
    for tag in [4u8, 9, 0x7F, 0xFF] {
        let img = image(&[(tag, vec![0; 8])], &[(-1, 0, 0, vec![OP_HALT])], 0);
        assert!(chunk_load(&img).is_none(), "tag {tag} is not a constant kind");
    }
}

#[test]
fn a_declared_constant_count_larger_than_the_body_is_refused() {
    let mut img = minimal();
    img[5] = 8; // eight constants promised, none supplied
    img[6] = 0;
    assert!(chunk_load(&img).is_none());
}

#[test]
fn a_declared_function_count_larger_than_the_body_is_refused() {
    let mut img = minimal();
    img[7] = 8; // eight functions promised, one supplied
    img[8] = 0;
    assert!(chunk_load(&img).is_none());
}

#[test]
fn a_string_constant_longer_than_the_bytes_that_follow_is_refused() {
    let mut payload = 4000u16.to_le_bytes().to_vec();
    payload.extend_from_slice(b"only a few");
    let img = image(&[(CONST_STRING, payload)], &[(-1, 0, 0, vec![OP_HALT])], 0);
    assert!(chunk_load(&img).is_none());
}

#[test]
fn a_string_constant_past_the_size_ceiling_is_refused() {
    let at_ceiling = vec![b'x'; 4096];
    let over_ceiling = vec![b'x'; 4097];
    let ok = image(&[string_const(&at_ceiling)], &[(-1, 0, 0, vec![OP_HALT])], 0);
    let bad = image(&[string_const(&over_ceiling)], &[(-1, 0, 0, vec![OP_HALT])], 0);
    assert!(chunk_load(&ok).is_some(), "4096 bytes is allowed");
    assert!(chunk_load(&bad).is_none(), "4097 bytes is not");
}

#[test]
fn frames_wider_than_the_declared_ceilings_are_refused() {
    let load = |params: u8, locals: u8| {
        chunk_load(&image(&[], &[(-1, params, locals, vec![OP_HALT])], 0)).is_some()
    };
    assert!(load(32, 64), "the ceilings themselves are allowed");
    assert!(!load(33, 64), "one parameter too many");
    assert!(!load(32, 65), "one local too many");
    assert!(!load(255, 255));
}

#[test]
fn a_function_with_no_code_still_loads() {
    let chunk = chunk_load(&image(&[], &[(-1, 0, 0, Vec::new())], 0)).expect("empty code is legal");
    assert!(chunk.funcs[0].code.is_empty());
}

#[test]
fn code_longer_than_the_bytes_that_follow_is_refused() {
    let mut img = image(&[], &[(-1, 0, 0, vec![OP_HALT])], 0);
    let len = img.len();
    img[len - 3] = 0xFF; // the low byte of the code length
    assert!(chunk_load(&img).is_none());
}

#[test]
fn no_single_byte_mutation_of_a_good_image_is_accepted_wrongly() {
    let good = image(
        &[(CONST_INT, 5i64.to_le_bytes().to_vec())],
        &[(-1, 1, 2, vec![OP_PUSH_NULL, OP_HALT])],
        0,
    );
    for i in 0..good.len() {
        for delta in [1u8, 0x40, 0xFF] {
            let mut mutated = good.clone();
            mutated[i] = mutated[i].wrapping_add(delta);
            // Whatever the loader decides, it must decide it without reading
            // past the buffer, and any chunk it hands back must be coherent.
            if let Some(chunk) = chunk_load(&mutated) {
                assert!((chunk.entry_idx as usize) < chunk.funcs.len());
                for func in &chunk.funcs {
                    assert!(func.param_count <= 32);
                    assert!(func.local_count <= 64);
                }
            }
        }
    }
}

#[test]
fn a_name_index_may_be_negative() {
    let chunk = chunk_load(&image(&[], &[(-1, 0, 0, vec![OP_HALT])], 0)).unwrap();
    assert_eq!(chunk.funcs[0].name_idx, -1, "an anonymous function is legal");
    let named = chunk_load(&image(
        &[string_const(b"main")],
        &[(0, 0, 0, vec![OP_HALT])],
        0,
    ))
    .unwrap();
    assert_eq!(named.funcs[0].name_idx, 0);
}
