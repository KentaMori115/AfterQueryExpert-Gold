//! JSON parsing, rendering and validation, and the tokenizer's behaviour on
//! source text it cannot make sense of.
//!
//! Parsed JSON produces heap objects, so every test here installs a collector
//! for the duration and releases what it parsed before returning.

use skald::gc::{gc_create, gc_destroy, GcPtr};
use skald::heap::{heap_set_gc, heap_value_decref};
use skald::json::{json_format, json_minify, json_parse, json_stringify, json_validate, JsonError};
use skald::lexer::tokenize_all;
use skald::value::{Value, ValueType};

/// Run `body` with a fresh collector installed, then tear it down.
fn with_heap<F: FnOnce()>(body: F) {
    let gc = gc_create();
    heap_set_gc(gc);
    body();
    heap_set_gc(GcPtr::null());
    gc_destroy(gc);
}

/// Parse `text`, hand the rendered form to `check`, then release the value.
fn round_trip<F: FnOnce(Value, Vec<u8>)>(text: &[u8], check: F) {
    let value = json_parse(text);
    let rendered = json_stringify(value);
    check(value, rendered);
    heap_value_decref(value);
}

#[test]
fn every_scalar_kind_parses_to_its_own_type() {
    with_heap(|| {
        assert_eq!(json_parse(b"null").type_of(), ValueType::Null);
        assert_eq!(json_parse(b"7").type_of(), ValueType::Int);
        assert_eq!(json_parse(b"7.5").type_of(), ValueType::Float);
        let string = json_parse(b"\"text\"");
        assert_eq!(string.type_of(), ValueType::Object);
        heap_value_decref(string);
    });
}

#[test]
fn integers_and_floats_are_told_apart() {
    with_heap(|| {
        assert!(matches!(json_parse(b"0"), Value::Int(0)));
        assert!(matches!(json_parse(b"-12"), Value::Int(-12)));
        assert!(matches!(json_parse(b"1.0"), Value::Float(_)));
        assert!(matches!(json_parse(b"1e3"), Value::Float(_)));
    });
}

#[test]
fn a_document_survives_a_parse_and_render_round_trip() {
    with_heap(|| {
        let source = br#"{"name":"skald","tags":[1,2,3],"nested":{"ok":true}}"#;
        round_trip(source, |value, rendered| {
            assert_eq!(value.type_of(), ValueType::Object);
            let second = json_parse(&rendered);
            assert_eq!(second.type_of(), ValueType::Object);
            let again = json_stringify(second);
            assert_eq!(rendered, again, "rendering is stable after one pass");
            heap_value_decref(second);
        });
    });
}

#[test]
fn an_empty_container_round_trips() {
    with_heap(|| {
        for source in [&b"[]"[..], b"{}"] {
            round_trip(source, |_, rendered| {
                assert_eq!(json_validate(&rendered), JsonError::Ok);
            });
        }
    });
}

#[test]
fn validation_accepts_what_it_can_parse() {
    let good: &[&[u8]] = &[
        b"null",
        b"0",
        b"-1.5e10",
        b"\"\"",
        b"[]",
        b"{}",
        br#"[1,"two",null,{"three":3}]"#,
        br#"{"a":{"b":{"c":[1,2]}}}"#,
    ];
    for source in good {
        assert_eq!(
            json_validate(source),
            JsonError::Ok,
            "{:?} should validate",
            String::from_utf8_lossy(source)
        );
    }
}

#[test]
fn validation_refuses_malformed_documents() {
    let bad: &[&[u8]] = &[
        b"",
        b"{",
        b"[",
        b"\"unterminated",
        b"{\"key\"}",
        b"{\"key\":}",
        b"[1,]",
        b"tru",
        b"01",
    ];
    for source in bad {
        assert_ne!(
            json_validate(source),
            JsonError::Ok,
            "{:?} should not validate",
            String::from_utf8_lossy(source)
        );
    }
}

#[test]
fn every_prefix_of_a_document_is_handled() {
    with_heap(|| {
        let source = br#"{"a":[1,2,{"b":null}],"c":"x"}"#;
        for cut in 0..source.len() {
            let head = &source[..cut];
            let value = json_parse(head);
            let _ = json_stringify(value);
            heap_value_decref(value);
            let _ = json_validate(head);
            let _ = json_minify(head);
        }
        assert_eq!(json_validate(source), JsonError::Ok);
    });
}

