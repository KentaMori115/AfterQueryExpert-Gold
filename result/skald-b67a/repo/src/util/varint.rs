//! LEB128 variable-length integers — part of the `util` subsystem.
//!
//! Unsigned values use plain LEB128; signed values are zig-zag mapped onto
//! unsigned first, so small magnitudes of either sign stay one byte wide.
//! Decoding is total: every function reports how many bytes it consumed and
//! refuses input that is truncated or over-long rather than wrapping.

/// The widest encoding a 64-bit value can produce.
pub const MAX_VARINT_LEN: usize = 10;

/// Why a decode refused the bytes it was given.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VarintError {
    /// The continuation bit was set on the last available byte.
    Truncated,
    /// More than [`MAX_VARINT_LEN`] bytes carried the continuation bit.
    TooLong,
    /// The value needs more than 64 bits.
    Overflow,
}

/// Append the unsigned LEB128 encoding of `value` to `out`, returning the
/// number of bytes written.
pub fn encode_u64(value: u64, out: &mut Vec<u8>) -> usize {
    let mut v = value;
    let mut written = 0;
    loop {
        let mut byte = (v & 0x7F) as u8;
        v >>= 7;
        if v != 0 {
            byte |= 0x80;
        }
        out.push(byte);
        written += 1;
        if v == 0 {
            return written;
        }
    }
}

/// Zig-zag map a signed value onto the unsigned range.
pub fn zigzag(value: i64) -> u64 {
    ((value << 1) ^ (value >> 63)) as u64
}

/// Undo [`zigzag`].
pub fn unzigzag(value: u64) -> i64 {
    ((value >> 1) as i64) ^ -((value & 1) as i64)
}

/// Append the zig-zag LEB128 encoding of `value` to `out`.
pub fn encode_i64(value: i64, out: &mut Vec<u8>) -> usize {
    encode_u64(zigzag(value), out)
}

/// Decode an unsigned LEB128 value from the front of `data`.
///
/// On success returns the value and the number of bytes it occupied.
pub fn decode_u64(data: &[u8]) -> Result<(u64, usize), VarintError> {
    let mut result: u64 = 0;
    let mut shift = 0u32;
    for (i, &byte) in data.iter().enumerate() {
        if i >= MAX_VARINT_LEN {
            return Err(VarintError::TooLong);
        }
        let payload = (byte & 0x7F) as u64;
        if shift >= 64 || (shift == 63 && payload > 1) {
            return Err(VarintError::Overflow);
        }
        result |= payload << shift;
        if byte & 0x80 == 0 {
            return Ok((result, i + 1));
        }
        shift += 7;
    }
    Err(VarintError::Truncated)
}

/// Decode a zig-zag LEB128 value from the front of `data`.
pub fn decode_i64(data: &[u8]) -> Result<(i64, usize), VarintError> {
    let (raw, used) = decode_u64(data)?;
    Ok((unzigzag(raw), used))
}

/// How many bytes [`encode_u64`] would write for `value`.
pub fn encoded_len_u64(value: u64) -> usize {
    let mut v = value >> 7;
    let mut n = 1;
    while v != 0 {
        v >>= 7;
        n += 1;
    }
    n
}

/// How many bytes [`encode_i64`] would write for `value`.
pub fn encoded_len_i64(value: i64) -> usize {
    encoded_len_u64(zigzag(value))
}

/// A forward-only reader over a buffer of concatenated varints.
///
/// The cursor never moves past the end of the buffer, and a failed read
/// leaves the position where it was, so a caller can retry after appending
/// more bytes.
pub struct VarintReader<'a> {
    data: &'a [u8],
    pos: usize,
}

impl<'a> VarintReader<'a> {
    pub fn new(data: &'a [u8]) -> VarintReader<'a> {
        VarintReader { data, pos: 0 }
    }

    /// Byte offset of the next unread byte.
    pub fn position(&self) -> usize {
        self.pos
    }

    /// Bytes not yet consumed.
    pub fn remaining(&self) -> usize {
        self.data.len() - self.pos
    }

    pub fn is_empty(&self) -> bool {
        self.remaining() == 0
    }

    /// Read one unsigned value, advancing past it only if it decodes.
    pub fn read_u64(&mut self) -> Result<u64, VarintError> {
        let (value, used) = decode_u64(&self.data[self.pos..])?;
        self.pos += used;
        Ok(value)
    }

    /// Read one signed value, advancing past it only if it decodes.
    pub fn read_i64(&mut self) -> Result<i64, VarintError> {
        let (value, used) = decode_i64(&self.data[self.pos..])?;
        self.pos += used;
        Ok(value)
    }

    /// Read a length-prefixed byte run.
    pub fn read_bytes(&mut self) -> Result<&'a [u8], VarintError> {
        let start = self.pos;
        let len = self.read_u64()? as usize;
        if len > self.remaining() {
            self.pos = start;
            return Err(VarintError::Truncated);
        }
        let out = &self.data[self.pos..self.pos + len];
        self.pos += len;
        Ok(out)
    }

    /// Decode every remaining unsigned value, stopping at the first refusal.
    pub fn read_all_u64(&mut self) -> Result<Vec<u64>, VarintError> {
        let mut out = Vec::new();
        while !self.is_empty() {
            out.push(self.read_u64()?);
        }
        Ok(out)
    }
}

/// Append a length-prefixed byte run to `out`.
pub fn encode_bytes(data: &[u8], out: &mut Vec<u8>) -> usize {
    let header = encode_u64(data.len() as u64, out);
    out.extend_from_slice(data);
    header + data.len()
}

/// Encode a whole slice of unsigned values back to back.
pub fn encode_all_u64(values: &[u64]) -> Vec<u8> {
    let mut out = Vec::with_capacity(values.len());
    for &v in values {
        encode_u64(v, &mut out);
    }
    out
}

/// Encode a whole slice of signed values back to back.
pub fn encode_all_i64(values: &[i64]) -> Vec<u8> {
    let mut out = Vec::with_capacity(values.len());
    for &v in values {
        encode_i64(v, &mut out);
    }
    out
}

/// Delta-encode an ascending sequence: the first value whole, the rest as
/// gaps. Sequences that are not ascending are encoded as signed deltas, so
/// the round trip holds either way.
pub fn encode_deltas(values: &[i64]) -> Vec<u8> {
    let mut out = Vec::new();
    let mut prev = 0i64;
    for &v in values {
        encode_i64(v.wrapping_sub(prev), &mut out);
        prev = v;
    }
    out
}

/// Undo [`encode_deltas`].
pub fn decode_deltas(data: &[u8]) -> Result<Vec<i64>, VarintError> {
    let mut reader = VarintReader::new(data);
    let mut out = Vec::new();
    let mut prev = 0i64;
    while !reader.is_empty() {
        let delta = reader.read_i64()?;
        prev = prev.wrapping_add(delta);
        out.push(prev);
    }
    Ok(out)
}
