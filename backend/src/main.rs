//! Orderbook Visualizer Backend Server

mod kraken_client;
mod orderbook_manager;
mod storage;
mod trading;

use crate::kraken_client::{start_kraken_ws, OrderbookCallback};
use crate::orderbook_manager::OrderbookManager;
use crate::storage::OrderbookSnapshot;
use crate::trading::{TradingService, TradingConfig, OrderIntent};

/// Callback that feeds orderbook updates to the manager
struct ManagerCallback {
    manager: std::sync::Arc<OrderbookManager>,
}

impl OrderbookCallback for ManagerCallback {
    fn on_orderbook(&self, snapshot: OrderbookSnapshot) {
        tracing::info!("Received orderbook update for {} with {} bids, {} asks", 
            snapshot.symbol, snapshot.bids.len(), snapshot.asks.len());
        self.manager.update_orderbook_snapshot(snapshot);
    }
    
    fn on_connected(&self) {
        tracing::info!("Kraken WebSocket connected");
    }
    
    fn on_disconnected(&self) {
        tracing::warn!("Kraken WebSocket disconnected");
    }
    
    fn on_error(&self, error: String) {
        tracing::error!("Kraken WebSocket error: {}", error);
    }
}
use chrono::{DateTime, Utc};
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use warp::Filter;

/// API query parameters for history endpoint
#[derive(Debug, Deserialize)]
struct HistoryQuery {
    from: Option<String>,
    to: Option<String>,
}

/// WebSocket message types
#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "type")]
enum WsMessage {
    #[serde(rename = "snapshot")]
    Snapshot { data: OrderbookSnapshot },
    #[serde(rename = "error")]
    Error { message: String },
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Initialize logging
    tracing_subscriber::fmt()
        .with_max_level(tracing::Level::INFO)
        .init();

    tracing::info!("🚀 Starting Orderbook Visualizer Backend");

    // Create orderbook manager
    let manager = Arc::new(OrderbookManager::new("./data/orderbooks")?);

    // Create trading service
    let trading_config = TradingConfig {
        live_enabled: std::env::var("ENABLE_LIVE_TRADING")
            .map(|v| v == "true" || v == "1")
            .unwrap_or(false),
        ..Default::default()
    };
    let trading_service = Arc::new(tokio::sync::RwLock::new(TradingService::new(trading_config)));
    
    // Try to initialize live trading if credentials are available
    {
        let mut service = trading_service.write().await;
        if let Err(e) = service.init_live().await {
            tracing::info!("Running in paper trading mode: {}", e);
        }
    }

    // Default symbols to track (Kraken WebSocket v1 format)
    let symbols = vec![
        "XBT/USD".to_string(),
        "ETH/USD".to_string(),
        "SOL/USD".to_string(),
    ];

    // Start direct Kraken WebSocket client in background
    let manager_clone = manager.clone();
    let symbols_clone = symbols.clone();
    tokio::spawn(async move {
        // Create callback that feeds the manager
        let callback = std::sync::Arc::new(ManagerCallback { manager: manager_clone });
        
        loop {
            if let Err(e) = start_kraken_ws(callback.clone(), symbols_clone.clone()).await {
                tracing::error!("Kraken client error: {}, reconnecting in 5s...", e);
            }
            tokio::time::sleep(std::time::Duration::from_secs(5)).await;
        }
    });

    // Set up web server routes
    let cors = warp::cors()
        .allow_any_origin()
        .allow_headers(vec!["content-type"])
        .allow_methods(vec!["GET", "POST", "OPTIONS"]);

    // GET /api/orderbook/:base/:quote - Get current orderbook (e.g., /api/orderbook/XBT/USD)
    let manager_current = manager.clone();
    let current_route = warp::path!("api" / "orderbook" / String / String)
        .and(warp::get())
        .map(move |base: String, quote: String| {
            let symbol = format!("{}/{}", base, quote);
            let manager = manager_current.clone();
            tracing::debug!("Looking up orderbook for symbol: {}", symbol);
            if let Some(snapshot) = manager.get_current(&symbol) {
                warp::reply::json(&snapshot)
            } else {
                warp::reply::json(&serde_json::json!({
                    "error": "Symbol not found",
                    "requested": symbol
                }))
            }
        });

