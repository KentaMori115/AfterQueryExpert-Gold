use thiserror::Error;

use crate::{Flash, FlashError, Slot, SlotLayout};

const METADATA_MAGIC: [u8; 4] = *b"FWMD";
const METADATA_VERSION: u8 = 1;
const METADATA_DATA_LEN: usize = 100;
const METADATA_ENCODED_LEN: usize = 104;
const METADATA_ENCODED_LEN_U32: u32 = 104;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct UpdateId(pub [u8; 16]);

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TransferRecord {
    pub update_id: UpdateId,
    pub target_slot: Slot,
    pub image_size: u32,
    pub image_digest: [u8; 32],
    pub accepted_offset: u32,
    pub rollback_counter: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BootMetadata {
    pub generation: u64,
    pub confirmed_slot: Slot,
    pub candidate_slot: Option<Slot>,
    pub candidate_attempts: u8,
    pub highest_rollback_counter: u64,
    pub candidate_rollback_counter: u64,
    pub transfer: Option<TransferRecord>,
}

impl BootMetadata {
    #[must_use]
    pub const fn initial(confirmed_slot: Slot, rollback_counter: u64) -> Self {
        Self {
            generation: 0,
            confirmed_slot,
            candidate_slot: None,
            candidate_attempts: 0,
            highest_rollback_counter: rollback_counter,
            candidate_rollback_counter: 0,
            transfer: None,
        }
    }

    pub fn validate(&self) -> Result<(), MetadataError> {
        if self.candidate_slot == Some(self.confirmed_slot) {
            return Err(MetadataError::Invariant(
                "candidate slot equals confirmed slot",
            ));
        }
        if self.candidate_slot.is_none()
            && (self.candidate_attempts != 0 || self.candidate_rollback_counter != 0)
        {
            return Err(MetadataError::Invariant(
                "candidate fields are set without a candidate",
            ));
        }
        if self.candidate_slot.is_some()
            && self.candidate_rollback_counter < self.highest_rollback_counter
        {
            return Err(MetadataError::Invariant(
                "candidate rollback counter is below confirmed counter",
            ));
        }
        if self.candidate_slot.is_some() && self.transfer.is_some() {
            return Err(MetadataError::Invariant(
                "candidate and transfer cannot be active together",
            ));
        }
        if let Some(transfer) = &self.transfer {
            if transfer.target_slot == self.confirmed_slot {
                return Err(MetadataError::Invariant("transfer targets confirmed slot"));
            }
            if transfer.image_size == 0 || transfer.accepted_offset > transfer.image_size {
                return Err(MetadataError::Invariant("invalid transfer extent"));
            }
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LoadedMetadata {
    pub metadata: BootMetadata,
    pub source_copy: Slot,
}

#[derive(Debug, Clone, Copy)]
pub struct MetadataStore {
    layout: SlotLayout,
}

#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum MetadataError {
    #[error(transparent)]
    Flash(#[from] FlashError),
    #[error("neither boot metadata copy is valid")]
    NoValidCopy,
    #[error("boot metadata encoding is invalid")]
    InvalidEncoding,
    #[error("boot metadata invariant failed: {0}")]
    Invariant(&'static str),
    #[error("boot metadata generation counter overflowed")]
    GenerationOverflow,
    #[error("metadata region is too small or incompatible with flash write geometry")]
    InvalidRegion,
    #[error("new boot metadata failed read-back verification")]
    VerificationFailed,
}

impl MetadataStore {
    #[must_use]
    pub const fn new(layout: SlotLayout) -> Self {
        Self { layout }
    }

    pub fn load<F: Flash>(&self, flash: &F) -> Result<LoadedMetadata, MetadataError> {
        let copy_a = self.read_copy(flash, Slot::A).ok();
        let copy_b = self.read_copy(flash, Slot::B).ok();
        match (copy_a, copy_b) {
            (Some(metadata), None) => Ok(LoadedMetadata {
                metadata,
                source_copy: Slot::A,
            }),
            (None, Some(metadata)) => Ok(LoadedMetadata {
                metadata,
                source_copy: Slot::B,
            }),
            (Some(a), Some(b)) if a.generation >= b.generation => Ok(LoadedMetadata {
                metadata: a,
                source_copy: Slot::A,
            }),
            (Some(_), Some(b)) => Ok(LoadedMetadata {
                metadata: b,
                source_copy: Slot::B,
            }),
            (None, None) => Err(MetadataError::NoValidCopy),
        }
    }

    pub fn initialize<F: Flash>(
        &self,
        flash: &mut F,
        metadata: &BootMetadata,
    ) -> Result<LoadedMetadata, MetadataError> {
        metadata.validate()?;
        self.write_copy(flash, Slot::A, metadata)?;
        Ok(LoadedMetadata {
            metadata: metadata.clone(),
            source_copy: Slot::A,
        })
    }

    pub fn commit<F: Flash>(
        &self,
        flash: &mut F,
        current: &LoadedMetadata,
        mut next: BootMetadata,
    ) -> Result<LoadedMetadata, MetadataError> {
        next.generation = current
            .metadata
            .generation
            .checked_add(1)
            .ok_or(MetadataError::GenerationOverflow)?;
        next.validate()?;
        let target_copy = current.source_copy.inactive();
        self.write_copy(flash, target_copy, &next)?;
        Ok(LoadedMetadata {
            metadata: next,
            source_copy: target_copy,
        })
    }

    fn read_copy<F: Flash>(&self, flash: &F, copy: Slot) -> Result<BootMetadata, MetadataError> {
        let region = self.layout.metadata(copy);
        if region.len < METADATA_ENCODED_LEN_U32 {
            return Err(MetadataError::InvalidRegion);
        }
        let mut encoded = [0_u8; METADATA_ENCODED_LEN];
        flash.read(region.start, &mut encoded)?;
        decode(&encoded)
    }

    fn write_copy<F: Flash>(
        &self,
        flash: &mut F,
        copy: Slot,
        metadata: &BootMetadata,
    ) -> Result<(), MetadataError> {
        let region = self.layout.metadata(copy);
        let encoded_len = METADATA_ENCODED_LEN_U32;
        if region.len < encoded_len
            || !region.start.is_multiple_of(flash.write_size())
            || !encoded_len.is_multiple_of(flash.write_size())
        {
            return Err(MetadataError::InvalidRegion);
        }
        let encoded = encode(metadata)?;
        flash.erase(region.start, region.len)?;
        flash.write(region.start, &encoded)?;
        let mut verify = [0_u8; METADATA_ENCODED_LEN];
        flash.read(region.start, &mut verify)?;
        if verify != encoded || decode(&verify)? != *metadata {
            return Err(MetadataError::VerificationFailed);
        }
        Ok(())
    }
}

fn encode(metadata: &BootMetadata) -> Result<[u8; METADATA_ENCODED_LEN], MetadataError> {
    metadata.validate()?;
    let mut out = [0_u8; METADATA_ENCODED_LEN];
    out[0..4].copy_from_slice(&METADATA_MAGIC);
    out[4] = METADATA_VERSION;
    out[5..13].copy_from_slice(&metadata.generation.to_le_bytes());
    out[13] = encode_slot(metadata.confirmed_slot);
    out[14] = encode_optional_slot(metadata.candidate_slot);
    out[15] = metadata.candidate_attempts;
    out[16..24].copy_from_slice(&metadata.highest_rollback_counter.to_le_bytes());
    out[24..32].copy_from_slice(&metadata.candidate_rollback_counter.to_le_bytes());
    if let Some(transfer) = &metadata.transfer {
        out[32] = 1;
        out[33..49].copy_from_slice(&transfer.update_id.0);
        out[49] = encode_slot(transfer.target_slot);
        out[50..54].copy_from_slice(&transfer.image_size.to_le_bytes());
        out[54..86].copy_from_slice(&transfer.image_digest);
        out[86..90].copy_from_slice(&transfer.accepted_offset.to_le_bytes());
        out[90..98].copy_from_slice(&transfer.rollback_counter.to_le_bytes());
    }
    let crc = crc32(&out[..METADATA_DATA_LEN]);
    out[METADATA_DATA_LEN..].copy_from_slice(&crc.to_le_bytes());
    Ok(out)
}

fn decode(encoded: &[u8; METADATA_ENCODED_LEN]) -> Result<BootMetadata, MetadataError> {
    if encoded[..4] != METADATA_MAGIC || encoded[4] != METADATA_VERSION {
        return Err(MetadataError::InvalidEncoding);
    }
    let stored_crc = u32::from_le_bytes(
        encoded[METADATA_DATA_LEN..]
            .try_into()
            .map_err(|_| MetadataError::InvalidEncoding)?,
    );
    if crc32(&encoded[..METADATA_DATA_LEN]) != stored_crc {
        return Err(MetadataError::InvalidEncoding);
    }
    let transfer = match encoded[32] {
        0 => None,
        1 => Some(TransferRecord {
            update_id: UpdateId(
                encoded[33..49]
                    .try_into()
                    .map_err(|_| MetadataError::InvalidEncoding)?,
            ),
            target_slot: decode_slot(encoded[49])?,
            image_size: read_u32(encoded, 50)?,
            image_digest: encoded[54..86]
                .try_into()
                .map_err(|_| MetadataError::InvalidEncoding)?,
            accepted_offset: read_u32(encoded, 86)?,
            rollback_counter: read_u64(encoded, 90)?,
        }),
        _ => return Err(MetadataError::InvalidEncoding),
    };
    let metadata = BootMetadata {
        generation: read_u64(encoded, 5)?,
        confirmed_slot: decode_slot(encoded[13])?,
        candidate_slot: decode_optional_slot(encoded[14])?,
        candidate_attempts: encoded[15],
        highest_rollback_counter: read_u64(encoded, 16)?,
        candidate_rollback_counter: read_u64(encoded, 24)?,
        transfer,
    };
    metadata.validate()?;
    Ok(metadata)
}

fn encode_slot(slot: Slot) -> u8 {
    match slot {
        Slot::A => 0,
        Slot::B => 1,
    }
}

fn decode_slot(value: u8) -> Result<Slot, MetadataError> {
    match value {
        0 => Ok(Slot::A),
        1 => Ok(Slot::B),
        _ => Err(MetadataError::InvalidEncoding),
    }
}

fn encode_optional_slot(slot: Option<Slot>) -> u8 {
    match slot {
        None => 0,
        Some(Slot::A) => 1,
        Some(Slot::B) => 2,
    }
}

fn decode_optional_slot(value: u8) -> Result<Option<Slot>, MetadataError> {
    match value {
        0 => Ok(None),
        1 => Ok(Some(Slot::A)),
        2 => Ok(Some(Slot::B)),
        _ => Err(MetadataError::InvalidEncoding),
    }
}

fn read_u32(bytes: &[u8], offset: usize) -> Result<u32, MetadataError> {
    Ok(u32::from_le_bytes(
        bytes
            .get(offset..offset + 4)
            .ok_or(MetadataError::InvalidEncoding)?
            .try_into()
            .map_err(|_| MetadataError::InvalidEncoding)?,
    ))
}

fn read_u64(bytes: &[u8], offset: usize) -> Result<u64, MetadataError> {
    Ok(u64::from_le_bytes(
        bytes
            .get(offset..offset + 8)
            .ok_or(MetadataError::InvalidEncoding)?
            .try_into()
            .map_err(|_| MetadataError::InvalidEncoding)?,
    ))
}

fn crc32(bytes: &[u8]) -> u32 {
    let mut crc = u32::MAX;
    for &byte in bytes {
        crc ^= u32::from(byte);
        for _ in 0..8 {
            let mask = 0_u32.wrapping_sub(crc & 1);
            crc = (crc >> 1) ^ (0xedb8_8320 & mask);
        }
    }
    !crc
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{Region, SlotLayout};

    struct RamFlash {
        bytes: Vec<u8>,
        erase_size: u32,
        write_size: u32,
        corrupt_writes: bool,
    }

    impl RamFlash {
        fn new(size: usize) -> Self {
            Self {
                bytes: vec![0xff; size],
                erase_size: 256,
                write_size: 4,
                corrupt_writes: false,
            }
        }
    }

    impl Flash for RamFlash {
        fn capacity(&self) -> u32 {
            u32::try_from(self.bytes.len()).unwrap()
        }

        fn erase_size(&self) -> u32 {
            self.erase_size
        }

        fn write_size(&self) -> u32 {
            self.write_size
        }

        fn erase(&mut self, start: u32, len: u32) -> Result<(), FlashError> {
            if !start.is_multiple_of(self.erase_size) || !len.is_multiple_of(self.erase_size) {
                return Err(FlashError::UnalignedErase);
            }
            let range = start as usize..(start + len) as usize;
            self.bytes
                .get_mut(range)
                .ok_or(FlashError::OutOfRange)?
                .fill(0xff);
            Ok(())
        }

        fn write(&mut self, offset: u32, data: &[u8]) -> Result<(), FlashError> {
            let start = offset as usize;
            let target = self
                .bytes
                .get_mut(start..start + data.len())
                .ok_or(FlashError::OutOfRange)?;
            if target
                .iter()
                .zip(data)
                .any(|(current, next)| current & next != *next)
            {
                return Err(FlashError::RequiresErase);
            }
            target.copy_from_slice(data);
            if self.corrupt_writes && !data.is_empty() {
                self.bytes[start] ^= 1;
            }
            Ok(())
        }

        fn read(&self, offset: u32, buf: &mut [u8]) -> Result<(), FlashError> {
            let start = offset as usize;
            let source = self
                .bytes
                .get(start..start + buf.len())
                .ok_or(FlashError::OutOfRange)?;
            buf.copy_from_slice(source);
            Ok(())
        }
    }

    fn layout() -> SlotLayout {
        SlotLayout {
            slot_a: Region {
                start: 0,
                len: 2048,
            },
            slot_b: Region {
                start: 2048,
                len: 2048,
            },
            metadata_a: Region {
                start: 4096,
                len: 256,
            },
            metadata_b: Region {
                start: 4352,
                len: 256,
            },
        }
    }

    fn transfer(target_slot: Slot) -> TransferRecord {
        TransferRecord {
            update_id: UpdateId([0x5a; 16]),
            target_slot,
            image_size: 1024,
            image_digest: [0x36; 32],
            accepted_offset: 512,
            rollback_counter: 8,
        }
    }

    #[test]
    fn metadata_encoding_round_trips() {
        let mut metadata = BootMetadata::initial(Slot::A, 7);
        metadata.transfer = Some(TransferRecord {
            update_id: UpdateId([2; 16]),
            target_slot: Slot::B,
            image_size: 1024,
            image_digest: [3; 32],
            accepted_offset: 512,
            rollback_counter: 8,
        });
        assert_eq!(decode(&encode(&metadata).unwrap()).unwrap(), metadata);
    }

    #[test]
    fn commit_alternates_metadata_copies() {
        let mut flash = RamFlash::new(8192);
        let store = MetadataStore::new(layout());
        let initial = store
            .initialize(&mut flash, &BootMetadata::initial(Slot::A, 4))
            .unwrap();
        let mut next = initial.metadata.clone();
        next.highest_rollback_counter = 5;
        let committed = store.commit(&mut flash, &initial, next).unwrap();
        assert_eq!(committed.source_copy, Slot::B);
        assert_eq!(committed.metadata.generation, 1);
        assert_eq!(store.load(&flash).unwrap(), committed);
    }

    #[test]
    fn corrupt_new_copy_falls_back_to_previous_generation() {
        let mut flash = RamFlash::new(8192);
        let store = MetadataStore::new(layout());
        let initial = store
            .initialize(&mut flash, &BootMetadata::initial(Slot::A, 4))
            .unwrap();
        let committed = store
            .commit(&mut flash, &initial, initial.metadata.clone())
            .unwrap();
        let crc_byte = layout().metadata(committed.source_copy).start as usize + METADATA_DATA_LEN;
        flash.bytes[crc_byte] ^= 1;
        assert_eq!(store.load(&flash).unwrap(), initial);
    }

    #[test]
    fn interrupted_target_erase_preserves_current_copy() {
        let mut flash = RamFlash::new(8192);
        let store = MetadataStore::new(layout());
        let current = store
            .initialize(&mut flash, &BootMetadata::initial(Slot::B, 11))
            .unwrap();
        let target = layout().metadata(current.source_copy.inactive());
        flash.erase(target.start, target.len).unwrap();
        assert_eq!(store.load(&flash).unwrap(), current);
    }

    #[test]
    fn rejects_transfer_into_confirmed_slot() {
        let mut metadata = BootMetadata::initial(Slot::A, 1);
        metadata.transfer = Some(transfer(Slot::A));
        assert!(metadata.validate().is_err());
    }

    #[test]
    fn rejects_incoherent_candidate_state() {
        let mut same_slot = BootMetadata::initial(Slot::A, 4);
        same_slot.candidate_slot = Some(Slot::A);
        same_slot.candidate_rollback_counter = 5;
        assert_eq!(
            same_slot.validate(),
            Err(MetadataError::Invariant(
                "candidate slot equals confirmed slot"
            ))
        );

        let mut orphaned_attempt = BootMetadata::initial(Slot::A, 4);
        orphaned_attempt.candidate_attempts = 1;
        assert!(orphaned_attempt.validate().is_err());

        let mut stale_counter = BootMetadata::initial(Slot::A, 9);
        stale_counter.candidate_slot = Some(Slot::B);
        stale_counter.candidate_rollback_counter = 8;
        assert!(stale_counter.validate().is_err());
    }

    #[test]
    fn rejects_overlapping_transfer_and_candidate_state() {
        let mut metadata = BootMetadata::initial(Slot::A, 7);
        metadata.candidate_slot = Some(Slot::B);
        metadata.candidate_rollback_counter = 8;
        metadata.transfer = Some(transfer(Slot::B));
        assert!(metadata.validate().is_err());
    }

    #[test]
    fn rejects_invalid_transfer_extents() {
        let mut empty = BootMetadata::initial(Slot::A, 7);
        let mut empty_transfer = transfer(Slot::B);
        empty_transfer.image_size = 0;
        empty.transfer = Some(empty_transfer);
        assert!(empty.validate().is_err());

        let mut beyond_end = BootMetadata::initial(Slot::A, 7);
        let mut overrun = transfer(Slot::B);
        overrun.accepted_offset = overrun.image_size + 1;
        beyond_end.transfer = Some(overrun);
        assert!(beyond_end.validate().is_err());
    }

    #[test]
    fn equal_generations_prefer_primary_copy() {
        let mut flash = RamFlash::new(8192);
        let store = MetadataStore::new(layout());
        let primary = BootMetadata::initial(Slot::A, 3);
        let secondary = BootMetadata::initial(Slot::B, 4);
        store.write_copy(&mut flash, Slot::A, &primary).unwrap();
        store.write_copy(&mut flash, Slot::B, &secondary).unwrap();

        let loaded = store.load(&flash).unwrap();
        assert_eq!(loaded.source_copy, Slot::A);
        assert_eq!(loaded.metadata, primary);
    }

    #[test]
    fn reports_when_both_copies_are_destroyed() {
        let mut flash = RamFlash::new(8192);
        let store = MetadataStore::new(layout());
        store
            .initialize(&mut flash, &BootMetadata::initial(Slot::A, 2))
            .unwrap();
        for copy in [Slot::A, Slot::B] {
            let region = layout().metadata(copy);
            flash.erase(region.start, region.len).unwrap();
        }
        assert_eq!(store.load(&flash), Err(MetadataError::NoValidCopy));
    }

    #[test]
    fn refuses_generation_counter_wrap() {
        let mut flash = RamFlash::new(8192);
        let store = MetadataStore::new(layout());
        let mut terminal = BootMetadata::initial(Slot::A, 12);
        terminal.generation = u64::MAX;
        let loaded = store.initialize(&mut flash, &terminal).unwrap();

        assert_eq!(
            store.commit(&mut flash, &loaded, terminal),
            Err(MetadataError::GenerationOverflow)
        );
    }

    #[test]
    fn rejects_metadata_that_fails_flash_readback() {
        let mut flash = RamFlash::new(8192);
        let store = MetadataStore::new(layout());
        let current = store
            .initialize(&mut flash, &BootMetadata::initial(Slot::A, 6))
            .unwrap();
        flash.corrupt_writes = true;

        let err = store
            .commit(&mut flash, &current, current.metadata.clone())
            .unwrap_err();
        assert_eq!(err, MetadataError::VerificationFailed);

        flash.corrupt_writes = false;
        assert_eq!(store.load(&flash).unwrap(), current);
    }
}
