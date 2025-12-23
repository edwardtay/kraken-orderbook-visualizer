# Orderbook Visualizer - Usage Guide

## Table of Contents

1. [Installation](#installation)
2. [Quick Start](#quick-start)
3. [Component API](#component-api)
4. [Backend API](#backend-api)
5. [Time Travel Mode](#time-travel-mode)
6. [Examples](#examples)
7. [Troubleshooting](#troubleshooting)

## Installation

### Backend Setup

```bash
cd orderbook-visualizer/backend
cargo build --release
```

### Frontend Setup

```bash
cd orderbook-visualizer/frontend
npm install
```

## Quick Start

### 1. Start the Backend Server

```bash
cd backend
cargo run --release
```

The server will start on `http://localhost:3033`

### 2. Start the Frontend

```bash
cd frontend
npm start
```

The UI will open at `http://localhost:3000`

## Component API

### Basic Usage

```jsx
import OrderbookVisualizer from './components/OrderbookVisualizer';

function App() {
  return (
    <OrderbookVisualizer
      symbol="BTC/USD"
      depth={20}
      autoUpdate={true}
    />
  );
}
```

### Props

| Prop | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `symbol` | string | Yes | - | Trading pair (e.g., "BTC/USD", "ETH/USD") |
| `depth` | number | No | 20 | Number of price levels to display (5-50) |
| `autoUpdate` | boolean | No | true | Enable real-time WebSocket updates |
| `timeTravel` | boolean | No | false | Enable time travel mode |
| `startTime` | string | No | null | ISO 8601 start time for time travel |
| `endTime` | string | No | null | ISO 8601 end time for time travel |
| `playbackSpeed` | number | No | 1.0 | Playback speed multiplier (0.1 - 10.0) |
| `theme` | string | No | 'dark' | UI theme ('dark' or 'light') |
| `apiUrl` | string | No | 'http://localhost:3033' | Backend API URL |

## Backend API

### REST Endpoints

#### Get Current Orderbook

```bash
GET /api/orderbook/:symbol
```

Example:
```bash
curl http://localhost:3033/api/orderbook/BTC%2FUSD
```

Response:
```json
{
  "symbol": "BTC/USD",
  "timestamp": "2024-01-15T10:30:00Z",
  "bids": [
    {"price": "45000.00", "volume": "1.5"},
    {"price": "44999.50", "volume": "2.3"}
  ],
  "asks": [
    {"price": "45001.00", "volume": "1.8"},
    {"price": "45001.50", "volume": "2.1"}
  ],
  "checksum": 123456789
}
```

#### Get Historical Data

```bash
GET /api/orderbook/:symbol/history?from=<ISO8601>&to=<ISO8601>
```

Example:
```bash
curl "http://localhost:3033/api/orderbook/BTC%2FUSD/history?from=2024-01-15T00:00:00Z&to=2024-01-15T23:59:59Z"
```

#### Get Snapshot at Specific Time

```bash
GET /api/orderbook/:symbol/snapshot/:timestamp
```

Example:
```bash
curl http://localhost:3033/api/orderbook/BTC%2FUSD/snapshot/2024-01-15T10:30:00Z
```

#### Get Storage Statistics

```bash
GET /api/orderbook/:symbol/stats
```

Example:
```bash
curl http://localhost:3033/api/orderbook/BTC%2FUSD/stats
```

Response:
```json
{
  "symbol": "BTC/USD",
  "snapshot_count": 1440,
  "oldest_snapshot": "2024-01-15T00:00:00Z",
  "newest_snapshot": "2024-01-15T23:59:00Z"
}
```

### WebSocket Endpoint

```bash
ws://localhost:3033/ws/orderbook/:symbol
```

#### Connect

```javascript
const ws = new WebSocket('ws://localhost:3033/ws/orderbook/BTC%2FUSD');

ws.onmessage = (event) => {
  const message = JSON.parse(event.data);

  if (message.type === 'snapshot') {
    console.log('Orderbook update:', message.data);
  } else if (message.type === 'error') {
    console.error('Error:', message.message);
  }
};
```

## Time Travel Mode

Time travel allows you to replay historical orderbook states.

### Enable Time Travel

```jsx
<OrderbookVisualizer
  symbol="BTC/USD"
  timeTravel={true}
  startTime="2024-01-15T00:00:00Z"
  endTime="2024-01-15T23:59:59Z"
  playbackSpeed={2.0}
/>
```

### Controls

- **Play/Pause**: Start or pause playback
- **Step Backward**: Go to previous snapshot
- **Step Forward**: Go to next snapshot
- **Timeline Slider**: Jump to any point in history
- **Playback Speed**: Control replay speed (0.5x to 10x)

### Use Cases

1. **Market Analysis**: Study orderbook behavior during specific events
2. **Strategy Backtesting**: Replay market conditions
3. **Education**: Demonstrate orderbook dynamics
4. **Debugging**: Analyze specific market scenarios

## Examples

### Example 1: Real-Time Multi-Symbol Dashboard

```jsx
import OrderbookVisualizer from './components/OrderbookVisualizer';

function Dashboard() {
  const symbols = ['BTC/USD', 'ETH/USD', 'SOL/USD'];

  return (
    <div className="dashboard">
      {symbols.map(symbol => (
        <OrderbookVisualizer
          key={symbol}
          symbol={symbol}
          depth={10}
          autoUpdate={true}
        />
      ))}
    </div>
  );
}
```

### Example 2: Historical Analysis

```jsx
function HistoricalAnalysis() {
  return (
    <OrderbookVisualizer
      symbol="BTC/USD"
      timeTravel={true}
      startTime="2024-01-15T09:00:00Z"
      endTime="2024-01-15T17:00:00Z"
      playbackSpeed={5.0}
      depth={25}
    />
  );
}
```

### Example 3: Custom Integration

```jsx
function CustomIntegration() {
  const [snapshot, setSnapshot] = useState(null);

  useEffect(() => {
    const ws = new WebSocket('ws://localhost:3033/ws/orderbook/BTC%2FUSD');

    ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.type === 'snapshot') {
        setSnapshot(message.data);
        // Custom processing
        analyzeOrderbook(message.data);
      }
    };

    return () => ws.close();
  }, []);

  return (
    <div>
      <OrderbookVisualizer symbol="BTC/USD" />
      <div>Custom Analysis: {/* Your custom UI */}</div>
    </div>
  );
}
```

### Example 4: REST API Integration

```jsx
async function fetchHistoricalData() {
  const from = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const to = new Date().toISOString();

  const response = await fetch(
    `http://localhost:3033/api/orderbook/BTC%2FUSD/history?from=${from}&to=${to}`
  );

  const snapshots = await response.json();

  // Process snapshots
  snapshots.forEach(snapshot => {
    console.log(`${snapshot.timestamp}: Spread = ${calculateSpread(snapshot)}`);
  });
}

function calculateSpread(snapshot) {
  if (snapshot.asks.length > 0 && snapshot.bids.length > 0) {
    return parseFloat(snapshot.asks[0].price) - parseFloat(snapshot.bids[0].price);
  }
  return 0;
}
```

## Troubleshooting

### WebSocket Connection Fails

**Problem**: Cannot connect to `ws://localhost:3033`

**Solution**:
1. Ensure backend server is running: `cargo run`
2. Check firewall settings
3. Verify port 3033 is not in use: `lsof -i :3033`

### No Historical Data

**Problem**: Time travel mode shows "No data"

**Solution**:
1. Backend needs time to collect data
2. Check data directory exists: `ls ./data/orderbooks`
3. Verify symbol has data: `curl http://localhost:3033/api/orderbook/BTC%2FUSD/stats`

### High Memory Usage

**Problem**: Backend consuming too much memory

**Solution**:
1. Reduce number of tracked symbols
2. Implement data retention policy
3. Use `clear_symbol()` to remove old data

### Frontend Not Updating

**Problem**: Orderbook visualization is frozen

**Solution**:
1. Check WebSocket connection status (green dot = connected)
2. Verify backend is receiving data from Kraken
3. Check browser console for errors
4. Try refreshing the page

### CORS Errors

**Problem**: API requests blocked by CORS

**Solution**:
Backend already has CORS enabled. If issues persist:
1. Check browser console for specific error
2. Verify API URL in frontend matches backend
3. Try running frontend and backend on same domain

## Performance Tips

1. **Depth**: Lower depth values (10-20) perform better than high values (40-50)
2. **Update Frequency**: Consider implementing throttling for high-frequency updates
3. **History Range**: Limit time travel range to needed period (hours vs days)
4. **Multiple Symbols**: Limit simultaneous visualizations to 3-5 symbols

## Next Steps

- See [ARCHITECTURE.md](ARCHITECTURE.md) for technical details
- Check [EXAMPLES.md](EXAMPLES.md) for more code samples
- Read [API.md](API.md) for complete API reference
