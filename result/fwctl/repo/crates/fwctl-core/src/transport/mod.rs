mod client;
mod connector;
mod memory;
mod serial;

use std::time::Duration;

use crate::Result;
use crate::protocol::Frame;

pub use client::ProtocolClient;
pub use connector::{Connector, OneShotConnector};
pub use memory::MemoryTransport;
pub use serial::{SerialConnector, SerialTransport};

pub trait Transport {
    fn endpoint(&self) -> &str;
    fn send(&mut self, frame: &Frame) -> Result<()>;
    fn recv(&mut self, timeout: Duration) -> Result<Frame>;
}
