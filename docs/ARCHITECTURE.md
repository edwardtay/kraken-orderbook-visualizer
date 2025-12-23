# Architecture Overview

## System Design

The Orderbook Visualizer is built with a clean separation between backend (Rust) and frontend (React), communicating via WebSocket and REST APIs.

```
┌─────────────────────────────────────────────────────────────┐
│                         Frontend (React)                     │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │ Visualizer   │  │ Time Travel  │  │  Controls    │      │
│  │ Component    │  │   Player     │  │   Panel      │      │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘      │
│         │                  │                  │              │
│         └──────────────────┴──────────────────┘              │
│                            │                                 │
└────────────────────────────┼─────────────────────────────────┘
                             │
                    WebSocket + REST API
                             │
┌────────────────────────────┼─────────────────────────────────┐
│                   Backend (Rust)                             │
│  ┌─────────────────────────┴──────────────────────┐         │
│  │         Warp Web Server (HTTP + WS)            │         │
│  └─────────────┬──────────────────────────────────┘         │
│                │                                             │
│  ┌─────────────┴────────────────┐  ┌────────────────────┐  │
│  │   OrderbookManager           │  │  Storage (Sled)    │  │
│  │  - State Management          │◄─┤  - Time Series DB │  │
│  │  - Broadcast Updates         │  │  - Snapshots       │  │
│  └─────────────┬────────────────┘  └────────────────────┘  │
│                │                                             │
│  ┌─────────────┴────────────────┐                           │
│  │   Kraken WS Client           │                           │
│  │  - OrderbookCallback         │                           │
│  │  - Connection Management     │                           │
│  └─────────────┬────────────────┘                           │
└────────────────┼─────────────────────────────────────────────┘
                 │
                 │ WebSocket
                 │
┌────────────────┼─────────────────────────────────────────────┐
│                │                                             │
│         Kraken Exchange API                                 │
│         wss://ws.kraken.com                                 │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

## Backend Components

### 1. Storage Layer (`storage.rs`)

**Purpose**: Persistent time-series storage for orderbook snapshots

**Technology**: Sled (embedded key-value database)

**Key Format**:
```
"{symbol}:{timestamp_nanos}"
```

**Features**:
- Fast writes for real-time data
- Efficient range queries for time travel
- Automatic indexing by symbol and timestamp
- Embedded (no separate database process)

**Data Structure**:
```rust
pub struct OrderbookSnapshot {
    pub symbol: String,
    pub timestamp: DateTime<Utc>,
    pub bids: Vec<PriceLevel>,
    pub asks: Vec<PriceLevel>,
    pub checksum: Option<u32>,
    pub sequence: Option<u64>,
}

pub struct PriceLevel {
    pub price: Decimal,
    pub volume: Decimal,
    pub order_count: Option<u32>,
}
```

### 2. Orderbook Manager (`orderbook_manager.rs`)

**Purpose**: Core state management and coordination

**Responsibilities**:
- Maintain current orderbook state
- Store snapshots to disk
- Broadcast updates to WebSocket clients
- Handle time-travel queries

**Thread Safety**:
- Uses `Arc<Mutex<>>` for shared state
- `broadcast` channel for pub/sub updates

**Key Methods**:
```rust
- get_current(symbol) -> Option<OrderbookSnapshot>
- get_history(symbol, from, to) -> Vec<OrderbookSnapshot>
- get_at_time(symbol, timestamp) -> Option<OrderbookSnapshot>
- update_orderbook(update)
- subscribe_updates() -> Receiver
```

### 3. Kraken WebSocket Client Integration

**Purpose**: Connect to live Kraken orderbook feed

**Uses**: `kraken-ws-sdk` from parent project

**Callback Flow**:
```
Kraken WS → OrderbookCallback → OrderbookManager → Storage + Broadcast
```

**Configuration**:
```rust
ClientConfig {
    endpoint: "wss://ws.kraken.com",
    timeout: Duration::from_secs(30),
    buffer_size: 4096,
    ..Default::default()
}
```

### 4. Web Server (`main.rs`)

**Framework**: Warp (async HTTP/WebSocket)

**Routes**:

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/orderbook/:symbol` | Current state |
| GET | `/api/orderbook/:symbol/history` | Time range |
| GET | `/api/orderbook/:symbol/snapshot/:ts` | Point-in-time |
| GET | `/api/orderbook/:symbol/stats` | Statistics |
| WS | `/ws/orderbook/:symbol` | Real-time stream |
| GET | `/api/health` | Health check |

## Frontend Components

### 1. OrderbookVisualizer Component

**File**: `OrderbookVisualizer.jsx`

**State Management**:
```javascript
- orderbook: Current/historical snapshot
- connected: WebSocket connection status
- loading: Initial load state
- error: Error messages
- isPlaying: Playback state
- currentTime: Current time in replay
- history: Array of historical snapshots
- historyIndex: Current position in history
```

