use std::io::{Read, Write};
use std::path::Path;
use std::time::{Duration, Instant};

use serialport::SerialPort;

use crate::device::discovery::{identify_transport_with_link, serial_port_candidates};
use crate::protocol::{Frame, FrameDecoder};
use crate::transport::{Connector, Transport};
use crate::{FwctlError, Result};

const READ_SLICE: Duration = Duration::from_millis(50);

pub struct SerialTransport {
    endpoint: String,
    port: Box<dyn SerialPort>,
    decoder: FrameDecoder,
}

#[derive(Debug, Clone, Copy)]
pub struct SerialConnector {
    baud_rate: u32,
}

impl SerialConnector {
    #[must_use]
    pub const fn new(baud_rate: u32) -> Self {
        Self { baud_rate }
    }
}

impl Default for SerialConnector {
    fn default() -> Self {
        Self::new(115_200)
    }
}

impl Connector for SerialConnector {
    type Link = SerialTransport;

    fn connect(&mut self, device_id: &str, timeout: Duration) -> Result<Self::Link> {
        for port_name in serial_port_candidates()? {
            let Ok(link) = SerialTransport::open(Path::new(&port_name), self.baud_rate) else {
                continue;
            };
            let nonce = serial_nonce(&port_name);
            let Ok((link, info, _)) = identify_transport_with_link(link, timeout, nonce) else {
                continue;
            };
            if info.device_id == device_id {
                return Ok(link);
            }
        }
        Err(FwctlError::DeviceNotFound(device_id.into()))
    }
}

impl SerialTransport {
    pub fn open(path: &Path, baud_rate: u32) -> Result<Self> {
        let endpoint = path.to_string_lossy().into_owned();
        let port = serialport::new(&endpoint, baud_rate)
            .timeout(READ_SLICE)
            .open()
            .map_err(|_| FwctlError::TransportDisconnected {
                operation: "opening serial device",
            })?;
        Ok(Self {
            endpoint,
            port,
            decoder: FrameDecoder::new(),
        })
    }

    pub fn clear_input(&mut self) -> Result<()> {
        self.port
            .clear(serialport::ClearBuffer::Input)
            .map_err(|_| FwctlError::TransportDisconnected {
                operation: "clearing serial input",
            })?;
        self.decoder.clear();
        Ok(())
    }
}

impl Transport for SerialTransport {
    fn endpoint(&self) -> &str {
        &self.endpoint
    }

    fn send(&mut self, frame: &Frame) -> Result<()> {
        let bytes = frame.encode()?;
        self.port
            .write_all(&bytes)
            .map_err(|err| map_io(err, "writing serial frame"))?;
        self.port
            .flush()
            .map_err(|err| map_io(err, "flushing serial frame"))
    }

    fn recv(&mut self, timeout: Duration) -> Result<Frame> {
        let deadline = Instant::now()
            .checked_add(timeout)
            .ok_or_else(|| FwctlError::Configuration("serial timeout overflow".into()))?;
        let mut rx_chunk = [0_u8; 2048];
        loop {
            if let Some(frame) = self.decoder.next_frame()? {
                return Ok(frame);
            }
            let now = Instant::now();
            if now >= deadline {
                return Err(FwctlError::TransportTimeout {
                    operation: "reading serial frame",
                });
            }
            let remaining = deadline.saturating_duration_since(now);
            self.port
                .set_timeout(remaining.min(READ_SLICE))
                .map_err(|_| FwctlError::TransportDisconnected {
                    operation: "setting serial timeout",
                })?;
            match self.port.read(&mut rx_chunk) {
                Ok(0) => {}
                Ok(count) => self.decoder.push(&rx_chunk[..count])?,
                Err(err)
                    if matches!(
                        err.kind(),
                        std::io::ErrorKind::TimedOut | std::io::ErrorKind::WouldBlock
                    ) => {}
                Err(err) => return Err(map_io(err, "reading serial frame")),
            }
        }
    }
}

fn map_io(err: std::io::Error, operation: &'static str) -> FwctlError {
    match err.kind() {
        std::io::ErrorKind::TimedOut | std::io::ErrorKind::WouldBlock => {
            FwctlError::TransportTimeout { operation }
        }
        std::io::ErrorKind::BrokenPipe
        | std::io::ErrorKind::ConnectionReset
        | std::io::ErrorKind::NotConnected
        | std::io::ErrorKind::UnexpectedEof => FwctlError::TransportDisconnected { operation },
        _ => FwctlError::io("serial device", err),
    }
}

fn serial_nonce(port_name: &str) -> u64 {
    let mut nonce = 0xcbf2_9ce4_8422_2325_u64;
    for byte in port_name.bytes() {
        nonce ^= u64::from(byte);
        nonce = nonce.wrapping_mul(0x100_0000_01b3);
    }
    nonce
}
