//! Direct Kraken WebSocket client implementation

use crate::storage::{OrderbookSnapshot, PriceLevel};
use chrono::Utc;
use futures_util::{SinkExt, StreamExt};
use rust_decimal::Decimal;
use serde::Serialize;
use std::collections::HashMap;
use std::str::FromStr;
use std::sync::Arc;
use tokio_tungstenite::{connect_async, tungstenite::Message};

/// Kraken subscription request
#[derive(Debug, Serialize)]
struct SubscribeRequest {
    event: String,
    pair: Vec<String>,
    subscription: SubscriptionDetails,
}

#[derive(Debug, Serialize)]
struct SubscriptionDetails {
    name: String,
    depth: i32,
}

/// Callback for orderbook updates
pub trait OrderbookCallback: Send + Sync {
    fn on_orderbook(&self, snapshot: OrderbookSnapshot);
    fn on_connected(&self);
    fn on_disconnected(&self);
    fn on_error(&self, error: String);
}

/// Start direct Kraken WebSocket connection
pub async fn start_kraken_ws(
    callback: Arc<dyn OrderbookCallback>,
    symbols: Vec<String>,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let url = "wss://ws.kraken.com";
    
    tracing::info!("Connecting to Kraken WebSocket at {}", url);
    
    let (ws_stream, _) = connect_async(url).await?;
    let (mut write, mut read) = ws_stream.split();
    
    callback.on_connected();
    tracing::info!("Connected to Kraken WebSocket");

    // Subscribe to orderbook for each symbol
    let subscribe_msg = SubscribeRequest {
        event: "subscribe".to_string(),
        pair: symbols.clone(),
        subscription: SubscriptionDetails {
            name: "book".to_string(),
            depth: 25,
        },
    };

    let msg_json = serde_json::to_string(&subscribe_msg)?;
    tracing::info!("Sending subscription: {}", msg_json);
    write.send(Message::Text(msg_json)).await?;

    // Track orderbook state per symbol
    let mut orderbooks: HashMap<String, (Vec<PriceLevel>, Vec<PriceLevel>)> = HashMap::new();

    // Process messages
    while let Some(msg) = read.next().await {
        match msg {
            Ok(Message::Text(text)) => {
                if let Some(snapshot) = parse_kraken_message(&text, &mut orderbooks) {
                    callback.on_orderbook(snapshot);
                }
            }
            Ok(Message::Ping(data)) => {
                let _ = write.send(Message::Pong(data)).await;
            }
            Ok(Message::Close(_)) => {
                tracing::warn!("WebSocket closed by server");
                callback.on_disconnected();
                break;
            }
            Err(e) => {
                tracing::error!("WebSocket error: {}", e);
                callback.on_error(e.to_string());
                break;
            }
            _ => {}
        }
    }

    Ok(())
}

/// Parse Kraken WebSocket message
fn parse_kraken_message(
    text: &str,
    orderbooks: &mut HashMap<String, (Vec<PriceLevel>, Vec<PriceLevel>)>,
) -> Option<OrderbookSnapshot> {
    // Try to parse as JSON array (orderbook data format)
    let value: serde_json::Value = serde_json::from_str(text).ok()?;
    
    // Kraken orderbook messages are arrays: [channelID, data, channelName, pair]
    if let Some(arr) = value.as_array() {
        // Check if it's an orderbook message (has 4 elements, last is pair string)
        if arr.len() >= 4 {
            let pair = arr.last()?.as_str()?;
            let channel_name = arr.get(arr.len() - 2)?.as_str()?;
            
            tracing::debug!("Received message for pair: {}, channel: {}", pair, channel_name);
            
            if !channel_name.starts_with("book") {
                return None;
            }

            // Get or create orderbook state
            let (bids, asks) = orderbooks.entry(pair.to_string()).or_insert_with(|| (Vec::new(), Vec::new()));

            // Parse orderbook data (can be snapshot or update)
            let data = &arr[1];
            
            // Check for snapshot (has "as" and "bs" keys)
            if let Some(obj) = data.as_object() {
                if let Some(ask_snap) = obj.get("as") {
                    *asks = parse_levels(ask_snap);
                    tracing::info!("Parsed {} ask levels for {}", asks.len(), pair);
                }
                if let Some(bid_snap) = obj.get("bs") {
                    *bids = parse_levels(bid_snap);
                    tracing::info!("Parsed {} bid levels for {}", bids.len(), pair);
                }
                // Handle updates (has "a" or "b" keys)
                if let Some(ask_updates) = obj.get("a") {
                    apply_updates(asks, ask_updates, false);
                }
                if let Some(bid_updates) = obj.get("b") {
                    apply_updates(bids, bid_updates, true);
                }
            }

            tracing::debug!("Returning snapshot with {} bids, {} asks", bids.len(), asks.len());
            
            // Return snapshot
            return Some(OrderbookSnapshot {
                symbol: pair.to_string(),
                timestamp: Utc::now(),
                bids: bids.clone(),
                asks: asks.clone(),
                checksum: None,
                sequence: None,
            });
        }
    }

    // Log non-orderbook messages for debugging
    if text.contains("systemStatus") || text.contains("subscriptionStatus") {
        tracing::info!("Kraken system message: {}", text);
    } else if text.starts_with("[") {
        // This is likely orderbook data, log first 200 chars for debugging
        tracing::debug!("Kraken data message: {}...", &text[..text.len().min(200)]);
    }

    None
}

/// Parse price levels from Kraken format [[price, volume, timestamp], ...]
fn parse_levels(value: &serde_json::Value) -> Vec<PriceLevel> {
    let mut levels = Vec::new();
    
    if let Some(arr) = value.as_array() {
        for item in arr {
            if let Some(level_arr) = item.as_array() {
                if level_arr.len() >= 2 {
                    let price = level_arr[0].as_str()
                        .and_then(|s| Decimal::from_str(s).ok());
                    let volume = level_arr[1].as_str()
                        .and_then(|s| Decimal::from_str(s).ok());
                    
                    if let (Some(price), Some(volume)) = (price, volume) {
                        levels.push(PriceLevel {
                            price,
                            volume,
                            order_count: None,
                        });
                    }
                }
            }
        }
    }
    
    levels
}

/// Apply incremental updates to orderbook
fn apply_updates(levels: &mut Vec<PriceLevel>, updates: &serde_json::Value, is_bid: bool) {
    if let Some(arr) = updates.as_array() {
        for item in arr {
            if let Some(update_arr) = item.as_array() {
                if update_arr.len() >= 2 {
                    let price_str = update_arr[0].as_str().unwrap_or("");
                    let volume_str = update_arr[1].as_str().unwrap_or("");
                    
                    let price = Decimal::from_str(price_str).unwrap_or_default();
                    let volume = Decimal::from_str(volume_str).unwrap_or_default();
                    
                    // Remove existing level at this price
                    levels.retain(|l| l.price != price);
                    
                    // Add new level if volume > 0
                    if volume > Decimal::ZERO {
                        levels.push(PriceLevel {
                            price,
                            volume,
                            order_count: None,
                        });
                    }
                    
                    // Sort levels
                    levels.sort_by(|a, b| {
                        if is_bid {
                            b.price.cmp(&a.price)
                        } else {
                            a.price.cmp(&b.price)
                        }
                    });
                    
                    // Keep only top 25 levels
                    levels.truncate(25);
                }
            }
        }
    }
}
