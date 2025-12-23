//! Time-series storage for orderbook snapshots

use chrono::{DateTime, Utc};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use sled::Db;
use std::sync::Arc;

/// Orderbook snapshot at a point in time
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrderbookSnapshot {
    pub symbol: String,
    pub timestamp: DateTime<Utc>,
    pub bids: Vec<PriceLevel>,
    pub asks: Vec<PriceLevel>,
    pub checksum: Option<u32>,
    pub sequence: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PriceLevel {
    pub price: Decimal,
    pub volume: Decimal,
    /// Number of orders at this price level (if available)
    pub order_count: Option<u32>,
}

/// Time-series storage for orderbook data
pub struct OrderbookStorage {
    db: Arc<Db>,
}

impl OrderbookStorage {
    /// Create a new storage instance
    pub fn new(path: &str) -> Result<Self, sled::Error> {
        let db = sled::open(path)?;
        Ok(Self { db: Arc::new(db) })
    }

    /// Store an orderbook snapshot
    pub fn store_snapshot(&self, snapshot: &OrderbookSnapshot) -> Result<(), Box<dyn std::error::Error>> {
        // Key format: "symbol:timestamp_nanos"
        let key = format!(
            "{}:{}",
            snapshot.symbol,
            snapshot.timestamp.timestamp_nanos_opt().unwrap_or(0)
        );

        let value = serde_json::to_vec(snapshot)?;
        self.db.insert(key.as_bytes(), value)?;

        Ok(())
    }

    /// Get the latest snapshot for a symbol
    pub fn get_latest(&self, symbol: &str) -> Result<Option<OrderbookSnapshot>, Box<dyn std::error::Error>> {
        let prefix = format!("{}:", symbol);

        // Scan backwards to find the latest entry
        let mut latest: Option<OrderbookSnapshot> = None;

        for result in self.db.scan_prefix(prefix.as_bytes()) {
            let (_key, value) = result?;
            let snapshot: OrderbookSnapshot = serde_json::from_slice(&value)?;

            if let Some(ref current) = latest {
                if snapshot.timestamp > current.timestamp {
                    latest = Some(snapshot);
                }
            } else {
                latest = Some(snapshot);
            }
        }

        Ok(latest)
    }

    /// Get snapshots within a time range
    pub fn get_range(
        &self,
        symbol: &str,
        from: DateTime<Utc>,
        to: DateTime<Utc>,
    ) -> Result<Vec<OrderbookSnapshot>, Box<dyn std::error::Error>> {
        let prefix = format!("{}:", symbol);
        let from_nanos = from.timestamp_nanos_opt().unwrap_or(0);
        let to_nanos = to.timestamp_nanos_opt().unwrap_or(i64::MAX);

        let mut snapshots = Vec::new();

        for result in self.db.scan_prefix(prefix.as_bytes()) {
            let (key, value) = result?;
            let key_str = String::from_utf8_lossy(&key);

            if let Some(timestamp_str) = key_str.split(':').nth(1) {
                if let Ok(timestamp_nanos) = timestamp_str.parse::<i64>() {
                    if timestamp_nanos >= from_nanos && timestamp_nanos <= to_nanos {
                        let snapshot: OrderbookSnapshot = serde_json::from_slice(&value)?;
                        snapshots.push(snapshot);
                    }
                }
            }
        }

        // Sort by timestamp
        snapshots.sort_by_key(|s| s.timestamp);

        Ok(snapshots)
    }

    /// Get a specific snapshot by timestamp
    pub fn get_at_time(
        &self,
        symbol: &str,
        timestamp: DateTime<Utc>,
    ) -> Result<Option<OrderbookSnapshot>, Box<dyn std::error::Error>> {
        let key = format!(
            "{}:{}",
            symbol,
            timestamp.timestamp_nanos_opt().unwrap_or(0)
        );

        if let Some(value) = self.db.get(key.as_bytes())? {
            let snapshot: OrderbookSnapshot = serde_json::from_slice(&value)?;
            Ok(Some(snapshot))
        } else {
            Ok(None)
        }
    }

    /// Get statistics for a symbol
    pub fn get_stats(&self, symbol: &str) -> Result<StorageStats, Box<dyn std::error::Error>> {
        let prefix = format!("{}:", symbol);
        let mut count = 0;
        let mut oldest: Option<DateTime<Utc>> = None;
        let mut newest: Option<DateTime<Utc>> = None;

        for result in self.db.scan_prefix(prefix.as_bytes()) {
            let (_key, value) = result?;
            let snapshot: OrderbookSnapshot = serde_json::from_slice(&value)?;

            count += 1;

            if let Some(old) = oldest {
                if snapshot.timestamp < old {
                    oldest = Some(snapshot.timestamp);
                }
            } else {
                oldest = Some(snapshot.timestamp);
            }

            if let Some(new) = newest {
                if snapshot.timestamp > new {
                    newest = Some(snapshot.timestamp);
                }
            } else {
                newest = Some(snapshot.timestamp);
            }
        }

        Ok(StorageStats {
            symbol: symbol.to_string(),
            snapshot_count: count,
            oldest_snapshot: oldest,
            newest_snapshot: newest,
        })
    }

    /// Clear all data for a symbol
    pub fn clear_symbol(&self, symbol: &str) -> Result<(), Box<dyn std::error::Error>> {
        let prefix = format!("{}:", symbol);

        let keys: Vec<_> = self.db
            .scan_prefix(prefix.as_bytes())
            .filter_map(|r| r.ok())
            .map(|(key, _)| key)
            .collect();

        for key in keys {
            self.db.remove(key)?;
        }

        Ok(())
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct StorageStats {
    pub symbol: String,
    pub snapshot_count: usize,
    pub oldest_snapshot: Option<DateTime<Utc>>,
    pub newest_snapshot: Option<DateTime<Utc>>,
}
