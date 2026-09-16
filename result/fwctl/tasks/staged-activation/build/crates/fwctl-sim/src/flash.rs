use fwctl_device::{Flash, FlashError};

#[derive(Debug, Clone)]
pub struct VirtualFlash {
    bytes: Vec<u8>,
    erase_size: u32,
    write_size: u32,
    fail_write_at: Option<u32>,
    erase_log: Vec<(u32, u32)>,
}

impl VirtualFlash {
    #[must_use]
    pub fn new(capacity: u32, erase_size: u32, write_size: u32) -> Self {
        Self {
            bytes: vec![0xff; usize::try_from(capacity).unwrap_or(0)],
            erase_size,
            write_size,
            fail_write_at: None,
            erase_log: Vec::new(),
        }
    }

    #[must_use]
    pub fn bytes(&self) -> &[u8] {
        &self.bytes
    }

    #[must_use]
    pub fn erase_log(&self) -> &[(u32, u32)] {
        &self.erase_log
    }

    pub fn fail_next_write_at(&mut self, offset: u32) {
        self.fail_write_at = Some(offset);
    }

    pub fn corrupt(&mut self, offset: u32, mask: u8) -> Result<(), FlashError> {
        let index = usize::try_from(offset).map_err(|_| FlashError::OutOfRange)?;
        let byte = self.bytes.get_mut(index).ok_or(FlashError::OutOfRange)?;
        *byte ^= mask;
        Ok(())
    }

    fn range(&self, offset: u32, len: usize) -> Result<std::ops::Range<usize>, FlashError> {
        let start = usize::try_from(offset).map_err(|_| FlashError::OutOfRange)?;
        let end = start.checked_add(len).ok_or(FlashError::OutOfRange)?;
        if end > self.bytes.len() {
            return Err(FlashError::OutOfRange);
        }
        Ok(start..end)
    }
}

impl Flash for VirtualFlash {
    fn capacity(&self) -> u32 {
        u32::try_from(self.bytes.len()).unwrap_or(u32::MAX)
    }

    fn erase_size(&self) -> u32 {
        self.erase_size
    }

    fn write_size(&self) -> u32 {
        self.write_size
    }

    fn erase(&mut self, start: u32, len: u32) -> Result<(), FlashError> {
        if self.erase_size == 0
            || !start.is_multiple_of(self.erase_size)
            || !len.is_multiple_of(self.erase_size)
        {
            return Err(FlashError::UnalignedErase);
        }
        let len = usize::try_from(len).map_err(|_| FlashError::OutOfRange)?;
        let range = self.range(start, len)?;
        self.bytes[range].fill(0xff);
        self.erase_log.push((start, u32::try_from(len).unwrap()));
        Ok(())
    }

    fn write(&mut self, offset: u32, data: &[u8]) -> Result<(), FlashError> {
        let range = self.range(offset, data.len())?;
        if let Some(fail_offset) = self.fail_write_at
            && range.contains(&usize::try_from(fail_offset).map_err(|_| FlashError::OutOfRange)?)
        {
            self.fail_write_at = None;
            return Err(FlashError::Driver(1));
        }
        let target = &mut self.bytes[range];
        if target
            .iter()
            .zip(data)
            .any(|(current, next)| current & next != *next)
        {
            return Err(FlashError::RequiresErase);
        }
        for (current, next) in target.iter_mut().zip(data) {
            *current &= *next;
        }
        Ok(())
    }

    fn read(&self, offset: u32, buf: &mut [u8]) -> Result<(), FlashError> {
        let range = self.range(offset, buf.len())?;
        buf.copy_from_slice(&self.bytes[range]);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn models_erase_before_write_constraint() {
        let mut flash = VirtualFlash::new(4096, 256, 4);
        flash.write(0, &[0x0f]).unwrap();
        assert_eq!(flash.write(0, &[0xf0]), Err(FlashError::RequiresErase));
        flash.erase(0, 256).unwrap();
        flash.write(0, &[0xf0]).unwrap();
    }

    #[test]
    fn injects_single_write_failure() {
        let mut flash = VirtualFlash::new(4096, 256, 4);
        flash.fail_next_write_at(100);
        assert_eq!(flash.write(96, &[0; 8]), Err(FlashError::Driver(1)));
        assert!(flash.write(96, &[0; 8]).is_ok());
    }

    #[test]
    fn rejects_unaligned_and_out_of_range_erase() {
        let mut flash = VirtualFlash::new(4096, 256, 4);
        assert_eq!(flash.erase(1, 256), Err(FlashError::UnalignedErase));
        assert_eq!(flash.erase(4096, 256), Err(FlashError::OutOfRange));
    }
}
