use std::fmt::Write;
use std::time::Duration;

use fwctl_core::device::{
    DeviceInfo, DeviceStatus, DiscoveredDevice, Slot, discover_serial_devices,
};
use fwctl_core::protocol::{MessageKind, ProtocolMessage};
use fwctl_core::transport::{Connector, ProtocolClient, SerialConnector};
use fwctl_core::{Config, FwctlError, Result};
use serde::Serialize;

use crate::cli::DeviceTarget;
use crate::output::StdOutput;

const MAX_PROBE_TIMEOUT: Duration = Duration::from_millis(500);

#[derive(Serialize)]
struct DeviceList {
    devices: Vec<DiscoveredDevice>,
}

#[derive(Serialize)]
struct StatusOutput {
    #[serde(flatten)]
    info: DeviceInfo,
    confirmation_state: fwctl_core::device::BootState,
    accepted_offset: u32,
    candidate_healthy: bool,
    boot_attempts: u8,
}

#[derive(Serialize)]
struct DeviceAction<'a> {
    device_id: &'a str,
    action: &'a str,
    active_slot: Slot,
}

pub fn list(timeout: Option<Duration>, config: &Config, output: &mut StdOutput) -> Result<()> {
    let devices = discover_serial_devices(probe_timeout(timeout, config))?;
    let human = render_devices(&devices);
    output.success(&DeviceList { devices }, format_args!("{human}"))
}

pub fn info(
    target: &DeviceTarget,
    global_target: Option<&str>,
    timeout: Option<Duration>,
    config: &Config,
    output: &mut StdOutput,
) -> Result<()> {
    let devices = discover_serial_devices(probe_timeout(timeout, config))?;
    let selected = select_device(&devices, target.device.as_deref().or(global_target))?;
    let info = &selected.info;
    output.success(
        info,
        format_args!(
            "Device: {}\n  Port: {}\n  Product: {}\n  Hardware: {}\n  Firmware: {}\n  Bootloader: {}\n  Active slot: {}\n  Candidate slot: {}\n  Rollback counter: {}\n  Update state: {:?}",
            info.device_id,
            selected.port,
            info.product,
            info.hardware_revision,
            info.firmware_version,
            info.bootloader_version,
            info.active_slot,
            info.candidate_slot.map_or_else(|| "none".into(), |slot| slot.to_string()),
            info.rollback_counter,
            info.update_state
        ),
    )
}

pub fn status(
    target: &DeviceTarget,
    global_target: Option<&str>,
    timeout: Option<Duration>,
    config: &Config,
    output: &mut StdOutput,
) -> Result<()> {
    let (selected, mut client) = connect_selected(target, global_target, timeout, config)?;
    let device_status = read_status(&mut client)?;
    let result = StatusOutput {
        info: selected.info,
        confirmation_state: device_status.boot_state,
        accepted_offset: device_status.accepted_offset,
        candidate_healthy: device_status.candidate_healthy,
        boot_attempts: device_status.boot_attempts,
    };
    output.success(
        &result,
        format_args!(
            "Device: {}\n  Firmware: {}\n  Active slot: {}\n  Candidate slot: {}\n  Boot state: {:?}\n  Update state: {:?}\n  Accepted offset: {}\n  Candidate healthy: {}\n  Boot attempts: {}",
            result.info.device_id,
            result.info.firmware_version,
            result.info.active_slot,
            result.info.candidate_slot.map_or_else(|| "none".into(), |slot| slot.to_string()),
            result.confirmation_state,
            result.info.update_state,
            result.accepted_offset,
            result.candidate_healthy,
            result.boot_attempts
        ),
    )
}

pub fn confirm(
    target: &DeviceTarget,
    global_target: Option<&str>,
    timeout: Option<Duration>,
    config: &Config,
    output: &mut StdOutput,
) -> Result<()> {
    let (selected, mut client) = connect_selected(target, global_target, timeout, config)?;
    let response = client.request(ProtocolMessage::ConfirmBoot, MessageKind::ConfirmBootResp)?;
    if !matches!(response, ProtocolMessage::ConfirmBootResponse) {
        return Err(FwctlError::ProtocolMismatch(
            "CONFIRM_BOOT returned wrong response payload".into(),
        ));
    }
    output.success(
        &DeviceAction {
            device_id: &selected.info.device_id,
            action: "confirmed",
            active_slot: selected.info.active_slot,
        },
        format_args!("Confirmed healthy boot on {}", selected.info.device_id),
    )
}

