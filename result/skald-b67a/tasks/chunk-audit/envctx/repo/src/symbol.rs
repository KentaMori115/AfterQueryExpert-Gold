//! Symbol interning table — a faithful port of `symbol.c`.
//!
//! Interns byte-string names into stable integer ids so the rest of the engine
//! can compare identifiers by id rather than by content. Ids are dense and
//! assigned in first-seen order; the reverse mapping recovers the name.

use std::collections::HashMap;

pub type SymbolId = u32;

pub const SYMBOL_INVALID: SymbolId = u32::MAX;

pub struct SymbolTable {
    names: Vec<Vec<u8>>,
    lookup: HashMap<Vec<u8>, SymbolId>,
}

impl Default for SymbolTable {
    fn default() -> Self {
        Self::new()
    }
}

impl SymbolTable {
    pub fn new() -> SymbolTable {
        SymbolTable {
            names: Vec::new(),
            lookup: HashMap::new(),
        }
    }

    /// Intern `name`, returning its id (creating one if unseen).
    pub fn intern(&mut self, name: &[u8]) -> SymbolId {
        if let Some(&id) = self.lookup.get(name) {
            return id;
        }
        let id = self.names.len() as SymbolId;
        self.names.push(name.to_vec());
        self.lookup.insert(name.to_vec(), id);
        id
    }

    /// Look up an existing symbol without creating one.
    pub fn find(&self, name: &[u8]) -> SymbolId {
        self.lookup.get(name).copied().unwrap_or(SYMBOL_INVALID)
    }

    /// Recover the name for an id.
    pub fn name_of(&self, id: SymbolId) -> Option<&[u8]> {
        self.names.get(id as usize).map(|v| v.as_slice())
    }

    pub fn contains(&self, name: &[u8]) -> bool {
        self.lookup.contains_key(name)
    }

    pub fn len(&self) -> usize {
        self.names.len()
    }
    pub fn is_empty(&self) -> bool {
        self.names.is_empty()
    }

    pub fn clear(&mut self) {
        self.names.clear();
        self.lookup.clear();
    }

    /// Iterate over `(id, name)` pairs in id order.
    pub fn iter(&self) -> impl Iterator<Item = (SymbolId, &[u8])> {
        self.names
            .iter()
            .enumerate()
            .map(|(i, n)| (i as SymbolId, n.as_slice()))
    }
}
