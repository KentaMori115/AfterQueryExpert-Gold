use crate::{FwctlError, Result};

use super::{FRAME_HEADER_SIZE, FRAME_OVERHEAD, Frame, MAGIC, MAX_FRAME_PAYLOAD};

const MAX_BUFFERED_BYTES: usize = 2 * (MAX_FRAME_PAYLOAD + FRAME_OVERHEAD);

#[derive(Debug, Default)]
pub struct FrameDecoder {
    rx_buf: Vec<u8>,
}

impl FrameDecoder {
    #[must_use]
    pub const fn new() -> Self {
        Self { rx_buf: Vec::new() }
    }

    pub fn push(&mut self, bytes: &[u8]) -> Result<()> {
        let new_len = self
            .rx_buf
            .len()
            .checked_add(bytes.len())
            .ok_or_else(|| FwctlError::ProtocolMismatch("receive buffer overflow".into()))?;
        if new_len > MAX_BUFFERED_BYTES {
            self.rx_buf.clear();
            return Err(FwctlError::ProtocolMismatch(format!(
                "receive buffer exceeds {MAX_BUFFERED_BYTES} bytes"
            )));
        }
        self.rx_buf.extend_from_slice(bytes);
        Ok(())
    }

    pub fn next_frame(&mut self) -> Result<Option<Frame>> {
        self.discard_line_noise();
        if self.rx_buf.len() < FRAME_HEADER_SIZE {
            return Ok(None);
        }
        let payload_len = u32::from_le_bytes(
            self.rx_buf[10..FRAME_HEADER_SIZE]
                .try_into()
                .map_err(|_| FwctlError::ProtocolMismatch("invalid frame length field".into()))?,
        );
        let payload_len = usize::try_from(payload_len)
            .map_err(|_| FwctlError::ProtocolMismatch("frame length exceeds host size".into()))?;
        if payload_len > MAX_FRAME_PAYLOAD {
            self.rx_buf.drain(..MAGIC.len());
            return Err(FwctlError::ProtocolMismatch(format!(
                "frame payload exceeds {MAX_FRAME_PAYLOAD} bytes"
            )));
        }
        let frame_len = FRAME_OVERHEAD
            .checked_add(payload_len)
            .ok_or_else(|| FwctlError::ProtocolMismatch("frame length overflow".into()))?;
        if self.rx_buf.len() < frame_len {
            return Ok(None);
        }
        let decode_result = Frame::decode(&self.rx_buf[..frame_len]);
        match decode_result {
            Ok(frame) => {
                self.rx_buf.drain(..frame_len);
                Ok(Some(frame))
            }
            Err(err) => {
                self.rx_buf.drain(..MAGIC.len());
                Err(err)
            }
        }
    }

    #[must_use]
    pub fn buffered_len(&self) -> usize {
        self.rx_buf.len()
    }

    pub fn clear(&mut self) {
        self.rx_buf.clear();
    }