pub fn rollback(
    target: &DeviceTarget,
    global_target: Option<&str>,
    timeout: Option<Duration>,
    config: &Config,
    output: &mut StdOutput,
) -> Result<()> {
    let (selected, mut client) = connect_selected(target, global_target, timeout, config)?;
    let response = client.request(ProtocolMessage::Rollback, MessageKind::RollbackResp)?;
    let ProtocolMessage::RollbackResponse { active_slot } = response else {
        return Err(FwctlError::ProtocolMismatch(
            "ROLLBACK returned wrong response payload".into(),
        ));
    };
    output.success(
        &DeviceAction {
            device_id: &selected.info.device_id,
            action: "rolled_back",
            active_slot,
        },
        format_args!(
            "Rolled back {} to slot {active_slot}",
            selected.info.device_id
        ),
    )
}

pub(super) fn probe_timeout(override_timeout: Option<Duration>, config: &Config) -> Duration {
    override_timeout
        .unwrap_or(config.default_timeout)
        .min(MAX_PROBE_TIMEOUT)
}

pub(super) fn select_device<'a>(
    devices: &'a [DiscoveredDevice],
    target: Option<&str>,
) -> Result<&'a DiscoveredDevice> {
    if let Some(target) = target {
        return devices
            .iter()
            .find(|device| device.info.device_id == target)
            .ok_or_else(|| FwctlError::DeviceNotFound(target.into()));
    }
    match devices {
        [] => Err(FwctlError::DeviceNotFound("auto".into())),
        [device] => Ok(device),
        _ => Err(FwctlError::Configuration(
            "multiple devices found; select one with --device".into(),
        )),
    }
}

fn render_devices(devices: &[DiscoveredDevice]) -> String {
    if devices.is_empty() {
        return "No compatible fwctl devices found".into();
    }
    let mut table =
        String::from("DEVICE ID             PRODUCT          HW       FIRMWARE    SLOT  PORT\n");
    for device in devices {
        let _ = writeln!(
            table,
            "{:<21} {:<16} {:<8} {:<11} {:<5} {}",
            device.info.device_id,
            device.info.product,
            device.info.hardware_revision,
            device.info.firmware_version,
            device.info.active_slot,
            device.port
        );
    }
    table.pop();
    table
}

fn connect_selected(
    target: &DeviceTarget,
    global_target: Option<&str>,
    timeout: Option<Duration>,
    config: &Config,
) -> Result<(
    DiscoveredDevice,
    ProtocolClient<fwctl_core::transport::SerialTransport>,
)> {
    let response_timeout = timeout.unwrap_or(config.default_timeout);
    let devices = discover_serial_devices(probe_timeout(timeout, config))?;
    let selected = select_device(&devices, target.device.as_deref().or(global_target))?.clone();
    let mut connector = SerialConnector::default();
    let link = connector.connect(&selected.info.device_id, response_timeout)?;
    Ok((selected, ProtocolClient::new(link, response_timeout, 2)))
}

fn read_status<T: fwctl_core::transport::Transport>(
    client: &mut ProtocolClient<T>,
) -> Result<DeviceStatus> {
    let response = client.request(ProtocolMessage::GetStatus, MessageKind::StatusResp)?;
    let ProtocolMessage::StatusResponse(status) = response else {
        return Err(FwctlError::ProtocolMismatch(
            "GET_STATUS returned wrong response payload".into(),
        ));
    };
    Ok(status)
}

#[cfg(test)]
mod tests {
    use fwctl_core::device::{DeviceInfo, Slot, UpdateState};

    use super::*;

    fn discovered(id: &str) -> DiscoveredDevice {
        DiscoveredDevice {
            port: format!("/dev/{id}"),
            max_frame_payload: 4096,
            info: DeviceInfo {
                device_id: id.into(),
                product: "meter".into(),
                hardware_revision: "A1".into(),
                firmware_version: "1.0.0".into(),
                bootloader_version: "0.2.0".into(),
                active_slot: Slot::A,
                candidate_slot: None,
                rollback_counter: 1,
                update_state: UpdateState::Idle,
            },
        }
    }

    #[test]
    fn auto_selects_only_device() {
        let devices = [discovered("one")];
        assert_eq!(select_device(&devices, None).unwrap().info.device_id, "one");
    }

    #[test]
    fn stable_id_selects_device_not_port_name() {
        let devices = [discovered("one"), discovered("two")];
        assert_eq!(
            select_device(&devices, Some("two")).unwrap().info.device_id,
            "two"
        );
        assert!(select_device(&devices, Some("/dev/two")).is_err());
    }

    #[test]
    fn refuses_ambiguous_auto_selection() {
        let devices = [discovered("one"), discovered("two")];
        assert!(select_device(&devices, None).is_err());
    }
}
