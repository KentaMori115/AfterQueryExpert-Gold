use thiserror::Error;

use crate::Flash;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Slot {
    A,
    B,
}

impl Slot {
    #[must_use]
    pub const fn inactive(self) -> Self {
        match self {
            Self::A => Self::B,
            Self::B => Self::A,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Region {
    pub start: u32,
    pub len: u32,
}

impl Region {
    #[must_use]
    pub const fn end(self) -> Option<u32> {
        self.start.checked_add(self.len)
    }

    #[must_use]
    pub fn contains(self, offset: u32, len: u32) -> bool {
        let Some(region_end) = self.end() else {
            return false;
        };
        let Some(data_end) = offset.checked_add(len) else {
            return false;
        };
        offset >= self.start && data_end <= region_end
    }

    #[must_use]
    pub fn overlaps(self, other: Self) -> bool {
        let (Some(self_end), Some(other_end)) = (self.end(), other.end()) else {
            return true;
        };
        self.start < other_end && other.start < self_end
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SlotLayout {
    pub slot_a: Region,
    pub slot_b: Region,
    pub metadata_a: Region,
    pub metadata_b: Region,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Error)]
pub enum LayoutError {
    #[error("flash region is empty or overflows the address space")]
    InvalidRegion,
    #[error("flash regions overlap")]
    Overlap,
    #[error("flash region exceeds physical capacity")]
    ExceedsFlash,
    #[error("flash region is not erase-aligned")]
    Unaligned,
    #[error("firmware image does not fit in target slot")]
    ImageTooLarge,
    #[error("normal update attempted to target the active slot")]
    ActiveSlotTargeted,
}

impl SlotLayout {
    pub fn validate<F: Flash>(&self, flash: &F) -> Result<(), LayoutError> {
        let regions = [self.slot_a, self.slot_b, self.metadata_a, self.metadata_b];
        for region in regions {
            let Some(end) = region.end() else {
                return Err(LayoutError::InvalidRegion);
            };
            if region.len == 0 {
                return Err(LayoutError::InvalidRegion);
            }
            if end > flash.capacity() {
                return Err(LayoutError::ExceedsFlash);
            }
            if !region.start.is_multiple_of(flash.erase_size())
                || !region.len.is_multiple_of(flash.erase_size())
            {
                return Err(LayoutError::Unaligned);
            }
        }
        for left in 0..regions.len() {
            for right in left + 1..regions.len() {
                if regions[left].overlaps(regions[right]) {
                    return Err(LayoutError::Overlap);
                }
            }
        }
        Ok(())
    }

    #[must_use]
    pub const fn slot(self, slot: Slot) -> Region {
        match slot {
            Slot::A => self.slot_a,
            Slot::B => self.slot_b,
        }
    }

    #[must_use]
    pub const fn metadata(self, copy: Slot) -> Region {
        match copy {
            Slot::A => self.metadata_a,
            Slot::B => self.metadata_b,
        }
    }

    pub fn update_target(self, active: Slot, image_size: u32) -> Result<Region, LayoutError> {
        let target = active.inactive();
        let region = self.slot(target);
        if image_size > region.len {
            return Err(LayoutError::ImageTooLarge);
        }
        Ok(region)
    }

    pub fn assert_inactive(self, active: Slot, target: Slot) -> Result<(), LayoutError> {
        if active == target {
            Err(LayoutError::ActiveSlotTargeted)
        } else {
            Ok(())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{Flash, FlashError};

    struct Geometry {
        capacity: u32,
        erase_size: u32,
    }

    impl Flash for Geometry {
        fn capacity(&self) -> u32 {
            self.capacity
        }

        fn erase_size(&self) -> u32 {
            self.erase_size
        }

        fn write_size(&self) -> u32 {
            4
        }

        fn erase(&mut self, _start: u32, _len: u32) -> Result<(), FlashError> {
            Ok(())
        }

        fn write(&mut self, _offset: u32, _data: &[u8]) -> Result<(), FlashError> {
            Ok(())
        }

        fn read(&self, _offset: u32, _buf: &mut [u8]) -> Result<(), FlashError> {
            Ok(())
        }
    }

    fn layout() -> SlotLayout {
        SlotLayout {
            slot_a: Region {
                start: 0x20_000,
                len: 0x60_000,
            },
            slot_b: Region {
                start: 0x80_000,
                len: 0x60_000,
            },
            metadata_a: Region {
                start: 0xe0_000,
                len: 0x1_000,
            },
            metadata_b: Region {
                start: 0xe1_000,
                len: 0x1_000,
            },
        }
    }

    #[test]
    fn validates_non_overlapping_aligned_layout() {
        let flash = Geometry {
            capacity: 0x10_0000,
            erase_size: 0x1000,
        };
        assert_eq!(layout().validate(&flash), Ok(()));
    }

    #[test]
    fn rejects_overlapping_slots() {
        let flash = Geometry {
            capacity: 0x10_0000,
            erase_size: 0x1000,
        };
        let mut layout = layout();
        layout.slot_b.start = 0x70_000;
        assert_eq!(layout.validate(&flash), Err(LayoutError::Overlap));
    }

    #[test]
    fn always_targets_inactive_slot() {
        let layout = layout();
        assert_eq!(
            layout.update_target(Slot::A, 0x20_000).unwrap(),
            layout.slot_b
        );
        assert_eq!(
            layout.assert_inactive(Slot::A, Slot::A),
            Err(LayoutError::ActiveSlotTargeted)
        );
    }
}
