#!/bin/bash

# Orderbook Visualizer - Quick Start Script

set -e

echo "🦑 Kraken Orderbook Visualizer - Quick Start"
echo "============================================="
echo ""

# Check if we're in the right directory
if [ ! -d "backend" ] || [ ! -d "frontend" ]; then
    echo "❌ Error: Please run this script from the orderbook-visualizer directory"
    exit 1
fi

# Function to check if a command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Check for required tools
echo "🔍 Checking dependencies..."

if ! command_exists cargo; then
    echo "❌ Cargo not found. Please install Rust: https://rustup.rs/"
    exit 1
fi

if ! command_exists node; then
    echo "❌ Node.js not found. Please install Node.js: https://nodejs.org/"
    exit 1
fi

if ! command_exists npm; then
    echo "❌ npm not found. Please install npm"
    exit 1
fi

echo "✅ All dependencies found"
echo ""

# Build and start backend
echo "🔧 Building backend..."
cd backend
cargo build --release

echo ""
echo "🚀 Starting backend server..."
cargo run --release &
BACKEND_PID=$!

# Wait for backend to start
echo "⏳ Waiting for backend to initialize..."
sleep 3

cd ..

# Setup and start frontend
echo ""
echo "📦 Installing frontend dependencies..."
cd frontend

if [ ! -d "node_modules" ]; then
    npm install
fi

echo ""
echo "🎨 Starting frontend..."
npm start &
FRONTEND_PID=$!

cd ..

echo ""
echo "✅ Orderbook Visualizer is starting!"
echo ""
echo "📊 Backend API: http://localhost:3033"
echo "🌐 Frontend UI: http://localhost:3000"
echo ""
echo "Press Ctrl+C to stop all services"
echo ""

# Trap SIGINT and SIGTERM to clean up child processes
trap 'echo ""; echo "🛑 Stopping services..."; kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit' INT TERM

# Wait for processes
wait
