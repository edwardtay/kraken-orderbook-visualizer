# Code Examples

This document provides practical code examples for integrating the Orderbook Visualizer into your applications.

## Table of Contents

1. [Basic Integration](#basic-integration)
2. [Advanced Features](#advanced-features)
3. [Custom Visualizations](#custom-visualizations)
4. [Backend Integration](#backend-integration)
5. [Data Analysis](#data-analysis)

## Basic Integration

### Example 1: Simple Live Orderbook

```jsx
import React from 'react';
import OrderbookVisualizer from './components/OrderbookVisualizer';

function SimpleLiveOrderbook() {
  return (
    <div>
      <h1>Bitcoin Orderbook</h1>
      <OrderbookVisualizer
        symbol="BTC/USD"
        depth={20}
        autoUpdate={true}
        theme="dark"
      />
    </div>
  );
}

export default SimpleLiveOrderbook;
```

### Example 2: Multiple Symbols Dashboard

```jsx
import React, { useState } from 'react';
import OrderbookVisualizer from './components/OrderbookVisualizer';
import './Dashboard.css';

function TradingDashboard() {
  const symbols = [
    { name: 'BTC/USD', color: '#f7931a' },
    { name: 'ETH/USD', color: '#627eea' },
    { name: 'SOL/USD', color: '#00d4aa' }
  ];

  return (
    <div className="trading-dashboard">
      <h1>Multi-Asset Orderbook Monitor</h1>
      <div className="orderbooks-grid">
        {symbols.map(({ name, color }) => (
          <div key={name} className="orderbook-card" style={{ borderColor: color }}>
            <OrderbookVisualizer
              symbol={name}
              depth={15}
              autoUpdate={true}
              theme="dark"
            />
          </div>
        ))}
      </div>
    </div>
  );
}

export default TradingDashboard;
```

### Example 3: Customizable Depth Control

```jsx
import React, { useState } from 'react';
import OrderbookVisualizer from './components/OrderbookVisualizer';

function CustomizableOrderbook() {
  const [symbol, setSymbol] = useState('BTC/USD');
  const [depth, setDepth] = useState(20);

  return (
    <div>
      <div className="controls">
        <select value={symbol} onChange={(e) => setSymbol(e.target.value)}>
          <option value="BTC/USD">Bitcoin</option>
          <option value="ETH/USD">Ethereum</option>
          <option value="SOL/USD">Solana</option>
        </select>

        <label>
          Depth: {depth}
          <input
            type="range"
            min="5"
            max="50"
            value={depth}
            onChange={(e) => setDepth(parseInt(e.target.value))}
          />
        </label>
      </div>

      <OrderbookVisualizer
        symbol={symbol}
        depth={depth}
        autoUpdate={true}
      />
    </div>
  );
}

export default CustomizableOrderbook;
```

## Advanced Features

### Example 4: Time Travel Analysis

```jsx
import React, { useState } from 'react';
import OrderbookVisualizer from './components/OrderbookVisualizer';
import { subHours, format } from 'date-fns';

function TimeTravelAnalysis() {
  const [dateRange, setDateRange] = useState({
    start: subHours(new Date(), 24).toISOString(),
    end: new Date().toISOString()
  });
  const [speed, setSpeed] = useState(2.0);

  return (
    <div className="time-travel-container">
      <h1>Historical Orderbook Replay</h1>

      <div className="controls">
        <div>
          <label>Start Time:</label>
          <input
            type="datetime-local"
            value={format(new Date(dateRange.start), "yyyy-MM-dd'T'HH:mm")}
            onChange={(e) => setDateRange({
              ...dateRange,
              start: new Date(e.target.value).toISOString()
            })}
          />
        </div>

        <div>
          <label>End Time:</label>
          <input
            type="datetime-local"
            value={format(new Date(dateRange.end), "yyyy-MM-dd'T'HH:mm")}
            onChange={(e) => setDateRange({
              ...dateRange,
              end: new Date(e.target.value).toISOString()
            })}
          />
        </div>

        <div>
          <label>Speed: {speed}x</label>
          <select value={speed} onChange={(e) => setSpeed(parseFloat(e.target.value))}>
            <option value="0.5">0.5x</option>
            <option value="1.0">1x</option>
            <option value="2.0">2x</option>
            <option value="5.0">5x</option>
            <option value="10.0">10x</option>
          </select>
        </div>
      </div>

      <OrderbookVisualizer
        symbol="BTC/USD"
        timeTravel={true}
        startTime={dateRange.start}
        endTime={dateRange.end}
        playbackSpeed={speed}
        depth={25}
      />
    </div>
  );
}

export default TimeTravelAnalysis;
```

### Example 5: Spread Monitor with Alerts

```jsx
import React, { useState, useEffect } from 'react';
import OrderbookVisualizer from './components/OrderbookVisualizer';

function SpreadMonitor() {
  const [spread, setSpread] = useState(null);
  const [alert, setAlert] = useState(null);
  const alertThreshold = 50; // $50 spread threshold

  useEffect(() => {
    const ws = new WebSocket('ws://localhost:3033/ws/orderbook/BTC%2FUSD');

    ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.type === 'snapshot') {
        const { bids, asks } = message.data;
        if (bids.length > 0 && asks.length > 0) {
          const currentSpread = parseFloat(asks[0].price) - parseFloat(bids[0].price);
          setSpread(currentSpread);

          if (currentSpread > alertThreshold) {
            setAlert(`Wide spread detected: $${currentSpread.toFixed(2)}`);
            // Play sound, send notification, etc.
          } else {
            setAlert(null);
          }
        }
      }
    };

    return () => ws.close();
  }, []);

  return (
    <div>
      <div className="spread-monitor">
        <h2>Spread Monitor</h2>
        <div className="spread-display">
          Current Spread: ${spread?.toFixed(2) || '--'}
        </div>
        {alert && (
          <div className="alert-banner">
            ⚠️ {alert}
          </div>
        )}
      </div>

      <OrderbookVisualizer
        symbol="BTC/USD"
        depth={20}
        autoUpdate={true}
      />
    </div>
  );
}

export default SpreadMonitor;
```

## Custom Visualizations

### Example 6: Depth Chart

```jsx
import React, { useState, useEffect } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';

function DepthChart({ symbol = 'BTC/USD' }) {
  const [depthData, setDepthData] = useState({ bids: [], asks: [] });

  useEffect(() => {
    const ws = new WebSocket(`ws://localhost:3033/ws/orderbook/${symbol.replace('/', '%2F')}`);

    ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.type === 'snapshot') {
        // Calculate cumulative volumes
        let cumBid = 0;
        const bids = message.data.bids.map(level => {
          cumBid += parseFloat(level.volume);
          return {
            price: parseFloat(level.price),
            cumVolume: cumBid
          };
        }).reverse();

        let cumAsk = 0;
        const asks = message.data.asks.map(level => {
          cumAsk += parseFloat(level.volume);
          return {
            price: parseFloat(level.price),
            cumVolume: cumAsk
          };
        });

        setDepthData({ bids, asks });
      }
    };

    return () => ws.close();
  }, [symbol]);

  const chartData = [
    ...depthData.bids,
    ...depthData.asks
  ].sort((a, b) => a.price - b.price);

  return (
    <div className="depth-chart">
      <h3>{symbol} Depth Chart</h3>
      <ResponsiveContainer width="100%" height={400}>
        <LineChart data={chartData}>
          <XAxis dataKey="price" tickFormatter={(val) => `$${val.toFixed(0)}`} />
          <YAxis />
          <Tooltip
            labelFormatter={(price) => `Price: $${price.toFixed(2)}`}
            formatter={(value) => [`${value.toFixed(2)} BTC`, 'Cumulative Volume']}
          />
          <Line
            type="stepAfter"
            dataKey="cumVolume"
            stroke="#8884d8"
            strokeWidth={2}
            dot={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export default DepthChart;
```

### Example 7: Liquidity Heatmap

```jsx
import React, { useState, useEffect } from 'react';

function LiquidityHeatmap({ symbol = 'BTC/USD' }) {
  const [heatmapData, setHeatmapData] = useState([]);

  useEffect(() => {
    const ws = new WebSocket(`ws://localhost:3033/ws/orderbook/${symbol.replace('/', '%2F')}`);

    ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.type === 'snapshot') {
        const { bids, asks } = message.data;

        // Combine and calculate intensity
        const maxVolume = Math.max(
          ...bids.map(b => parseFloat(b.volume)),
          ...asks.map(a => parseFloat(a.volume))
        );

        const data = [
          ...bids.slice(0, 20).map(level => ({
            price: parseFloat(level.price),
            volume: parseFloat(level.volume),
            intensity: parseFloat(level.volume) / maxVolume,
            side: 'bid'
          })),
          ...asks.slice(0, 20).map(level => ({
            price: parseFloat(level.price),
            volume: parseFloat(level.volume),
            intensity: parseFloat(level.volume) / maxVolume,
            side: 'ask'
          }))
        ];

        setHeatmapData(data);
      }
    };

    return () => ws.close();
  }, [symbol]);

  return (
    <div className="liquidity-heatmap">
      <h3>Liquidity Heatmap</h3>
      <div className="heatmap-grid">
        {heatmapData.map((level, idx) => (
          <div
            key={idx}
            className="heatmap-cell"
            style={{
              backgroundColor: level.side === 'bid'
                ? `rgba(39, 174, 96, ${level.intensity})`
                : `rgba(231, 76, 60, ${level.intensity})`,
              height: `${level.intensity * 100}px`
            }}
            title={`$${level.price.toFixed(2)}: ${level.volume.toFixed(4)}`}
          />
        ))}
      </div>
    </div>
  );
}

export default LiquidityHeatmap;
```

## Backend Integration

### Example 8: Fetch Historical Data

```javascript
async function fetchOrderbookHistory(symbol, hours = 24) {
  const endTime = new Date();
  const startTime = new Date(endTime.getTime() - hours * 60 * 60 * 1000);

  const response = await fetch(
    `http://localhost:3033/api/orderbook/${encodeURIComponent(symbol)}/history` +
    `?from=${startTime.toISOString()}&to=${endTime.toISOString()}`
  );

  if (!response.ok) {
    throw new Error(`Failed to fetch history: ${response.statusText}`);
  }

  return await response.json();
}

// Usage
fetchOrderbookHistory('BTC/USD', 24)
  .then(snapshots => {
    console.log(`Received ${snapshots.length} snapshots`);
    snapshots.forEach(snapshot => {
      const spread = calculateSpread(snapshot);
      console.log(`${snapshot.timestamp}: Spread = $${spread.toFixed(2)}`);
    });
  })
  .catch(error => console.error(error));

function calculateSpread(snapshot) {
  if (snapshot.asks.length > 0 && snapshot.bids.length > 0) {
    return parseFloat(snapshot.asks[0].price) - parseFloat(snapshot.bids[0].price);
  }
  return 0;
}
```

### Example 9: Storage Statistics

```javascript
async function getOrderbookStats(symbol) {
  const response = await fetch(
    `http://localhost:3033/api/orderbook/${encodeURIComponent(symbol)}/stats`
  );

  if (!response.ok) {
    throw new Error(`Failed to fetch stats: ${response.statusText}`);
  }

  return await response.json();
}

// Usage
getOrderbookStats('BTC/USD')
  .then(stats => {
    console.log(`Symbol: ${stats.symbol}`);
    console.log(`Total snapshots: ${stats.snapshot_count}`);
    console.log(`Date range: ${stats.oldest_snapshot} to ${stats.newest_snapshot}`);

    if (stats.oldest_snapshot && stats.newest_snapshot) {
      const duration = new Date(stats.newest_snapshot) - new Date(stats.oldest_snapshot);
      const hours = duration / (1000 * 60 * 60);
      console.log(`Coverage: ${hours.toFixed(1)} hours`);
    }
  })
  .catch(error => console.error(error));
```

## Data Analysis

### Example 10: Spread Analysis

```javascript
function analyzeSpread(snapshots) {
  const spreads = snapshots
    .map(snapshot => {
      if (snapshot.asks.length > 0 && snapshot.bids.length > 0) {
        return {
          timestamp: new Date(snapshot.timestamp),
          spread: parseFloat(snapshot.asks[0].price) - parseFloat(snapshot.bids[0].price),
          midPrice: (parseFloat(snapshot.asks[0].price) + parseFloat(snapshot.bids[0].price)) / 2
        };
      }
      return null;
    })
    .filter(s => s !== null);

  const avgSpread = spreads.reduce((sum, s) => sum + s.spread, 0) / spreads.length;
  const maxSpread = Math.max(...spreads.map(s => s.spread));
  const minSpread = Math.min(...spreads.map(s => s.spread));

  return {
    average: avgSpread,
    max: maxSpread,
    min: minSpread,
    spreads
  };
}

// Usage
fetchOrderbookHistory('BTC/USD', 24)
  .then(snapshots => {
    const analysis = analyzeSpread(snapshots);
    console.log('Spread Analysis:');
    console.log(`Average: $${analysis.average.toFixed(2)}`);
    console.log(`Max: $${analysis.max.toFixed(2)}`);
    console.log(`Min: $${analysis.min.toFixed(2)}`);
  });
```

### Example 11: Volume Profile

```javascript
function calculateVolumeProfile(snapshot, numBins = 20) {
  if (!snapshot.bids.length || !snapshot.asks.length) return [];

  const minPrice = parseFloat(snapshot.bids[snapshot.bids.length - 1].price);
  const maxPrice = parseFloat(snapshot.asks[snapshot.asks.length - 1].price);
  const binSize = (maxPrice - minPrice) / numBins;

  const bins = Array(numBins).fill(0).map((_, i) => ({
    priceLevel: minPrice + i * binSize,
    volume: 0
  }));

  // Aggregate bids
  snapshot.bids.forEach(bid => {
    const price = parseFloat(bid.price);
    const binIndex = Math.floor((price - minPrice) / binSize);
    if (binIndex >= 0 && binIndex < numBins) {
      bins[binIndex].volume += parseFloat(bid.volume);
    }
  });

  // Aggregate asks
  snapshot.asks.forEach(ask => {
    const price = parseFloat(ask.price);
    const binIndex = Math.floor((price - minPrice) / binSize);
    if (binIndex >= 0 && binIndex < numBins) {
      bins[binIndex].volume += parseFloat(ask.volume);
    }
  });

  return bins;
}

// Usage
fetch('http://localhost:3033/api/orderbook/BTC%2FUSD')
  .then(res => res.json())
  .then(snapshot => {
    const profile = calculateVolumeProfile(snapshot, 20);
    console.log('Volume Profile:');
    profile.forEach((bin, i) => {
      const bar = '█'.repeat(Math.floor(bin.volume * 10));
      console.log(`$${bin.priceLevel.toFixed(0)}: ${bar} (${bin.volume.toFixed(2)})`);
    });
  });
```

### Example 12: Real-Time Metrics

```jsx
import React, { useState, useEffect } from 'react';

function RealTimeMetrics({ symbol = 'BTC/USD' }) {
  const [metrics, setMetrics] = useState({
    updateCount: 0,
    avgSpread: 0,
    bidDepth: 0,
    askDepth: 0,
    lastUpdate: null
  });

  useEffect(() => {
    const ws = new WebSocket(`ws://localhost:3033/ws/orderbook/${symbol.replace('/', '%2F')}`);
    let spreads = [];

    ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.type === 'snapshot') {
        const { bids, asks } = message.data;

        const spread = parseFloat(asks[0].price) - parseFloat(bids[0].price);
        spreads.push(spread);
        if (spreads.length > 100) spreads.shift();

        const bidDepth = bids.reduce((sum, b) => sum + parseFloat(b.volume), 0);
        const askDepth = asks.reduce((sum, a) => sum + parseFloat(a.volume), 0);

        setMetrics(prev => ({
          updateCount: prev.updateCount + 1,
          avgSpread: spreads.reduce((a, b) => a + b, 0) / spreads.length,
          bidDepth,
          askDepth,
          lastUpdate: new Date()
        }));
      }
    };

    return () => ws.close();
  }, [symbol]);

  return (
    <div className="metrics-panel">
      <h3>Real-Time Metrics</h3>
      <div className="metric">Updates: {metrics.updateCount}</div>
      <div className="metric">Avg Spread: ${metrics.avgSpread.toFixed(2)}</div>
      <div className="metric">Bid Depth: {metrics.bidDepth.toFixed(4)}</div>
      <div className="metric">Ask Depth: {metrics.askDepth.toFixed(4)}</div>
      <div className="metric">
        Last Update: {metrics.lastUpdate?.toLocaleTimeString() || 'N/A'}
      </div>
    </div>
  );
}

export default RealTimeMetrics;
```

## Next Steps

For more examples, see:
- [USAGE.md](USAGE.md) - Complete usage guide
- [ARCHITECTURE.md](ARCHITECTURE.md) - Technical architecture
- Live demo: `http://localhost:3000` (after running the app)
