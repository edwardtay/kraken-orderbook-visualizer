import React, { useState, useEffect, useRef } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { format } from 'date-fns';
import './OrderbookVisualizer.css';
import MiniCandlestickStrip from './MiniCandlestickStrip';

const TICK_SIZES = [0.01, 0.1, 1, 5, 10, 50, 100];
const IMBALANCE_DEPTHS = [5, 10, 20, 50];
const DEPTH_RANGES = [1, 2, 5, 10, 20]; // Percent from mid-price
const STALE_THRESHOLD_MS = 5000; // 5 seconds without update = stale
const LARGE_ORDER_THRESHOLD = 2.0; // 2x average size = large order
const WHALE_THRESHOLD = 5.0; // 5x rolling average = whale
const SPOOF_DETECTION_WINDOW = 3000; // 3 seconds to detect spoofing
const HEATMAP_HISTORY_SIZE = 30; // Number of snapshots for heatmap

// Per-pair price formatting (decimals based on typical price range)
const PAIR_DECIMALS = {
  'XBT/USD': 2,  // BTC ~$100k, show cents
  'ETH/USD': 2,  // ETH ~$3k, show cents
  'SOL/USD': 3,  // SOL ~$200, show more precision
  'default': 2,
};

const getPriceDecimals = (symbol) => PAIR_DECIMALS[symbol] || PAIR_DECIMALS['default'];

const PLAYBACK_SPEEDS = [0.5, 1, 2, 4];

// Default API URL - uses environment variable in production
const DEFAULT_API_URL = process.env.REACT_APP_API_URL || 'http://localhost:3033';

