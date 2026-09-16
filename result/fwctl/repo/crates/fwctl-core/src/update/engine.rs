use std::thread;
use std::time::{Duration, Instant};

use serde::Serialize;
use uuid::Uuid;

use crate::crypto::TrustedPublicKey;
use crate::device::{DeviceInfo, DeviceStatus, UpdateId, UpdateState as DeviceUpdateState};
use crate::package::FirmwarePackage;
use crate::protocol::{BeginUpdate, BeginUpdateResponse, MessageKind, ProtocolMessage};
use crate::transport::{Connector, ProtocolClient};
use crate::update::{UpdatePlan, UpdatePolicy};
use crate::{FwctlError, Result};

const PROTOCOL_RETRIES: u8 = 2;
const MAX_RESUME_ATTEMPTS: u8 = 5;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum UpdateState {
    Idle,
    Connected,
    Validated,
    Preparing,
    Erasing,
    Transferring,
    Verifying,
    CandidateSet,
    Rebooting,
    WaitingForDevice,
    WaitingForHealth,
    Confirming,
    Completed,
    Failed,
    RolledBack,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct UpdateEvent {
    pub state: UpdateState,
    pub bytes_transferred: u32,
    pub image_size: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct UpdateReport {
    pub device_id: String,
    pub old_version: String,
    pub new_version: String,
    pub target_slot: crate::device::Slot,
    pub image_size: u32,
    pub resumed_connections: u8,
    pub duration_ms: u128,
    pub state: UpdateState,
}

pub struct UpdateEngine<C: Connector> {
    connector: C,
    client: Option<ProtocolClient<C::Link>>,
    response_timeout: Duration,
    reconnect_timeout: Duration,
    requested_chunk_size: usize,
    state: UpdateState,
}

impl<C: Connector> UpdateEngine<C> {
    #[must_use]
    pub const fn new(
        connector: C,
        response_timeout: Duration,
        reconnect_timeout: Duration,
        chunk_size: usize,
    ) -> Self {
        Self {
            connector,
            client: None,
            response_timeout,
            reconnect_timeout,
            requested_chunk_size: chunk_size,
            state: UpdateState::Idle,
        }
    }

    #[must_use]
    pub const fn state(&self) -> UpdateState {
        self.state
    }

    pub fn into_connector(self) -> C {
        self.connector
    }

    pub fn run(
        &mut self,
        device_id: &str,
        package: &FirmwarePackage,
        trusted_key: &TrustedPublicKey,
        policy: UpdatePolicy,
        mut observe: impl FnMut(UpdateEvent),
    ) -> Result<UpdateReport> {
        let started = Instant::now();
        match self.run_inner(device_id, package, trusted_key, policy, &mut observe) {
            Ok(mut report) => {
                report.duration_ms = started.elapsed().as_millis();
                Ok(report)
            }
            Err(err) => {
                if matches!(err, FwctlError::AutomaticRollback) {
                    self.state = UpdateState::RolledBack;
                } else {
                    self.state = UpdateState::Failed;
                }
                Err(err)
            }
        }
    }

    fn run_inner(
        &mut self,
        device_id: &str,
        package: &FirmwarePackage,
        trusted_key: &TrustedPublicKey,
        policy: UpdatePolicy,
        observe: &mut impl FnMut(UpdateEvent),
    ) -> Result<UpdateReport> {
        let info = self.connect_and_identify(device_id)?;
        self.transition(UpdateState::Connected, 0, 0, observe);
        let plan = policy.evaluate(package, trusted_key, &info)?;
        self.transition(UpdateState::Validated, 0, plan.image_size, observe);
        let update_id = UpdateId::from_bytes(*Uuid::new_v4().as_bytes());
        self.transition(UpdateState::Preparing, 0, plan.image_size, observe);
        let begin = self.begin_update(update_id, &plan, package)?;
        let resumed_connections =
            self.transfer_image(device_id, package, &plan, update_id, begin, observe)?;
        self.activate_and_confirm(device_id, update_id, &plan, observe)?;
        Ok(UpdateReport {
            device_id: plan.device_id,
            old_version: plan.old_version,
            new_version: plan.new_version,
            target_slot: plan.target_slot,
            image_size: plan.image_size,
            resumed_connections,
            duration_ms: 0,
            state: UpdateState::Completed,
        })
    }

    fn transfer_image(
        &mut self,
        device_id: &str,
        package: &FirmwarePackage,
        plan: &UpdatePlan,
        update_id: UpdateId,
        begin: BeginUpdateResponse,
        observe: &mut impl FnMut(UpdateEvent),
    ) -> Result<u8> {
        let chunk_size = self
            .requested_chunk_size
            .min(usize::from(begin.max_chunk_size));
        if chunk_size < 256 {
            return Err(FwctlError::ProtocolMismatch(
                "device negotiated a chunk size below 256 bytes".into(),
            ));
        }
        let mut offset = begin.accepted_offset;
        if offset == 0 {
            self.erase_inactive_slot(update_id, plan, observe)?;
        }
        Self::validate_offset(offset, plan.image_size)?;
        self.transition(UpdateState::Transferring, offset, plan.image_size, observe);
        let mut resumed_connections = 0_u8;
        while offset < plan.image_size {
            let start = usize::try_from(offset).map_err(|_| {
                FwctlError::ProtocolMismatch("transfer offset exceeds host size".into())
            })?;
            let end = start.saturating_add(chunk_size).min(package.image.len());
            let request = ProtocolMessage::WriteChunk {
                update_id,
                offset,
                data: package.image[start..end].to_vec(),
            };
            match self.request(request, MessageKind::WriteChunkResp) {
                Ok(ProtocolMessage::WriteChunkResponse { accepted_offset }) => {
                    let expected = u32::try_from(end).map_err(|_| {
                        FwctlError::ProtocolMismatch("image size exceeds protocol limit".into())
                    })?;
                    if accepted_offset != expected {
                        return Err(FwctlError::ProtocolMismatch(format!(
                            "device accepted offset {accepted_offset}, expected {expected}"
                        )));
                    }
                    offset = accepted_offset;
                }
                Ok(_) => return Err(wrong_response("WRITE_CHUNK")),
                Err(err) if reconnectable(&err) => {
                    resumed_connections = resumed_connections.saturating_add(1);
                    if resumed_connections > MAX_RESUME_ATTEMPTS {
                        return Err(err);
                    }
                    offset = self.resume_transfer(device_id, update_id, plan, observe)?;
                }
                Err(err) => return Err(err),
            }
            self.transition(UpdateState::Transferring, offset, plan.image_size, observe);
        }
        Ok(resumed_connections)
    }

    fn erase_inactive_slot(
        &mut self,
        update_id: UpdateId,
        plan: &UpdatePlan,
        observe: &mut impl FnMut(UpdateEvent),
    ) -> Result<()> {
        self.transition(UpdateState::Erasing, 0, plan.image_size, observe);
        let response = self.request(
            ProtocolMessage::EraseSlot {
                update_id,
                slot: plan.target_slot,
            },
            MessageKind::EraseSlotResp,
        )?;
        if matches!(response, ProtocolMessage::EraseSlotResponse { slot } if slot == plan.target_slot)
        {
            Ok(())
        } else {
            Err(FwctlError::ProtocolMismatch(
                "device erased an unexpected slot".into(),
            ))
        }
    }

    fn activate_and_confirm(
        &mut self,
        device_id: &str,
        update_id: UpdateId,
        plan: &UpdatePlan,
        observe: &mut impl FnMut(UpdateEvent),
    ) -> Result<()> {
        self.transition(
            UpdateState::Verifying,
            plan.image_size,
            plan.image_size,
            observe,
        );
        let verify = self.request(
            ProtocolMessage::VerifyImage { update_id },
            MessageKind::VerifyImageResp,
        )?;
        if !matches!(verify, ProtocolMessage::VerifyImageResponse { image_digest } if image_digest == plan.image_digest)
        {
            return Err(FwctlError::ImageVerificationFailed);
        }
        let candidate = self.request(
            ProtocolMessage::SetCandidate { update_id },
            MessageKind::SetCandidateResp,
        )?;
        if !matches!(candidate, ProtocolMessage::SetCandidateResponse) {
            return Err(wrong_response("SET_CANDIDATE"));
        }
        self.transition(
            UpdateState::CandidateSet,
            plan.image_size,
            plan.image_size,
            observe,
        );
        self.transition(
            UpdateState::Rebooting,
            plan.image_size,
            plan.image_size,
            observe,
        );
        let reboot = self.request(ProtocolMessage::Reboot, MessageKind::RebootResp);
        if reboot.as_ref().is_err_and(reconnectable) {
            self.reconnect_client(device_id)?;
        } else if !matches!(reboot?, ProtocolMessage::RebootResponse) {
            return Err(wrong_response("REBOOT"));
        }
        self.transition(
            UpdateState::WaitingForHealth,
            plan.image_size,
            plan.image_size,
            observe,
        );
        validate_candidate_health(&self.read_status()?)?;
        self.transition(
            UpdateState::Confirming,
            plan.image_size,
            plan.image_size,
            observe,
        );
        if !matches!(
            self.request(ProtocolMessage::ConfirmBoot, MessageKind::ConfirmBootResp)?,
            ProtocolMessage::ConfirmBootResponse
        ) {
            return Err(wrong_response("CONFIRM_BOOT"));
        }
        self.transition(
            UpdateState::Completed,
            plan.image_size,
            plan.image_size,
            observe,
        );
        Ok(())
    }

    fn connect_and_identify(&mut self, device_id: &str) -> Result<DeviceInfo> {
        self.reconnect_client(device_id)?;
        let response = self.request(ProtocolMessage::GetInfo, MessageKind::InfoResp)?;
        let ProtocolMessage::InfoResponse(info) = response else {
            return Err(FwctlError::ProtocolMismatch(
                "GET_INFO returned wrong response payload".into(),
            ));
        };
        if info.device_id != device_id {
            return Err(FwctlError::DeviceNotFound(device_id.into()));
        }
        Ok(info)
    }

    fn reconnect_client(&mut self, device_id: &str) -> Result<()> {
        self.client = None;
        let deadline = Instant::now()
            .checked_add(self.reconnect_timeout)
            .ok_or(FwctlError::RebootTimeout)?;
        loop {
            if let Ok(link) = self.connector.connect(device_id, self.response_timeout) {
                let mut client = ProtocolClient::new(link, self.response_timeout, PROTOCOL_RETRIES);
                let nonce_bytes = Uuid::new_v4();
                let host_nonce = u64::from_le_bytes(
                    nonce_bytes.as_bytes()[..8]
                        .try_into()
                        .map_err(|_| FwctlError::ProtocolMismatch("nonce width".into()))?,
                );
                let hello = client.request(
                    ProtocolMessage::Hello { host_nonce },
                    MessageKind::HelloResp,
                );
                if matches!(
                    hello,
                    Ok(ProtocolMessage::HelloResponse {
                        host_nonce: echoed,
                        device_id: ref response_id,
                        ..
                    }) if echoed == host_nonce && response_id == device_id
                ) {
                    self.client = Some(client);
                    return Ok(());
                }
            }
            if Instant::now() >= deadline {
                return Err(FwctlError::RebootTimeout);
            }
            thread::sleep(Duration::from_millis(10));
        }
    }

    fn begin_update(
        &mut self,
        update_id: UpdateId,
        plan: &UpdatePlan,
        package: &FirmwarePackage,
    ) -> Result<BeginUpdateResponse> {
        let response = self.request(
            ProtocolMessage::BeginUpdate(BeginUpdate {
                update_id,
                format_version: package.manifest.format_version,
                product: package.manifest.product.clone(),
                image_size: plan.image_size,
                image_digest: plan.image_digest,
                firmware_version: plan.new_version.clone(),
                hardware_revisions: package.manifest.hardware_revisions.clone(),
                rollback_counter: plan.rollback_counter,
                image_file: package.manifest.image.file.clone(),
                signing_key: package.manifest.signing_key.clone(),
                signature: package.signature,
                target_slot: plan.target_slot,
            }),
            MessageKind::BeginUpdateResp,
        )?;
        let ProtocolMessage::BeginUpdateResponse(response) = response else {
            return Err(FwctlError::ProtocolMismatch(
                "BEGIN_UPDATE returned wrong response payload".into(),
            ));
        };
        Ok(response)
    }

    fn resume_transfer(
        &mut self,
        device_id: &str,
        update_id: UpdateId,
        plan: &UpdatePlan,
        observe: &mut impl FnMut(UpdateEvent),
    ) -> Result<u32> {
        self.transition(UpdateState::WaitingForDevice, 0, plan.image_size, observe);
        self.reconnect_client(device_id)?;
        let status = self.read_status()?;
        if status.update_id != Some(update_id) {
            return Err(FwctlError::ProtocolMismatch(
                "device has no matching interrupted update".into(),
            ));
        }
        Self::validate_offset(status.accepted_offset, plan.image_size)?;
        self.transition(
            UpdateState::Transferring,
            status.accepted_offset,
            plan.image_size,
            observe,
        );
        Ok(status.accepted_offset)
    }

    fn read_status(&mut self) -> Result<DeviceStatus> {
        let response = self.request(ProtocolMessage::GetStatus, MessageKind::StatusResp)?;
        let ProtocolMessage::StatusResponse(status) = response else {
            return Err(FwctlError::ProtocolMismatch(
                "GET_STATUS returned wrong response payload".into(),
            ));
        };
        Ok(status)
    }

    fn request(
        &mut self,
        message: ProtocolMessage,
        expected: MessageKind,
    ) -> Result<ProtocolMessage> {
        self.client
            .as_mut()
            .ok_or_else(|| FwctlError::DeviceNotFound("disconnected".into()))?
            .request(message, expected)
    }

    fn validate_offset(offset: u32, image_size: u32) -> Result<()> {
        if offset <= image_size {
            Ok(())
        } else {
            Err(FwctlError::ProtocolMismatch(format!(
                "resume offset {offset} exceeds image size {image_size}"
            )))
        }
    }

    fn transition(
        &mut self,
        state: UpdateState,
        bytes_transferred: u32,
        image_size: u32,
        observe: &mut impl FnMut(UpdateEvent),
    ) {
        self.state = state;
        observe(UpdateEvent {
            state,
            bytes_transferred,
            image_size,
        });
    }
}

fn validate_candidate_health(status: &DeviceStatus) -> Result<()> {
    match status.state {
        DeviceUpdateState::RolledBack => Err(FwctlError::AutomaticRollback),
        DeviceUpdateState::AwaitingConfirmation if status.candidate_healthy => Ok(()),
        DeviceUpdateState::AwaitingConfirmation => Err(FwctlError::HealthCheckFailed),
        _ => Err(FwctlError::ProtocolMismatch(format!(
            "device entered unexpected post-reboot state {:?}",
            status.state
        ))),
    }
}

fn reconnectable(err: &FwctlError) -> bool {
    matches!(
        err,
        FwctlError::TransportTimeout { .. } | FwctlError::TransportDisconnected { .. }
    )
}

fn wrong_response(operation: &str) -> FwctlError {
    FwctlError::ProtocolMismatch(format!("{operation} returned the wrong response payload"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::device::{BootState, UpdateState as DeviceState};

    #[test]
    fn health_gate_accepts_only_healthy_candidate() {
        let mut status = DeviceStatus {
            state: DeviceState::AwaitingConfirmation,
            boot_state: BootState::Candidate,
            update_id: None,
            accepted_offset: 0,
            candidate_healthy: true,
            boot_attempts: 1,
        };
        assert!(validate_candidate_health(&status).is_ok());
        status.candidate_healthy = false;
        assert!(matches!(
            validate_candidate_health(&status),
            Err(FwctlError::HealthCheckFailed)
        ));
        status.state = DeviceState::RolledBack;
        assert!(matches!(
            validate_candidate_health(&status),
            Err(FwctlError::AutomaticRollback)
        ));
    }
}
