# Kraken Orderbook Visualizer

A professional-grade real-time orderbook visualization tool with time-travel capabilities, built on the [Kraken WebSocket SDK](https://github.com/edwardtay/kraken-sdk).

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![React](https://img.shields.io/badge/React-18-blue.svg)](https://reactjs.org/)
[![Rust](https://img.shields.io/badge/Rust-Backend-orange.svg)](https://www.rust-lang.org/)

## 🎯 Hackathon Track

**Track #2 - Orderbook Visualizer**: Build a web orderbook visualizer that connects to Kraken's exchange WS API and allows time travel.

## ✨ Features

### Real-time Visualization
- **Live Orderbook**: Real-time bid/ask depth ladder
- **Price Aggregation**: Configurable tick size grouping
- **Spread Display**: Mid-price and spread in basis points
- **Imbalance Indicator**: Visual buy/sell pressure gauge

### Time Travel
- **Historical Playback**: Scrub through past orderbook states
- **Snapshot Storage**: Efficient time-series storage with sled DB
- **Range Queries**: Query orderbook state at any timestamp

### Advanced Features
- **Whale Detection**: Highlight large orders (5x rolling average)
- **Market Health**: Stale data detection and connection status
- **Multi-Symbol**: Support for XBT/USD, ETH/USD, SOL/USD

## 🖼️ Screenshots

```
┌─────────────────────────────────────────────────────────────┐
│  XBT/USD    $97,234.50    Spread: 0.02%    ● Connected     │
├─────────────────────────────────────────────────────────────┤
│  BIDS                    │  ASKS                           │
│  ████████████  97,234    │  97,235    ████████             │
│  ██████████    97,233    │  97,236    ██████████████       │
│  ████████      97,232    │  97,237    ████████████         │
│  ██████        97,231    │  97,238    ██████               │
├─────────────────────────────────────────────────────────────┤
│  ◀ ══════════════●══════════════ ▶   12:34:56             │
│                Time Travel Slider                          │
└─────────────────────────────────────────────────────────────┘
```

## 🚀 Quick Start

### Prerequisites
- Rust 1.70+ (for backend)
- Node.js 18+ (for frontend)

### Running Locally

```bash
# Clone the repository
git clone https://github.com/edwardtay/kraken-orderbook
cd kraken-orderbook

# Start the backend
cd backend
cargo build --release
./target/release/orderbook-visualizer

# In another terminal, start the frontend
cd frontend
npm install
npm start
```

The visualizer will be available at `http://localhost:3000`

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Frontend (React)                         │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐         │
│  │ Orderbook   │  │ Time Travel │  │ Health      │         │
│  │ Visualizer  │  │ Slider      │  │ Indicator   │         │
│  └─────────────┘  └─────────────┘  └─────────────┘         │
└────────────────────────┬────────────────────────────────────┘
                         │ WebSocket
┌────────────────────────▼────────────────────────────────────┐
│                    Backend (Rust)                           │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐         │
│  │ Kraken WS   │  │ Orderbook   │  │ Time-Series │         │
│  │ Client      │  │ Manager     │  │ Storage     │         │
│  └─────────────┘  └─────────────┘  └─────────────┘         │
└────────────────────────┬────────────────────────────────────┘
                         │ WebSocket
┌────────────────────────▼────────────────────────────────────┐
│              Kraken WebSocket SDK                           │
│         (github.com/edwardtay/kraken-sdk)               │
└─────────────────────────────────────────────────────────────┘
```

## 📡 API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/orderbook/:base/:quote` | GET | Current orderbook snapshot |
| `/api/orderbook/:base/:quote/history` | GET | Historical snapshots |
| `/api/orderbook/:base/:quote/stats` | GET | Storage statistics |
| `/ws/orderbook/:base/:quote` | WS | Real-time orderbook stream |
| `/api/health` | GET | Service health check |

## 📚 Documentation

| Document | Description |
|----------|-------------|
| [Backend API](./backend/README.md) | Backend service documentation |
| [Frontend Guide](./frontend/README.md) | Frontend component guide |

## 🔗 Related Projects

This visualizer is part of a 3-project hackathon submission:

1. **[Kraken SDK](https://github.com/edwardtay/kraken-sdk)** - Core WebSocket SDK (dependency)
2. **[Kraken Orderbook](https://github.com/edwardtay/kraken-orderbook)** (this repo) - Orderbook visualizer
3. **[Kraken Strategy Builder](https://github.com/edwardtay/kraken-strategy-builder)** - No-code trading (uses this)

## 📄 License

MIT License - see [LICENSE](./LICENSE) for details.

---

**Built for Kraken Hackathon 2024** | Track #2: Orderbook Visualizer
