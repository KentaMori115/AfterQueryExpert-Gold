use std::thread::{self, JoinHandle};
use std::time::Duration;

use fwctl_core::crypto::SigningIdentity;
use fwctl_core::device::{
    BootState as HostBootState, DeviceInfo, DeviceStatus, Slot as HostSlot,
    UpdateId as HostUpdateId, UpdateState,
};
use fwctl_core::package::ImageDigest;
use fwctl_core::protocol::{BeginUpdate, BeginUpdateResponse, Frame, ProtocolMessage};
use fwctl_core::transport::{Connector, MemoryTransport, Transport};
use fwctl_device::{
    AuthorizationError, BootDecision, BootMetadata, DeviceUpdater, Region, Slot, SlotLayout,
    TrustedReleaseKey, UpdateAuthorization, UpdateId as DeviceUpdateId, UpdaterError,
};
use thiserror::Error;

use crate::{DEFAULT_FLASH_SIZE, VirtualFlash};

const SIM_ERASE_SIZE: u32 = 4096;
const SIM_WRITE_SIZE: u32 = 4;
const MAX_CHUNK_SIZE: u16 = 4096;

#[derive(Debug, Clone)]
pub struct SimulatorConfig {
    pub device_id: String,
    pub product: String,
    pub hardware_revision: String,
    pub firmware_version: String,
    pub bootloader_version: String,
    pub rollback_counter: u64,
    pub trusted_keys: Vec<SimulatorTrustedKey>,
}

#[derive(Debug, Clone)]
pub struct SimulatorTrustedKey {
    pub key_id: String,
    pub public_key: [u8; 32],
}

impl Default for SimulatorConfig {
    fn default() -> Self {
        let default_key = SigningIdentity::from_seed("release", [0x42; 32]);
        Self {
            device_id: "sim-0001".into(),
            product: "sensor-node".into(),
            hardware_revision: "A1".into(),
            firmware_version: "1.0.0".into(),
            bootloader_version: "0.1.0".into(),
            rollback_counter: 1,
            trusted_keys: vec![SimulatorTrustedKey {
                key_id: "release".into(),
                public_key: default_key.public_key().to_bytes(),
            }],
        }
    }
}

#[derive(Debug, Clone)]
pub struct SimulatorFaults {
    pub disconnect_at_chunk: Option<u32>,
    pub flash_failure_at: Option<u32>,
    pub force_verify_failure: bool,
    pub candidate_healthy: bool,
    pub reboot_failure: bool,
}

impl Default for SimulatorFaults {
    fn default() -> Self {
        Self {
            disconnect_at_chunk: None,
            flash_failure_at: None,
            force_verify_failure: false,
            candidate_healthy: true,
            reboot_failure: false,
        }
    }
}

