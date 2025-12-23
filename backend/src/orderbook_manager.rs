//! Orderbook state management and time-travel functionality

use crate::storage::{OrderbookSnapshot, OrderbookStorage};
use chrono::{DateTime, Utc};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tokio::sync::broadcast;

/// Orderbook manager with real-time updates and time-travel
pub struct OrderbookManager {
    storage: Arc<OrderbookStorage>,
    current_books: Arc<Mutex<HashMap<String, OrderbookSnapshot>>>,
    update_tx: broadcast::Sender<OrderbookSnapshot>,
}

impl OrderbookManager {
    /// Create a new orderbook manager
    pub fn new(storage_path: &str) -> Result<Self, Box<dyn std::error::Error>> {
        let storage = Arc::new(OrderbookStorage::new(storage_path)?);
        let current_books = Arc::new(Mutex::new(HashMap::new()));
        let (update_tx, _) = broadcast::channel(1000);

        Ok(Self {
            storage,
            current_books,
            update_tx,
        })
    }

    /// Get the current orderbook for a symbol
    pub fn get_current(&self, symbol: &str) -> Option<OrderbookSnapshot> {
        self.current_books.lock().unwrap().get(symbol).cloned()
    }

    /// Get orderbook history
    pub fn get_history(
        &self,
        symbol: &str,
        from: DateTime<Utc>,
        to: DateTime<Utc>,
    ) -> Result<Vec<OrderbookSnapshot>, Box<dyn std::error::Error>> {
        self.storage.get_range(symbol, from, to)
    }

    /// Get snapshot at specific time
    pub fn get_at_time(
        &self,
        symbol: &str,
        timestamp: DateTime<Utc>,
    ) -> Result<Option<OrderbookSnapshot>, Box<dyn std::error::Error>> {
        // Try to find exact match first
        if let Some(snapshot) = self.storage.get_at_time(symbol, timestamp)? {
            return Ok(Some(snapshot));
        }

        // Otherwise, find the closest snapshot before the requested time
        let from = timestamp - chrono::Duration::hours(1);
        let snapshots = self.storage.get_range(symbol, from, timestamp)?;

        Ok(snapshots.last().cloned())
    }

    /// Subscribe to real-time updates
    pub fn subscribe_updates(&self) -> broadcast::Receiver<OrderbookSnapshot> {
        self.update_tx.subscribe()
    }

    /// Update orderbook state from snapshot
    pub fn update_orderbook_snapshot(&self, snapshot: OrderbookSnapshot) {
        let symbol = snapshot.symbol.clone();
        
        // Update current state
        {
            let mut current = self.current_books.lock().unwrap();
            current.insert(symbol.clone(), snapshot.clone());
            tracing::debug!("Stored snapshot for {}, total symbols: {}", symbol, current.len());
        }

        // Store snapshot (throttle to avoid too many writes)
        if let Err(e) = self.storage.store_snapshot(&snapshot) {
            tracing::error!("Failed to store snapshot: {}", e);
        }

        // Broadcast update
        let _ = self.update_tx.send(snapshot);
    }

    /// Get storage for a symbol
    pub fn get_stats(&self, symbol: &str) -> Result<crate::storage::StorageStats, Box<dyn std::error::Error>> {
        self.storage.get_stats(symbol)
    }
}
