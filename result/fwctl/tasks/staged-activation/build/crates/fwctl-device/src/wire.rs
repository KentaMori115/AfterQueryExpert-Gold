use alloc::vec::Vec;

use thiserror::Error;

const MAGIC: [u8; 4] = *b"FWUP";
const PROTOCOL_VERSION: u8 = 1;
const HEADER_SIZE: usize = 14;
const FRAME_OVERHEAD: usize = 18;
const MAX_PAYLOAD: usize = 16 * 1024;
const MAX_BUFFERED: usize = 2 * (MAX_PAYLOAD + FRAME_OVERHEAD);

pub trait DeviceSerialDriver {
    fn read(&mut self, data: &mut [u8]) -> Result<usize, u32>;
    fn write(&mut self, data: &[u8]) -> Result<(), u32>;
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DeviceFrame {
    pub kind: u8,
    pub sequence: u32,
    pub payload: Vec<u8>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DeviceReply {
    pub kind: u8,
    pub payload: Vec<u8>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DeviceHandlerError {
    pub code: u16,
    pub message: &'static str,
}

pub trait DeviceFrameHandler<F> {
    fn handle(
        &mut self,
        updater: &mut crate::DeviceUpdater<F>,
        kind: u8,
        payload: &[u8],
    ) -> Result<DeviceReply, DeviceHandlerError>
    where
        F: crate::Flash;
}

#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum DeviceLinkError {
    #[error("device serial driver failed with code {0}")]
    Driver(u32),
    #[error("serial receive buffer exceeded its protocol bound")]
    BufferOverflow,
    #[error("truncated or malformed fwctl frame")]
    MalformedFrame,
    #[error("unsupported fwctl protocol version {0}")]
    UnsupportedVersion(u8),
    #[error("fwctl frame payload exceeds the protocol limit")]
    OversizedPayload,
    #[error("fwctl frame CRC mismatch")]
    CrcMismatch,
    #[error("device response text exceeds the protocol limit")]
    ResponseTooLong,
}

pub struct DeviceSerialLink<U> {
    driver: U,
    rx_buf: Vec<u8>,
}

impl<U> DeviceSerialLink<U> {
    #[must_use]
    pub const fn new(driver: U) -> Self {
        Self {
            driver,
            rx_buf: Vec::new(),
        }
    }

    pub fn into_inner(self) -> U {
        self.driver
    }
}

impl<U: DeviceSerialDriver> DeviceSerialLink<U> {
    pub fn service<F: crate::Flash>(
        &mut self,
        updater: &mut crate::DeviceUpdater<F>,
        handler: &mut impl DeviceFrameHandler<F>,
    ) -> Result<bool, DeviceLinkError> {
        let mut serial_packet = [0_u8; 64];
        let count = self
            .driver
            .read(&mut serial_packet)
            .map_err(DeviceLinkError::Driver)?;
        let packet = serial_packet
            .get(..count)
            .ok_or(DeviceLinkError::BufferOverflow)?;
        let next_len = self
            .rx_buf
            .len()
            .checked_add(packet.len())
            .ok_or(DeviceLinkError::BufferOverflow)?;
        if next_len > MAX_BUFFERED {
            self.rx_buf.clear();
            return Err(DeviceLinkError::BufferOverflow);
        }
        self.rx_buf.extend_from_slice(packet);
        let Some(frame) = self.next_frame()? else {
            return Ok(false);
        };
        let reply = match handler.handle(updater, frame.kind, &frame.payload) {
            Ok(reply) => reply,
            Err(err) => error_reply(err)?,
        };
        self.send(frame.sequence, &reply)?;
        Ok(true)
    }

    fn next_frame(&mut self) -> Result<Option<DeviceFrame>, DeviceLinkError> {
        self.discard_noise();
        if self.rx_buf.len() < HEADER_SIZE {
            return Ok(None);
        }
        if self.rx_buf[4] != PROTOCOL_VERSION {
            let version = self.rx_buf[4];
            self.rx_buf.drain(..MAGIC.len());
            return Err(DeviceLinkError::UnsupportedVersion(version));
        }
        let payload_len = usize::try_from(read_u32(&self.rx_buf, 10)?)
            .map_err(|_| DeviceLinkError::OversizedPayload)?;
        if payload_len > MAX_PAYLOAD {
            self.rx_buf.drain(..MAGIC.len());
            return Err(DeviceLinkError::OversizedPayload);
        }
        let frame_len = FRAME_OVERHEAD
            .checked_add(payload_len)
            .ok_or(DeviceLinkError::OversizedPayload)?;
        if self.rx_buf.len() < frame_len {
            return Ok(None);
        }
        let crc_offset = HEADER_SIZE + payload_len;
        let received_crc = read_u32(&self.rx_buf, crc_offset)?;
        if crc32(&self.rx_buf[..crc_offset]) != received_crc {
            self.rx_buf.drain(..MAGIC.len());
            return Err(DeviceLinkError::CrcMismatch);
        }
        let frame = DeviceFrame {
            kind: self.rx_buf[5],
            sequence: read_u32(&self.rx_buf, 6)?,
            payload: self.rx_buf[HEADER_SIZE..crc_offset].to_vec(),
        };
        self.rx_buf.drain(..frame_len);
        Ok(Some(frame))
    }

    fn send(&mut self, sequence: u32, reply: &DeviceReply) -> Result<(), DeviceLinkError> {
        if reply.payload.len() > MAX_PAYLOAD {
            return Err(DeviceLinkError::OversizedPayload);
        }
        let payload_len =
            u32::try_from(reply.payload.len()).map_err(|_| DeviceLinkError::OversizedPayload)?;
        let mut bytes = Vec::with_capacity(FRAME_OVERHEAD + reply.payload.len());
        bytes.extend_from_slice(&MAGIC);
        bytes.push(PROTOCOL_VERSION);
        bytes.push(reply.kind);
        bytes.extend_from_slice(&sequence.to_le_bytes());
        bytes.extend_from_slice(&payload_len.to_le_bytes());
        bytes.extend_from_slice(&reply.payload);
        bytes.extend_from_slice(&crc32(&bytes).to_le_bytes());
        self.driver.write(&bytes).map_err(DeviceLinkError::Driver)
    }

    fn discard_noise(&mut self) {
        if self.rx_buf.starts_with(&MAGIC) {
            return;
        }
        if let Some(offset) = self
            .rx_buf
            .windows(MAGIC.len())
            .position(|window| window == MAGIC)
        {
            self.rx_buf.drain(..offset);
            return;
        }
        let keep = (1..MAGIC.len())
            .rev()
            .find(|&len| self.rx_buf.ends_with(&MAGIC[..len]))
            .unwrap_or(0);
        self.rx_buf.drain(..self.rx_buf.len() - keep);
    }
}

fn error_reply(error: DeviceHandlerError) -> Result<DeviceReply, DeviceLinkError> {
    let message_len =
        u8::try_from(error.message.len()).map_err(|_| DeviceLinkError::ResponseTooLong)?;
    let mut payload = Vec::with_capacity(3 + error.message.len());
    payload.extend_from_slice(&error.code.to_le_bytes());
    payload.push(message_len);
    payload.extend_from_slice(error.message.as_bytes());
    Ok(DeviceReply {
        kind: 0x7f,
        payload,
    })
}

fn read_u32(bytes: &[u8], offset: usize) -> Result<u32, DeviceLinkError> {
    let field = bytes
        .get(offset..offset + 4)
        .ok_or(DeviceLinkError::MalformedFrame)?;
    Ok(u32::from_le_bytes(
        field
            .try_into()
            .map_err(|_| DeviceLinkError::MalformedFrame)?,
    ))
}

fn crc32(bytes: &[u8]) -> u32 {
    let mut crc = u32::MAX;
    for &byte in bytes {
        crc ^= u32::from(byte);
        for _ in 0..8 {
            let mask = 0_u32.wrapping_sub(crc & 1);
            crc = (crc >> 1) ^ (0xedb8_8320 & mask);
        }
    }
    !crc
}

#[cfg(test)]
mod tests {
    use std::collections::VecDeque;

    use fwctl_core::protocol::{Frame, MessageKind};

    use super::*;
    use crate::{BootMetadata, DeviceUpdater, FlashError, Region, Slot, SlotLayout};

    #[derive(Default)]
    struct Usb {
        rx: VecDeque<Vec<u8>>,
        tx: Vec<Vec<u8>>,
    }

    impl DeviceSerialDriver for Usb {
        fn read(&mut self, data: &mut [u8]) -> Result<usize, u32> {
            let Some(packet) = self.rx.pop_front() else {
                return Ok(0);
            };
            data[..packet.len()].copy_from_slice(&packet);
            Ok(packet.len())
        }

        fn write(&mut self, data: &[u8]) -> Result<(), u32> {
            self.tx.push(data.to_vec());
            Ok(())
        }
    }

    struct FlashMem(Vec<u8>);

    impl crate::Flash for FlashMem {
        fn capacity(&self) -> u32 {
            4096
        }
        fn erase_size(&self) -> u32 {
            256
        }
        fn write_size(&self) -> u32 {
            4
        }
        fn erase(&mut self, start: u32, len: u32) -> Result<(), FlashError> {
            self.0[start as usize..(start + len) as usize].fill(0xff);
            Ok(())
        }
        fn write(&mut self, offset: u32, data: &[u8]) -> Result<(), FlashError> {
            self.0[offset as usize..offset as usize + data.len()].copy_from_slice(data);
            Ok(())
        }
        fn read(&self, offset: u32, data: &mut [u8]) -> Result<(), FlashError> {
            data.copy_from_slice(&self.0[offset as usize..offset as usize + data.len()]);
            Ok(())
        }
    }

    struct Echo;

    impl DeviceFrameHandler<FlashMem> for Echo {
        fn handle(
            &mut self,
            _updater: &mut DeviceUpdater<FlashMem>,
            _kind: u8,
            payload: &[u8],
        ) -> Result<DeviceReply, DeviceHandlerError> {
            Ok(DeviceReply {
                kind: 0x02,
                payload: payload.to_vec(),
            })
        }
    }

    fn updater() -> DeviceUpdater<FlashMem> {
        let layout = SlotLayout {
            slot_a: Region {
                start: 0,
                len: 1024,
            },
            slot_b: Region {
                start: 1024,
                len: 1024,
            },
            metadata_a: Region {
                start: 2048,
                len: 256,
            },
            metadata_b: Region {
                start: 2304,
                len: 256,
            },
        };
        DeviceUpdater::provision(
            FlashMem(vec![0xff; 4096]),
            layout,
            &BootMetadata::initial(Slot::A, 1),
        )
        .unwrap()
    }

    #[test]
    fn frames_are_host_wire_compatible_across_serial_packets() {
        let request = Frame::new(MessageKind::Hello, 91, 55_u64.to_le_bytes().to_vec())
            .unwrap()
            .encode()
            .unwrap();
        let mut serial = Usb::default();
        serial
            .rx
            .push_back([b"boot\r\n".as_slice(), &request[..7]].concat());
        serial.rx.push_back(request[7..].to_vec());
        let mut link = DeviceSerialLink::new(serial);
        let mut updater = updater();
        assert!(!link.service(&mut updater, &mut Echo).unwrap());
        assert!(link.service(&mut updater, &mut Echo).unwrap());

        let serial = link.into_inner();
        let response = Frame::decode(&serial.tx[0]).unwrap();
        assert_eq!(response.kind, MessageKind::HelloResp);
        assert_eq!(response.sequence, 91);
        assert_eq!(response.payload, 55_u64.to_le_bytes());
    }

    #[test]
    fn corrupt_crc_never_reaches_handler() {
        let mut request = Frame::new(MessageKind::GetInfo, 3, Vec::new())
            .unwrap()
            .encode()
            .unwrap();
        request[5] ^= 1;
        let mut serial = Usb::default();
        serial.rx.push_back(request);
        let mut link = DeviceSerialLink::new(serial);
        assert_eq!(
            link.service(&mut updater(), &mut Echo),
            Err(DeviceLinkError::CrcMismatch)
        );
        assert!(link.into_inner().tx.is_empty());
    }
}
