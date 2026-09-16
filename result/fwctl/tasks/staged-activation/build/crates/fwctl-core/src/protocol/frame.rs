use crc32fast::Hasher;
use serde::{Deserialize, Serialize};

use crate::{FwctlError, Result};

pub const MAGIC: [u8; 4] = *b"FWUP";
pub const PROTOCOL_VERSION: u8 = 1;
pub const MAX_FRAME_PAYLOAD: usize = 16 * 1024;
pub const FRAME_HEADER_SIZE: usize = 14;
pub const FRAME_OVERHEAD: usize = FRAME_HEADER_SIZE + 4;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[repr(u8)]
pub enum MessageKind {
    Hello = 0x01,
    HelloResp = 0x02,
    GetInfo = 0x03,
    InfoResp = 0x04,
    BeginUpdate = 0x10,
    BeginUpdateResp = 0x11,
    EraseSlot = 0x12,
    EraseSlotResp = 0x13,
    WriteChunk = 0x14,
    WriteChunkResp = 0x15,
    VerifyImage = 0x16,
    VerifyImageResp = 0x17,
    SetCandidate = 0x18,
    SetCandidateResp = 0x19,
    Reboot = 0x1a,
    RebootResp = 0x1b,
    GetStatus = 0x20,
    StatusResp = 0x21,
    ConfirmBoot = 0x22,
    ConfirmBootResp = 0x23,
    Rollback = 0x24,
    RollbackResp = 0x25,
    Error = 0x7f,
}

impl TryFrom<u8> for MessageKind {
    type Error = FwctlError;

