use std::time::Duration;

use crate::protocol::{MessageKind, ProtocolMessage};
use crate::transport::Transport;
use crate::{FwctlError, Result};

const MAX_UNRELATED_FRAMES: usize = 8;

pub struct ProtocolClient<T> {
    transport: T,
    response_timeout: Duration,
    retry_limit: u8,
    next_sequence: u32,
}

impl<T: Transport> ProtocolClient<T> {
    #[must_use]
    pub const fn new(transport: T, response_timeout: Duration, retry_limit: u8) -> Self {
        Self {
            transport,
            response_timeout,
            retry_limit,
            next_sequence: 1,
        }
    }

    #[must_use]
    pub fn endpoint(&self) -> &str {
        self.transport.endpoint()
    }

    pub fn request(
        &mut self,
        request: ProtocolMessage,
        expected_kind: MessageKind,
    ) -> Result<ProtocolMessage> {
        let sequence = self.allocate_sequence();
        let frame = request.into_frame(sequence)?;
        for attempt in 0..=self.retry_limit {
            self.transport.send(&frame)?;
            match self.wait_for(sequence, expected_kind) {
                Ok(response) => return Ok(response),
                Err(FwctlError::TransportTimeout { .. }) if attempt < self.retry_limit => {}
                Err(err) => return Err(err),
            }
        }
        Err(FwctlError::TransportTimeout {
            operation: "waiting for protocol response",
        })
    }

    pub fn into_transport(self) -> T {
        self.transport
    }

    fn wait_for(&mut self, sequence: u32, expected_kind: MessageKind) -> Result<ProtocolMessage> {
        for _ in 0..MAX_UNRELATED_FRAMES {
            let frame = self.transport.recv(self.response_timeout)?;
            if frame.sequence != sequence {
                continue;
            }
            let actual_kind = frame.kind;
            let message = ProtocolMessage::from_frame(&frame)?;
            if let ProtocolMessage::Error { code, message } = message {
                return Err(FwctlError::ProtocolMismatch(format!(
                    "device error {code}: {message}"
                )));
            }
            if actual_kind != expected_kind {
                return Err(FwctlError::ProtocolMismatch(format!(
                    "expected {expected_kind:?}, received {actual_kind:?}"
                )));
            }
            return Ok(message);
        }
        Err(FwctlError::ProtocolMismatch(
            "too many unrelated frames while waiting for response".into(),
        ))
    }

    fn allocate_sequence(&mut self) -> u32 {
        let sequence = self.next_sequence;
        self.next_sequence = self.next_sequence.wrapping_add(1).max(1);
        sequence
    }
}

#[cfg(test)]
mod tests {
    use std::thread;

    use super::*;
    use crate::device::{DeviceInfo, Slot, UpdateId, UpdateState};
    use crate::protocol::ProtocolMessage;
    use crate::transport::MemoryTransport;

    #[test]
    fn correlates_request_and_response_sequence() {
        let (host, mut device) = MemoryTransport::pair();
        let worker = thread::spawn(move || {
            let request = device.recv(Duration::from_secs(1)).unwrap();
            let stale = ProtocolMessage::HelloResponse {
                host_nonce: 1,
                device_id: "stale".into(),
                max_frame_payload: 1024,
            }
            .into_frame(request.sequence + 1)
            .unwrap();
            device.send(&stale).unwrap();
            let response = ProtocolMessage::HelloResponse {
                host_nonce: 8,
                device_id: "board-1".into(),
                max_frame_payload: 4096,
            }
            .into_frame(request.sequence)
            .unwrap();
            device.send(&response).unwrap();
        });

        let mut client = ProtocolClient::new(host, Duration::from_millis(20), 0);
        let response = client
            .request(
                ProtocolMessage::Hello { host_nonce: 8 },
                MessageKind::HelloResp,
            )
            .unwrap();
        assert!(matches!(
            response,
            ProtocolMessage::HelloResponse { device_id, .. } if device_id == "board-1"
        ));
        worker.join().unwrap();
    }

