use thiserror::Error;

use super::{Pico2FrameHandler, Pico2LinkError, Pico2UsbLink, Rp2350UsbSerialDriver};
use crate::{
    BootDecision, DeviceUpdater, Flash, FlashError, Region, Slot, SlotLayout, UpdaterError,
};

pub const FLASH_CAPACITY: u32 = 4 * 1024 * 1024;
pub const ERASE_SIZE: u32 = 4096;
pub const PAGE_SIZE: usize = 256;
const PAGE_SIZE_U32: u32 = 256;

pub const SLOT_LAYOUT: SlotLayout = SlotLayout {
    slot_a: Region {
        start: 0x02_0000,
        len: 0x1d_0000,
    },
    slot_b: Region {
        start: 0x1f_0000,
        len: 0x1d_0000,
    },
    metadata_a: Region {
        start: 0x3c_0000,
        len: ERASE_SIZE,
    },
    metadata_b: Region {
        start: 0x3c_1000,
        len: ERASE_SIZE,
    },
};

pub trait Rp2350FlashDriver {
    fn erase_sector(&mut self, flash_offset: u32) -> Result<(), u32>;
    fn program_page(&mut self, flash_offset: u32, data: &[u8]) -> Result<(), u32>;
    fn read(&self, flash_offset: u32, data: &mut [u8]) -> Result<(), u32>;
}

pub trait Rp2350BootControl {
    fn select_boot_partition(&mut self, slot: Slot) -> Result<(), u32>;
    fn watchdog_reset(&mut self) -> !;
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct Pico2Health {
    pub core_initialized: bool,
    pub update_protocol_ready: bool,
    pub application_ready: bool,
}

impl Pico2Health {
    #[must_use]
    pub const fn ready_to_confirm(self) -> bool {
        self.core_initialized && self.update_protocol_ready && self.application_ready
    }
}

pub fn apply_boot_decision(
    control: &mut impl Rp2350BootControl,
    decision: BootDecision,
) -> Result<Slot, u32> {
    let slot = match decision {
        BootDecision::Confirmed(slot)
        | BootDecision::Candidate { slot, .. }
        | BootDecision::RolledBack(slot) => slot,
    };
    control.select_boot_partition(slot)?;
    Ok(slot)
}

#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum Pico2AppError {
    #[error(transparent)]
    Updater(#[from] UpdaterError),
    #[error(transparent)]
    Usb(#[from] Pico2LinkError),
    #[error("RP2350 boot control failed with code {0}")]
    BootControl(u32),
}

pub struct Pico2ReferenceApp<D, U, H> {
    updater: DeviceUpdater<Pico2Flash<D>>,
    usb_link: Pico2UsbLink<U>,
    request_handler: H,
    health: Pico2Health,
}

impl<D, U, H> Pico2ReferenceApp<D, U, H> {
    #[must_use]
    pub const fn new(
        updater: DeviceUpdater<Pico2Flash<D>>,
        usb_link: Pico2UsbLink<U>,
        request_handler: H,
    ) -> Self {
        Self {
            updater,
            usb_link,
            request_handler,
            health: Pico2Health {
                core_initialized: false,
                update_protocol_ready: false,
                application_ready: false,
            },
        }
    }

    #[must_use]
    pub const fn health(&self) -> Pico2Health {
        self.health
    }

    pub fn health_mut(&mut self) -> &mut Pico2Health {
        &mut self.health
    }

    #[must_use]
    pub fn updater(&self) -> &DeviceUpdater<Pico2Flash<D>> {
        &self.updater
    }

    pub fn updater_mut(&mut self) -> &mut DeviceUpdater<Pico2Flash<D>> {
        &mut self.updater
    }

    pub fn into_parts(self) -> (DeviceUpdater<Pico2Flash<D>>, Pico2UsbLink<U>, H) {
        (self.updater, self.usb_link, self.request_handler)
    }
}

impl<D, U, H> Pico2ReferenceApp<D, U, H>
where
    D: Rp2350FlashDriver,
    U: Rp2350UsbSerialDriver,
    H: Pico2FrameHandler<Pico2Flash<D>>,
{
    pub fn service_usb(&mut self) -> Result<bool, Pico2AppError> {
        let serviced = self
            .usb_link
            .service(&mut self.updater, &mut self.request_handler)?;
        if serviced {
            self.health.update_protocol_ready = true;
        }
        Ok(serviced)
    }

    pub fn select_boot_target(
        &mut self,
        control: &mut impl Rp2350BootControl,
    ) -> Result<Slot, Pico2AppError> {
        let decision = self.updater.prepare_boot()?;
        apply_boot_decision(control, decision).map_err(Pico2AppError::BootControl)
    }

    pub fn confirm_if_healthy(&mut self) -> Result<Option<Slot>, Pico2AppError> {
        if !self.health.ready_to_confirm() || self.updater.metadata().candidate_slot.is_none() {
            return Ok(None);
        }
        Ok(Some(self.updater.confirm_candidate()?))
    }
}

pub struct Pico2Flash<D> {
    driver: D,
}

impl<D> Pico2Flash<D> {
    #[must_use]
    pub const fn new(driver: D) -> Self {
        Self { driver }
    }

    pub fn into_inner(self) -> D {
        self.driver
    }

    fn checked_range(offset: u32, len: usize) -> Result<(), FlashError> {
        let len = u32::try_from(len).map_err(|_| FlashError::OutOfRange)?;
        let end = offset.checked_add(len).ok_or(FlashError::OutOfRange)?;
        if end > FLASH_CAPACITY {
            return Err(FlashError::OutOfRange);
        }
        Ok(())
    }
}

impl<D: Rp2350FlashDriver> Flash for Pico2Flash<D> {
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
        Self::checked_range(
            start,
            usize::try_from(len).map_err(|_| FlashError::OutOfRange)?,
        )?;
        let mut sector_offset = start;
        let end = start.checked_add(len).ok_or(FlashError::OutOfRange)?;
        while sector_offset < end {
            self.driver
                .erase_sector(sector_offset)
                .map_err(FlashError::Driver)?;
            sector_offset = sector_offset
                .checked_add(ERASE_SIZE)
                .ok_or(FlashError::OutOfRange)?;
        }
        Ok(())
    }

    fn write(&mut self, offset: u32, data: &[u8]) -> Result<(), FlashError> {
        Self::checked_range(offset, data.len())?;
        let mut cursor = 0_usize;
        while cursor < data.len() {
            let cursor_u32 = u32::try_from(cursor).map_err(|_| FlashError::OutOfRange)?;
            let page_offset = offset
                .checked_add(cursor_u32)
                .ok_or(FlashError::OutOfRange)?;
            let in_page =
                usize::try_from(page_offset % PAGE_SIZE_U32).map_err(|_| FlashError::OutOfRange)?;
            let count = (PAGE_SIZE - in_page).min(data.len() - cursor);
            self.driver
                .program_page(page_offset, &data[cursor..cursor + count])
                .map_err(FlashError::Driver)?;
            cursor += count;
        }
        Ok(())
    }

    fn read(&self, offset: u32, buf: &mut [u8]) -> Result<(), FlashError> {
        Self::checked_range(offset, buf.len())?;
        self.driver.read(offset, buf).map_err(FlashError::Driver)
    }
}

#[cfg(test)]
mod tests {
    use sha2::{Digest, Sha256};

