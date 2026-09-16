#![cfg_attr(not(feature = "std"), no_std)]
#![forbid(unsafe_code)]

extern crate alloc;

pub mod auth;
pub mod boards;
pub mod flash;
pub mod layout;
pub mod metadata;
pub mod updater;
pub mod wire;

pub use auth::{AuthorizationError, TrustedReleaseKey, UpdateAuthorization};
pub use flash::{Flash, FlashError};
pub use layout::{Region, Slot, SlotLayout};
pub use metadata::{
    BootMetadata, LoadedMetadata, MetadataError, MetadataStore, TransferRecord, UpdateId,
};
pub use updater::{BootDecision, DeviceUpdater, UpdaterError};
pub use wire::{
    DeviceFrame, DeviceFrameHandler, DeviceHandlerError, DeviceLinkError, DeviceReply,
    DeviceSerialDriver, DeviceSerialLink,
};
