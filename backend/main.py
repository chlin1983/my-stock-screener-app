import os
import json
import uvicorn
from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional, Dict, Any
import yfinance as yf

import config
import scanner

app = FastAPI(title="Stock Screener API", description="Screener for MA20 Pullbacks, VCP Patterns and GMMA Strategy")

# Enable CORS for frontend development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, specify the actual frontend origin
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Status variable for background scans
scan_status = {
    "is_running": False,
    "last_completed": None,
    "current_universe": None,
    "error": None
}

class ScanRequest(BaseModel):
    universe: str  # 'dow30', 'nasdaq100', 'nasdaq', 'nyse', 'amex', 'sp500', 'custom'
    custom_tickers: Optional[List[str]] = None
    ma20_tolerance_pct: Optional[float] = None
    ma20_min_pullback_days: Optional[int] = None
    ma20_trend_filter: Optional[bool] = None
    vcp_trend_template: Optional[bool] = None
    vcp_max_tightness_pct: Optional[float] = None
    vcp_volume_dryup_pct: Optional[float] = None
    vcp_min_contractions: Optional[int] = None
    vcp_max_contractions: Optional[int] = None
    vcp_consolidation_days: Optional[int] = None
    # GMMA parameters
    gmma_require_bullish_alignment: Optional[bool] = None
    gmma_crossover_lookback_days: Optional[int] = None
    gmma_min_separation_pct: Optional[float] = None

def execute_background_scan(req: ScanRequest):
    global scan_status
    scan_status["is_running"] = True
    scan_status["current_universe"] = req.universe
    scan_status["error"] = None
    
    try:
        # Override config params with request overrides
        ma20_params = {**config.MA20_PULLBACK_PARAMS}
        if req.ma20_tolerance_pct is not None:
            ma20_params["tolerance_pct"] = req.ma20_tolerance_pct
        if req.ma20_min_pullback_days is not None:
            ma20_params["min_pullback_days"] = req.ma20_min_pullback_days
        if req.ma20_trend_filter is not None:
            ma20_params["trend_filter"] = req.ma20_trend_filter
            
        vcp_params = {**config.VCP_PARAMS}
        if req.vcp_trend_template is not None:
            vcp_params["trend_template"] = req.vcp_trend_template
        if req.vcp_max_tightness_pct is not None:
            vcp_params["max_tightness_pct"] = req.vcp_max_tightness_pct
        if req.vcp_volume_dryup_pct is not None:
            vcp_params["volume_dryup_pct"] = req.vcp_volume_dryup_pct
        if req.vcp_min_contractions is not None:
            vcp_params["min_contractions"] = req.vcp_min_contractions
        if req.vcp_max_contractions is not None:
            vcp_params["max_contractions"] = req.vcp_max_contractions
        if req.vcp_consolidation_days is not None:
            vcp_params["consolidation_days"] = req.vcp_consolidation_days
            
        gmma_params = {**config.GMMA_PARAMS}
        if req.gmma_require_bullish_alignment is not None:
            gmma_params["require_bullish_alignment"] = req.gmma_require_bullish_alignment
        if req.gmma_crossover_lookback_days is not None:
            gmma_params["crossover_lookback_days"] = req.gmma_crossover_lookback_days
        if req.gmma_min_separation_pct is not None:
            gmma_params["min_separation_pct"] = req.gmma_min_separation_pct
            
        scanner.run_scan(
            universe_name=req.universe,
            custom_tickers=req.custom_tickers,
            ma20_params=ma20_params,
            vcp_params=vcp_params,
            gmma_params=gmma_params
        )
        scan_status["last_completed"] = scanner.datetime.now().isoformat()
    except Exception as e:
        import traceback
        traceback.print_exc()
        scan_status["error"] = str(e)
        print(f"Background scan error: {e}")
    finally:
        scan_status["is_running"] = False

@app.get("/")
def read_root():
    return {
        "name": "Stock Screener API",
        "status": "online",
        "endpoints": ["/scan/latest", "/scan/run", "/scan/status", "/stock/{ticker}/history", "/config"]
    }

@app.get("/scan/status")
def get_scan_status():
    return scan_status

