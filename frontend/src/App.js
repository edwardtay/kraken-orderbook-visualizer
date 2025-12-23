import React, { useState } from 'react';
import OrderbookVisualizer from './components/OrderbookVisualizer';
import './App.css';

function App() {
  const [symbol, setSymbol] = useState('XBT/USD');
  const [mode, setMode] = useState('live'); // 'live' or 'replay'
  const [depth, setDepth] = useState(20);

  // Replay settings
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [playbackSpeed, setPlaybackSpeed] = useState(1.0);

  // Kraken uses XBT for Bitcoin
  const symbols = ['XBT/USD', 'ETH/USD', 'SOL/USD'];

  return (
    <div className="App">
      <header className="App-header">
        <h1>Kraken Orderbook Visualizer</h1>
        <p>Real-time and historical orderbook visualization with replay</p>
      </header>

      <div className="controls-panel">
        <div className="control-group">
          <label>Symbol:</label>
          <select value={symbol} onChange={(e) => setSymbol(e.target.value)}>
            {symbols.map((sym) => (
              <option key={sym} value={sym}>
                {sym}
              </option>
            ))}
          </select>
        </div>

        <div className="control-group">
          <label>Mode:</label>
          <select value={mode} onChange={(e) => setMode(e.target.value)}>
            <option value="live">Live</option>
            <option value="replay">Replay</option>
          </select>
        </div>

        <div className="control-group">
          <label>Depth:</label>
          <input
            type="number"
            value={depth}
            onChange={(e) => setDepth(parseInt(e.target.value))}
            min="5"
            max="50"
          />
        </div>

        {mode === 'replay' && (
          <>
            <div className="control-group">
              <label>Start Time:</label>
              <input
                type="datetime-local"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
              />
            </div>

            <div className="control-group">
              <label>End Time:</label>
              <input
                type="datetime-local"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
              />
            </div>
          </>
        )}
      </div>

      <main className="visualizer-container">
        <OrderbookVisualizer
          symbol={symbol}
          depth={depth}
          autoUpdate={mode === 'live'}
          replay={mode === 'replay'}
          startTime={startTime ? new Date(startTime).toISOString() : null}
          endTime={endTime ? new Date(endTime).toISOString() : null}
          playbackSpeed={playbackSpeed}
          onPlaybackSpeedChange={setPlaybackSpeed}
          theme="dark"
        />
      </main>

      <footer className="App-footer">
        <p>
          Built with{' '}
          <a href="https://crates.io/crates/kraken-ws-sdk" target="_blank" rel="noopener noreferrer">
            kraken-ws-sdk
          </a>
        </p>
        <p>Data provided by Kraken Exchange</p>
      </footer>
    </div>
  );
}

export default App;