**Hooks**:
- `useEffect` for WebSocket connection
- `useEffect` for historical data loading
- `useEffect` for playback timer
- `useRef` for WebSocket and timer references

### 2. Visualization

**Library**: Recharts (React charting library)

**Charts**:
- **Horizontal Bar Charts**: Bid/Ask volumes by price level
- **Color Coding**:
  - Green: Bids (buy orders)
  - Red: Asks (sell orders)

**Tables**:
- Price levels with volume
- Cumulative volume calculation
- Responsive layout

### 3. Time Travel Controls

**Features**:
- Play/Pause button
- Step backward/forward
- Timeline slider
- Playback speed selector
- Current time display

**Playback Logic**:
```javascript
setInterval(() => {
  historyIndex++;
  setOrderbook(history[historyIndex]);
  setCurrentTime(history[historyIndex].timestamp);
}, 1000 / playbackSpeed)
```

## Data Flow

### Real-Time Mode

```
1. User opens page
2. React connects to ws://localhost:3033/ws/orderbook/BTC%2FUSD
3. Backend sends current snapshot
4. Kraken sends orderbook update
5. OrderbookCallback → OrderbookManager
6. Manager stores snapshot + broadcasts
7. WebSocket handler sends to client
8. React updates visualization
```

### Time Travel Mode

```
1. User selects time range
2. React fetches /api/orderbook/:symbol/history
3. Backend queries Storage layer
4. Returns array of snapshots
5. React loads into state
6. User clicks Play
7. Timer advances through snapshots
8. Visualization updates frame-by-frame
```

## Performance Considerations

### Backend

**Write Performance**:
- Sled: ~100k writes/sec
- Bottleneck: Kraken update rate (~1-10 updates/sec)
- No performance issues expected

**Read Performance**:
- Range queries: O(n) where n = snapshots in range
- Point queries: O(log n)
- Optimization: Index by timestamp

**Memory**:
- Current state: ~1KB per symbol
- Storage: ~1KB per snapshot
- 1 day at 1 update/sec = ~86MB per symbol

### Frontend

**Rendering**:
- Recharts optimized for up to 50 data points
- Depth limit: 20-50 levels recommended
- Re-renders throttled by WebSocket rate

**WebSocket**:
- Binary protocol (JSON)
- ~1-5KB per update
- Bandwidth: negligible

**Time Travel**:
- Memory: Array of snapshots in RAM
- 1000 snapshots ≈ 1MB
- Playback: Timer-based, low CPU

## Scalability

### Horizontal Scaling

**Current**: Single instance

**Future**:
- Load balancer for multiple backend instances
- Shared storage (Redis/PostgreSQL)
- Message queue for Kraken updates

### Vertical Scaling

**CPU**: Not a bottleneck (async I/O)
**Memory**: Scales with symbols × history depth
**Disk**: 1GB = ~1 million snapshots

## Security

### Authentication

**Current**: None (demo/hackathon)

**Production**:
- API key authentication
- Rate limiting
- User-specific data access

### Data Validation

- Checksum verification from Kraken
- Input sanitization on API endpoints
- CORS enabled (configurable origins)

### WebSocket

- No sensitive data transmitted
- Read-only access
- Auto-disconnect on errors

## Deployment

### Development

```bash
# Backend
cd backend && cargo run

# Frontend
cd frontend && npm start
```

### Production

**Backend**:
```bash
cargo build --release
./target/release/orderbook-visualizer
```

**Frontend**:
```bash
npm run build
# Serve static files from build/
```

**Docker** (Future):
```dockerfile
FROM rust:1.70 as backend
# Build backend

FROM node:18 as frontend
# Build frontend

FROM nginx
# Serve frontend + proxy to backend
```

## Monitoring

### Metrics (Future)

- WebSocket connections active
- Snapshots stored per symbol
- API request latency
- Storage disk usage
- Kraken connection status

### Logging

**Backend**:
```rust
tracing::info!("Connection state changed");
tracing::error!("Failed to store snapshot");
```

**Frontend**:
```javascript
console.log("Connected to orderbook stream");
console.error("WebSocket error");
```

## Testing Strategy

### Backend

**Unit Tests**:
- Storage CRUD operations
- Orderbook state management
- Time range queries

**Integration Tests**:
- Kraken WebSocket connection
- API endpoints
- WebSocket broadcasting

### Frontend

**Component Tests**:
- Orderbook rendering
- Time travel controls
- WebSocket connection

**E2E Tests**:
- Full flow: Connect → Update → Display
- Time travel: Load → Play → Seek

## Future Enhancements

1. **Heatmap View**: Liquidity depth visualization
2. **Multi-Symbol Compare**: Side-by-side comparison
3. **Export Data**: CSV/JSON download
4. **Alerts**: Price/volume thresholds
5. **Analytics**: Statistical analysis tools
6. **Mobile App**: React Native version
7. **Data Compression**: Reduce storage footprint
8. **Clustering**: Distributed storage