@app.get("/scan/latest")
def get_latest_scan():
    if not config.json_exists("scan_results.json"):
        return {
            "timestamp": None,
            "universe": None,
            "scanned_count": 0,
            "ma20_alerts": [],
            "vcp_alerts": [],
            "message": "No scan has been performed yet."
        }
    try:
        data = config.read_json("scan_results.json")
            
        # Check if we need to enrich with company names
        needs_enrichment = False
        for a in data.get("ma20_alerts", []):
            if "name" not in a:
                needs_enrichment = True
                break
        if not needs_enrichment:
            for a in data.get("vcp_alerts", []):
                if "name" not in a:
                    needs_enrichment = True
                    break
        if not needs_enrichment:
            for a in data.get("gmma_alerts", []):
                if "name" not in a:
                    needs_enrichment = True
                    break
                    
        if needs_enrichment:
            print("Enriching latest scan results with company names...")
            ma20_alerts = data.get("ma20_alerts", [])
            vcp_alerts = data.get("vcp_alerts", [])
            gmma_alerts = data.get("gmma_alerts", [])
            unique_tickers = list(set(
                [a["ticker"] for a in ma20_alerts] +
                [a["ticker"] for a in vcp_alerts] +
                [a["ticker"] for a in gmma_alerts]
            ))
            
            ticker_names = {}
            for t in unique_tickers:
                try:
                    ticker_names[t] = yf.Ticker(t).info.get('longName', t)
                except Exception:
                    ticker_names[t] = t
                    
            for a in ma20_alerts:
                if "name" not in a:
                    a["name"] = ticker_names.get(a["ticker"], a["ticker"])
            for a in vcp_alerts:
                if "name" not in a:
                    a["name"] = ticker_names.get(a["ticker"], a["ticker"])
            for a in gmma_alerts:
                if "name" not in a:
                    a["name"] = ticker_names.get(a["ticker"], a["ticker"])
                    
            # Save enriched results back to file
            config.write_json("scan_results.json", data, indent=2)
                
        # Ensure gmma_alerts key always exists for older cached results
        if "gmma_alerts" not in data:
            data["gmma_alerts"] = []
                
        return data
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to read scan results: {str(e)}")

@app.post("/scan/run")
def run_scan_endpoint(req: ScanRequest, background_tasks: BackgroundTasks, sync: Optional[bool] = False):
    if scan_status["is_running"]:
        return {"message": "A scan is already in progress.", "status": scan_status}
        
    if sync:
        print("Running scan synchronously...")
        execute_background_scan(req)
        if config.json_exists("scan_results.json"):
            return config.read_json("scan_results.json")
        return {"message": "Scan completed, but results could not be loaded.", "status": scan_status}
    else:
        background_tasks.add_task(execute_background_scan, req)
        return {"message": "Scan started in background.", "status": "running", "universe": req.universe}

@app.get("/stock/{ticker}/history")
def get_stock_history(ticker: str):
    ticker = ticker.upper()
    cache_key = f"stocks/{ticker}.json"
    
    # 1. Try reading from cache first
    if config.json_exists(cache_key):
        try:
            cache_data = config.read_json(cache_key)
            if cache_data.get("fetched_4y", False):
                return cache_data
        except Exception as e:
            print(f"Error reading cache for {ticker}: {e}")
            
    # 2. Fetch from yfinance if not in cache (or if cache doesn't have 4y data)
    try:
        print(f"Fetching history online for {ticker} (4y)...")
        df = yf.download(ticker, period="4y", interval="1d", progress=False)
        if df.empty:
            raise HTTPException(status_code=404, detail=f"No stock data found for ticker {ticker}")
            
        # Flatten MultiIndex columns if present
        if hasattr(df.columns, 'levels'):
            df.columns = df.columns.droplevel(1)
            
        hist_data = {
            "dates": [d.strftime("%Y-%m-%d") for d in df.index],
            "open": df["Open"].tolist(),
            "high": df["High"].tolist(),
            "low": df["Low"].tolist(),
            "close": df["Close"].tolist(),
            "volume": df["Volume"].tolist(),
            "fetched_4y": True
        }
        
        # Save to cache
        config.write_json(cache_key, hist_data)
            
        return hist_data
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch stock history: {str(e)}")

@app.get("/config")
def get_current_config():
    return {
        "ma20_pullback": config.MA20_PULLBACK_PARAMS,
        "vcp": config.VCP_PARAMS,
        "gmma": config.GMMA_PARAMS,
        "default_watchlist": config.DEFAULT_WATCHLIST,
        "dow30_tickers": config.DOW_30_FALLBACK,
        "nasdaq100_tickers": config.NASDAQ_100_FALLBACK
    }

if __name__ == "__main__":
    # Get PORT from environment (Cloud Run requirement), defaulting to 8000
    port = int(os.environ.get("PORT", 8000))
    # Bind to 0.0.0.0 instead of 127.0.0.1 to make the container accessible
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=True)
