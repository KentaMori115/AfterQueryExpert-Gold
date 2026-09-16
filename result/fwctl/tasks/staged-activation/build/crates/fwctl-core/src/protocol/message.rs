use crate::device::{BootState, DeviceInfo, DeviceStatus, Slot, UpdateId, UpdateState};
use crate::package::ImageDigest;
use crate::{FwctlError, Result};

use super::codec::{PayloadReader, PayloadWriter};
use super::{Frame, MessageKind};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BeginUpdate {
    pub update_id: UpdateId,
    pub format_version: u32,
    pub product: String,
    pub image_size: u32,
    pub image_digest: ImageDigest,
    pub firmware_version: String,
    pub hardware_revisions: Vec<String>,
    pub rollback_counter: u64,
    pub image_file: String,
    pub signing_key: String,
    pub signature: [u8; 64],
    pub target_slot: Slot,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BeginUpdateResponse {
    pub accepted_offset: u32,
    pub max_chunk_size: u16,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProtocolMessage {
    Hello {
        host_nonce: u64,
    },
    HelloResponse {
        host_nonce: u64,
        device_id: String,
        max_frame_payload: u16,
    },
    GetInfo,
    InfoResponse(DeviceInfo),
    BeginUpdate(BeginUpdate),
    BeginUpdateResponse(BeginUpdateResponse),
    EraseSlot {
        update_id: UpdateId,
        slot: Slot,
    },
    EraseSlotResponse {
        slot: Slot,
    },
    WriteChunk {
        update_id: UpdateId,
        offset: u32,
        data: Vec<u8>,
    },
    WriteChunkResponse {
        accepted_offset: u32,
    },
    VerifyImage {
        update_id: UpdateId,
    },
    VerifyImageResponse {
        image_digest: ImageDigest,
    },
    SetCandidate {
        update_id: UpdateId,
    },
    SetCandidateResponse,
    Reboot,
    RebootResponse,
    GetStatus,
    StatusResponse(DeviceStatus),
    ConfirmBoot,
    ConfirmBootResponse,
    Rollback,
    RollbackResponse {
        active_slot: Slot,
    },
    Error {
        code: u16,
        message: String,
    },
}

impl ProtocolMessage {
    pub fn into_frame(self, sequence: u32) -> Result<Frame> {
        let kind = self.kind();
        let payload = self.encode_payload()?;
        Frame::new(kind, sequence, payload)
    }

    pub fn from_frame(frame: &Frame) -> Result<Self> {
        let mut payload = PayloadReader::new(&frame.payload);
        let message = match frame.kind {
            MessageKind::Hello => Self::Hello {
                host_nonce: payload.u64()?,
            },
            MessageKind::HelloResp => Self::HelloResponse {
                host_nonce: payload.u64()?,
                device_id: payload.string()?,
                max_frame_payload: payload.u16()?,
            },
            MessageKind::GetInfo => Self::GetInfo,
            MessageKind::InfoResp => Self::InfoResponse(read_device_info(&mut payload)?),
            MessageKind::BeginUpdate => Self::BeginUpdate(BeginUpdate {
                update_id: read_update_id(&mut payload)?,
                format_version: payload.u32()?,
                product: payload.string()?,
                image_size: payload.u32()?,
                image_digest: read_digest(&mut payload)?,
                firmware_version: payload.string()?,
                hardware_revisions: read_string_list(&mut payload)?,
                rollback_counter: payload.u64()?,
                image_file: payload.string()?,
                signing_key: payload.string()?,
                signature: payload.fixed()?,
                target_slot: read_slot(&mut payload)?,
            }),
            MessageKind::BeginUpdateResp => Self::BeginUpdateResponse(BeginUpdateResponse {
                accepted_offset: payload.u32()?,
                max_chunk_size: payload.u16()?,
            }),
            MessageKind::EraseSlot => Self::EraseSlot {
                update_id: read_update_id(&mut payload)?,
                slot: read_slot(&mut payload)?,
            },
            MessageKind::EraseSlotResp => Self::EraseSlotResponse {
                slot: read_slot(&mut payload)?,
            },
            MessageKind::WriteChunk => Self::WriteChunk {
                update_id: read_update_id(&mut payload)?,
                offset: payload.u32()?,
                data: payload.blob()?,
            },
            MessageKind::WriteChunkResp => Self::WriteChunkResponse {
                accepted_offset: payload.u32()?,
            },
            MessageKind::VerifyImage => Self::VerifyImage {
                update_id: read_update_id(&mut payload)?,
            },
            MessageKind::VerifyImageResp => Self::VerifyImageResponse {
                image_digest: read_digest(&mut payload)?,
            },
            MessageKind::SetCandidate => Self::SetCandidate {
                update_id: read_update_id(&mut payload)?,
            },
            MessageKind::SetCandidateResp => Self::SetCandidateResponse,
            MessageKind::Reboot => Self::Reboot,
            MessageKind::RebootResp => Self::RebootResponse,
            MessageKind::GetStatus => Self::GetStatus,
            MessageKind::StatusResp => Self::StatusResponse(read_device_status(&mut payload)?),
            MessageKind::ConfirmBoot => Self::ConfirmBoot,
            MessageKind::ConfirmBootResp => Self::ConfirmBootResponse,
            MessageKind::Rollback => Self::Rollback,
            MessageKind::RollbackResp => Self::RollbackResponse {
                active_slot: read_slot(&mut payload)?,
            },
            MessageKind::Error => Self::Error {
                code: payload.u16()?,
                message: payload.string()?,
            },
        };
        payload.finish()?;
        Ok(message)
    }

    #[must_use]
    pub const fn kind(&self) -> MessageKind {
        match self {
            Self::Hello { .. } => MessageKind::Hello,
            Self::HelloResponse { .. } => MessageKind::HelloResp,
            Self::GetInfo => MessageKind::GetInfo,
            Self::InfoResponse(_) => MessageKind::InfoResp,
            Self::BeginUpdate(_) => MessageKind::BeginUpdate,
            Self::BeginUpdateResponse(_) => MessageKind::BeginUpdateResp,
            Self::EraseSlot { .. } => MessageKind::EraseSlot,
            Self::EraseSlotResponse { .. } => MessageKind::EraseSlotResp,
            Self::WriteChunk { .. } => MessageKind::WriteChunk,
            Self::WriteChunkResponse { .. } => MessageKind::WriteChunkResp,
            Self::VerifyImage { .. } => MessageKind::VerifyImage,
            Self::VerifyImageResponse { .. } => MessageKind::VerifyImageResp,
            Self::SetCandidate { .. } => MessageKind::SetCandidate,
            Self::SetCandidateResponse => MessageKind::SetCandidateResp,
            Self::Reboot => MessageKind::Reboot,
            Self::RebootResponse => MessageKind::RebootResp,
            Self::GetStatus => MessageKind::GetStatus,
            Self::StatusResponse(_) => MessageKind::StatusResp,
            Self::ConfirmBoot => MessageKind::ConfirmBoot,
            Self::ConfirmBootResponse => MessageKind::ConfirmBootResp,
            Self::Rollback => MessageKind::Rollback,
            Self::RollbackResponse { .. } => MessageKind::RollbackResp,
            Self::Error { .. } => MessageKind::Error,
        }
    }

    fn encode_payload(&self) -> Result<Vec<u8>> {
        let mut payload = PayloadWriter::new();
        match self {
            Self::Hello { host_nonce } => payload.u64(*host_nonce),
            Self::HelloResponse {
                host_nonce,
                device_id,
                max_frame_payload,
            } => {
                payload.u64(*host_nonce);
                payload.string(device_id)?;
                payload.u16(*max_frame_payload);
            }
            Self::GetInfo
            | Self::SetCandidateResponse
            | Self::Reboot
            | Self::RebootResponse
            | Self::GetStatus
            | Self::ConfirmBoot
            | Self::ConfirmBootResponse
            | Self::Rollback => {}
            Self::InfoResponse(info) => write_device_info(&mut payload, info)?,
            Self::BeginUpdate(begin) => {
                payload.fixed(begin.update_id.as_bytes());
                payload.u32(begin.format_version);
                payload.string(&begin.product)?;
                payload.u32(begin.image_size);
                payload.fixed(begin.image_digest.as_bytes());
                payload.string(&begin.firmware_version)?;
                write_string_list(&mut payload, &begin.hardware_revisions)?;
                payload.u64(begin.rollback_counter);
                payload.string(&begin.image_file)?;
                payload.string(&begin.signing_key)?;
                payload.fixed(&begin.signature);
                write_slot(&mut payload, begin.target_slot);
            }
            Self::BeginUpdateResponse(response) => {
                payload.u32(response.accepted_offset);
                payload.u16(response.max_chunk_size);
            }
            Self::EraseSlot { update_id, slot } => {
                payload.fixed(update_id.as_bytes());
                write_slot(&mut payload, *slot);
            }
            Self::EraseSlotResponse { slot } => write_slot(&mut payload, *slot),
            Self::WriteChunk {
                update_id,
                offset,
                data,
            } => {
                payload.fixed(update_id.as_bytes());
                payload.u32(*offset);
                payload.blob(data)?;
            }
            Self::WriteChunkResponse { accepted_offset } => payload.u32(*accepted_offset),
            Self::VerifyImage { update_id } | Self::SetCandidate { update_id } => {
                payload.fixed(update_id.as_bytes());
            }
            Self::VerifyImageResponse { image_digest } => {
                payload.fixed(image_digest.as_bytes());
            }
            Self::StatusResponse(status) => write_device_status(&mut payload, status),
            Self::RollbackResponse { active_slot } => write_slot(&mut payload, *active_slot),
            Self::Error { code, message } => {
                payload.u16(*code);
                payload.string(message)?;
            }
        }
        Ok(payload.finish())
    }
}

fn write_device_info(payload: &mut PayloadWriter, info: &DeviceInfo) -> Result<()> {
    info.validate()?;
    payload.string(&info.device_id)?;
    payload.string(&info.product)?;
    payload.string(&info.hardware_revision)?;
    payload.string(&info.firmware_version)?;
    payload.string(&info.bootloader_version)?;
    write_slot(payload, info.active_slot);
    write_optional_slot(payload, info.candidate_slot);
    payload.u64(info.rollback_counter);
    write_update_state(payload, info.update_state);
    Ok(())
}

fn read_device_info(payload: &mut PayloadReader<'_>) -> Result<DeviceInfo> {
    let info = DeviceInfo {
        device_id: payload.string()?,
        product: payload.string()?,
        hardware_revision: payload.string()?,
        firmware_version: payload.string()?,
        bootloader_version: payload.string()?,
        active_slot: read_slot(payload)?,
        candidate_slot: read_optional_slot(payload)?,
        rollback_counter: payload.u64()?,
        update_state: read_update_state(payload)?,
    };
    info.validate()?;
    Ok(info)
}

fn write_device_status(payload: &mut PayloadWriter, status: &DeviceStatus) {
    write_update_state(payload, status.state);
    write_boot_state(payload, status.boot_state);
    match status.update_id {
        Some(update_id) => {
            payload.u8(1);
            payload.fixed(update_id.as_bytes());
        }
        None => payload.u8(0),
    }
    payload.u32(status.accepted_offset);
    payload.u8(u8::from(status.candidate_healthy));
    payload.u8(status.boot_attempts);
}

fn read_device_status(payload: &mut PayloadReader<'_>) -> Result<DeviceStatus> {
    let state = read_update_state(payload)?;
    let boot_state = read_boot_state(payload)?;
    let update_id = match payload.u8()? {
        0 => None,
        1 => Some(read_update_id(payload)?),
        value => return Err(invalid_enum("update ID presence", value)),
    };
    Ok(DeviceStatus {
        state,
        boot_state,
        update_id,
        accepted_offset: payload.u32()?,
        candidate_healthy: read_bool(payload)?,
        boot_attempts: payload.u8()?,
    })
}

fn write_slot(payload: &mut PayloadWriter, slot: Slot) {
    payload.u8(match slot {
        Slot::A => 0,
        Slot::B => 1,
    });
}

fn read_slot(payload: &mut PayloadReader<'_>) -> Result<Slot> {
    match payload.u8()? {
        0 => Ok(Slot::A),
        1 => Ok(Slot::B),
        value => Err(invalid_enum("slot", value)),
    }
}

fn write_optional_slot(payload: &mut PayloadWriter, slot: Option<Slot>) {
    match slot {
        None => payload.u8(0),
        Some(Slot::A) => payload.u8(1),
        Some(Slot::B) => payload.u8(2),
    }
}

fn read_optional_slot(payload: &mut PayloadReader<'_>) -> Result<Option<Slot>> {
    match payload.u8()? {
        0 => Ok(None),
        1 => Ok(Some(Slot::A)),
        2 => Ok(Some(Slot::B)),
        value => Err(invalid_enum("optional slot", value)),
    }
}

fn write_update_state(payload: &mut PayloadWriter, state: UpdateState) {
    payload.u8(match state {
        UpdateState::Idle => 0,
        UpdateState::Preparing => 1,
        UpdateState::Erasing => 2,
        UpdateState::Receiving => 3,
        UpdateState::Verifying => 4,
        UpdateState::CandidateReady => 5,
        UpdateState::AwaitingConfirmation => 6,
        UpdateState::Confirmed => 7,
        UpdateState::RolledBack => 8,
        UpdateState::Failed => 9,
    });
}

fn read_update_state(payload: &mut PayloadReader<'_>) -> Result<UpdateState> {
    match payload.u8()? {
        0 => Ok(UpdateState::Idle),
        1 => Ok(UpdateState::Preparing),
        2 => Ok(UpdateState::Erasing),
        3 => Ok(UpdateState::Receiving),
        4 => Ok(UpdateState::Verifying),
        5 => Ok(UpdateState::CandidateReady),
        6 => Ok(UpdateState::AwaitingConfirmation),
        7 => Ok(UpdateState::Confirmed),
        8 => Ok(UpdateState::RolledBack),
        9 => Ok(UpdateState::Failed),
        value => Err(invalid_enum("update state", value)),
    }
}

fn write_boot_state(payload: &mut PayloadWriter, state: BootState) {
    payload.u8(match state {
        BootState::Confirmed => 0,
        BootState::Candidate => 1,
        BootState::Rollback => 2,
    });
}

fn read_boot_state(payload: &mut PayloadReader<'_>) -> Result<BootState> {
    match payload.u8()? {
        0 => Ok(BootState::Confirmed),
        1 => Ok(BootState::Candidate),
        2 => Ok(BootState::Rollback),
        value => Err(invalid_enum("boot state", value)),
    }
}

fn read_update_id(payload: &mut PayloadReader<'_>) -> Result<UpdateId> {
    Ok(UpdateId::from_bytes(payload.fixed()?))
}

fn read_digest(payload: &mut PayloadReader<'_>) -> Result<ImageDigest> {
    Ok(ImageDigest::from_bytes(payload.fixed()?))
}

fn read_bool(payload: &mut PayloadReader<'_>) -> Result<bool> {
    match payload.u8()? {
        0 => Ok(false),
        1 => Ok(true),
        value => Err(invalid_enum("boolean", value)),
    }
}

fn write_string_list(payload: &mut PayloadWriter, values: &[String]) -> Result<()> {
    let count = u8::try_from(values.len())
        .map_err(|_| FwctlError::ProtocolMismatch("too many string list entries".into()))?;
    payload.u8(count);
    for value in values {
        payload.string(value)?;
    }
    Ok(())
}

fn read_string_list(payload: &mut PayloadReader<'_>) -> Result<Vec<String>> {
    let count = usize::from(payload.u8()?);
    (0..count).map(|_| payload.string()).collect()
}

fn invalid_enum(field: &str, value: u8) -> FwctlError {
    FwctlError::ProtocolMismatch(format!("invalid {field} value {value}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::package::digest_bytes;

    fn info() -> DeviceInfo {
        DeviceInfo {
            device_id: "board-1029".into(),
            product: "sensor-node".into(),
            hardware_revision: "A2".into(),
            firmware_version: "1.4.0".into(),
            bootloader_version: "0.9.0".into(),
            active_slot: Slot::A,
            candidate_slot: Some(Slot::B),
            rollback_counter: 19,
            update_state: UpdateState::Receiving,
        }
    }

    fn messages() -> Vec<ProtocolMessage> {
        let update_id = UpdateId::from_bytes([3; 16]);
        let digest = digest_bytes(b"candidate");
        vec![
            ProtocolMessage::Hello { host_nonce: 42 },
            ProtocolMessage::HelloResponse {
                host_nonce: 42,
                device_id: "board-1029".into(),
                max_frame_payload: 4096,
            },
            ProtocolMessage::GetInfo,
            ProtocolMessage::InfoResponse(info()),
            ProtocolMessage::BeginUpdate(BeginUpdate {
                update_id,
                format_version: 1,
                product: "sensor-node".into(),
                image_size: 8192,
                image_digest: digest,
                firmware_version: "1.5.0".into(),
                hardware_revisions: vec!["A1".into(), "A2".into()],
                rollback_counter: 20,
                image_file: "firmware.bin".into(),
                signing_key: "release".into(),
                signature: [0x33; 64],
                target_slot: Slot::B,
            }),
            ProtocolMessage::BeginUpdateResponse(BeginUpdateResponse {
                accepted_offset: 1024,
                max_chunk_size: 2048,
            }),
            ProtocolMessage::EraseSlot {
                update_id,
                slot: Slot::B,
            },
            ProtocolMessage::EraseSlotResponse { slot: Slot::B },
            ProtocolMessage::WriteChunk {
                update_id,
                offset: 1024,
                data: vec![0x5a; 128],
            },
            ProtocolMessage::WriteChunkResponse {
                accepted_offset: 1152,
            },
            ProtocolMessage::VerifyImage { update_id },
            ProtocolMessage::VerifyImageResponse {
                image_digest: digest,
            },
            ProtocolMessage::SetCandidate { update_id },
            ProtocolMessage::SetCandidateResponse,
            ProtocolMessage::Reboot,
            ProtocolMessage::RebootResponse,
            ProtocolMessage::GetStatus,
            ProtocolMessage::StatusResponse(DeviceStatus {
                state: UpdateState::AwaitingConfirmation,
                boot_state: BootState::Candidate,
                update_id: Some(update_id),
                accepted_offset: 8192,
                candidate_healthy: true,
                boot_attempts: 1,
            }),
            ProtocolMessage::ConfirmBoot,
            ProtocolMessage::ConfirmBootResponse,
            ProtocolMessage::Rollback,
            ProtocolMessage::RollbackResponse {
                active_slot: Slot::A,
            },
            ProtocolMessage::Error {
                code: 17,
                message: "flash busy".into(),
            },
        ]
    }

    #[test]
    fn every_protocol_message_round_trips() {
        for (sequence, message) in messages().into_iter().enumerate() {
            let expected = message.clone();
            let sequence = u32::try_from(sequence).unwrap();
            let frame = message.into_frame(sequence).unwrap();
            assert_eq!(frame.sequence, sequence);
            assert_eq!(ProtocolMessage::from_frame(&frame).unwrap(), expected);
        }
    }

    #[test]
    fn empty_message_rejects_trailing_payload() {
        let frame = Frame::new(MessageKind::GetInfo, 1, vec![0]).unwrap();
        assert!(ProtocolMessage::from_frame(&frame).is_err());
    }

    #[test]
    fn rejects_unknown_slot_encoding() {
        let frame = Frame::new(MessageKind::RollbackResp, 1, vec![9]).unwrap();
        assert!(ProtocolMessage::from_frame(&frame).is_err());
    }
}
