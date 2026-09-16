use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::time::Duration;

use crate::protocol::Frame;
use crate::transport::Transport;
use crate::{FwctlError, Result};

pub struct MemoryTransport {
    endpoint: String,
    tx_frame: Sender<Frame>,
    rx_frame: Receiver<Frame>,
}

impl MemoryTransport {
    #[must_use]
    pub fn pair() -> (Self, Self) {
        let (host_tx, device_rx) = mpsc::channel();
        let (device_tx, host_rx) = mpsc::channel();
        (
            Self {
                endpoint: "memory:host".into(),
                tx_frame: host_tx,
                rx_frame: host_rx,
            },
            Self {
                endpoint: "memory:device".into(),
                tx_frame: device_tx,
                rx_frame: device_rx,
            },
        )
    }
}

impl Transport for MemoryTransport {
    fn endpoint(&self) -> &str {
        &self.endpoint
    }

    fn send(&mut self, frame: &Frame) -> Result<()> {
        self.tx_frame
            .send(frame.clone())
            .map_err(|_| FwctlError::TransportDisconnected {
                operation: "sending in-memory frame",
            })
    }

    fn recv(&mut self, timeout: Duration) -> Result<Frame> {
        match self.rx_frame.recv_timeout(timeout) {
            Ok(frame) => Ok(frame),
            Err(RecvTimeoutError::Timeout) => Err(FwctlError::TransportTimeout {
                operation: "waiting for in-memory frame",
            }),
            Err(RecvTimeoutError::Disconnected) => Err(FwctlError::TransportDisconnected {
                operation: "waiting for in-memory frame",
            }),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::MessageKind;

    #[test]
    fn exchanges_frames_in_both_directions() {
        let (mut host, mut device) = MemoryTransport::pair();
        let request = Frame::new(MessageKind::Hello, 4, vec![1, 2]).unwrap();
        host.send(&request).unwrap();
        assert_eq!(device.recv(Duration::from_millis(5)).unwrap(), request);

        let response = Frame::new(MessageKind::HelloResp, 4, vec![3]).unwrap();
        device.send(&response).unwrap();
        assert_eq!(host.recv(Duration::from_millis(5)).unwrap(), response);
    }

    #[test]
    fn reports_timeout_without_poisoning_channel() {
        let (mut host, mut device) = MemoryTransport::pair();
        assert!(matches!(
            host.recv(Duration::from_millis(1)),
            Err(FwctlError::TransportTimeout { .. })
        ));
        device
            .send(&Frame::new(MessageKind::GetInfo, 2, Vec::new()).unwrap())
            .unwrap();
        assert!(host.recv(Duration::from_millis(5)).is_ok());
    }

    #[test]
    fn reports_peer_disconnect() {
        let (mut host, device) = MemoryTransport::pair();
        drop(device);
        assert!(matches!(
            host.recv(Duration::from_millis(1)),
            Err(FwctlError::TransportDisconnected { .. })
        ));
    }
}
