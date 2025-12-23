import React, { useEffect, useRef, useState, useCallback } from 'react';
import { createChart } from 'lightweight-charts';
import './MiniCandlestickStrip.css';

// Kraken symbol mapping (orderbook symbol -> Kraken REST API pair)
const KRAKEN_PAIRS = {
  'XBT/USD': 'XXBTZUSD',
  'ETH/USD': 'XETHZUSD',
  'SOL/USD': 'SOLUSD',
};

// Available timeframes (minutes)
const TIMEFRAMES = [
  { label: '1m', value: 1 },
  { label: '5m', value: 5 },
];

/**
 * Minimal candlestick strip - provides price context in Replay mode only
 * 
 * Design rules:
 * - Very small height (60px)
 * - No indicators, drawing tools, RSI, MACD, volume
 * - 1m or 5m timeframe only
 * - Syncs with selected symbol and replay time
 * - Replay mode only - live mode stays book-focused
 * 
 * Data source: Kraken OHLC REST endpoint (decoupled from orderbook logic)
 */
const MiniCandlestickStrip = ({ 
  symbol = 'XBT/USD',
  replayTime, // ISO string or Date - required for replay context
  theme = 'dark',
}) => {
  const containerRef = useRef(null);
  const chartRef = useRef(null);
  const seriesRef = useRef(null);
  
  const [timeframe, setTimeframe] = useState(1); // Default 1m
  const [candles, setCandles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  
  // Map symbol to Kraken pair
  const krakenPair = KRAKEN_PAIRS[symbol] || symbol.replace('/', '');

  // Fetch OHLC data from Kraken public REST API (decoupled from orderbook logic)
  const fetchCandles = useCallback(async () => {
    if (!replayTime) return; // Requires replay time
    
    setLoading(true);
    setError(null);
    
    try {
      // Kraken OHLC endpoint - interval: 1, 5, 15, 30, 60, 240, 1440, 10080, 21600
      const interval = timeframe;
      const replayDate = replayTime instanceof Date ? replayTime : new Date(replayTime);
      
      // Get candles from 2 hours before replay time for context
      const sinceTime = Math.floor((replayDate.getTime() - 2 * 60 * 60 * 1000) / 1000);
      const url = `https://api.kraken.com/0/public/OHLC?pair=${krakenPair}&interval=${interval}&since=${sinceTime}`;
      
      const response = await fetch(url);
      const data = await response.json();
      
      if (data.error && data.error.length > 0) {
        throw new Error(data.error[0]);
      }
      
      // Get result data (key varies by pair)
      const resultKey = Object.keys(data.result).find(k => k !== 'last');
      const ohlcData = data.result[resultKey] || [];
      
      // Transform to lightweight-charts format
      // Kraken returns: [time, open, high, low, close, vwap, volume, count]
      const formattedCandles = ohlcData.map(candle => ({
        time: candle[0], // Unix timestamp
        open: parseFloat(candle[1]),
        high: parseFloat(candle[2]),
        low: parseFloat(candle[3]),
        close: parseFloat(candle[4]),
      }));
      
      // Filter to only show candles up to replay time
      const replayUnix = Math.floor(replayDate.getTime() / 1000);
      const filteredCandles = formattedCandles.filter(c => c.time <= replayUnix);
      
      // Take last 60 candles for the strip
      const displayCandles = filteredCandles.slice(-60);
      
      setCandles(displayCandles);
      setLoading(false);
    } catch (err) {
      console.error('Failed to fetch OHLC:', err);
      setError(err.message);
      setLoading(false);
    }
  }, [krakenPair, timeframe, replayTime]);

  // Fetch candles on mount and when dependencies change (replay mode only)
  useEffect(() => {
    fetchCandles();
  }, [fetchCandles]);

  // Initialize chart
  useEffect(() => {
    if (!containerRef.current) return;
    
    // Clear previous chart
    if (chartRef.current) {
      chartRef.current.remove();
      chartRef.current = null;
      seriesRef.current = null;
    }
    
    const isDark = theme === 'dark';
    
    const chart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height: 60,
      layout: {
        background: { type: 'solid', color: 'transparent' },
        textColor: isDark ? '#6e7681' : '#656d76',
        fontSize: 9,
      },
      grid: {
        vertLines: { visible: false },
        horzLines: { visible: false },
      },
      crosshair: {
        mode: 0, // No crosshair
        vertLine: { visible: false },
        horzLine: { visible: false },
      },
      rightPriceScale: {
        visible: false,
      },
      leftPriceScale: {
        visible: false,
      },
      timeScale: {
        visible: false,
        borderVisible: false,
      },
      handleScroll: false,
      handleScale: false,
    });
    
    const series = chart.addCandlestickSeries({
      upColor: '#3fb950',
      downColor: '#f85149',
      borderUpColor: '#3fb950',
      borderDownColor: '#f85149',
      wickUpColor: '#3fb950',
      wickDownColor: '#f85149',
    });
    
    chartRef.current = chart;
    seriesRef.current = series;
    
    // Handle resize
    const handleResize = () => {
      if (chartRef.current && containerRef.current) {
        chartRef.current.applyOptions({ width: containerRef.current.clientWidth });
      }
    };
    
    window.addEventListener('resize', handleResize);
    
    return () => {
      window.removeEventListener('resize', handleResize);
      if (chartRef.current) {
        chartRef.current.remove();
        chartRef.current = null;
        seriesRef.current = null;
      }
    };
  }, [theme]);

  // Update chart data
  useEffect(() => {
    if (seriesRef.current && candles.length > 0) {
      seriesRef.current.setData(candles);
      
      // Auto-fit to show all data
      if (chartRef.current) {
        chartRef.current.timeScale().fitContent();
      }
    }
  }, [candles]);

  // Calculate price change
  const priceChange = candles.length >= 2 
    ? candles[candles.length - 1].close - candles[0].close 
    : 0;
  const priceChangePercent = candles.length >= 2 && candles[0].close !== 0
    ? ((priceChange / candles[0].close) * 100).toFixed(2)
    : '0.00';
  const isPositive = priceChange >= 0;

  return (
    <div className={`mini-candlestick-strip ${theme}`}>
      <div className="strip-header">
        <div className="strip-timeframe">
          {TIMEFRAMES.map(tf => (
            <button
              key={tf.value}
              className={`tf-btn ${timeframe === tf.value ? 'active' : ''}`}
              onClick={() => setTimeframe(tf.value)}
            >
              {tf.label}
            </button>
          ))}
        </div>
        <div className={`strip-change ${isPositive ? 'positive' : 'negative'}`}>
          {isPositive ? '+' : ''}{priceChangePercent}%
        </div>
      </div>
      
      <div className="strip-chart" ref={containerRef}>
        {loading && <div className="strip-loading">·</div>}
        {error && <div className="strip-error">!</div>}
      </div>
    </div>
  );
};

export default MiniCandlestickStrip;

