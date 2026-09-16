pub mod esp32;
pub mod pico2;

pub use crate::wire::{
    DeviceFrame as Pico2Frame, DeviceFrameHandler as Pico2FrameHandler,
    DeviceHandlerError as Pico2HandlerError, DeviceLinkError as Pico2LinkError,
    DeviceReply as Pico2Reply, DeviceSerialDriver as Rp2350UsbSerialDriver,
    DeviceSerialLink as Pico2UsbLink,
};