    use super::*;
    use crate::boards::{Pico2HandlerError, Pico2Reply};
    use crate::{BootMetadata, UpdateId};

    #[derive(Default)]
    struct Driver {
        erases: Vec<u32>,
        writes: Vec<(u32, usize)>,
        bytes: Vec<u8>,
    }

    impl Driver {
        fn memory() -> Self {
            Self {
                bytes: vec![0xff; usize::try_from(FLASH_CAPACITY).unwrap()],
                ..Self::default()
            }
        }
    }

    #[derive(Default)]
    struct BootControl {
        selected: Option<Slot>,
    }

    impl Rp2350BootControl for BootControl {
        fn select_boot_partition(&mut self, slot: Slot) -> Result<(), u32> {
            self.selected = Some(slot);
            Ok(())
        }

        fn watchdog_reset(&mut self) -> ! {
            panic!("reset")
        }
    }

    impl Rp2350FlashDriver for Driver {
        fn erase_sector(&mut self, flash_offset: u32) -> Result<(), u32> {
            self.erases.push(flash_offset);
            if !self.bytes.is_empty() {
                let start = usize::try_from(flash_offset).map_err(|_| 1_u32)?;
                let erase_len = usize::try_from(ERASE_SIZE).map_err(|_| 1_u32)?;
                self.bytes[start..start + erase_len].fill(0xff);
            }
            Ok(())
        }

        fn program_page(&mut self, flash_offset: u32, data: &[u8]) -> Result<(), u32> {
            assert!(
                usize::try_from(flash_offset % PAGE_SIZE_U32).unwrap() + data.len() <= PAGE_SIZE
            );
            self.writes.push((flash_offset, data.len()));
            if !self.bytes.is_empty() {
                let start = usize::try_from(flash_offset).map_err(|_| 2_u32)?;
                self.bytes[start..start + data.len()].copy_from_slice(data);
            }
            Ok(())
        }

        fn read(&self, flash_offset: u32, data: &mut [u8]) -> Result<(), u32> {
            if self.bytes.is_empty() {
                data.fill(0xff);
            } else {
                let start = usize::try_from(flash_offset).map_err(|_| 3_u32)?;
                data.copy_from_slice(&self.bytes[start..start + data.len()]);
            }
            Ok(())
        }
    }

    struct Usb;

    impl Rp2350UsbSerialDriver for Usb {
        fn read(&mut self, _data: &mut [u8]) -> Result<usize, u32> {
            Ok(0)
        }

