//! Trading module for the orderbook visualizer backend
//!
//! Provides secure server-side order execution.
//! API keys are stored server-side, not exposed to the frontend.

use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::RwLock;

/// Trading service configuration
#[derive(Debug, Clone)]
pub struct TradingConfig {
    /// Enable live trading (false = paper trading only)
    pub live_enabled: bool,
    /// Maximum order size (safety limit)
    pub max_order_size: Decimal,
    /// Allowed trading pairs
    pub allowed_pairs: Vec<String>,
}

impl Default for TradingConfig {
    fn default() -> Self {
        Self {
            live_enabled: false,
            max_order_size: Decimal::from(1),
            allowed_pairs: vec![
                "XBT/USD".to_string(),
                "ETH/USD".to_string(),
                "SOL/USD".to_string(),
            ],
        }
    }
}

/// Trading service state
pub struct TradingService {
    config: TradingConfig,
    paper_orders: Arc<RwLock<Vec<PaperOrder>>>,
}

/// Paper trading order record
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PaperOrder {
    pub id: String,
    pub pair: String,
    pub side: String,
    pub order_type: String,
    pub volume: Decimal,
    pub price: Option<Decimal>,
    pub status: String,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

/// Order request from frontend
#[derive(Debug, Deserialize)]
pub struct OrderIntent {
    pub pair: String,
    pub side: String,
    pub order_type: String,
    pub volume: Decimal,
    pub price: Option<Decimal>,
    pub client_id: Option<String>,
}

/// Order response to frontend
#[derive(Debug, Serialize)]
pub struct OrderResult {
    pub success: bool,
    pub mode: String,
    pub order_id: Option<String>,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// Account info response
#[derive(Debug, Serialize)]
pub struct AccountInfo {
    pub mode: String,
    pub balances: Vec<BalanceInfo>,
    pub open_orders: Vec<OrderInfo>,
    pub positions: Vec<PositionInfo>,
}

#[derive(Debug, Serialize)]
pub struct BalanceInfo {
    pub asset: String,
    pub total: Decimal,
    pub available: Decimal,
}

#[derive(Debug, Serialize)]
pub struct OrderInfo {
    pub txid: String,
    pub pair: String,
    pub side: String,
    pub order_type: String,
    pub volume: Decimal,
    pub volume_exec: Decimal,
    pub price: Option<Decimal>,
    pub status: String,
}

#[derive(Debug, Serialize)]
pub struct PositionInfo {
    pub pair: String,
    pub side: String,
    pub volume: Decimal,
    pub entry_price: Decimal,
    pub pnl_percent: Decimal,
}

impl TradingService {
    pub fn new(config: TradingConfig) -> Self {
        Self {
            config,
            paper_orders: Arc::new(RwLock::new(Vec::new())),
        }
    }

    pub async fn init_live(&mut self) -> Result<(), String> {
        // For now, just paper trading mode
        tracing::info!("Trading service initialized in paper mode");
        Ok(())
    }

    pub fn is_live_available(&self) -> bool {
        false // Paper mode only for now
    }

    pub fn mode(&self) -> &str {
        "paper"
    }

    pub async fn execute_order(&self, intent: OrderIntent) -> OrderResult {
        if let Err(e) = self.validate_order(&intent) {
            return OrderResult {
                success: false,
                mode: "paper".to_string(),
                order_id: None,
                message: "Validation failed".to_string(),
                error: Some(e),
            };
        }

        let order_id = format!("paper_{}", uuid::Uuid::new_v4());
        
        let paper_order = PaperOrder {
            id: order_id.clone(),
            pair: intent.pair.clone(),
            side: intent.side.clone(),
            order_type: intent.order_type.clone(),
            volume: intent.volume,
            price: intent.price,
            status: "filled".to_string(),
            created_at: chrono::Utc::now(),
        };

        {
            let mut orders = self.paper_orders.write().await;
            orders.push(paper_order);
            if orders.len() > 100 {
                orders.remove(0);
            }
        }

        let message = format!(
            "📝 PAPER {} {} {} {} @ {}",
            intent.order_type.to_uppercase(),
            intent.side.to_uppercase(),
            intent.volume,
            intent.pair,
            intent.price.map(|p| p.to_string()).unwrap_or("MARKET".to_string())
        );

        tracing::info!("{}", message);

        OrderResult {
            success: true,
            mode: "paper".to_string(),
            order_id: Some(order_id),
            message,
            error: None,
        }
    }

    fn validate_order(&self, intent: &OrderIntent) -> Result<(), String> {
        if !self.config.allowed_pairs.contains(&intent.pair) {
            return Err(format!("Pair {} not allowed", intent.pair));
        }
        if intent.volume > self.config.max_order_size {
            return Err(format!("Volume exceeds max {}", self.config.max_order_size));
        }
        if intent.volume <= Decimal::ZERO {
            return Err("Volume must be positive".to_string());
        }
        if intent.order_type == "limit" && intent.price.is_none() {
            return Err("Limit orders require price".to_string());
        }
        Ok(())
    }

    pub async fn cancel_order(&self, txid: &str) -> OrderResult {
        OrderResult {
            success: true,
            mode: "paper".to_string(),
            order_id: Some(txid.to_string()),
            message: "Paper order cancelled".to_string(),
            error: None,
        }
    }

    pub async fn cancel_all(&self) -> OrderResult {
        OrderResult {
            success: true,
            mode: "paper".to_string(),
            order_id: None,
            message: "All paper orders cancelled".to_string(),
            error: None,
        }
    }

    pub async fn get_account_info(&self) -> AccountInfo {
        AccountInfo {
            mode: "paper".to_string(),
            balances: vec![
                BalanceInfo {
                    asset: "USD".to_string(),
                    total: Decimal::from(100000),
                    available: Decimal::from(100000),
                },
                BalanceInfo {
                    asset: "XBT".to_string(),
                    total: Decimal::from(1),
                    available: Decimal::from(1),
                },
            ],
            open_orders: vec![],
            positions: vec![],
        }
    }

    pub async fn get_paper_orders(&self) -> Vec<PaperOrder> {
        self.paper_orders.read().await.clone()
    }
}
