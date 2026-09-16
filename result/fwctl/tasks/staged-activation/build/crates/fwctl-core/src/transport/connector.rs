use std::time::Duration;

use crate::transport::Transport;
use crate::{FwctlError, Result};

pub trait Connector {
    type Link: Transport;

    fn connect(&mut self, device_id: &str, timeout: Duration) -> Result<Self::Link>;
}

pub struct OneShotConnector<T> {
    link: Option<T>,
}

impl<T> OneShotConnector<T> {
    #[must_use]
    pub const fn new(link: T) -> Self {
        Self { link: Some(link) }
    }
}

impl<T: Transport> Connector for OneShotConnector<T> {
    type Link = T;

    fn connect(&mut self, device_id: &str, _timeout: Duration) -> Result<Self::Link> {
        self.link
            .take()
            .ok_or_else(|| FwctlError::DeviceNotFound(device_id.into()))
    }
}
