//! Round-trip and refusal behaviour of the LEB128 codec.

use skald::util::varint::{
    decode_deltas, decode_i64, decode_u64, encode_all_i64, encode_all_u64, encode_bytes,
    encode_deltas, encode_i64, encode_u64, encoded_len_i64, encoded_len_u64, unzigzag, zigzag,
    VarintError, VarintReader, MAX_VARINT_LEN,
};

fn enc_u(v: u64) -> Vec<u8> {
    let mut out = Vec::new();
    encode_u64(v, &mut out);
    out
}

#[test]
fn small_unsigned_values_take_one_byte() {
    for v in 0..=127u64 {
        let bytes = enc_u(v);
        assert_eq!(bytes.len(), 1, "value {v} should be one byte");
        assert_eq!(bytes[0], v as u8);
        assert_eq!(decode_u64(&bytes), Ok((v, 1)));
    }
}

#[test]
fn unsigned_round_trip_across_every_width() {
    let mut value = 1u64;
    loop {
        for probe in [value - 1, value, value + 1] {
            let bytes = enc_u(probe);
            assert_eq!(bytes.len(), encoded_len_u64(probe));
            assert_eq!(decode_u64(&bytes), Ok((probe, bytes.len())));
        }
        if value > u64::MAX / 2 {
            break;
        }
        value <<= 1;
    }
}

#[test]
fn the_widest_value_uses_the_declared_maximum() {
    let bytes = enc_u(u64::MAX);
    assert_eq!(bytes.len(), MAX_VARINT_LEN);
    assert_eq!(encoded_len_u64(u64::MAX), MAX_VARINT_LEN);
    assert_eq!(decode_u64(&bytes), Ok((u64::MAX, MAX_VARINT_LEN)));
}

#[test]
fn zigzag_maps_small_magnitudes_to_small_codes() {
    assert_eq!(zigzag(0), 0);
    assert_eq!(zigzag(-1), 1);
    assert_eq!(zigzag(1), 2);
    assert_eq!(zigzag(-2), 3);
    for v in [-1i64, 0, 1, -63, 63] {
        let mut out = Vec::new();
        assert_eq!(encode_i64(v, &mut out), 1, "value {v} should be one byte");
    }
}

#[test]
fn zigzag_is_its_own_inverse() {
    for v in [i64::MIN, -1000, -1, 0, 1, 1000, i64::MAX] {
        assert_eq!(unzigzag(zigzag(v)), v);
        let mut out = Vec::new();
        encode_i64(v, &mut out);
        assert_eq!(out.len(), encoded_len_i64(v));
        assert_eq!(decode_i64(&out), Ok((v, out.len())));
    }
}

#[test]
fn a_truncated_encoding_is_refused_not_guessed() {
    let bytes = enc_u(300);
    assert!(bytes.len() > 1);
    assert_eq!(decode_u64(&bytes[..bytes.len() - 1]), Err(VarintError::Truncated));
    assert_eq!(decode_u64(&[]), Err(VarintError::Truncated));
}

#[test]
fn continuation_bits_past_the_maximum_width_are_refused() {
    let over_long = vec![0x80u8; MAX_VARINT_LEN + 2];
    assert_eq!(decode_u64(&over_long), Err(VarintError::TooLong));
}

#[test]
fn a_value_wider_than_sixty_four_bits_is_refused() {
    let mut bytes = vec![0x80u8; 9];
    bytes.push(0x7F);
    assert_eq!(decode_u64(&bytes), Err(VarintError::Overflow));
}

#[test]
fn trailing_bytes_are_left_for_the_next_read() {
    let mut buf = enc_u(1);
    buf.extend_from_slice(&enc_u(100000));
    buf.push(0xAA);
    let (first, used) = decode_u64(&buf).unwrap();
    assert_eq!(first, 1);
    assert_eq!(used, 1);
    let (second, used2) = decode_u64(&buf[used..]).unwrap();
    assert_eq!(second, 100000);
    assert_eq!(buf[used + used2], 0xAA);
}

#[test]
fn a_reader_walks_a_concatenated_run() {
    let values = [0u64, 1, 127, 128, 300, u64::MAX];
    let buf = encode_all_u64(&values);
    let mut reader = VarintReader::new(&buf);
    assert_eq!(reader.position(), 0);
    assert_eq!(reader.remaining(), buf.len());
    let read = reader.read_all_u64().unwrap();
    assert_eq!(read, values);
    assert!(reader.is_empty());
    assert_eq!(reader.position(), buf.len());
}

#[test]
fn a_signed_run_round_trips_through_a_reader() {
    let values = [i64::MIN, -7, 0, 7, i64::MAX];
    let buf = encode_all_i64(&values);
    let mut reader = VarintReader::new(&buf);
    for &expected in &values {
        assert_eq!(reader.read_i64(), Ok(expected));
    }
    assert!(reader.is_empty());
}

#[test]
fn a_failed_read_leaves_the_cursor_where_it_was() {
    let mut buf = enc_u(9);
    buf.push(0x80); // a continuation byte with nothing after it
    let mut reader = VarintReader::new(&buf);
    assert_eq!(reader.read_u64(), Ok(9));
    let before = reader.position();
    assert_eq!(reader.read_u64(), Err(VarintError::Truncated));
    assert_eq!(reader.position(), before);
}

#[test]
fn a_length_prefixed_run_round_trips() {
    let mut buf = Vec::new();
    encode_bytes(b"", &mut buf);
    encode_bytes(b"skald", &mut buf);
    let long = vec![b'z'; 500];
    encode_bytes(&long, &mut buf);
    let mut reader = VarintReader::new(&buf);
    assert_eq!(reader.read_bytes(), Ok(&b""[..]));
    assert_eq!(reader.read_bytes(), Ok(&b"skald"[..]));
    assert_eq!(reader.read_bytes(), Ok(&long[..]));
    assert!(reader.is_empty());
}

#[test]
fn a_run_claiming_more_bytes_than_follow_is_refused() {
    let mut buf = Vec::new();
    encode_bytes(b"abcdef", &mut buf);
    let short = &buf[..buf.len() - 2];
    let mut reader = VarintReader::new(short);
    assert_eq!(reader.read_bytes(), Err(VarintError::Truncated));
    assert_eq!(reader.position(), 0, "a refused read consumes nothing");
}

#[test]
fn ascending_deltas_cost_less_than_whole_values() {
    let values: Vec<i64> = (0..200).map(|i| 1_000_000 + i * 3).collect();
    let whole = encode_all_i64(&values);
    let deltas = encode_deltas(&values);
    assert!(
        deltas.len() < whole.len() / 2,
        "deltas {} should be far smaller than {}",
        deltas.len(),
        whole.len()
    );
    assert_eq!(decode_deltas(&deltas).unwrap(), values);
}

#[test]
fn deltas_round_trip_when_the_sequence_descends() {
    let values = vec![50i64, 40, 40, -10, 0, i64::MAX, i64::MIN];
    let encoded = encode_deltas(&values);
    assert_eq!(decode_deltas(&encoded).unwrap(), values);
}

#[test]
fn an_empty_input_decodes_to_an_empty_sequence() {
    assert_eq!(encode_deltas(&[]), Vec::<u8>::new());
    assert_eq!(decode_deltas(&[]).unwrap(), Vec::<i64>::new());
    assert_eq!(encode_all_u64(&[]), Vec::<u8>::new());
}