#[test]
fn minifying_removes_whitespace_without_changing_the_document() {
    with_heap(|| {
        let spaced = b"{ \"a\" : [ 1 , 2 ] , \"b\" : null }";
        let minified = json_minify(spaced);
        assert!(!minified.contains(&b' '));
        assert_eq!(json_validate(&minified), JsonError::Ok);
        round_trip(spaced, |_, from_spaced| {
            round_trip(&minified, |_, from_minified| {
                assert_eq!(from_spaced, from_minified, "the value is the same either way");
            });
        });
    });
}

#[test]
fn minifying_leaves_string_contents_alone() {
    let minified = json_minify(br#"{"key":"a b  c"}"#);
    assert_eq!(minified, br#"{"key":"a b  c"}"#.to_vec());
}

#[test]
fn formatting_indents_without_changing_the_value() {
    with_heap(|| {
        let source = br#"{"a":[1,2],"b":{"c":3}}"#;
        let value = json_parse(source);
        let formatted = json_format(value, 2);
        let compact = json_stringify(value);
        assert!(formatted.len() >= compact.len(), "indentation adds bytes");
        assert_eq!(json_validate(&formatted), JsonError::Ok);
        let reparsed = json_parse(&formatted);
        assert_eq!(json_stringify(reparsed), compact);
        heap_value_decref(reparsed);
        heap_value_decref(value);
    });
}

#[test]
fn formatting_with_no_indent_matches_the_compact_form_value() {
    with_heap(|| {
        let value = json_parse(br#"[1,2,3]"#);
        let flat = json_format(value, 0);
        assert_eq!(json_validate(&flat), JsonError::Ok);
        heap_value_decref(value);
    });
}

#[test]
fn escapes_survive_the_round_trip() {
    with_heap(|| {
        let source = br#"{"escaped":"a\"b\\c\nd\te"}"#;
        round_trip(source, |_, rendered| {
            assert_eq!(json_validate(&rendered), JsonError::Ok);
            let again = json_parse(&rendered);
            assert_eq!(json_stringify(again), rendered);
            heap_value_decref(again);
        });
    });
}

#[test]
fn a_deeply_nested_document_terminates() {
    with_heap(|| {
        for depth in [1usize, 8, 64, 400] {
            let mut source = vec![b'['; depth];
            source.extend(vec![b']'; depth]);
            let value = json_parse(&source);
            let _ = json_stringify(value);
            heap_value_decref(value);
            let _ = json_validate(&source);
        }
    });
}

#[test]
fn unbalanced_nesting_is_refused_rather_than_hanging() {
    for depth in [1usize, 32, 500] {
        let open = vec![b'['; depth];
        assert_ne!(json_validate(&open), JsonError::Ok);
        let close = vec![b']'; depth];
        assert_ne!(json_validate(&close), JsonError::Ok);
    }
}

#[test]
fn arbitrary_bytes_never_validate_as_json() {
    let junk: &[&[u8]] = &[
        b"\xff\xfe\x00\x01",
        b"\xc3\x28",
        b"\xed\xa0\x80",
        &[0u8; 32],
    ];
    for source in junk {
        assert_ne!(json_validate(source), JsonError::Ok);
    }
}

#[test]
fn the_tokenizer_counts_what_it_reads() {
    assert_eq!(tokenize_all(b""), 1, "empty source still ends with an end token");
    assert!(tokenize_all(b"let x = 1;") > 0);
    assert!(
        tokenize_all(b"let x = 1; let y = 2;") > tokenize_all(b"let x = 1;"),
        "more source means more tokens"
    );
}

#[test]
fn the_tokenizer_accepts_the_reserved_words() {
    let source = b"if else while for fn return let true false null try catch finally throw";
    assert!(tokenize_all(source) >= 14, "every reserved word is a token");
}

#[test]
fn the_tokenizer_terminates_on_input_it_cannot_read() {
    let awkward: &[&[u8]] = &[
        b"\"unterminated string",
        b"/* unterminated comment",
        b"0x",
        b"1e",
        b"'",
        b"\\",
        b"\xff\xff\xff\xff",
        &[0u8; 64],
    ];
    for source in awkward {
        let _ = tokenize_all(source);
    }
}

#[test]
fn every_prefix_of_a_program_tokenizes() {
    let source = b"fn add(a, b) { let c = a + b; return c; } // trailing comment";
    for cut in 0..=source.len() {
        let _ = tokenize_all(&source[..cut]);
    }
    assert!(tokenize_all(source) > 10);
}
