use crate::{FwctlError, Result};

pub(super) struct PayloadWriter {
    bytes: Vec<u8>,
}

impl PayloadWriter {
    pub fn new() -> Self {
        Self { bytes: Vec::new() }
    }

    pub fn u8(&mut self, value: u8) {
        self.bytes.push(value);
    }

    pub fn u16(&mut self, value: u16) {
        self.bytes.extend_from_slice(&value.to_le_bytes());
    }

    pub fn u32(&mut self, value: u32) {
        self.bytes.extend_from_slice(&value.to_le_bytes());
    }

    pub fn u64(&mut self, value: u64) {
        self.bytes.extend_from_slice(&value.to_le_bytes());
    }

    pub fn fixed(&mut self, value: &[u8]) {
        self.bytes.extend_from_slice(value);
    }

    pub fn string(&mut self, value: &str) -> Result<()> {
        let len = u8::try_from(value.len()).map_err(|_| {
            FwctlError::ProtocolMismatch("protocol string exceeds 255 bytes".into())
        })?;
        self.u8(len);
        self.fixed(value.as_bytes());
        Ok(())
    }

    pub fn blob(&mut self, value: &[u8]) -> Result<()> {
        let len = u16::try_from(value.len()).map_err(|_| {
            FwctlError::ProtocolMismatch("protocol blob exceeds 65535 bytes".into())
        })?;
        self.u16(len);
        self.fixed(value);
        Ok(())
    }

    pub fn finish(self) -> Vec<u8> {
        self.bytes
    }
}

pub(super) struct PayloadReader<'a> {
    bytes: &'a [u8],
    cursor: usize,
}

impl<'a> PayloadReader<'a> {
    pub fn new(bytes: &'a [u8]) -> Self {
        Self { bytes, cursor: 0 }
    }

    pub fn u8(&mut self) -> Result<u8> {
        Ok(self.fixed::<1>()?[0])
    }

    pub fn u16(&mut self) -> Result<u16> {
        Ok(u16::from_le_bytes(self.fixed()?))
    }

    pub fn u32(&mut self) -> Result<u32> {
        Ok(u32::from_le_bytes(self.fixed()?))
    }

    pub fn u64(&mut self) -> Result<u64> {
        Ok(u64::from_le_bytes(self.fixed()?))
    }

    pub fn fixed<const N: usize>(&mut self) -> Result<[u8; N]> {
        let end = self
            .cursor
            .checked_add(N)
            .ok_or_else(|| FwctlError::ProtocolMismatch("payload cursor overflow".into()))?;
        let field = self
            .bytes
            .get(self.cursor..end)
            .ok_or_else(|| FwctlError::ProtocolMismatch("truncated message payload".into()))?;
        self.cursor = end;
        field
            .try_into()
            .map_err(|_| FwctlError::ProtocolMismatch("invalid fixed-width field".into()))
    }

    pub fn string(&mut self) -> Result<String> {
        let len = usize::from(self.u8()?);
        let bytes = self.slice(len)?;
        String::from_utf8(bytes.to_vec())
            .map_err(|_| FwctlError::ProtocolMismatch("protocol string is not UTF-8".into()))
    }

    pub fn blob(&mut self) -> Result<Vec<u8>> {
        let len = usize::from(self.u16()?);
        Ok(self.slice(len)?.to_vec())
    }

    pub fn finish(self) -> Result<()> {
        if self.cursor == self.bytes.len() {
            Ok(())
        } else {
            Err(FwctlError::ProtocolMismatch(format!(
                "message has {} trailing payload bytes",
                self.bytes.len() - self.cursor
            )))
        }
    }

    fn slice(&mut self, len: usize) -> Result<&'a [u8]> {
        let end = self
            .cursor
            .checked_add(len)
            .ok_or_else(|| FwctlError::ProtocolMismatch("payload cursor overflow".into()))?;
        let field = self
            .bytes
            .get(self.cursor..end)
            .ok_or_else(|| FwctlError::ProtocolMismatch("truncated message payload".into()))?;
        self.cursor = end;
        Ok(field)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn primitive_fields_round_trip() {
        let mut writer = PayloadWriter::new();
        writer.u8(0xab);
        writer.u16(0x1234);
        writer.u32(0x5566_7788);
        writer.u64(0x1122_3344_5566_7788);
        writer.string("slot-b").unwrap();
        writer.blob(&[1, 2, 3]).unwrap();

        let bytes = writer.finish();
        let mut reader = PayloadReader::new(&bytes);
        assert_eq!(reader.u8().unwrap(), 0xab);
        assert_eq!(reader.u16().unwrap(), 0x1234);
        assert_eq!(reader.u32().unwrap(), 0x5566_7788);
        assert_eq!(reader.u64().unwrap(), 0x1122_3344_5566_7788);
        assert_eq!(reader.string().unwrap(), "slot-b");
        assert_eq!(reader.blob().unwrap(), [1, 2, 3]);
        reader.finish().unwrap();
    }

    #[test]
    fn rejects_truncated_and_trailing_payloads() {
        let mut truncated = PayloadReader::new(&[1, 2, 3]);
        assert!(truncated.u32().is_err());
        assert!(PayloadReader::new(&[1]).finish().is_err());
    }

    #[test]
    fn bounds_variable_width_fields() {
        let mut writer = PayloadWriter::new();
        assert!(writer.string(&"x".repeat(256)).is_err());
        assert!(writer.blob(&vec![0; usize::from(u16::MAX) + 1]).is_err());
    }
}
