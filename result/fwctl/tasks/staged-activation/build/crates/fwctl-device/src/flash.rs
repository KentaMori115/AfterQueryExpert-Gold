use thiserror::Error;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Error)]
pub enum FlashError {
    #[error("flash address is out of range")]
    OutOfRange,
    #[error("flash address or length is not erase-aligned")]
    UnalignedErase,
    #[error("flash write attempted to change a zero bit back to one")]
    RequiresErase,
    #[error("flash driver failed with code {0}")]
    Driver(u32),
}

pub trait Flash {
    fn capacity(&self) -> u32;
    fn erase_size(&self) -> u32;
    fn write_size(&self) -> u32;
    fn erase(&mut self, start: u32, len: u32) -> Result<(), FlashError>;
    fn write(&mut self, offset: u32, data: &[u8]) -> Result<(), FlashError>;
    fn read(&self, offset: u32, buf: &mut [u8]) -> Result<(), FlashError>;
}
