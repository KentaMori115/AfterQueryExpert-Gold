use thiserror::Error;

use crate::{
    BootDecision, DeviceFrameHandler, DeviceLinkError, DeviceSerialDriver, DeviceSerialLink,
    DeviceUpdater, Flash, FlashError, Region, Slot, SlotLayout, UpdateId, UpdaterError,
};

pub const FLASH_CAPACITY: u32 = 4 * 1024 * 1024;
pub const ERASE_SIZE: u32 = 4096;

pub const SLOT_LAYOUT: SlotLayout = SlotLayout {
    slot_a: Region {
        start: 0x01_0000,
        len: 0x1d_0000,
    },
    slot_b: Region {
        start: 0x1e_0000,
        len: 0x1d_0000,
    },
    metadata_a: Region {
        start: 0x3b_0000,
        len: ERASE_SIZE,
    },
    metadata_b: Region {
        start: 0x3b_1000,
        len: ERASE_SIZE,
    },
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Esp32Partition {
    Ota0,
    Ota1,
    Metadata0,
    Metadata1,
}

impl Esp32Partition {
    #[must_use]
    pub const fn region(self) -> Region {
        match self {
            Self::Ota0 => SLOT_LAYOUT.slot_a,
            Self::Ota1 => SLOT_LAYOUT.slot_b,
            Self::Metadata0 => SLOT_LAYOUT.metadata_a,
            Self::Metadata1 => SLOT_LAYOUT.metadata_b,
        }
    }

    #[must_use]
    pub const fn from_slot(slot: Slot) -> Self {
        match slot {
            Slot::A => Self::Ota0,
            Slot::B => Self::Ota1,
        }
    }
}

pub trait Esp32PartitionDriver {
    fn erase(&mut self, partition: Esp32Partition, offset: u32, len: u32) -> Result<(), u32>;
    fn write(&mut self, partition: Esp32Partition, offset: u32, data: &[u8]) -> Result<(), u32>;
    fn read(&self, partition: Esp32Partition, offset: u32, data: &mut [u8]) -> Result<(), u32>;
}

pub trait Esp32OtaControl {
    fn running_partition(&self) -> Result<Slot, u32>;
    fn verify_partition(&mut self, slot: Slot) -> Result<(), u32>;
    fn set_boot_partition(&mut self, slot: Slot) -> Result<(), u32>;
    fn mark_running_valid(&mut self) -> Result<(), u32>;
    fn restart(&mut self) -> Result<(), u32>;
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct Esp32Health {
    pub services_ready: bool,
    pub update_protocol_ready: bool,
    pub application_ready: bool,
}

impl Esp32Health {
    #[must_use]
    pub const fn ready_to_confirm(self) -> bool {
        self.services_ready && self.update_protocol_ready && self.application_ready
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum Esp32AppError {
    #[error(transparent)]
    Updater(#[from] UpdaterError),
    #[error(transparent)]
    Serial(#[from] DeviceLinkError),
    #[error("ESP-IDF OTA control failed with code {0}")]
    OtaControl(u32),
    #[error("running slot {running:?} does not match candidate slot {candidate:?}")]
    RunningSlotMismatch { running: Slot, candidate: Slot },
}

pub fn apply_boot_decision(
    control: &mut impl Esp32OtaControl,
    decision: BootDecision,
) -> Result<Slot, u32> {
    let slot = match decision {
        BootDecision::Confirmed(slot)
        | BootDecision::Candidate { slot, .. }
        | BootDecision::RolledBack(slot) => slot,
    };
    control.set_boot_partition(slot)?;
    Ok(slot)
}

pub struct Esp32Flash<D> {
    driver: D,
}

impl<D> Esp32Flash<D> {
    #[must_use]
    pub const fn new(driver: D) -> Self {
        Self { driver }
    }

    pub fn into_inner(self) -> D {
        self.driver
    }

    fn map_range(addr: u32, len: usize) -> Result<(Esp32Partition, u32), FlashError> {
        let len = u32::try_from(len).map_err(|_| FlashError::OutOfRange)?;
        for partition in [
            Esp32Partition::Ota0,
            Esp32Partition::Ota1,
            Esp32Partition::Metadata0,
            Esp32Partition::Metadata1,
        ] {
            let region = partition.region();
            if region.contains(addr, len) {
                return Ok((partition, addr - region.start));
            }
        }
        Err(FlashError::OutOfRange)
    }
}

impl<D: Esp32PartitionDriver> Flash for Esp32Flash<D> {
    fn capacity(&self) -> u32 {
        FLASH_CAPACITY
    }

    fn erase_size(&self) -> u32 {
        ERASE_SIZE
    }

    fn write_size(&self) -> u32 {
        1
    }

    fn erase(&mut self, start: u32, len: u32) -> Result<(), FlashError> {
        if !start.is_multiple_of(ERASE_SIZE) || !len.is_multiple_of(ERASE_SIZE) {
            return Err(FlashError::UnalignedErase);
        }
        let len_usize = usize::try_from(len).map_err(|_| FlashError::OutOfRange)?;
        let (partition, offset) = Self::map_range(start, len_usize)?;
        self.driver
            .erase(partition, offset, len)
            .map_err(FlashError::Driver)
    }

    fn write(&mut self, offset: u32, data: &[u8]) -> Result<(), FlashError> {
        let (partition, partition_offset) = Self::map_range(offset, data.len())?;
        self.driver
            .write(partition, partition_offset, data)
            .map_err(FlashError::Driver)
    }

    fn read(&self, offset: u32, data: &mut [u8]) -> Result<(), FlashError> {
        let (partition, partition_offset) = Self::map_range(offset, data.len())?;
        self.driver
            .read(partition, partition_offset, data)
            .map_err(FlashError::Driver)
    }
}

pub struct Esp32ReferenceApp<D, S, H, C> {
    updater: DeviceUpdater<Esp32Flash<D>>,
    serial_link: DeviceSerialLink<S>,
    request_handler: H,
    ota_control: C,
    health: Esp32Health,
}

impl<D, S, H, C> Esp32ReferenceApp<D, S, H, C> {
    #[must_use]
    pub const fn new(
        updater: DeviceUpdater<Esp32Flash<D>>,
        serial_link: DeviceSerialLink<S>,
        request_handler: H,
        ota_control: C,
    ) -> Self {
        Self {
            updater,
            serial_link,
            request_handler,
            ota_control,
            health: Esp32Health {
                services_ready: false,
                update_protocol_ready: false,
                application_ready: false,
            },
        }
    }

    #[must_use]
    pub const fn health(&self) -> Esp32Health {
        self.health
    }

    pub fn health_mut(&mut self) -> &mut Esp32Health {
        &mut self.health
    }

    #[must_use]
    pub fn updater(&self) -> &DeviceUpdater<Esp32Flash<D>> {
        &self.updater
    }

    pub fn updater_mut(&mut self) -> &mut DeviceUpdater<Esp32Flash<D>> {
        &mut self.updater
    }

    pub fn ota_control_mut(&mut self) -> &mut C {
        &mut self.ota_control
    }

    pub fn into_parts(self) -> (DeviceUpdater<Esp32Flash<D>>, DeviceSerialLink<S>, H, C) {
        (
            self.updater,
            self.serial_link,
            self.request_handler,
            self.ota_control,
        )
    }
}

impl<D, S, H, C> Esp32ReferenceApp<D, S, H, C>
where
    D: Esp32PartitionDriver,
    S: DeviceSerialDriver,
    H: DeviceFrameHandler<Esp32Flash<D>>,
    C: Esp32OtaControl,
{
    pub fn service_serial(&mut self) -> Result<bool, Esp32AppError> {
        let serviced = self
            .serial_link
            .service(&mut self.updater, &mut self.request_handler)?;
        if serviced {
            self.health.update_protocol_ready = true;
        }
        Ok(serviced)
    }

    pub fn finalize_candidate(&mut self, update_id: UpdateId) -> Result<Slot, Esp32AppError> {
        self.updater.verify_image(update_id)?;
        let target = self
            .updater
            .metadata()
            .transfer
            .as_ref()
            .ok_or(UpdaterError::NotReady)?
            .target_slot;
        self.ota_control
            .verify_partition(target)
            .map_err(Esp32AppError::OtaControl)?;
        let candidate = self.updater.set_candidate(update_id)?;
        self.ota_control
            .set_boot_partition(candidate)
            .map_err(Esp32AppError::OtaControl)?;
        Ok(candidate)
    }

    pub fn prepare_boot(&mut self) -> Result<Slot, Esp32AppError> {
        let decision = self.updater.prepare_boot()?;
        let target = apply_boot_decision(&mut self.ota_control, decision)
            .map_err(Esp32AppError::OtaControl)?;
        let running = self
            .ota_control
            .running_partition()
            .map_err(Esp32AppError::OtaControl)?;
        if running != target {
            self.ota_control
                .restart()
                .map_err(Esp32AppError::OtaControl)?;
        }
        Ok(target)
    }

    pub fn confirm_if_healthy(&mut self) -> Result<Option<Slot>, Esp32AppError> {
        if !self.health.ready_to_confirm() {
            return Ok(None);
        }
        let Some(candidate) = self.updater.metadata().candidate_slot else {
            return Ok(None);
        };
        let running = self
            .ota_control
            .running_partition()
            .map_err(Esp32AppError::OtaControl)?;
        if running != candidate {
            return Err(Esp32AppError::RunningSlotMismatch { running, candidate });
        }
        self.ota_control
            .mark_running_valid()
            .map_err(Esp32AppError::OtaControl)?;
        Ok(Some(self.updater.confirm_candidate()?))
    }

    pub fn rollback_and_restart(&mut self) -> Result<Slot, Esp32AppError> {
        let confirmed = self.updater.rollback_candidate()?;
        self.ota_control
            .set_boot_partition(confirmed)
            .map_err(Esp32AppError::OtaControl)?;
        self.ota_control
            .restart()
            .map_err(Esp32AppError::OtaControl)?;
        Ok(confirmed)
    }
}

#[cfg(test)]
mod tests {
    use alloc::vec;
    use alloc::vec::Vec;
    use sha2::{Digest, Sha256};

    use super::*;
    use crate::{BootMetadata, DeviceHandlerError, DeviceReply};

    #[derive(Default)]
    struct Driver {
        bytes: Vec<u8>,
        erases: Vec<(Esp32Partition, u32, u32)>,
        writes: Vec<(Esp32Partition, u32, usize)>,
    }

    impl Driver {
        fn memory() -> Self {
            Self {
                bytes: vec![0xff; FLASH_CAPACITY as usize],
                ..Self::default()
            }
        }

        fn address(partition: Esp32Partition, offset: u32) -> usize {
            (partition.region().start + offset) as usize
        }
    }

    impl Esp32PartitionDriver for Driver {
        fn erase(&mut self, partition: Esp32Partition, offset: u32, len: u32) -> Result<(), u32> {
            self.erases.push((partition, offset, len));
            let start = Self::address(partition, offset);
            self.bytes[start..start + len as usize].fill(0xff);
            Ok(())
        }

        fn write(
            &mut self,
            partition: Esp32Partition,
            offset: u32,
            data: &[u8],
        ) -> Result<(), u32> {
            self.writes.push((partition, offset, data.len()));
            let start = Self::address(partition, offset);
            self.bytes[start..start + data.len()].copy_from_slice(data);
            Ok(())
        }

        fn read(&self, partition: Esp32Partition, offset: u32, data: &mut [u8]) -> Result<(), u32> {
            let start = Self::address(partition, offset);
            data.copy_from_slice(&self.bytes[start..start + data.len()]);
            Ok(())
        }
    }

    #[derive(Default)]
    struct Ota {
        running: Option<Slot>,
        verified: Vec<Slot>,
        selected: Vec<Slot>,
        confirmations: usize,
        restarts: usize,
    }

    impl Esp32OtaControl for Ota {
        fn running_partition(&self) -> Result<Slot, u32> {
            self.running.ok_or(90)
        }

        fn verify_partition(&mut self, slot: Slot) -> Result<(), u32> {
            self.verified.push(slot);
            Ok(())
        }

        fn set_boot_partition(&mut self, slot: Slot) -> Result<(), u32> {
            self.selected.push(slot);
            Ok(())
        }

        fn mark_running_valid(&mut self) -> Result<(), u32> {
            self.confirmations += 1;
            Ok(())
        }

        fn restart(&mut self) -> Result<(), u32> {
            self.restarts += 1;
            Ok(())
        }
    }

    struct Serial;

    impl DeviceSerialDriver for Serial {
        fn read(&mut self, _data: &mut [u8]) -> Result<usize, u32> {
            Ok(0)
        }

        fn write(&mut self, _data: &[u8]) -> Result<(), u32> {
            Ok(())
        }
    }

    struct Handler;

    impl DeviceFrameHandler<Esp32Flash<Driver>> for Handler {
        fn handle(
            &mut self,
            _updater: &mut DeviceUpdater<Esp32Flash<Driver>>,
            _kind: u8,
            _payload: &[u8],
        ) -> Result<DeviceReply, DeviceHandlerError> {
            Ok(DeviceReply {
                kind: 0,
                payload: Vec::new(),
            })
        }
    }

    fn digest(data: &[u8]) -> [u8; 32] {
        Sha256::digest(data).into()
    }

    fn updater() -> DeviceUpdater<Esp32Flash<Driver>> {
        DeviceUpdater::provision(
            Esp32Flash::new(Driver::memory()),
            SLOT_LAYOUT,
            &BootMetadata::initial(Slot::A, 1),
        )
        .unwrap()
    }

    fn app(running: Slot) -> Esp32ReferenceApp<Driver, Serial, Handler, Ota> {
        Esp32ReferenceApp::new(
            updater(),
            DeviceSerialLink::new(Serial),
            Handler,
            Ota {
                running: Some(running),
                ..Ota::default()
            },
        )
    }

    fn candidate_app(running: Slot) -> Esp32ReferenceApp<Driver, Serial, Handler, Ota> {
        let image = vec![0xa5; 6000];
        let update_id = UpdateId([7; 16]);
        let mut app = app(running);
        app.updater_mut()
            .begin_update(
                update_id,
                Slot::B,
                u32::try_from(image.len()).unwrap(),
                digest(&image),
                2,
            )
            .unwrap();
        app.updater_mut().erase_target(update_id).unwrap();
        app.updater_mut().write_chunk(update_id, 0, &image).unwrap();
        app.finalize_candidate(update_id).unwrap();
        app
    }

    #[test]
    fn layout_matches_dual_ota_partition_table() {
        let flash = Esp32Flash::new(Driver::memory());
        SLOT_LAYOUT.validate(&flash).unwrap();
        assert_eq!(Esp32Partition::from_slot(Slot::A), Esp32Partition::Ota0);
        assert_eq!(Esp32Partition::from_slot(Slot::B), Esp32Partition::Ota1);
        assert_eq!(SLOT_LAYOUT.slot_a.end(), Some(SLOT_LAYOUT.slot_b.start));
    }

    #[test]
    fn flash_routes_absolute_addresses_to_partition_offsets() {
        let mut flash = Esp32Flash::new(Driver::memory());
        flash
            .erase(SLOT_LAYOUT.slot_b.start, SLOT_LAYOUT.slot_b.len)
            .unwrap();
        flash
            .write(SLOT_LAYOUT.slot_b.start + 33, &[1, 2, 3])
            .unwrap();
        let mut buf = [0; 3];
        flash.read(SLOT_LAYOUT.slot_b.start + 33, &mut buf).unwrap();
        assert_eq!(buf, [1, 2, 3]);
        let driver = flash.into_inner();
        assert_eq!(
            driver.erases,
            vec![(Esp32Partition::Ota1, 0, SLOT_LAYOUT.slot_b.len)]
        );
        assert_eq!(driver.writes[0], (Esp32Partition::Ota1, 33, 3));
    }

    #[test]
    fn flash_rejects_reserved_and_cross_partition_ranges() {
        let mut flash = Esp32Flash::new(Driver::memory());
        assert_eq!(flash.write(0x9000, &[1]), Err(FlashError::OutOfRange));
        assert_eq!(
            flash.write(SLOT_LAYOUT.slot_a.end().unwrap() - 1, &[1, 2]),
            Err(FlashError::OutOfRange)
        );
        assert_eq!(
            flash.erase(SLOT_LAYOUT.slot_a.start + 1, ERASE_SIZE),
            Err(FlashError::UnalignedErase)
        );
    }

    #[test]
    fn interrupted_transfer_resumes_through_esp32_partitions() {
        let image = vec![0x3c; 70_000];
        let update_id = UpdateId([9; 16]);
        let mut updater = updater();
        updater
            .begin_update(update_id, Slot::B, 70_000, digest(&image), 2)
            .unwrap();
        updater.erase_target(update_id).unwrap();
        updater.write_chunk(update_id, 0, &image[..65_536]).unwrap();

        let flash = updater.into_flash();
        let mut resumed = DeviceUpdater::load(flash, SLOT_LAYOUT).unwrap();
        assert_eq!(
            resumed
                .begin_update(update_id, Slot::B, 70_000, digest(&image), 2)
                .unwrap(),
            65_536
        );
        resumed
            .write_chunk(update_id, 65_536, &image[65_536..])
            .unwrap();
        assert_eq!(resumed.verify_image(update_id).unwrap(), digest(&image));
    }

    #[test]
    fn finalize_verifies_before_selecting_candidate() {
        let image = vec![0xa5; 6000];
        let update_id = UpdateId([7; 16]);
        let mut app = app(Slot::A);
        app.updater_mut()
            .begin_update(
                update_id,
                Slot::B,
                u32::try_from(image.len()).unwrap(),
                digest(&image),
                2,
            )
            .unwrap();
        app.updater_mut().erase_target(update_id).unwrap();
        app.updater_mut().write_chunk(update_id, 0, &image).unwrap();

        assert_eq!(app.finalize_candidate(update_id).unwrap(), Slot::B);
        let (_, _, _, ota) = app.into_parts();
        assert_eq!(ota.verified, vec![Slot::B]);
        assert_eq!(ota.selected, vec![Slot::B]);
    }

    #[test]
    fn confirmation_requires_health_and_matching_running_partition() {
        let mut app = candidate_app(Slot::A);
        *app.health_mut() = Esp32Health {
            services_ready: true,
            update_protocol_ready: true,
            application_ready: true,
        };
        assert_eq!(
            app.confirm_if_healthy(),
            Err(Esp32AppError::RunningSlotMismatch {
                running: Slot::A,
                candidate: Slot::B,
            })
        );
    }

    #[test]
    fn healthy_running_candidate_is_confirmed_in_both_stores() {
        let mut app = candidate_app(Slot::B);
        *app.health_mut() = Esp32Health {
            services_ready: true,
            update_protocol_ready: true,
            application_ready: true,
        };
        assert_eq!(app.confirm_if_healthy().unwrap(), Some(Slot::B));
        assert_eq!(app.updater().metadata().confirmed_slot, Slot::B);
        let (_, _, _, ota) = app.into_parts();
        assert_eq!(ota.confirmations, 1);
    }

    #[test]
    fn exhausted_candidate_selects_confirmed_partition() {
        let mut app = candidate_app(Slot::B);
        assert_eq!(app.prepare_boot().unwrap(), Slot::B);
        assert_eq!(app.prepare_boot().unwrap(), Slot::B);
        assert_eq!(app.prepare_boot().unwrap(), Slot::A);
        assert_eq!(app.updater().metadata().candidate_slot, None);
        let (_, _, _, ota) = app.into_parts();
        assert_eq!(ota.selected.last(), Some(&Slot::A));
        assert_eq!(ota.restarts, 1);
    }
}