    fn try_from(value: u8) -> Result<Self> {
        match value {
            0x01 => Ok(Self::Hello),
            0x02 => Ok(Self::HelloResp),
            0x03 => Ok(Self::GetInfo),
            0x04 => Ok(Self::InfoResp),
            0x10 => Ok(Self::BeginUpdate),
            0x11 => Ok(Self::BeginUpdateResp),
            0x12 => Ok(Self::EraseSlot),
            0x13 => Ok(Self::EraseSlotResp),
            0x14 => Ok(Self::WriteChunk),
            0x15 => Ok(Self::WriteChunkResp),
            0x16 => Ok(Self::VerifyImage),
            0x17 => Ok(Self::VerifyImageResp),
            0x18 => Ok(Self::SetCandidate),
            0x19 => Ok(Self::SetCandidateResp),
            0x1a => Ok(Self::Reboot),
            0x1b => Ok(Self::RebootResp),
            0x20 => Ok(Self::GetStatus),
            0x21 => Ok(Self::StatusResp),
            0x22 => Ok(Self::ConfirmBoot),
            0x23 => Ok(Self::ConfirmBootResp),
            0x24 => Ok(Self::Rollback),
            0x25 => Ok(Self::RollbackResp),
            0x7f => Ok(Self::Error),
            _ => Err(FwctlError::ProtocolMismatch(format!(
                "unknown message type 0x{value:02x}"
            ))),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Frame {
    pub kind: MessageKind,
    pub sequence: u32,
    pub payload: Vec<u8>,
}

impl Frame {
    pub fn new(kind: MessageKind, sequence: u32, payload: Vec<u8>) -> Result<Self> {
        if payload.len() > MAX_FRAME_PAYLOAD {
            return Err(FwctlError::ProtocolMismatch(format!(
                "frame payload exceeds {MAX_FRAME_PAYLOAD} bytes"
            )));
        }
        Ok(Self {
            kind,
            sequence,
            payload,
        })
    }

    #[must_use]
    pub fn encoded_len(&self) -> usize {
        FRAME_OVERHEAD + self.payload.len()
    }

    pub fn encode(&self) -> Result<Vec<u8>> {
        if self.payload.len() > MAX_FRAME_PAYLOAD {
            return Err(FwctlError::ProtocolMismatch(format!(
                "frame payload exceeds {MAX_FRAME_PAYLOAD} bytes"
            )));
        }
        let payload_len = u32::try_from(self.payload.len())
            .map_err(|_| FwctlError::ProtocolMismatch("frame length overflow".into()))?;
        let mut bytes = Vec::with_capacity(self.encoded_len());
        bytes.extend_from_slice(&MAGIC);
        bytes.push(PROTOCOL_VERSION);
        bytes.push(self.kind as u8);
        bytes.extend_from_slice(&self.sequence.to_le_bytes());
        bytes.extend_from_slice(&payload_len.to_le_bytes());
        bytes.extend_from_slice(&self.payload);
        let crc = crc32fast::hash(&bytes);
        bytes.extend_from_slice(&crc.to_le_bytes());
        Ok(bytes)
    }

    pub fn decode(bytes: &[u8]) -> Result<Self> {
        if bytes.len() < FRAME_OVERHEAD {
            return Err(FwctlError::ProtocolMismatch(
                "truncated frame header".into(),
            ));
        }
        if bytes[..MAGIC.len()] != MAGIC {
            return Err(FwctlError::ProtocolMismatch("invalid frame magic".into()));
        }
        if bytes[4] != PROTOCOL_VERSION {
            return Err(FwctlError::ProtocolMismatch(format!(
                "unsupported protocol version {}",
                bytes[4]
            )));
        }
        let kind = MessageKind::try_from(bytes[5])?;
        let sequence = read_u32(bytes, 6)?;
        let payload_len = usize::try_from(read_u32(bytes, 10)?)
            .map_err(|_| FwctlError::ProtocolMismatch("frame length exceeds host size".into()))?;
        if payload_len > MAX_FRAME_PAYLOAD {
            return Err(FwctlError::ProtocolMismatch(format!(
                "frame payload exceeds {MAX_FRAME_PAYLOAD} bytes"
            )));
        }
        let expected_len = FRAME_OVERHEAD
            .checked_add(payload_len)
            .ok_or_else(|| FwctlError::ProtocolMismatch("frame length overflow".into()))?;
        if bytes.len() != expected_len {
            return Err(FwctlError::ProtocolMismatch(format!(
                "frame length is {}, header requires {expected_len}",
                bytes.len()
            )));
        }
        let crc_offset = FRAME_HEADER_SIZE + payload_len;
        let received_crc = read_u32(bytes, crc_offset)?;
        let mut hasher = Hasher::new();
        hasher.update(&bytes[..crc_offset]);
        let expected_crc = hasher.finalize();
        if received_crc != expected_crc {
            return Err(FwctlError::ProtocolMismatch(format!(
                "frame CRC mismatch: received {received_crc:08x}, expected {expected_crc:08x}"
            )));
        }
        Ok(Self {
            kind,
            sequence,
            payload: bytes[FRAME_HEADER_SIZE..crc_offset].to_vec(),
        })
    }
}

fn read_u32(bytes: &[u8], offset: usize) -> Result<u32> {
    let field = bytes
        .get(offset..offset + 4)
        .ok_or_else(|| FwctlError::ProtocolMismatch("truncated 32-bit frame field".into()))?;
    Ok(u32::from_le_bytes(field.try_into().map_err(|_| {
        FwctlError::ProtocolMismatch("invalid 32-bit frame field".into())
    })?))
}

#[cfg(test)]
mod tests {
    use super::*;

    const MESSAGE_KINDS: &[MessageKind] = &[
        MessageKind::Hello,
        MessageKind::HelloResp,
        MessageKind::GetInfo,
        MessageKind::InfoResp,
        MessageKind::BeginUpdate,
        MessageKind::BeginUpdateResp,
        MessageKind::EraseSlot,
        MessageKind::EraseSlotResp,
        MessageKind::WriteChunk,
        MessageKind::WriteChunkResp,
        MessageKind::VerifyImage,
        MessageKind::VerifyImageResp,
        MessageKind::SetCandidate,
        MessageKind::SetCandidateResp,
        MessageKind::Reboot,
        MessageKind::RebootResp,
        MessageKind::GetStatus,
        MessageKind::StatusResp,
        MessageKind::ConfirmBoot,
        MessageKind::ConfirmBootResp,
        MessageKind::Rollback,
        MessageKind::RollbackResp,
        MessageKind::Error,
    ];

    #[test]
    fn every_message_kind_round_trips() {
        for kind in MESSAGE_KINDS {
            let frame = Frame::new(*kind, 0xaabb_ccdd, vec![1, 2, 3, 4]).unwrap();
            assert_eq!(Frame::decode(&frame.encode().unwrap()).unwrap(), frame);
        }
    }

    #[test]
    fn rejects_corrupted_payload() {
        let frame = Frame::new(MessageKind::WriteChunk, 7, vec![0xaa; 128]).unwrap();
        let mut encoded = frame.encode().unwrap();
        encoded[FRAME_HEADER_SIZE + 20] ^= 0x80;
        assert!(
            Frame::decode(&encoded)
                .unwrap_err()
                .to_string()
                .contains("CRC")
        );
    }

    #[test]
    fn rejects_trailing_and_truncated_bytes() {
        let frame = Frame::new(MessageKind::Hello, 0, Vec::new()).unwrap();
        let mut encoded = frame.encode().unwrap();
        encoded.push(0);
        assert!(Frame::decode(&encoded).is_err());
        encoded.truncate(7);
        assert!(Frame::decode(&encoded).is_err());
    }

    #[test]
    fn rejects_unsupported_version_before_payload() {
        let frame = Frame::new(MessageKind::Hello, 0, Vec::new()).unwrap();
        let mut encoded = frame.encode().unwrap();
        encoded[4] = 2;
        assert!(
            Frame::decode(&encoded)
                .unwrap_err()
                .to_string()
                .contains("version 2")
        );
    }

    #[test]
    fn refuses_oversized_payload() {
        assert!(Frame::new(MessageKind::WriteChunk, 1, vec![0; MAX_FRAME_PAYLOAD + 1]).is_err());
    }

    #[test]
    fn rejects_invalid_magic_and_unknown_message_kind() {
        let frame = Frame::new(MessageKind::Hello, 12, Vec::new()).unwrap();

        let mut invalid_magic = frame.encode().unwrap();
        invalid_magic[0] = b'X';
        assert!(
            Frame::decode(&invalid_magic)
                .unwrap_err()
                .to_string()
                .contains("magic")
        );

        let mut unknown_kind = frame.encode().unwrap();
        unknown_kind[5] = 0x55;
        assert!(
            Frame::decode(&unknown_kind)
                .unwrap_err()
                .to_string()
                .contains("0x55")
        );
    }

    #[test]
    fn rejects_declared_payload_larger_than_wire_data() {
        let frame = Frame::new(MessageKind::GetInfo, 19, vec![1, 2, 3]).unwrap();
        let mut encoded = frame.encode().unwrap();
        encoded[10..14].copy_from_slice(&1024_u32.to_le_bytes());

        let err = Frame::decode(&encoded).unwrap_err();
        assert!(err.to_string().contains("header requires"));
    }

    #[test]
    fn accepts_maximum_payload_exactly() {
        let frame = Frame::new(
            MessageKind::WriteChunk,
            u32::MAX,
            vec![0x5a; MAX_FRAME_PAYLOAD],
        )
        .unwrap();
        assert_eq!(Frame::decode(&frame.encode().unwrap()).unwrap(), frame);
    }
}