const OrderbookVisualizer = ({
  symbol = 'BTC/USD',
  depth = 20,
  autoUpdate = true,
  replay = false,
  timeTravel = false, // deprecated, use replay
  startTime = null,
  endTime = null,
  playbackSpeed = 1.0,
  onPlaybackSpeedChange = null,
  theme = 'dark',
  apiUrl = DEFAULT_API_URL,
}) => {
  // Support both replay and legacy timeTravel prop
  const isReplayMode = replay || timeTravel;
  
  const [orderbook, setOrderbook] = useState(null);
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [tickSize, setTickSize] = useState(1);

  // Replay state
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(null);
  const [history, setHistory] = useState([]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [localPlaybackSpeed, setLocalPlaybackSpeed] = useState(playbackSpeed);

  // New feature states
  const [lastUpdateTime, setLastUpdateTime] = useState(Date.now());
  const [latencyMs, setLatencyMs] = useState(0);
  const [isStale, setIsStale] = useState(false);
  const [imbalanceDepth, setImbalanceDepth] = useState(10);

  const [flashingPrices, setFlashingPrices] = useState(new Map());
  const [prevOrderbook, setPrevOrderbook] = useState(null);
  const [midPriceUpdated, setMidPriceUpdated] = useState(false);

  // Advanced feature states
  const [depthRangePercent, setDepthRangePercent] = useState(5);
  const [whaleOrders, setWhaleOrders] = useState(new Set());
  const [heatmapData, setHeatmapData] = useState([]);
  const [spoofAlerts, setSpoofAlerts] = useState([]);

  const wsRef = useRef(null);
  const playbackTimerRef = useRef(null);
  const staleCheckRef = useRef(null);
  const volumeHistoryRef = useRef({ bids: [], asks: [] });
  const recentLiquidityRef = useRef(new Map());
  const rollingAvgRef = useRef({ bid: 0, ask: 0 });
  const currentSymbolRef = useRef(symbol);

  // Keep symbol ref in sync
  useEffect(() => {
    currentSymbolRef.current = symbol;
  }, [symbol]);

  // Clear state when symbol changes
  useEffect(() => {
    // Reset all state for new symbol
    setOrderbook(null);
    setPrevOrderbook(null);
    setLoading(true);
    setError(null);
    setConnected(false);
    setIsStale(false);
    setLatencyMs(0);
    setWhaleOrders(new Set());
    setHeatmapData([]);
    setSpoofAlerts([]);
    setFlashingPrices(new Map());
    
    // Clear refs
    volumeHistoryRef.current = { bids: [], asks: [] };
    recentLiquidityRef.current = new Map();
    rollingAvgRef.current = { bid: 0, ask: 0 };
  }, [symbol]);

  // Clear live-mode detection state when entering replay mode
  useEffect(() => {
    if (isReplayMode) {
      setWhaleOrders(new Set());
      setSpoofAlerts([]);
      setFlashingPrices(new Map());
      setHeatmapData([]);
    }
  }, [isReplayMode]);

  // Sync playback speed with parent
  const currentPlaybackSpeed = onPlaybackSpeedChange ? playbackSpeed : localPlaybackSpeed;
  const setCurrentPlaybackSpeed = onPlaybackSpeedChange || setLocalPlaybackSpeed;

  // Connect to WebSocket for real-time updates
  useEffect(() => {
    if (!autoUpdate || isReplayMode) return;

    // Close any existing connection first - only if OPEN
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.close();
    }
    wsRef.current = null;

    // Split symbol into base/quote for URL (e.g., "XBT/USD" -> "XBT/USD")
    const [base, quote] = symbol.split('/');
    // Convert http(s) URL to ws(s) URL
    const wsProtocol = apiUrl.startsWith('https') ? 'wss' : 'ws';
    const wsHost = apiUrl.replace(/^https?:\/\//, '');
    const wsUrl = `${wsProtocol}://${wsHost}/ws/orderbook/${base}/${quote}`;
    const ws = new WebSocket(wsUrl);
    const expectedSymbol = symbol; // Capture for closure
    let intentionalClose = false; // Track if we closed intentionally

    ws.onopen = () => {
      console.log(`Connected to ${expectedSymbol} orderbook stream`);
      setConnected(true);
      setLoading(false);
      setError(null); // Clear any previous error
      setLastUpdateTime(Date.now());
    };

    ws.onmessage = (event) => {
      // Guard: drop message if symbol changed
      if (currentSymbolRef.current !== expectedSymbol) {
        return; // Silently drop - not an error
      }
      
      const receiveTime = Date.now();
      try {
        const message = JSON.parse(event.data);
        if (message.type === 'snapshot') {
          // Calculate latency
          if (message.data.timestamp) {
            const serverTime = new Date(message.data.timestamp).getTime();
            setLatencyMs(receiveTime - serverTime);
          }
          setLastUpdateTime(receiveTime);
          setIsStale(false);
          // Trigger mid price pulse
          setMidPriceUpdated(true);
          setTimeout(() => setMidPriceUpdated(false), 400);
          
          // Store previous orderbook for change detection
          setOrderbook((prev) => {
            setPrevOrderbook(prev);
            return message.data;
          });
        } else if (message.type === 'error') {
          setError(message.message);
        }
      } catch (err) {
        console.error('Failed to parse message:', err);
      }
    };

    ws.onerror = (err) => {
      // Only log/set error if not an intentional close and still on same symbol
      if (!intentionalClose && currentSymbolRef.current === expectedSymbol) {
        console.error('WebSocket error:', err);
        setError('WebSocket connection error');
        setConnected(false);
      }
    };

    ws.onclose = () => {
      // Only log and update state if not intentional and still on same symbol
      if (!intentionalClose && currentSymbolRef.current === expectedSymbol) {
        console.log(`WebSocket closed for ${expectedSymbol}`);
        setConnected(false);
      }
    };

    wsRef.current = ws;

    return () => {
      intentionalClose = true; // Mark as intentional before closing
      if (ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
    };
  }, [symbol, autoUpdate, isReplayMode]);

  // Trades WebSocket removed - endpoint not implemented on backend

  // Stale book detection
  useEffect(() => {
    if (!autoUpdate || isReplayMode) return;

    staleCheckRef.current = setInterval(() => {
      const timeSinceUpdate = Date.now() - lastUpdateTime;
      setIsStale(timeSinceUpdate > STALE_THRESHOLD_MS);
    }, 1000);

    return () => {
      if (staleCheckRef.current) {
        clearInterval(staleCheckRef.current);
      }
    };
  }, [autoUpdate, isReplayMode, lastUpdateTime]);

  // Detect large order changes, whale orders, and spoofing
  // Use a ref to track the last processed orderbook to avoid loops
  const lastProcessedRef = useRef(null);
  
  useEffect(() => {
    if (!orderbook || !prevOrderbook) return;
    
    // Skip detection in replay mode - these are live-mode features
    // Replay should show static historical snapshots
    if (isReplayMode) return;
    
    // Skip if we already processed this exact orderbook (prevent loops)
    if (lastProcessedRef.current === orderbook) return;
    lastProcessedRef.current = orderbook;

    const now = Date.now();

    const detectChanges = (current, previous, side) => {
      const currentMap = new Map(current.map((l) => [parseFloat(l.price), parseFloat(l.volume)]));
      const prevMap = new Map(previous.map((l) => [parseFloat(l.price), parseFloat(l.volume)]));
      
      // Calculate average size
      const allSizes = [...currentMap.values()];
      const avgSize = allSizes.length > 0 ? allSizes.reduce((a, b) => a + b, 0) / allSizes.length : 0;
      const threshold = avgSize * LARGE_ORDER_THRESHOLD;

      const changes = new Map();
      
      // Check for new or increased orders
      currentMap.forEach((vol, price) => {
        const prevVol = prevMap.get(price) || 0;
        const diff = vol - prevVol;
        if (diff > threshold) {
          changes.set(price, { type: 'added', side });
        }
      });

      // Check for removed or decreased orders
      prevMap.forEach((vol, price) => {
        const currVol = currentMap.get(price) || 0;
        const diff = vol - currVol;
        if (diff > threshold) {
          changes.set(price, { type: 'removed', side });
        }
      });

      return { changes, avgSize };
    };

    const bidResult = detectChanges(orderbook.bids || [], prevOrderbook.bids || [], 'bid');
    const askResult = detectChanges(orderbook.asks || [], prevOrderbook.asks || [], 'ask');
    
    const allChanges = new Map([...bidResult.changes, ...askResult.changes]);
    
    if (allChanges.size > 0) {
      setFlashingPrices(allChanges);
      setTimeout(() => setFlashingPrices(new Map()), 600);
    }

    // Update rolling average for whale detection
    const bidVolumes = (orderbook.bids || []).map((l) => parseFloat(l.volume));
    const askVolumes = (orderbook.asks || []).map((l) => parseFloat(l.volume));
    
    volumeHistoryRef.current.bids.push(...bidVolumes);
    volumeHistoryRef.current.asks.push(...askVolumes);
    
    // Keep last 100 samples
    if (volumeHistoryRef.current.bids.length > 100) {
      volumeHistoryRef.current.bids = volumeHistoryRef.current.bids.slice(-100);
    }
    if (volumeHistoryRef.current.asks.length > 100) {
      volumeHistoryRef.current.asks = volumeHistoryRef.current.asks.slice(-100);
    }

    const bidRollingAvg = volumeHistoryRef.current.bids.length > 0
      ? volumeHistoryRef.current.bids.reduce((a, b) => a + b, 0) / volumeHistoryRef.current.bids.length
      : 0;
    const askRollingAvg = volumeHistoryRef.current.asks.length > 0
      ? volumeHistoryRef.current.asks.reduce((a, b) => a + b, 0) / volumeHistoryRef.current.asks.length
      : 0;

    // Store rolling avg in ref (no re-render needed)
    rollingAvgRef.current = { bid: bidRollingAvg, ask: askRollingAvg };

    // Detect whale orders (5x rolling average)
    const newWhales = new Set();
    (orderbook.bids || []).forEach((l) => {
      const vol = parseFloat(l.volume);
      if (vol > bidRollingAvg * WHALE_THRESHOLD) {
        newWhales.add(parseFloat(l.price));
      }
    });
    (orderbook.asks || []).forEach((l) => {
      const vol = parseFloat(l.volume);
      if (vol > askRollingAvg * WHALE_THRESHOLD) {
        newWhales.add(parseFloat(l.price));
      }
    });
    setWhaleOrders(newWhales);

    // Track liquidity for spoof detection using ref (no state loop)
    const avgVol = (bidRollingAvg + askRollingAvg) / 2;
    const detectedSpoofs = [];
    const liquidityMap = recentLiquidityRef.current;
    
    [...(orderbook.bids || []), ...(orderbook.asks || [])].forEach((l) => {
      const price = parseFloat(l.price);
      const volume = parseFloat(l.volume);
      const history = liquidityMap.get(price) || [];
      history.push({ time: now, volume });
      const filtered = history.filter((h) => now - h.time < SPOOF_DETECTION_WINDOW);
      if (filtered.length > 0) {
        liquidityMap.set(price, filtered);
        
        if (filtered.length >= 2) {
          const maxVol = Math.max(...filtered.map((h) => h.volume));
          const minVol = Math.min(...filtered.map((h) => h.volume));
          if (maxVol > avgVol * 3 && minVol < avgVol * 0.5) {
            const timeDiff = filtered[filtered.length - 1].time - filtered[0].time;
            if (timeDiff < SPOOF_DETECTION_WINDOW) {
              detectedSpoofs.push({ price, maxVol, time: now });
            }
          }
        }
      } else {
        liquidityMap.delete(price);
      }
    });

    if (detectedSpoofs.length > 0) {
      setSpoofAlerts((prevAlerts) => [...detectedSpoofs, ...prevAlerts].slice(0, 10));
    }

    // Update heatmap data
    setHeatmapData((prev) => {
      const snapshot = {
        time: now,
        bids: (orderbook.bids || []).slice(0, 15).map((l) => ({
          price: parseFloat(l.price),
          volume: parseFloat(l.volume),
        })),
        asks: (orderbook.asks || []).slice(0, 15).map((l) => ({
          price: parseFloat(l.price),
          volume: parseFloat(l.volume),
        })),
      };
      return [...prev, snapshot].slice(-HEATMAP_HISTORY_SIZE);
    });
  }, [orderbook, prevOrderbook, isReplayMode]);

  // Load historical data for replay - optimized for performance
  const MAX_SNAPSHOTS = 300; // Cap snapshots for smooth playback
  
  useEffect(() => {
    if (!isReplayMode) return;

    const from = startTime || new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const to = endTime || new Date().toISOString();

    // Reset state before loading
    setLoading(true);
    setIsPlaying(false);
    setHistoryIndex(0);
    setHistory([]);
    setOrderbook(null);
    setError(null);
    
    const [histBase, histQuote] = symbol.split('/');
    const controller = new AbortController();
    
    fetch(`${apiUrl}/api/orderbook/${histBase}/${histQuote}/history?from=${from}&to=${to}`, {
      signal: controller.signal,
    })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => {
        if (Array.isArray(data)) {
          // Downsample if too many snapshots for smooth playback
          let processedData = data;
          if (data.length > MAX_SNAPSHOTS) {
            const step = Math.ceil(data.length / MAX_SNAPSHOTS);
            processedData = data.filter((_, idx) => idx % step === 0);
            console.log(`Downsampled ${data.length} snapshots to ${processedData.length} for smooth playback`);
          }
          
          setHistory(processedData);
          if (processedData.length > 0) {
            setOrderbook(processedData[0]);
            setCurrentTime(new Date(processedData[0].timestamp));
          }
        }
        setLoading(false);
      })
      .catch((err) => {
        if (err.name === 'AbortError') return; // Ignore aborted requests
        console.error('Failed to load history:', err);
        setError('Failed to load historical data');
        setLoading(false);
      });
      
    return () => controller.abort(); // Cancel on unmount/re-run
  }, [symbol, isReplayMode, startTime, endTime, apiUrl]);

  // Replay playback
  useEffect(() => {
    if (!isPlaying || !isReplayMode || history.length === 0) {
      if (playbackTimerRef.current) {
        clearInterval(playbackTimerRef.current);
      }
      return;
    }

    playbackTimerRef.current = setInterval(() => {
      setHistoryIndex((prev) => {
        const next = prev + 1;
        if (next >= history.length) {
          setIsPlaying(false);
          return prev;
        }
        setOrderbook(history[next]);
        setCurrentTime(new Date(history[next].timestamp));
        return next;
      });
    }, 1000 / currentPlaybackSpeed);

    return () => {
      if (playbackTimerRef.current) {
        clearInterval(playbackTimerRef.current);
      }
    };
  }, [isPlaying, isReplayMode, history, currentPlaybackSpeed]);

  // Aggregate orders by tick size
  const aggregateByTickSize = (orders, tickSize, isBid) => {
    const aggregated = new Map();
    
    orders.forEach((level) => {
      const price = parseFloat(level.price);
      const volume = parseFloat(level.volume);
      // Round to tick size
      const roundedPrice = isBid
        ? Math.floor(price / tickSize) * tickSize
        : Math.ceil(price / tickSize) * tickSize;
      
      if (aggregated.has(roundedPrice)) {
        aggregated.set(roundedPrice, aggregated.get(roundedPrice) + volume);
      } else {
        aggregated.set(roundedPrice, volume);
      }
    });

    return Array.from(aggregated.entries())
      .map(([price, volume]) => ({ price, volume, total: 0 }))
      .sort((a, b) => isBid ? b.price - a.price : a.price - b.price);
  };

  // Format orderbook data for visualization
  const formatOrderbookData = () => {
    if (!orderbook) return { bids: [], asks: [], maxTotal: 0 };

    // Calculate mid price for depth range filtering
    const rawBids = orderbook.bids || [];
    const rawAsks = orderbook.asks || [];
    const bestBidPrice = rawBids.length > 0 ? parseFloat(rawBids[0].price) : 0;
    const bestAskPrice = rawAsks.length > 0 ? parseFloat(rawAsks[0].price) : 0;
    const midPriceCalc = (bestBidPrice + bestAskPrice) / 2;

    // Filter by depth range (percent from mid-price)
    const filterByRange = (orders, isBid) => {
      if (depthRangePercent >= 20) return orders; // No filter for 20%+
      const rangeLimit = midPriceCalc * (depthRangePercent / 100);
      return orders.filter((l) => {
        const price = parseFloat(l.price);
        const diff = Math.abs(price - midPriceCalc);
        return diff <= rangeLimit;
      });
    };

    const filteredBids = filterByRange(rawBids, true);
    const filteredAsks = filterByRange(rawAsks, false);

    // Aggregate by tick size
    let bids = aggregateByTickSize(filteredBids, tickSize, true).slice(0, depth);
    let asks = aggregateByTickSize(filteredAsks, tickSize, false).slice(0, depth);

    // Reverse bids for display (highest first becomes lowest in array for chart)
    bids = bids.reverse();

    // Calculate cumulative volumes
    let cumBid = 0;
    bids.forEach((bid) => {
      cumBid += bid.volume;
      bid.total = cumBid;
    });

    let cumAsk = 0;
    asks.forEach((ask) => {
      cumAsk += ask.volume;
      ask.total = cumAsk;
    });

    // Calculate max total for depth bar scaling
    const maxTotal = Math.max(
      bids.length > 0 ? bids[bids.length - 1].total : 0,
      asks.length > 0 ? asks[asks.length - 1].total : 0
    );

    return { bids, asks, maxTotal };
  };

  const { bids, asks, maxTotal } = formatOrderbookData();
  const bestBid = bids.length > 0 ? bids[bids.length - 1].price : null;
  const bestAsk = asks.length > 0 ? asks[0].price : null;
  
  // Get decimals for current symbol
  const priceDecimals = getPriceDecimals(symbol);
  const formatPrice = (price) => price.toFixed(priceDecimals);

  const spread = bestAsk && bestBid
    ? formatPrice(bestAsk - bestBid)
    : 'N/A';

  const midPrice = bestAsk && bestBid
    ? formatPrice((bestAsk + bestBid) / 2)
    : 'N/A';

  // Calculate liquidity imbalance
  const calculateImbalance = () => {
    if (!orderbook) return { ratio: 0.5, bidTotal: 0, askTotal: 0 };
    
    const bidLevels = (orderbook.bids || []).slice(0, imbalanceDepth);
    const askLevels = (orderbook.asks || []).slice(0, imbalanceDepth);
    
    const bidTotal = bidLevels.reduce((sum, l) => sum + parseFloat(l.volume), 0);
    const askTotal = askLevels.reduce((sum, l) => sum + parseFloat(l.volume), 0);
    const total = bidTotal + askTotal;
    
    return {
      ratio: total > 0 ? bidTotal / total : 0.5,
      bidTotal,
      askTotal,
    };
  };

  const imbalance = calculateImbalance();

  // Get flash class for a price level
  const getFlashClass = (price) => {
    const flash = flashingPrices.get(price);
    if (!flash) return '';
    return flash.type === 'added' ? 'flash-added' : 'flash-removed';
  };



  // Check if price level is a whale order
  const isWhaleOrder = (price) => whaleOrders.has(price);

  // Get heatmap intensity for a price level (0-1)
  const getHeatmapIntensity = (price) => {
    if (heatmapData.length === 0) return 0;
    
    let totalPresence = 0;
    
    heatmapData.forEach((snapshot) => {
      const allLevels = [...snapshot.bids, ...snapshot.asks];
      const level = allLevels.find((l) => Math.abs(l.price - price) < tickSize);
      if (level) {
        totalPresence++;
      }
    });

    // Persistence score (how often this price appears)
    const persistence = totalPresence / heatmapData.length;
    return persistence;
  };

  // Check if price level has spoof alert
  const hasSpoofAlert = (price) => {
    return spoofAlerts.some((alert) => Math.abs(alert.price - price) < tickSize);
  };

  // Calculate max volume across both sides for normalized bars
  const maxVolume = Math.max(
    ...bids.map((b) => b.volume),
    ...asks.map((a) => a.volume),
    0.001 // Prevent division by zero
  );

  // Threshold for "tiny" volumes (bottom 8% of max)
  const tinyThreshold = maxVolume * 0.08;

  // Smart volume formatting - reduce noise for tiny values
  const formatVolume = (vol, isTiny = false) => {
    if (isTiny) return '·'; // Dot for tiny volumes
    if (vol >= 100) return vol.toFixed(1);
    if (vol >= 10) return vol.toFixed(2);
    if (vol >= 1) return vol.toFixed(3);
    return vol.toFixed(4);
  };

  // Check if volume is tiny
  const isTinyVolume = (vol) => vol < tinyThreshold;

  // Replay controls
  const handlePlayPause = () => setIsPlaying(!isPlaying);

  const handleSeek = (e) => {
    const index = parseInt(e.target.value);
    setHistoryIndex(index);
    if (history[index]) {
      setOrderbook(history[index]);
      setCurrentTime(new Date(history[index].timestamp));
    }
  };

  // Jump back 10 seconds
  const handleJumpBack = () => {
    if (history.length === 0 || !currentTime) return;
    const targetTime = currentTime.getTime() - 10000; // 10 seconds back
    let newIndex = historyIndex;
    for (let i = historyIndex - 1; i >= 0; i--) {
      const snapTime = new Date(history[i].timestamp).getTime();
      if (snapTime <= targetTime) {
        newIndex = i;
        break;
      }
      newIndex = i; // Keep going back
    }
    if (newIndex !== historyIndex) {
      setHistoryIndex(newIndex);
      setOrderbook(history[newIndex]);
      setCurrentTime(new Date(history[newIndex].timestamp));
    }
  };

  // Jump forward 10 seconds
  const handleJumpForward = () => {
    if (history.length === 0 || !currentTime) return;
    const targetTime = currentTime.getTime() + 10000; // 10 seconds forward
    let newIndex = historyIndex;
    for (let i = historyIndex + 1; i < history.length; i++) {
      const snapTime = new Date(history[i].timestamp).getTime();
      newIndex = i;
      if (snapTime >= targetTime) {
        break;
      }
    }
    if (newIndex !== historyIndex) {
      setHistoryIndex(newIndex);
      setOrderbook(history[newIndex]);
      setCurrentTime(new Date(history[newIndex].timestamp));
    }
  };

  const handleSpeedChange = (speed) => {
    setCurrentPlaybackSpeed(speed);
  };

  // Non-replay loading/error states - return early
  if (!isReplayMode && loading) {
    return <div className={`orderbook-container ${theme}`}>Loading...</div>;
  }

  if (!isReplayMode && error) {
    return <div className={`orderbook-container ${theme}`}>Error: {error}</div>;
  }

  return (
    <div className={`orderbook-container ${theme}`}>
      {/* Header - Compact */}
      <div className="orderbook-header">
        <h2>{symbol}</h2>
        <div className="orderbook-stats">
          {/* Status Badge */}
          <div className="stat">
            {loading ? (
              <span className="status-badge loading">
                <span className="loading-spinner" />
                Loading
              </span>
            ) : isReplayMode ? (
              <span className="status-badge replaying">
                <span className="replay-icon">⏪</span>
                Replaying
              </span>
            ) : (
              <span className={`status-badge ${connected ? (isStale ? 'stale' : 'live') : 'offline'}`}>
                {connected ? (isStale ? '⚠ Stale' : '● LIVE') : 'Offline'}
              </span>
            )}
          </div>
          
          <div className="stat">
            <span className="label">Mid</span>
            <span className={`value mid-price ${midPriceUpdated ? 'updated' : ''}`}>${midPrice}</span>
          </div>
          <div className="stat">
            <span className="label">Sprd</span>
            <span className="value">${spread}</span>
          </div>
          
          {/* Latency - only show in live mode, hidden in replay */}
          {!isReplayMode && connected && (
            <div className="stat latency-stat">
              <span className={`value latency ${latencyMs > 1000 ? 'high' : latencyMs > 500 ? 'medium' : 'low'}`}>
                {latencyMs}ms
              </span>
            </div>
          )}
          
          {/* Current replay time */}
          {isReplayMode && currentTime && (
            <div className="stat">
              <span className="label">Time</span>
              <span className="value replay-time">{format(currentTime, 'HH:mm:ss')}</span>
            </div>
          )}
        </div>
      </div>

      {/* Stale Warning */}
      {isStale && connected && (
        <div className="market-pause-banner">
          ⚠ Stale ({Math.floor((Date.now() - lastUpdateTime) / 1000)}s)
        </div>
      )}

      {/* Replay Controls - Show even during loading */}
      {isReplayMode && (
        <div className="replay-controls">
          <div className="replay-buttons">
            <button 
              onClick={handleJumpBack} 
              disabled={historyIndex === 0 || loading}
              className="replay-btn jump-btn"
              title="Jump back 10 seconds"
            >
              -10s
            </button>
            
            <button 
              onClick={handlePlayPause} 
              disabled={loading || history.length === 0}
              className={`replay-btn play-pause-btn ${isPlaying ? 'playing' : ''}`}
              title={isPlaying ? 'Pause' : 'Play'}
            >
              {isPlaying ? '⏸' : '▶'}
            </button>
            
            <button 
              onClick={handleJumpForward} 
              disabled={historyIndex >= history.length - 1 || loading}
              className="replay-btn jump-btn"
              title="Jump forward 10 seconds"
            >
              +10s
            </button>
          </div>
          
          <div className="replay-timeline">
            <input 
              type="range" 
              min="0" 
              max={Math.max(history.length - 1, 0)} 
              value={historyIndex} 
              onChange={handleSeek} 
              className="timeline-slider"
              disabled={loading || history.length === 0}
            />
            <div className="timeline-info">
              <span className="timeline-position">
                {loading ? 'Loading...' : `${historyIndex + 1} / ${history.length}`}
              </span>
            </div>
          </div>
          
          <div className="replay-speed">
            <span className="speed-label">Speed:</span>
            <div className="speed-buttons">
              {PLAYBACK_SPEEDS.map((speed) => (
                <button
                  key={speed}
                  onClick={() => handleSpeedChange(speed)}
                  className={`speed-btn ${currentPlaybackSpeed === speed ? 'active' : ''}`}
                >
                  {speed}x
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
      
      {/* Replay loading state - stable placeholder */}
      {isReplayMode && loading && (
        <div className="replay-loading">
          <span className="loading-spinner" />
          Loading historical data...
        </div>
      )}
      
      {/* Placeholder for candlestick strip during replay loading */}
      {isReplayMode && loading && (
        <div className="mini-candlestick-placeholder" />
      )}
      
      {/* Replay error state */}
      {isReplayMode && error && (
        <div className="replay-empty" style={{ color: 'var(--ask-color)' }}>
          Error: {error}
        </div>
      )}
      
      {/* Replay empty state */}
      {isReplayMode && !loading && !error && history.length === 0 && (
        <div className="replay-empty">
          No historical data available for the selected time range.
        </div>
      )}

      {/* Mini Candlestick Strip - Only in Replay mode for historical context */}
      {isReplayMode && !loading && history.length > 0 && (
        <MiniCandlestickStrip
          symbol={symbol}
          replayTime={currentTime}
          theme={theme}
        />
      )}

      {/* Controls Section - Visually Separated (hide during replay loading) */}
      {(!isReplayMode || (!loading && history.length > 0)) && (
      <div className="controls-section">
        {/* Imbalance Bar - Compact */}
        <div className="imbalance-indicator">
          <div className="imbalance-header">
            <span className="imbalance-title">
              Imbalance
              <span className="info-tooltip" title="Imbalance = Σ bid volume ÷ (Σ bid + Σ ask) within selected depth. &gt;50% = bid heavy, &lt;50% = ask heavy">ⓘ</span>
            </span>
            <div className="imbalance-depth-selector">
              {IMBALANCE_DEPTHS.map((d) => (
                <button key={d} className={`depth-btn ${imbalanceDepth === d ? 'active' : ''}`} onClick={() => setImbalanceDepth(d)}>{d}</button>
              ))}
            </div>
          </div>
          <div className="imbalance-bar-container">
            <span className="imbalance-label bid-label">{imbalance.bidTotal.toFixed(1)}</span>
            <div className="imbalance-bar">
              <div className="imbalance-fill bid-fill" style={{ width: `${imbalance.ratio * 100}%` }} />
              <div className="imbalance-fill ask-fill" style={{ width: `${(1 - imbalance.ratio) * 100}%` }} />
            </div>
            <span className="imbalance-label ask-label">{imbalance.askTotal.toFixed(1)}</span>
          </div>
        </div>

        {/* Alerts - Compact */}
        {(whaleOrders.size > 0 || spoofAlerts.length > 0) && (
          <div className="alerts-panel">
            {whaleOrders.size > 0 && (
              <div className="whale-alert">
                🐋 {whaleOrders.size} whale
                <span className="info-tooltip" title="Whale = order size &gt; 5× rolling average volume. Large player activity.">ⓘ</span>
              </div>
            )}
            {spoofAlerts.length > 0 && (
              <div className="spoof-alert">
                ⚠ {spoofAlerts.length} spoof
                <span className="info-tooltip" title={`Spoof Detection: Order > 3× avg size appeared then removed within ${SPOOF_DETECTION_WINDOW/1000}s. May indicate manipulation.`}>ⓘ</span>
              </div>
            )}
          </div>
        )}

        {/* Controls - Single Row */}
        <div className="grouping-controls">
          <span className="grouping-label">Tick</span>
          {TICK_SIZES.map((size) => (
            <button key={size} className={`tick-btn ${tickSize === size ? 'active' : ''}`} onClick={() => setTickSize(size)}>{size}</button>
          ))}
          <span className="grouping-label">Range</span>
          {DEPTH_RANGES.map((pct) => (
            <button key={pct} className={`tick-btn ${depthRangePercent === pct ? 'active' : ''}`} onClick={() => setDepthRangePercent(pct)}>{pct}%</button>
          ))}
        </div>
      </div>
      )}

      {/* Charts hidden for compact view */}
      <div className="orderbook-content" style={{display: 'none'}}>
        {/* Asks (Sell Orders) */}
        <div className="orderbook-side asks-side">
          <h3>Asks (Sell)</h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={asks} layout="vertical" margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis type="number" />
              <YAxis type="category" dataKey="price" tickFormatter={(val) => formatPrice(val)} />
              <Tooltip
                formatter={(value, name) => [
                  name === 'volume' ? value.toFixed(4) : formatPrice(value),
                  name === 'volume' ? 'Volume' : 'Cumulative',
                ]}
                labelFormatter={(price) => `Price: $${formatPrice(price)}`}
              />
              <Bar dataKey="volume" stackId="a">
                {asks.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill="#e74c3c" opacity={0.7} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Spread Indicator */}
        <div className="spread-indicator">
          <div className="spread-label">Spread</div>
          <div className="spread-value">${spread}</div>
        </div>

        {/* Bids (Buy Orders) */}
        <div className="orderbook-side bids-side">
          <h3>Bids (Buy)</h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={bids} layout="vertical" margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis type="number" />
              <YAxis type="category" dataKey="price" tickFormatter={(val) => formatPrice(val)} />
              <Tooltip
                formatter={(value, name) => [
                  name === 'volume' ? value.toFixed(4) : formatPrice(value),
                  name === 'volume' ? 'Volume' : 'Cumulative',
                ]}
                labelFormatter={(price) => `Price: $${formatPrice(price)}`}
              />
              <Bar dataKey="volume" stackId="a">
                {bids.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill="#27ae60" opacity={0.7} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Depth Table */}
      <div className={`orderbook-table ${isStale ? 'stale' : ''}`}>
        <div className="table-section">
          <h4>Bids</h4>
          <table>
            <thead>
              <tr>
                <th>Price</th>
                <th>Size</th>
                <th>Sum</th>
              </tr>
            </thead>
            <tbody>
              {bids.slice().reverse().slice(0, 10).map((bid, idx, arr) => {
                const isBest = idx === arr.length - 1;
                const depthPercent = maxTotal > 0 ? (bid.total / maxTotal) * 100 : 0;
                const flashClass = getFlashClass(bid.price);
                const isWhale = isWhaleOrder(bid.price);
                const isSpoof = hasSpoofAlert(bid.price);
                const heatIntensity = getHeatmapIntensity(bid.price);
                return (
                  <tr 
                    key={idx} 
                    className={`bid-row ${isBest ? 'best-bid' : ''} ${flashClass} ${isWhale ? 'whale-row' : ''} ${isSpoof ? 'spoof-row' : ''}`}
                    style={{ 
                      '--depth-percent': `${depthPercent}%`,
                      '--heat-intensity': heatIntensity,
                    }}
                  >
                    <td className="price">
                      {isWhale && <span className="whale-icon" title={`Whale: Size ${formatVolume(bid.volume)} > 5× rolling avg`}>🐋</span>}
                      {isSpoof && <span className="spoof-icon" title={`Spoof: Large order added then removed within ${SPOOF_DETECTION_WINDOW/1000}s`}>⚠️</span>}
                      ${formatPrice(bid.price)}
                      {isBest && <span className="best-label bid">BEST BID</span>}
                    </td>
                    <td className={`volume-cell ${isTinyVolume(bid.volume) ? 'tiny-volume' : ''}`}>
                      {formatVolume(bid.volume, isTinyVolume(bid.volume))}
                    </td>
                    <td className={isTinyVolume(bid.volume) ? 'tiny-volume' : ''}>
                      {formatVolume(bid.total, isTinyVolume(bid.total))}
                      {heatIntensity > 0.5 && <span className="heat-indicator" title={`Sticky liquidity: Present in ${(heatIntensity * 100).toFixed(0)}% of recent snapshots. Likely real resting order, not fleeting.`}>🔥</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="table-section">
          <h4>Asks</h4>
          <table>
            <thead>
              <tr>
                <th>Price</th>
                <th>Size</th>
                <th>Sum</th>
              </tr>
            </thead>
            <tbody>
              {asks.slice(0, 10).map((ask, idx) => {
                const isBest = idx === 0;
                const depthPercent = maxTotal > 0 ? (ask.total / maxTotal) * 100 : 0;
                const flashClass = getFlashClass(ask.price);
                const isWhale = isWhaleOrder(ask.price);
                const isSpoof = hasSpoofAlert(ask.price);
                const heatIntensity = getHeatmapIntensity(ask.price);
                return (
                  <tr 
                    key={idx} 
                    className={`ask-row ${isBest ? 'best-ask' : ''} ${flashClass} ${isWhale ? 'whale-row' : ''} ${isSpoof ? 'spoof-row' : ''}`}
                    style={{ 
                      '--depth-percent': `${depthPercent}%`,
                      '--heat-intensity': heatIntensity,
                    }}
                  >
                    <td className="price">
                      {isWhale && <span className="whale-icon" title={`Whale: Size ${formatVolume(ask.volume)} > 5× rolling avg`}>🐋</span>}
                      {isSpoof && <span className="spoof-icon" title={`Spoof: Large order added then removed within ${SPOOF_DETECTION_WINDOW/1000}s`}>⚠️</span>}
                      ${formatPrice(ask.price)}
                      {isBest && <span className="best-label ask">BEST ASK</span>}
                    </td>
                    <td className={`volume-cell ${isTinyVolume(ask.volume) ? 'tiny-volume' : ''}`}>
                      {formatVolume(ask.volume, isTinyVolume(ask.volume))}
                    </td>
                    <td className={isTinyVolume(ask.volume) ? 'tiny-volume' : ''}>
                      {formatVolume(ask.total, isTinyVolume(ask.total))}
                      {heatIntensity > 0.5 && <span className="heat-indicator" title={`Sticky liquidity: Present in ${(heatIntensity * 100).toFixed(0)}% of recent snapshots. Likely real resting order, not fleeting.`}>🔥</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default OrderbookVisualizer;