    // GET /api/orderbook/:base/:quote/history?from=<ts>&to=<ts> - Get history
    let manager_history = manager.clone();
    let history_route = warp::path!("api" / "orderbook" / String / String / "history")
        .and(warp::get())
        .and(warp::query::<HistoryQuery>())
        .map(move |base: String, quote: String, query: HistoryQuery| {
            let symbol = format!("{}/{}", base, quote);
            let manager = manager_history.clone();

            let from = query
                .from
                .and_then(|s| DateTime::parse_from_rfc3339(&s).ok())
                .map(|dt| dt.with_timezone(&Utc))
                .unwrap_or_else(|| Utc::now() - chrono::Duration::hours(24));

            let to = query
                .to
                .and_then(|s| DateTime::parse_from_rfc3339(&s).ok())
                .map(|dt| dt.with_timezone(&Utc))
                .unwrap_or_else(Utc::now);

            match manager.get_history(&symbol, from, to) {
                Ok(snapshots) => warp::reply::json(&snapshots),
                Err(e) => warp::reply::json(&serde_json::json!({
                    "error": format!("Failed to get history: {}", e)
                })),
            }
        });

    // GET /api/orderbook/:base/:quote/snapshot/:timestamp - Get snapshot at time
    let manager_snapshot = manager.clone();
    let snapshot_route = warp::path!("api" / "orderbook" / String / String / "snapshot" / String)
        .and(warp::get())
        .map(move |base: String, quote: String, timestamp: String| {
            let symbol = format!("{}/{}", base, quote);
            let manager = manager_snapshot.clone();

            if let Ok(dt) = DateTime::parse_from_rfc3339(&timestamp) {
                let dt_utc = dt.with_timezone(&Utc);
                match manager.get_at_time(&symbol, dt_utc) {
                    Ok(Some(snapshot)) => warp::reply::json(&snapshot),
                    Ok(None) => warp::reply::json(&serde_json::json!({
                        "error": "No snapshot found at that time"
                    })),
                    Err(e) => warp::reply::json(&serde_json::json!({
                        "error": format!("Failed to get snapshot: {}", e)
                    })),
                }
            } else {
                warp::reply::json(&serde_json::json!({
                    "error": "Invalid timestamp format"
                }))
            }
        });

    // GET /api/orderbook/:base/:quote/stats - Get storage stats
    let manager_stats = manager.clone();
    let stats_route = warp::path!("api" / "orderbook" / String / String / "stats")
        .and(warp::get())
        .map(move |base: String, quote: String| {
            let symbol = format!("{}/{}", base, quote);
            let manager = manager_stats.clone();
            match manager.get_stats(&symbol) {
                Ok(stats) => warp::reply::json(&stats),
                Err(e) => warp::reply::json(&serde_json::json!({
                    "error": format!("Failed to get stats: {}", e)
                })),
            }
        });

    // WebSocket route - ws://localhost:3033/ws/orderbook/:base/:quote
    let manager_ws = manager.clone();
    let ws_route = warp::path!("ws" / "orderbook" / String / String)
        .and(warp::ws())
        .map(move |base: String, quote: String, ws: warp::ws::Ws| {
            let symbol = format!("{}/{}", base, quote);
            let manager = manager_ws.clone();
            ws.on_upgrade(move |socket| websocket_handler(socket, symbol, manager))
        });

    // Health check
    let health_route = warp::path!("api" / "health")
        .and(warp::get())
        .map(|| {
            warp::reply::json(&serde_json::json!({
                "status": "healthy",
                "service": "orderbook-visualizer",
                "timestamp": Utc::now().to_rfc3339()
            }))
        });

    // ========== Trading Routes ==========

    // GET /api/trading/status - Get trading mode and status
    let trading_status = trading_service.clone();
    let trading_status_route = warp::path!("api" / "trading" / "status")
        .and(warp::get())
        .and_then(move || {
            let service = trading_status.clone();
            async move {
                let service = service.read().await;
                Ok::<_, warp::Rejection>(warp::reply::json(&serde_json::json!({
                    "mode": service.mode(),
                    "live_available": service.is_live_available(),
                })))
            }
        });

    // GET /api/trading/account - Get account info
    let trading_account = trading_service.clone();
    let trading_account_route = warp::path!("api" / "trading" / "account")
        .and(warp::get())
        .and_then(move || {
            let service = trading_account.clone();
            async move {
                let service = service.read().await;
                let info = service.get_account_info().await;
                Ok::<_, warp::Rejection>(warp::reply::json(&info))
            }
        });