    fn discard_line_noise(&mut self) {
        if self.rx_buf.starts_with(&MAGIC) {
            return;
        }
        if let Some(offset) = self
            .rx_buf
            .windows(MAGIC.len())
            .position(|window| window == MAGIC)
        {
            self.rx_buf.drain(..offset);
        } else {
            let keep = (1..MAGIC.len())
                .rev()
                .find(|&len| self.rx_buf.ends_with(&MAGIC[..len]))
                .unwrap_or(0);
            let discard = self.rx_buf.len() - keep;
            self.rx_buf.drain(..discard);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::MessageKind;

    #[test]
    fn decodes_frame_received_one_byte_at_a_time() {
        let frame = Frame::new(MessageKind::WriteChunk, 9, vec![0xa5; 1024]).unwrap();
        let encoded = frame.encode().unwrap();
        let mut decoder = FrameDecoder::new();
        for byte in encoded {
            decoder.push(&[byte]).unwrap();
        }
        assert_eq!(decoder.next_frame().unwrap(), Some(frame));
        assert_eq!(decoder.buffered_len(), 0);
    }

    #[test]
    fn retains_back_to_back_frames() {
        let first = Frame::new(MessageKind::Hello, 1, vec![1]).unwrap();
        let second = Frame::new(MessageKind::GetInfo, 2, Vec::new()).unwrap();
        let mut bytes = first.encode().unwrap();
        bytes.extend_from_slice(&second.encode().unwrap());
        let mut decoder = FrameDecoder::new();
        decoder.push(&bytes).unwrap();
        assert_eq!(decoder.next_frame().unwrap(), Some(first));
        assert_eq!(decoder.next_frame().unwrap(), Some(second));
        assert_eq!(decoder.next_frame().unwrap(), None);
    }

    #[test]
    fn skips_serial_boot_noise() {
        let frame = Frame::new(MessageKind::HelloResp, 1, vec![2]).unwrap();
        let mut decoder = FrameDecoder::new();
        decoder.push(b"booting...\r\n").unwrap();
        decoder.push(&frame.encode().unwrap()).unwrap();
        assert_eq!(decoder.next_frame().unwrap(), Some(frame));
    }

    #[test]
    fn recovers_after_corrupt_frame() {
        let corrupt = Frame::new(MessageKind::Hello, 1, vec![0; 8]).unwrap();
        let valid = Frame::new(MessageKind::GetInfo, 2, Vec::new()).unwrap();
        let mut bytes = corrupt.encode().unwrap();
        bytes[FRAME_HEADER_SIZE] ^= 1;
        bytes.extend_from_slice(&valid.encode().unwrap());
        let mut decoder = FrameDecoder::new();
        decoder.push(&bytes).unwrap();
        assert!(decoder.next_frame().is_err());
        assert_eq!(decoder.next_frame().unwrap(), Some(valid));
    }

    #[test]
    fn bounds_unframed_input() {
        let mut decoder = FrameDecoder::new();
        assert!(decoder.push(&vec![0; MAX_BUFFERED_BYTES + 1]).is_err());
        assert_eq!(decoder.buffered_len(), 0);
    }

    #[test]
    fn preserves_partial_magic_across_reads() {
        let frame = Frame::new(MessageKind::GetStatus, 42, Vec::new()).unwrap();
        let encoded = frame.encode().unwrap();
        let mut decoder = FrameDecoder::new();

        decoder.push(b"RP2350 boot\r\nFW").unwrap();
        assert_eq!(decoder.next_frame().unwrap(), None);
        assert_eq!(decoder.buffered_len(), 2);

        decoder.push(&encoded[2..]).unwrap();
        assert_eq!(decoder.next_frame().unwrap(), Some(frame));
    }

    #[test]
    fn resumes_after_oversized_length_field() {
        let malformed = Frame::new(MessageKind::Hello, 1, Vec::new()).unwrap();
        let mut malformed = malformed.encode().unwrap();
        let hostile_len = u32::try_from(MAX_FRAME_PAYLOAD + 1).unwrap();
        malformed[10..14].copy_from_slice(&hostile_len.to_le_bytes());
        let valid = Frame::new(MessageKind::GetInfo, 2, Vec::new()).unwrap();
        malformed.extend_from_slice(&valid.encode().unwrap());

        let mut decoder = FrameDecoder::new();
        decoder.push(&malformed).unwrap();
        assert!(decoder.next_frame().is_err());
        assert_eq!(decoder.next_frame().unwrap(), Some(valid));
    }

    #[test]
    fn clear_discards_partial_frame() {
        let frame = Frame::new(MessageKind::InfoResp, 6, vec![4; 64]).unwrap();
        let encoded = frame.encode().unwrap();
        let mut decoder = FrameDecoder::new();
        decoder.push(&encoded[..FRAME_HEADER_SIZE]).unwrap();
        assert!(decoder.buffered_len() > 0);
        decoder.clear();
        assert_eq!(decoder.buffered_len(), 0);
        assert_eq!(decoder.next_frame().unwrap(), None);
    }
}
