//! Named counters and gauges — part of the `metrics` subsystem.
//!
//! A registry keeps one record per name. Counters only ever move upwards and
//! saturate instead of wrapping; gauges hold a signed level that can move
//! either way. Names are interned on first use and keep their insertion order,
//! so a rendered report reads the same way run to run.

/// What a registered name records.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    /// Monotonic: only [`Registry::incr`] moves it.
    Counter,
    /// Signed level: [`Registry::add`] and [`Registry::set`] move it.
    Gauge,
}

/// A registered name's current reading.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Reading {
    pub name: Vec<u8>,
    pub kind: Kind,
    pub value: i64,
    /// How many times this record has been written since it was registered.
    pub updates: u64,
}

struct Record {
    name: Vec<u8>,
    kind: Kind,
    value: i64,
    updates: u64,
}

/// A flat, insertion-ordered set of named records.
///
/// Lookups are linear. The registry is meant for the tens of names an engine
/// subsystem reports, not for bulk data.
pub struct Registry {
    records: Vec<Record>,
}

impl Default for Registry {
    fn default() -> Registry {
        Registry::new()
    }
}

impl Registry {
    pub fn new() -> Registry {
        Registry {
            records: Vec::new(),
        }
    }

    pub fn len(&self) -> usize {
        self.records.len()
    }

    pub fn is_empty(&self) -> bool {
        self.records.is_empty()
    }

    fn index_of(&self, name: &[u8]) -> Option<usize> {
        self.records.iter().position(|r| r.name == name)
    }

    /// Register `name` as `kind` if it is new, and return its index.
    ///
    /// A name already registered under the other kind keeps the kind it was
    /// registered with; the caller's request is ignored rather than silently
    /// changing what a reader has been watching.
    pub fn register(&mut self, name: &[u8], kind: Kind) -> usize {
        if let Some(i) = self.index_of(name) {
            return i;
        }
        self.records.push(Record {
            name: name.to_vec(),
            kind,
            value: 0,
            updates: 0,
        });
        self.records.len() - 1
    }

    /// The kind `name` is registered under, if it is registered at all.
    pub fn kind_of(&self, name: &[u8]) -> Option<Kind> {
        self.index_of(name).map(|i| self.records[i].kind)
    }

    /// Add `delta` to a counter, saturating at [`i64::MAX`].
    ///
    /// A negative delta is refused: counters do not go backwards. Returns the
    /// value after the operation, or `None` if the name is a gauge.
    pub fn incr(&mut self, name: &[u8], delta: i64) -> Option<i64> {
        let i = self.register(name, Kind::Counter);
        if self.records[i].kind != Kind::Counter || delta < 0 {
            return None;
        }
        let r = &mut self.records[i];
        r.value = r.value.saturating_add(delta);
        r.updates += 1;
        Some(r.value)
    }

    /// Move a gauge by `delta`, saturating at either end of the range.
    pub fn add(&mut self, name: &[u8], delta: i64) -> Option<i64> {
        let i = self.register(name, Kind::Gauge);
        if self.records[i].kind != Kind::Gauge {
            return None;
        }
        let r = &mut self.records[i];
        r.value = r.value.saturating_add(delta);
        r.updates += 1;
        Some(r.value)
    }

    /// Set a gauge outright.
    pub fn set(&mut self, name: &[u8], value: i64) -> Option<i64> {
        let i = self.register(name, Kind::Gauge);
        if self.records[i].kind != Kind::Gauge {
            return None;
        }
        let r = &mut self.records[i];
        r.value = value;
        r.updates += 1;
        Some(value)
    }

    /// Current value of `name`, whatever its kind.
    pub fn value(&self, name: &[u8]) -> Option<i64> {
        self.index_of(name).map(|i| self.records[i].value)
    }

    /// How many writes `name` has taken.
    pub fn updates(&self, name: &[u8]) -> Option<u64> {
        self.index_of(name).map(|i| self.records[i].updates)
    }

    /// Every reading, in the order the names were first registered.
    pub fn readings(&self) -> Vec<Reading> {
        self.records
            .iter()
            .map(|r| Reading {
                name: r.name.clone(),
                kind: r.kind,
                value: r.value,
                updates: r.updates,
            })
            .collect()
    }

    /// Readings whose name starts with `prefix`, in registration order.
    pub fn readings_with_prefix(&self, prefix: &[u8]) -> Vec<Reading> {
        self.readings()
            .into_iter()
            .filter(|r| r.name.starts_with(prefix))
            .collect()
    }

    /// Zero every value, keeping the names, kinds and update counts.
    pub fn reset_values(&mut self) {
        for r in self.records.iter_mut() {
            r.value = 0;
        }
    }

    /// Forget every name.
    pub fn clear(&mut self) {
        self.records.clear();
    }

    /// One line per reading: `kind name value`.
    pub fn render(&self) -> String {
        let mut out = String::new();
        for r in &self.records {
            let kind = match r.kind {
                Kind::Counter => "counter",
                Kind::Gauge => "gauge",
            };
            out.push_str(kind);
            out.push(' ');
            out.push_str(&String::from_utf8_lossy(&r.name));
            out.push(' ');
            out.push_str(&r.value.to_string());
            out.push('\n');
        }
        out
    }
}