    // POST /api/trading/order - Place an order
    let trading_order = trading_service.clone();
    let trading_order_route = warp::path!("api" / "trading" / "order")
        .and(warp::post())
        .and(warp::body::json())
        .and_then(move |intent: OrderIntent| {
            let service = trading_order.clone();
            async move {
                let service = service.read().await;
                let result = service.execute_order(intent).await;
                Ok::<_, warp::Rejection>(warp::reply::json(&result))
            }
        });

    // DELETE /api/trading/order/:txid - Cancel an order
    let trading_cancel = trading_service.clone();
    let trading_cancel_route = warp::path!("api" / "trading" / "order" / String)
        .and(warp::delete())
        .and_then(move |txid: String| {
            let service = trading_cancel.clone();
            async move {
                let service = service.read().await;
                let result = service.cancel_order(&txid).await;
                Ok::<_, warp::Rejection>(warp::reply::json(&result))
            }
        });

    // DELETE /api/trading/orders - Cancel all orders
    let trading_cancel_all = trading_service.clone();
    let trading_cancel_all_route = warp::path!("api" / "trading" / "orders")
        .and(warp::delete())
        .and_then(move || {
            let service = trading_cancel_all.clone();
            async move {
                let service = service.read().await;
                let result = service.cancel_all().await;
                Ok::<_, warp::Rejection>(warp::reply::json(&result))
            }
        });

    // GET /api/trading/paper-orders - Get paper order history
    let trading_paper = trading_service.clone();
    let trading_paper_route = warp::path!("api" / "trading" / "paper-orders")
        .and(warp::get())
        .and_then(move || {
            let service = trading_paper.clone();
            async move {
                let service = service.read().await;
                let orders = service.get_paper_orders().await;
                Ok::<_, warp::Rejection>(warp::reply::json(&orders))
            }
        });

    // Combine routes
    let routes = current_route
        .or(history_route)
        .or(snapshot_route)
        .or(stats_route)
        .or(ws_route)
        .or(health_route)
        .or(trading_status_route)
        .or(trading_account_route)
        .or(trading_order_route)
        .or(trading_cancel_route)
        .or(trading_cancel_all_route)
        .or(trading_paper_route)
        .with(cors);

    // Get port from environment variable (for Cloud Run) or default to 3033
    let port: u16 = std::env::var("PORT")
        .unwrap_or_else(|_| "3033".to_string())
        .parse()
        .unwrap_or(3033);

    tracing::info!("🌐 Server starting on http://0.0.0.0:{}", port);
    tracing::info!("📊 API endpoint: http://0.0.0.0:{}/api/orderbook/:symbol", port);
    tracing::info!("🔌 WebSocket: ws://0.0.0.0:{}/ws/orderbook/:symbol", port);

    warp::serve(routes).run(([0, 0, 0, 0], port)).await;

    Ok(())
}

/// WebSocket handler for real-time orderbook updates
async fn websocket_handler(
    ws: warp::ws::WebSocket,
    symbol: String,
    manager: Arc<OrderbookManager>,
) {
    let (mut ws_tx, mut ws_rx) = ws.split();
    let mut update_rx = manager.subscribe_updates();

    tracing::info!("WebSocket client connected for symbol: {}", symbol);

    // Send current snapshot on connection
    if let Some(snapshot) = manager.get_current(&symbol) {
        let msg = WsMessage::Snapshot { data: snapshot };
        if let Ok(json) = serde_json::to_string(&msg) {
            let _ = ws_tx.send(warp::ws::Message::text(json)).await;
        }
    }

    // Handle updates and client messages
    tokio::select! {
        _ = async {
            while let Ok(snapshot) = update_rx.recv().await {
                // Only send updates for the requested symbol
                if snapshot.symbol == symbol {
                    let msg = WsMessage::Snapshot { data: snapshot };
                    if let Ok(json) = serde_json::to_string(&msg) {
                        if ws_tx.send(warp::ws::Message::text(json)).await.is_err() {
                            break;
                        }
                    }
                }
            }
        } => {},
        _ = async {
            while let Some(result) = ws_rx.next().await {
                match result {
                    Ok(msg) => {
                        if msg.is_close() {
                            break;
                        }
                    }
                    Err(e) => {
                        tracing::error!("WebSocket error: {}", e);
                        break;
                    }
                }
            }
        } => {},
    }

    tracing::info!("WebSocket client disconnected for symbol: {}", symbol);
}
