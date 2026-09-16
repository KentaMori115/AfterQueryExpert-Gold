use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use serialport::{SerialPortInfo, SerialPortType};

use super::DeviceInfo;
use crate::protocol::{MessageKind, ProtocolMessage};
use crate::transport::{ProtocolClient, SerialTransport, Transport};
use crate::{FwctlError, Result};

const DISCOVERY_BAUD: u32 = 115_200;
static NONCE_COUNTER: AtomicU64 = AtomicU64::new(1);

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct DiscoveredDevice {
    pub port: String,
    pub max_frame_payload: u16,
    pub info: DeviceInfo,
}

pub fn discover_serial_devices(probe_timeout: Duration) -> Result<Vec<DiscoveredDevice>> {
    let mut devices = Vec::new();
    for port_name in serial_port_candidates()? {
        let Ok(transport) = SerialTransport::open(Path::new(&port_name), DISCOVERY_BAUD) else {
            continue;
        };
        if let Ok((info, max_frame_payload)) =
            identify_transport(transport, probe_timeout, next_nonce())
        {
            devices.push(DiscoveredDevice {
                port: port_name,
                max_frame_payload,
                info,
            });
        }
    }
    devices.sort_unstable_by(|left, right| left.info.device_id.cmp(&right.info.device_id));
    Ok(devices)
}

pub fn identify_transport<T: Transport>(
    transport: T,
    timeout: Duration,
    host_nonce: u64,
) -> Result<(DeviceInfo, u16)> {
    let mut client = ProtocolClient::new(transport, timeout, 0);
    identify_client(&mut client, host_nonce)
}

pub(crate) fn identify_transport_with_link<T: Transport>(
    transport: T,
    timeout: Duration,
    host_nonce: u64,
) -> Result<(T, DeviceInfo, u16)> {
    let mut client = ProtocolClient::new(transport, timeout, 0);
    let (info, max_payload) = identify_client(&mut client, host_nonce)?;
    Ok((client.into_transport(), info, max_payload))
}

fn identify_client<T: Transport>(
    client: &mut ProtocolClient<T>,
    host_nonce: u64,
) -> Result<(DeviceInfo, u16)> {
    let hello = client.request(
        ProtocolMessage::Hello { host_nonce },
        MessageKind::HelloResp,
    )?;
    let ProtocolMessage::HelloResponse {
        host_nonce: echoed_nonce,
        device_id,
        max_frame_payload,
    } = hello
    else {
        return Err(FwctlError::ProtocolMismatch(
            "HELLO returned wrong response payload".into(),
        ));
    };
    if echoed_nonce != host_nonce {
        return Err(FwctlError::ProtocolMismatch(
            "HELLO response nonce does not match request".into(),
        ));
    }
    let response = client.request(ProtocolMessage::GetInfo, MessageKind::InfoResp)?;
    let ProtocolMessage::InfoResponse(info) = response else {
        return Err(FwctlError::ProtocolMismatch(
            "GET_INFO returned wrong response payload".into(),
        ));
    };
    if info.device_id != device_id {
        return Err(FwctlError::ProtocolMismatch(
            "HELLO and INFO device IDs differ".into(),
        ));
    }
    info.validate()?;
    Ok((info, max_frame_payload))
}

pub(crate) fn serial_port_candidates() -> Result<Vec<String>> {
    let ports = serialport::available_ports().map_err(|err| {
        FwctlError::Configuration(format!("could not enumerate serial ports: {err}"))
    })?;
    Ok(ports
        .iter()
        .filter(|port| plausible_port(port))
        .map(|port| port.port_name.clone())
        .collect())
}

fn plausible_port(port: &SerialPortInfo) -> bool {
    if matches!(port.port_type, SerialPortType::UsbPort(_)) {
        return true;
    }
    let port_name = port.port_name.as_str();
    port_name.starts_with("/dev/ttyACM") || port_name.starts_with("/dev/ttyUSB")
}

fn next_nonce() -> u64 {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |duration| {
            duration.as_secs().rotate_left(29) ^ u64::from(duration.subsec_nanos())
        });
    timestamp
        ^ NONCE_COUNTER
            .fetch_add(1, Ordering::Relaxed)
            .rotate_left(17)
}

#[cfg(test)]
mod tests {
    use std::thread;

    use super::*;
    use crate::device::{Slot, UpdateState};
    use crate::transport::MemoryTransport;

    fn info() -> DeviceInfo {
        DeviceInfo {
            device_id: "probe-7".into(),
            product: "controller".into(),
            hardware_revision: "B2".into(),
            firmware_version: "1.1.0".into(),
            bootloader_version: "0.5.0".into(),
            active_slot: Slot::A,
            candidate_slot: None,
            rollback_counter: 5,
            update_state: UpdateState::Idle,
        }
    }

    #[test]
    fn identifies_device_after_correlated_hello() {
        let (host, mut device) = MemoryTransport::pair();
        let worker = thread::spawn(move || {
            let hello = device.recv(Duration::from_secs(1)).unwrap();
            let ProtocolMessage::Hello { host_nonce } =
                ProtocolMessage::from_frame(&hello).unwrap()
            else {
                panic!("expected HELLO");
            };
            device
                .send(
                    &ProtocolMessage::HelloResponse {
                        host_nonce,
                        device_id: "probe-7".into(),
                        max_frame_payload: 4096,
                    }
                    .into_frame(hello.sequence)
                    .unwrap(),
                )
                .unwrap();
            let get_info = device.recv(Duration::from_secs(1)).unwrap();
            device
                .send(
                    &ProtocolMessage::InfoResponse(info())
                        .into_frame(get_info.sequence)
                        .unwrap(),
                )
                .unwrap();
        });
        let (identified, max_payload) =
            identify_transport(host, Duration::from_millis(20), 44).unwrap();
        assert_eq!(identified, info());
        assert_eq!(max_payload, 4096);
        worker.join().unwrap();
    }

    #[test]
    fn rejects_nonce_mismatch_without_get_info() {
        let (host, mut device) = MemoryTransport::pair();
        let worker = thread::spawn(move || {
            let hello = device.recv(Duration::from_secs(1)).unwrap();
            device
                .send(
                    &ProtocolMessage::HelloResponse {
                        host_nonce: 999,
                        device_id: "probe-7".into(),
                        max_frame_payload: 4096,
                    }
                    .into_frame(hello.sequence)
                    .unwrap(),
                )
                .unwrap();
        });
        assert!(identify_transport(host, Duration::from_millis(20), 44).is_err());
        worker.join().unwrap();
    }

    #[test]
    fn filters_unrelated_serial_ports() {
        let pci = SerialPortInfo {
            port_name: "/dev/ttyS0".into(),
            port_type: SerialPortType::PciPort,
        };
        let acm = SerialPortInfo {
            port_name: "/dev/ttyACM0".into(),
            port_type: SerialPortType::Unknown,
        };
        assert!(!plausible_port(&pci));
        assert!(plausible_port(&acm));
    }
}