        fn write(&mut self, _data: &[u8]) -> Result<(), u32> {
            Ok(())
        }
    }

    struct Handler;

    impl Pico2FrameHandler<Pico2Flash<Driver>> for Handler {
        fn handle(
            &mut self,
            _updater: &mut DeviceUpdater<Pico2Flash<Driver>>,
            _kind: u8,
            _payload: &[u8],
        ) -> Result<Pico2Reply, Pico2HandlerError> {
            Ok(Pico2Reply {
                kind: 0x7f,
                payload: Vec::new(),
            })
        }
    }

    #[test]
    fn pico_layout_fits_four_megabyte_flash() {
        let flash = Pico2Flash::new(Driver::default());
        SLOT_LAYOUT.validate(&flash).unwrap();
        assert!(!SLOT_LAYOUT.slot_a.overlaps(SLOT_LAYOUT.slot_b));
    }

    #[test]
    fn adapter_splits_unaligned_page_programs() {
        let mut flash = Pico2Flash::new(Driver::default());
        flash.write(250, &[0x55; 300]).unwrap();
        let driver = flash.into_inner();
        assert_eq!(driver.writes, [(250, 6), (256, 256), (512, 38)]);
    }

    #[test]
    fn adapter_erases_only_requested_sectors() {
        let mut flash = Pico2Flash::new(Driver::default());
        flash
            .erase(SLOT_LAYOUT.slot_b.start, 2 * ERASE_SIZE)
            .unwrap();
        let driver = flash.into_inner();
        assert_eq!(
            driver.erases,
            [
                SLOT_LAYOUT.slot_b.start,
                SLOT_LAYOUT.slot_b.start + ERASE_SIZE
            ]
        );
    }

    #[test]
    fn candidate_boot_selects_matching_rom_partition() {
        let mut control = BootControl::default();
        let slot = apply_boot_decision(
            &mut control,
            BootDecision::Candidate {
                slot: Slot::B,
                attempt: 1,
            },
        )
        .unwrap();
        assert_eq!(slot, Slot::B);
        assert_eq!(control.selected, Some(Slot::B));
    }

    #[test]
    fn health_requires_protocol_and_application_readiness() {
        let mut health = Pico2Health {
            core_initialized: true,
            update_protocol_ready: true,
            application_ready: false,
        };
        assert!(!health.ready_to_confirm());
        health.application_ready = true;
        assert!(health.ready_to_confirm());
    }

    #[test]
    fn adapter_rejects_geometry_violations_before_driver_access() {
        let mut flash = Pico2Flash::new(Driver::default());
        assert_eq!(flash.erase(1, ERASE_SIZE), Err(FlashError::UnalignedErase));
        assert_eq!(
            flash.erase(FLASH_CAPACITY, ERASE_SIZE),
            Err(FlashError::OutOfRange)
        );
        assert_eq!(
            flash.write(FLASH_CAPACITY - 3, &[0xaa; 4]),
            Err(FlashError::OutOfRange)
        );
        let driver = flash.into_inner();
        assert!(driver.erases.is_empty());
        assert!(driver.writes.is_empty());
    }

    #[test]
    fn every_boot_decision_selects_its_declared_slot() {
        for decision in [
            BootDecision::Confirmed(Slot::A),
            BootDecision::Candidate {
                slot: Slot::B,
                attempt: 2,
            },
            BootDecision::RolledBack(Slot::A),
        ] {
            let mut control = BootControl::default();
            assert_eq!(
                apply_boot_decision(&mut control, decision).unwrap(),
                control.selected.unwrap()
            );
        }
    }

    #[test]
    fn reference_app_confirms_only_after_all_health_signals() {
        let flash = Pico2Flash::new(Driver::memory());
        let updater =
            DeviceUpdater::provision(flash, SLOT_LAYOUT, &BootMetadata::initial(Slot::A, 4))
                .unwrap();
        let mut app = Pico2ReferenceApp::new(updater, Pico2UsbLink::new(Usb), Handler);
        let update_id = UpdateId([0x81; 16]);
        let image = [0x35; 64];
        let digest = Sha256::digest(image).into();
        app.updater_mut()
            .begin_update(update_id, Slot::B, 64, digest, 5)
            .unwrap();
        app.updater_mut().erase_target(update_id).unwrap();
        app.updater_mut().write_chunk(update_id, 0, &image).unwrap();
        app.updater_mut().verify_image(update_id).unwrap();
        app.updater_mut().set_candidate(update_id).unwrap();

        assert_eq!(app.confirm_if_healthy().unwrap(), None);
        *app.health_mut() = Pico2Health {
            core_initialized: true,
            update_protocol_ready: true,
            application_ready: true,
        };
        assert_eq!(app.confirm_if_healthy().unwrap(), Some(Slot::B));
        assert_eq!(app.updater().metadata().confirmed_slot, Slot::B);
    }
}
