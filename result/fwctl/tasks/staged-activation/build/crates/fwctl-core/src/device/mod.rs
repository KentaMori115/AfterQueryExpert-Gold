pub(crate) mod discovery;
mod model;

pub use discovery::{DiscoveredDevice, discover_serial_devices, identify_transport};
pub use model::{BootState, DeviceInfo, DeviceStatus, Slot, UpdateId, UpdateState};