#[derive(Debug, Error)]
pub enum SimulatorError {
    #[error(transparent)]
    Updater(#[from] UpdaterError),
    #[error("unexpected host message")]
    UnexpectedMessage,
    #[error("image size exceeds simulator slot capacity")]
    ImageTooLarge,
    #[error(transparent)]
    Authorization(#[from] AuthorizationError),
}

pub struct Simulator {
    config: SimulatorConfig,
    faults: SimulatorFaults,
    updater: DeviceUpdater<VirtualFlash>,
    running_slot: Slot,
    slot_versions: [String; 2],
    pending_version: Option<String>,
    state: UpdateState,
    candidate_healthy: bool,
    chunk_index: u32,
}

pub struct SimulatorConnector {
    simulator: Option<Simulator>,
    worker: Option<JoinHandle<Simulator>>,
}

impl SimulatorConnector {
    #[must_use]
    pub const fn new(simulator: Simulator) -> Self {
        Self {
            simulator: Some(simulator),
            worker: None,
        }
    }

    #[must_use]
    pub fn shutdown(mut self) -> Simulator {
        if let Some(worker) = self.worker.take() {
            return worker.join().expect("simulator server panicked");
        }
        self.simulator.take().expect("simulator is available")
    }

    fn reclaim(&mut self) -> fwctl_core::Result<Simulator> {
        if let Some(worker) = self.worker.take() {
            return worker
                .join()
                .map_err(|_| fwctl_core::FwctlError::TransportDisconnected {
                    operation: "joining simulator server",
                });
        }
        self.simulator
            .take()
            .ok_or_else(|| fwctl_core::FwctlError::DeviceNotFound("simulator".into()))
    }
}

impl Connector for SimulatorConnector {
    type Link = MemoryTransport;

    fn connect(&mut self, device_id: &str, _timeout: Duration) -> fwctl_core::Result<Self::Link> {
        let simulator = self.reclaim()?;
        if simulator.config.device_id != device_id {
            self.simulator = Some(simulator);
            return Err(fwctl_core::FwctlError::DeviceNotFound(device_id.into()));
        }
        if simulator.faults.reboot_failure && simulator.state == UpdateState::CandidateReady {
            self.simulator = Some(simulator);
            return Err(fwctl_core::FwctlError::DeviceNotFound(device_id.into()));
        }
        let (host, worker) = simulator.spawn();
        self.worker = Some(worker);
        Ok(host)
    }
}

impl Simulator {
    pub fn new(config: SimulatorConfig) -> Result<Self, SimulatorError> {
        let capacity = u32::try_from(DEFAULT_FLASH_SIZE).map_err(|_| {
            SimulatorError::Updater(UpdaterError::Flash(fwctl_device::FlashError::OutOfRange))
        })?;
        let flash = VirtualFlash::new(capacity, SIM_ERASE_SIZE, SIM_WRITE_SIZE);
        let updater = DeviceUpdater::provision(
            flash,
            reference_layout(),
            &BootMetadata::initial(Slot::A, config.rollback_counter),
        )?;
        Ok(Self {
            slot_versions: [config.firmware_version.clone(), "0.0.0".into()],
            config,
            faults: SimulatorFaults::default(),
            updater,
            running_slot: Slot::A,
            pending_version: None,
            state: UpdateState::Idle,
            candidate_healthy: true,
            chunk_index: 0,
        })
    }

    pub fn faults_mut(&mut self) -> &mut SimulatorFaults {
        &mut self.faults
    }

    #[must_use]
    pub fn info(&self) -> DeviceInfo {
        DeviceInfo {
            device_id: self.config.device_id.clone(),
            product: self.config.product.clone(),
            hardware_revision: self.config.hardware_revision.clone(),
            firmware_version: self.slot_versions[slot_index(self.running_slot)].clone(),
            bootloader_version: self.config.bootloader_version.clone(),
            active_slot: host_slot(self.running_slot),
            candidate_slot: self.updater.metadata().candidate_slot.map(host_slot),
            rollback_counter: self.updater.metadata().highest_rollback_counter,
            update_state: self.state,
        }
    }

    #[must_use]
    pub fn status(&self) -> DeviceStatus {
        let metadata = self.updater.metadata();
        DeviceStatus {
            state: self.state,
            boot_state: if metadata.candidate_slot.is_some() {
                HostBootState::Candidate
            } else if self.state == UpdateState::RolledBack {
                HostBootState::Rollback
            } else {
                HostBootState::Confirmed
            },
            update_id: metadata
                .transfer
                .as_ref()
                .map(|transfer| HostUpdateId::from_bytes(transfer.update_id.0)),
            accepted_offset: self.updater.accepted_offset(),
            candidate_healthy: self.candidate_healthy,
            boot_attempts: metadata.candidate_attempts,
        }
    }

    pub fn handle(&mut self, message: ProtocolMessage) -> Result<ProtocolMessage, SimulatorError> {
        match message {
            ProtocolMessage::Hello { host_nonce } => Ok(ProtocolMessage::HelloResponse {
                host_nonce,
                device_id: self.config.device_id.clone(),
                max_frame_payload: MAX_CHUNK_SIZE,
            }),
            ProtocolMessage::GetInfo => Ok(ProtocolMessage::InfoResponse(self.info())),
            ProtocolMessage::BeginUpdate(begin) => self.handle_begin(begin),
            ProtocolMessage::EraseSlot { update_id, slot } => {
                self.updater
                    .erase_target(DeviceUpdateId(*update_id.as_bytes()))?;
                self.state = UpdateState::Erasing;
                Ok(ProtocolMessage::EraseSlotResponse { slot })
            }
            ProtocolMessage::WriteChunk {
                update_id,
                offset,
                data,
            } => self.handle_chunk(update_id, offset, &data),
            ProtocolMessage::VerifyImage { update_id } => {
                self.state = UpdateState::Verifying;
                let digest = self
                    .updater
                    .verify_image(DeviceUpdateId(*update_id.as_bytes()))?;
                if self.faults.force_verify_failure {
                    return Ok(ProtocolMessage::VerifyImageResponse {
                        image_digest: ImageDigest::from_bytes([0; 32]),
                    });
                }
                Ok(ProtocolMessage::VerifyImageResponse {
                    image_digest: ImageDigest::from_bytes(digest),
                })
            }
            ProtocolMessage::SetCandidate { update_id } => {
                let slot = self
                    .updater
                    .set_candidate(DeviceUpdateId(*update_id.as_bytes()))?;
                if let Some(version) = self.pending_version.take() {
                    self.slot_versions[slot_index(slot)] = version;
                }
                self.state = UpdateState::CandidateReady;
                Ok(ProtocolMessage::SetCandidateResponse)
            }
            ProtocolMessage::Reboot => self.handle_reboot(),
            ProtocolMessage::GetStatus => Ok(ProtocolMessage::StatusResponse(self.status())),
            ProtocolMessage::ConfirmBoot => {
                if !self.candidate_healthy {
                    return Err(SimulatorError::UnexpectedMessage);
                }
                self.running_slot = self.updater.confirm_candidate()?;
                self.state = UpdateState::Confirmed;
                Ok(ProtocolMessage::ConfirmBootResponse)
            }
            ProtocolMessage::Rollback => {
                self.running_slot = self.updater.rollback_candidate()?;
                self.state = UpdateState::RolledBack;
                Ok(ProtocolMessage::RollbackResponse {
                    active_slot: host_slot(self.running_slot),
                })
            }
            _ => Err(SimulatorError::UnexpectedMessage),
        }
    }

    fn handle_begin(&mut self, begin: BeginUpdate) -> Result<ProtocolMessage, SimulatorError> {
        let trusted = self
            .config
            .trusted_keys
            .iter()
            .find(|key| key.key_id == begin.signing_key)
            .ok_or(AuthorizationError::UntrustedKey)?;
        let revisions = begin
            .hardware_revisions
            .iter()
            .map(String::as_str)
            .collect::<Vec<_>>();
        UpdateAuthorization {
            format_version: begin.format_version,
            product: &begin.product,
            firmware_version: &begin.firmware_version,
            hardware_revisions: &revisions,
            image_file: &begin.image_file,
            image_size: u64::from(begin.image_size),
            image_digest: *begin.image_digest.as_bytes(),
            rollback_counter: begin.rollback_counter,
            signing_key: &begin.signing_key,
            signature: begin.signature,
        }
        .verify(
            &self.config.product,
            &self.config.hardware_revision,
            self.updater.metadata().highest_rollback_counter,
            TrustedReleaseKey {
                key_id: &trusted.key_id,
                public_key: trusted.public_key,
            },
        )?;
        let accepted_offset = self.updater.begin_update(
            DeviceUpdateId(*begin.update_id.as_bytes()),
            device_slot(begin.target_slot),
            begin.image_size,
            *begin.image_digest.as_bytes(),
            begin.rollback_counter,
        )?;
        self.pending_version = Some(begin.firmware_version);
        self.state = if accepted_offset == 0 {
            UpdateState::Preparing
        } else {
            UpdateState::Receiving
        };
        self.chunk_index = 0;
        Ok(ProtocolMessage::BeginUpdateResponse(BeginUpdateResponse {
            accepted_offset,
            max_chunk_size: MAX_CHUNK_SIZE,
        }))
    }

    fn handle_chunk(
        &mut self,
        update_id: HostUpdateId,
        offset: u32,
        data: &[u8],
    ) -> Result<ProtocolMessage, SimulatorError> {
        if let Some(fail_offset) = self.faults.flash_failure_at.take() {
            let target = reference_layout().slot(self.running_slot.inactive());
            self.updater
                .flash_mut()
                .fail_next_write_at(target.start.saturating_add(fail_offset));
        }
        let accepted_offset =
            self.updater
                .write_chunk(DeviceUpdateId(*update_id.as_bytes()), offset, data)?;
        self.chunk_index = self.chunk_index.saturating_add(1);
        self.state = UpdateState::Receiving;
        Ok(ProtocolMessage::WriteChunkResponse { accepted_offset })
    }

    fn handle_reboot(&mut self) -> Result<ProtocolMessage, SimulatorError> {
        if self.faults.reboot_failure {
            return Err(SimulatorError::UnexpectedMessage);
        }
        match self.updater.prepare_boot()? {
            BootDecision::Confirmed(slot) => {
                self.running_slot = slot;
                self.state = UpdateState::Confirmed;
                self.candidate_healthy = true;
            }
            BootDecision::Candidate { slot, .. } => {
                self.running_slot = slot;
                self.state = UpdateState::AwaitingConfirmation;
                self.candidate_healthy = self.faults.candidate_healthy;
            }
            BootDecision::RolledBack(slot) => {
                self.running_slot = slot;
                self.state = UpdateState::RolledBack;
                self.candidate_healthy = true;
            }
        }
        Ok(ProtocolMessage::RebootResponse)
    }

    #[must_use]
    pub fn spawn(mut self) -> (MemoryTransport, JoinHandle<Self>) {
        let (host, mut device) = MemoryTransport::pair();
        let worker = thread::spawn(move || {
            let mut cached_response: Option<Frame> = None;
            loop {
                let request = match device.recv(Duration::from_millis(50)) {
                    Ok(frame) => frame,
                    Err(fwctl_core::FwctlError::TransportTimeout { .. }) => continue,
                    Err(_) => break,
                };
                if cached_response
                    .as_ref()
                    .is_some_and(|response| response.sequence == request.sequence)
                {
                    if device.send(cached_response.as_ref().unwrap()).is_err() {
                        break;
                    }
                    continue;
                }
                if request.kind == fwctl_core::protocol::MessageKind::WriteChunk
                    && self.faults.disconnect_at_chunk == Some(self.chunk_index)
                {
                    self.faults.disconnect_at_chunk = None;
                    break;
                }
                if request.kind == fwctl_core::protocol::MessageKind::Reboot
                    && self.faults.reboot_failure
                {
                    continue;
                }
                let response = match ProtocolMessage::from_frame(&request)
                    .map_err(|err| err.to_string())
                    .and_then(|message| self.handle(message).map_err(|err| err.to_string()))
                {
                    Ok(response) => response,
                    Err(message) => ProtocolMessage::Error { code: 1, message },
                };
                let Ok(response) = response.into_frame(request.sequence) else {
                    break;
                };
                if device.send(&response).is_err() {
                    break;
                }
                cached_response = Some(response);
            }
            self
        });
        (host, worker)
    }
}

#[must_use]
pub const fn reference_layout() -> SlotLayout {
    SlotLayout {
        slot_a: Region {
            start: 0x2_0000,
            len: 0xc_0000,
        },
        slot_b: Region {
            start: 0xe_0000,
            len: 0xc_0000,
        },
        metadata_a: Region {
            start: 0x1a_0000,
            len: 0x1000,
        },
        metadata_b: Region {
            start: 0x1a_1000,
            len: 0x1000,
        },
    }
}

const fn slot_index(slot: Slot) -> usize {
    match slot {
        Slot::A => 0,
        Slot::B => 1,
    }
}

const fn host_slot(slot: Slot) -> HostSlot {
    match slot {
        Slot::A => HostSlot::A,
        Slot::B => HostSlot::B,
    }
}

const fn device_slot(slot: HostSlot) -> Slot {
    match slot {
        HostSlot::A => Slot::A,
        HostSlot::B => Slot::B,
    }
}

#[cfg(test)]
mod tests {
    use sha2::{Digest, Sha256};

    use super::*;
    use fwctl_core::device::UpdateId;
    use fwctl_core::package::FirmwareManifest;
    use fwctl_core::protocol::BeginUpdate;
    use fwctl_core::transport::ProtocolClient;

    fn signed_begin(image: &[u8], update_id: UpdateId) -> BeginUpdate {
        let signer = SigningIdentity::from_seed("release", [0x42; 32]);
        let image_digest = ImageDigest::from_bytes(Sha256::digest(image).into());
        let manifest = FirmwareManifest::new(
            "sensor-node".into(),
            "1.1.0".into(),
            vec!["A1".into()],
            image.len() as u64,
            image_digest,
            2,
            "release".into(),
        )
        .unwrap();
        BeginUpdate {
            update_id,
            format_version: manifest.format_version,
            product: manifest.product.clone(),
            image_size: u32::try_from(image.len()).unwrap(),
            image_digest,
            firmware_version: manifest.firmware_version.clone(),
            hardware_revisions: manifest.hardware_revisions.clone(),
            rollback_counter: manifest.rollback_counter,
            image_file: manifest.image.file.clone(),
            signing_key: manifest.signing_key.clone(),
            signature: signer.sign_manifest(&manifest).unwrap(),
            target_slot: HostSlot::B,
        }
    }

    #[test]
    fn simulates_complete_candidate_lifecycle() {
        let image = vec![0x4c; 1024];
        let update_id = UpdateId::from_bytes([7; 16]);
        let mut sim = Simulator::new(SimulatorConfig::default()).unwrap();
        assert!(matches!(
            sim.handle(ProtocolMessage::BeginUpdate(signed_begin(
                &image, update_id
            )))
            .unwrap(),
            ProtocolMessage::BeginUpdateResponse(_)
        ));
        sim.handle(ProtocolMessage::EraseSlot {
            update_id,
            slot: HostSlot::B,
        })
        .unwrap();
        sim.handle(ProtocolMessage::WriteChunk {
            update_id,
            offset: 0,
            data: image,
        })
        .unwrap();
        sim.handle(ProtocolMessage::VerifyImage { update_id })
            .unwrap();
        sim.handle(ProtocolMessage::SetCandidate { update_id })
            .unwrap();
        sim.handle(ProtocolMessage::Reboot).unwrap();
        assert_eq!(sim.info().active_slot, HostSlot::B);
        assert_eq!(sim.info().update_state, UpdateState::AwaitingConfirmation);
        sim.handle(ProtocolMessage::ConfirmBoot).unwrap();
        assert_eq!(sim.info().firmware_version, "1.1.0");
        assert_eq!(sim.info().rollback_counter, 2);
    }

    #[test]
    fn serves_protocol_with_duplicate_response_cache() {
        let sim = Simulator::new(SimulatorConfig::default()).unwrap();
        let (host, worker) = sim.spawn();
        let mut client = ProtocolClient::new(host, Duration::from_millis(30), 1);
        let response = client
            .request(
                ProtocolMessage::Hello { host_nonce: 55 },
                fwctl_core::protocol::MessageKind::HelloResp,
            )
            .unwrap();
        assert!(matches!(
            response,
            ProtocolMessage::HelloResponse { host_nonce: 55, .. }
        ));
        drop(client);
        worker.join().unwrap();
    }

    #[test]
    fn unhealthy_candidate_refuses_confirmation() {
        let image = vec![0x11; 32];
        let update_id = UpdateId::from_bytes([9; 16]);
        let mut sim = Simulator::new(SimulatorConfig::default()).unwrap();
        sim.faults.candidate_healthy = false;
        sim.handle(ProtocolMessage::BeginUpdate(signed_begin(
            &image, update_id,
        )))
        .unwrap();
        sim.handle(ProtocolMessage::EraseSlot {
            update_id,
            slot: HostSlot::B,
        })
        .unwrap();
        sim.handle(ProtocolMessage::WriteChunk {
            update_id,
            offset: 0,
            data: image,
        })
        .unwrap();
        sim.handle(ProtocolMessage::VerifyImage { update_id })
            .unwrap();
        sim.handle(ProtocolMessage::SetCandidate { update_id })
            .unwrap();
        sim.handle(ProtocolMessage::Reboot).unwrap();
        assert!(!sim.status().candidate_healthy);
        assert!(sim.handle(ProtocolMessage::ConfirmBoot).is_err());
    }
}