    #[test]
    fn retries_same_sequence_after_timeout() {
        let (host, mut device) = MemoryTransport::pair();
        let worker = thread::spawn(move || {
            let first = device.recv(Duration::from_secs(1)).unwrap();
            let retry = device.recv(Duration::from_secs(1)).unwrap();
            assert_eq!(first.sequence, retry.sequence);
            let response = ProtocolMessage::InfoResponse(DeviceInfo {
                device_id: "board-2".into(),
                product: "meter".into(),
                hardware_revision: "C1".into(),
                firmware_version: "1.0.0".into(),
                bootloader_version: "0.4.0".into(),
                active_slot: Slot::A,
                candidate_slot: None,
                rollback_counter: 1,
                update_state: UpdateState::Idle,
            })
            .into_frame(retry.sequence)
            .unwrap();
            device.send(&response).unwrap();
        });

        let mut client = ProtocolClient::new(host, Duration::from_millis(5), 1);
        assert!(
            client
                .request(ProtocolMessage::GetInfo, MessageKind::InfoResp)
                .is_ok()
        );
        worker.join().unwrap();
    }

    #[test]
    fn converts_device_error_response() {
        let (host, mut device) = MemoryTransport::pair();
        let worker = thread::spawn(move || {
            let request = device.recv(Duration::from_secs(1)).unwrap();
            let response = ProtocolMessage::Error {
                code: 31,
                message: "active slot cannot be erased".into(),
            }
            .into_frame(request.sequence)
            .unwrap();
            device.send(&response).unwrap();
        });
        let mut client = ProtocolClient::new(host, Duration::from_millis(20), 0);
        let err = client
            .request(
                ProtocolMessage::EraseSlot {
                    update_id: UpdateId::from_bytes([1; 16]),
                    slot: Slot::A,
                },
                MessageKind::EraseSlotResp,
            )
            .unwrap_err();
        assert!(err.to_string().contains("active slot"));
        worker.join().unwrap();
    }

    #[test]
    fn rejects_response_kind_mismatch() {
        let (host, mut device) = MemoryTransport::pair();
        let worker = thread::spawn(move || {
            let request = device.recv(Duration::from_secs(1)).unwrap();
            let response = ProtocolMessage::HelloResponse {
                host_nonce: 11,
                device_id: "board-3".into(),
                max_frame_payload: 2048,
            }
            .into_frame(request.sequence)
            .unwrap();
            device.send(&response).unwrap();
        });

        let mut client = ProtocolClient::new(host, Duration::from_millis(20), 0);
        let err = client
            .request(ProtocolMessage::GetInfo, MessageKind::InfoResp)
            .unwrap_err();
        assert!(err.to_string().contains("expected InfoResp"));
        worker.join().unwrap();
    }

    #[test]
    fn bounds_unrelated_response_traffic() {
        let (host, mut device) = MemoryTransport::pair();
        let worker = thread::spawn(move || {
            let request = device.recv(Duration::from_secs(1)).unwrap();
            for delta in 1..=MAX_UNRELATED_FRAMES {
                let stale = ProtocolMessage::HelloResponse {
                    host_nonce: delta as u64,
                    device_id: format!("stale-{delta}"),
                    max_frame_payload: 1024,
                }
                .into_frame(request.sequence.wrapping_add(u32::try_from(delta).unwrap()))
                .unwrap();
                device.send(&stale).unwrap();
            }
        });

        let mut client = ProtocolClient::new(host, Duration::from_millis(20), 0);
        let err = client
            .request(
                ProtocolMessage::Hello { host_nonce: 4 },
                MessageKind::HelloResp,
            )
            .unwrap_err();
        assert!(err.to_string().contains("too many unrelated frames"));
        worker.join().unwrap();
    }

    #[test]
    fn sequence_counter_skips_zero_after_wrap() {
        let (host, _device) = MemoryTransport::pair();
        let mut client = ProtocolClient::new(host, Duration::from_millis(1), 0);
        client.next_sequence = u32::MAX;
        assert_eq!(client.allocate_sequence(), u32::MAX);
        assert_eq!(client.allocate_sequence(), 1);
        assert_eq!(client.allocate_sequence(), 2);
    }
}
