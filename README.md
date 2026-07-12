# Antigravity Stock Screener Dashboard

An advanced stock screening and charting dashboard built with **FastAPI** (Python) and **React** (TypeScript/Vite). This application is designed to identify high-probability trading setups by scanning watchlists or the entire US stock market for Stage 2 uptrends using three powerful technical analysis strategies.

---

## 🚀 Key Features & Screening Strategies

### 1. MA20 Pullback Strategy
* **Concept**: Finds stocks in an established uptrend that are pulling back to find support near their 20-day Simple Moving Average (SMA).
* **Filters**: Customizable SMA proximity tolerance (e.g., within 0.5% of SMA20) and minimum pullback duration. Optional long-term trend filter (price above SMA50/SMA200).

### 2. Minervini VCP (Volatility Contraction Pattern)
* **Concept**: Identifies progressive tightening patterns (contractions or "T's") as described by Mark Minervini.
* **Filters**: Computes 1T to 4T contractions, validates Stage 2 uptrend template rules, enforces final contraction tightness bounds (e.g., <8%), and verifies volume dry-up (below average trading volume during contractions).

### 3. Guppy Multiple Moving Average (GMMA)
* **Concept**: Uses two groups of Exponential Moving Averages (EMAs) to understand the behavior of short-term traders vs. long-term investors.
  * **Short-Term (Traders)**: 3, 5, 8, 10, 12, and 15 EMAs.
  * **Long-Term (Investors)**: 30, 35, 40, 45, 50, and 60 EMAs.
* **Filters**: Detects bullish alignments (short-term group completely above long-term group) and recent crossover signals within a configurable lookback window.

### 4. Interactive Charts & Watchlist Manager
* Built with TradingView's **Lightweight Charts** for high-performance rendering.
* Displays VCP contraction markers directly on the price chart.
* Dedicated **Watchlist Manager** allows users to organize custom sectors (e.g., Semiconductors, Space, Biotech) with unique emoji representations.

---

## 🛠️ Technology Stack

* **Backend**: FastAPI (Python), `yfinance` (Yahoo Finance market data client), `uvicorn`.
* **Frontend**: React 19, TypeScript, Vite, Tailwind CSS / Vanilla CSS, `lightweight-charts`.
* **Data Layer**: Local JSON file storage with integrated Google Cloud Storage (GCS) support for cloud-backed deployments. Includes 4-year daily price history cache.

---

## ⚙️ Installation & Setup

### Prerequisites
* Python 3.10 or higher
* Node.js 18 or higher

---

### Quick Start (Windows)
Double-click the root [launch.bat](launch.bat) script. This will automatically spin up the backend and frontend dev servers in separate command prompt windows:
* **Backend API**: `http://127.0.0.1:8000`
* **Frontend Dashboard**: `http://localhost:5173/`

---

### Manual Setup

#### 1. Backend API
1. Navigate to the backend directory:
   ```bash
   cd backend
   ```
2. Create and activate a virtual environment:
   ```bash
   python -m venv venv
   # On Windows:
   .\venv\Scripts\activate
   # On macOS/Linux:
   source venv/bin/activate
   ```
3. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```
4. Run the development server:
   ```bash
   python main.py
   ```

#### 2. Frontend App
1. Navigate to the frontend directory:
   ```bash
   cd ../frontend
   ```
2. Install npm dependencies:
   ```bash
   npm install
   ```
3. Run the Vite development server:
   ```bash
   npm run dev
   ```

---

## 🐳 Container Deployment

A `Dockerfile` is provided in the `backend/` directory for containerizing the FastAPI service:
```bash
docker build -t stock-screener-backend ./backend
docker run -p 8000:8000 stock-screener-backend
```

---

## 🛡️ License & Backup
This project is configured as a private repository backup on GitHub. All rights reserved.
