import os
import json
import uvicorn
import asyncio
from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional, Dict, Any
import yfinance as yf
import time
import httpx
import re

import config
import scanner

# Configure Gemini AI if available
try:
    import google.generativeai as genai
    HAS_GENAI = True
    if config.GEMINI_API_KEY:
        genai.configure(api_key=config.GEMINI_API_KEY)
except ImportError:
    HAS_GENAI = False
    print("Warning: google-generativeai package not found. AI Chatbot will run in demo/mock mode.")

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

class FavoriteArticle(BaseModel):
    id: int
    title: str
    content: Optional[str] = None
    summary: Optional[str] = None
    author: Optional[str] = None
    published_at: Optional[int] = None
    image_url: Optional[str] = None
    url: Optional[str] = None

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
def get_latest_scan(universe: Optional[str] = None):
    filename = "scan_results.json"
    if universe:
        universe_clean = "custom" if universe == "watchlist" else universe.lower()
        filename = f"scan_results_{universe_clean}.json"

    if not config.json_exists(filename):
        # Fall back to default scan_results.json if it exists and matches the universe
        if filename != "scan_results.json" and config.json_exists("scan_results.json"):
            fallback_data = config.read_json("scan_results.json")
            fallback_univ = fallback_data.get("universe", "").lower()
            target_univ = "custom" if universe == "watchlist" else universe.lower()
            if fallback_univ == target_univ or (fallback_univ == "watchlist" and target_univ == "custom"):
                filename = "scan_results.json"
            else:
                return {
                    "timestamp": None,
                    "universe": universe,
                    "scanned_count": 0,
                    "ma20_alerts": [],
                    "vcp_alerts": [],
                    "message": f"No scan has been performed for {universe} yet."
                }
        else:
            return {
                "timestamp": None,
                "universe": universe,
                "scanned_count": 0,
                "ma20_alerts": [],
                "vcp_alerts": [],
                "message": "No scan has been performed yet."
            }
    try:
        data = config.read_json(filename)
            
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
            print(f"Enriching {filename} scan results with company names...")
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
            config.write_json(filename, data, indent=2)
                
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

def translate_to_mandarin(text: str) -> str:
    """Uses Gemini API to translate the business summary to Mandarin.
    Falls back to English text if genai is not available or errors out.
    """
    if not HAS_GENAI or not config.GEMINI_API_KEY or not text or text.startswith("No company summary available") or text.startswith("Failed to load"):
        return text
    try:
        model = genai.GenerativeModel('gemini-3.5-flash')
        prompt = (
            "Please translate the following English business description of a company into clear, "
            "professional, and natural Chinese (Mandarin). Only return the translated text without any "
            "introductory or concluding remarks:\n\n" + text
        )
        response = model.generate_content(prompt)
        if response and response.text:
            return response.text.strip()
    except Exception as e:
        print(f"Gemini Translation error for stock description: {e}")
    return text

@app.get("/stock/{ticker}/details")
def get_stock_details(ticker: str):
    ticker = ticker.upper().strip()
    cache_filename = f"details/{ticker}.json"
    
    # Check if cache is fresh (less than 7 days old)
    seven_days_ago = time.time() - 7 * 24 * 3600
    if config.json_exists(cache_filename) and config.get_json_mtime(cache_filename) > seven_days_ago:
        try:
            return config.read_json(cache_filename)
        except Exception:
            pass # Fallback to live fetch if cache read fails
            
    try:
        t = yf.Ticker(ticker)
        
        # 1. Fetch info
        info = t.info
        summary = info.get("longBusinessSummary", "No company summary available.")
        summary = translate_to_mandarin(summary)
        sector = info.get("sector", "N/A")
        industry = info.get("industry", "N/A")
        website = info.get("website", "")
        market_cap = info.get("marketCap", None)
        long_name = info.get("longName", ticker)
        
        # 2. Fetch quarterly financials
        df = t.quarterly_financials
        financials = []
        if df is not None and not df.empty:
            import pandas as pd
            import numpy as np
            sorted_cols = sorted(df.columns)
            for col in sorted_cols:
                date_str = col.strftime("%Y-%m-%d")
                
                def get_row(keys):
                    for k in keys:
                        if k in df.index:
                            val = df.loc[k, col]
                            if isinstance(val, (pd.Series, np.ndarray)):
                                val = val.iloc[0] if hasattr(val, 'iloc') else val[0]
                            if not pd.isna(val):
                                return float(val)
                    return None
                    
                revenue = get_row(['Total Revenue', 'Operating Revenue'])
                net_income = get_row(['Net Income', 'Net Income Common Stockholders'])
                eps = get_row(['Diluted EPS', 'Basic EPS'])
                
                financials.append({
                    "quarter": date_str,
                    "revenue": revenue,
                    "net_income": net_income,
                    "eps": eps
                })
                
        data = {
            "ticker": ticker,
            "name": long_name,
            "summary": summary,
            "sector": sector,
            "industry": industry,
            "website": website,
            "market_cap": market_cap,
            "financials": financials
        }
        
        # Save to cache (creates details/ folder if local)
        if config.STORAGE_TYPE == "local":
            os.makedirs(os.path.join(config.LOCAL_CACHE_DIR, "details"), exist_ok=True)
            
        config.write_json(cache_filename, data, indent=2)
        return data
        
    except Exception as e:
        print(f"Error fetching stock details for {ticker}: {e}")
        # Return fallback empty structure
        return {
            "ticker": ticker,
            "name": ticker,
            "summary": "Failed to load company summary.",
            "sector": "N/A",
            "industry": "N/A",
            "website": "",
            "market_cap": None,
            "financials": []
        }

class UserSettings(BaseModel):
    ma20Color: Optional[str] = None
    ma50Color: Optional[str] = None
    ma150Color: Optional[str] = None
    ma200Color: Optional[str] = None

@app.get("/user-settings")
def get_user_settings():
    cache_key = "user_settings.json"
    if config.json_exists(cache_key):
        try:
            return config.read_json(cache_key)
        except Exception as e:
            print(f"Error reading user settings: {e}")
    return {
        "ma20Color": "#eab308",
        "ma50Color": "#3b82f6",
        "ma150Color": "#f97316",
        "ma200Color": "#ec4899"
    }

@app.post("/user-settings")
def save_user_settings(settings: UserSettings):
    cache_key = "user_settings.json"
    try:
        current = {}
        if config.json_exists(cache_key):
            try:
                current = config.read_json(cache_key)
            except Exception:
                pass
        
        # Merge new changes
        data_dict = settings.model_dump(exclude_unset=True) if hasattr(settings, 'model_dump') else settings.dict(exclude_unset=True)
        current.update(data_dict)
        
        config.write_json(cache_key, current)
        return {"status": "success", "settings": current}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save user settings: {str(e)}")

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

@app.get("/portfolio/performance")
def get_portfolio_performance():
    # Return the YTD return curve percentages matching the user's yield curve chart
    return {
        "dates": [
            "2026-01-01", "2026-01-12", "2026-01-22", "2026-02-02", "2026-02-11", 
            "2026-02-23", "2026-03-04", "2026-03-13", "2026-03-24", "2026-04-02", 
            "2026-04-14", "2026-04-23", "2026-05-04", "2026-05-13", "2026-05-22", 
            "2026-06-03", "2026-06-12", "2026-06-24", "2026-07-06"
        ],
        "values": [
            6.0, 15.2, 20.2, 22.5, 21.4, 29.3, 30.5, 12.1, 23.8, 4.4, 18.5, 
            48.8, 69.3, 111.4, 105.6, 103.0, 131.8, 157.7, 108.26
        ]
    }

class HoldingItem(BaseModel):
    ticker: str
    name: Optional[str] = None
    qty: int
    avg_cost: float

class PortfolioConfigRequest(BaseModel):
    cash_balance: float
    holdings: List[HoldingItem]

@app.get("/portfolio/holdings")
def get_portfolio_holdings():
    cache_key = "portfolio_config.json"
    
    # 1. Initialize default file if not exists
    if not config.json_exists(cache_key):
        default_config = {
            "cash_balance": 15400.0,
            "holdings": [
                {"ticker": "AMD", "name": "Advanced Micro Devices Inc.", "qty": 50, "avg_cost": 464.0},
                {"ticker": "ASML", "name": "ASML Holding N.V.", "qty": 10, "avg_cost": 1676.0},
                {"ticker": "AMGN", "name": "Amgen Inc.", "qty": 20, "avg_cost": 347.0},
                {"ticker": "APP", "name": "AppLovin Corp.", "qty": 100, "avg_cost": 493.0}
            ]
        }
        config.write_json(cache_key, default_config)
        
    # 2. Read current config
    portfolio_config = config.read_json(cache_key)
    holdings = portfolio_config.get("holdings", [])
    cash_balance = portfolio_config.get("cash_balance", 15400.0)
    
    tickers_list = [h["ticker"] for h in holdings]
    current_prices = {}
    
    # Attempt batch download of latest close prices from yfinance
    if tickers_list:
        try:
            df = yf.download(" ".join(tickers_list), period="1d", progress=False)
            if not df.empty:
                # Check for MultiIndex columns vs flat Symbol columns
                if hasattr(df.columns, 'levels') and 'Close' in df.columns:
                    close_series = df['Close'].iloc[-1]
                    for t in tickers_list:
                        if t in close_series:
                            current_prices[t] = float(close_series[t])
                elif 'Close' in df:
                    close_series = df['Close'].iloc[-1]
                    if isinstance(close_series, float):
                        current_prices[tickers_list[0]] = float(close_series)
                else:
                    for t in tickers_list:
                        if t in df:
                            current_prices[t] = float(df[t].iloc[-1])
        except Exception as e:
            print(f"Error fetching live prices in holdings: {e}")
        
    # Predefined close fallbacks from user's screen state if fetch fails or returns nulls
    fallbacks = {
        "AMD": 557.89,
        "ASML": 1797.32,
        "AMGN": 363.39,
        "APP": 506.98
    }
    
    enriched = []
    total_cost = 0.0
    total_value = 0.0
    
    for h in holdings:
        price = current_prices.get(h["ticker"]) or fallbacks.get(h["ticker"], h["avg_cost"])
        market_value = h["qty"] * price
        cost_basis = h["qty"] * h["avg_cost"]
        total_cost += cost_basis
        total_value += market_value
        
        gain_loss = market_value - cost_basis
        gain_loss_pct = (gain_loss / cost_basis) * 100 if cost_basis > 0 else 0.0
        
        enriched.append({
            **h,
            "current_price": price,
            "market_value": market_value,
            "cost_basis": cost_basis,
            "gain_loss": gain_loss,
            "gain_loss_pct": gain_loss_pct
        })
        
    return {
        "holdings": enriched,
        "summary": {
            "total_cost": total_cost,
            "total_value": total_value + cash_balance,
            "unrealized_pnl": total_value - total_cost,
            "unrealized_pnl_pct": ((total_value - total_cost) / total_cost) * 100 if total_cost > 0 else 0.0,
            "cash_balance": cash_balance
        }
    }

@app.post("/portfolio/holdings")
def save_portfolio_holdings(req: PortfolioConfigRequest):
    cache_key = "portfolio_config.json"
    
    holdings_list = []
    for h in req.holdings:
        name = h.name
        ticker_upper = h.ticker.upper().strip()
        if not name or name == ticker_upper:
            try:
                name = yf.Ticker(ticker_upper).info.get('longName', ticker_upper)
            except Exception:
                name = ticker_upper
        holdings_list.append({
            "ticker": ticker_upper,
            "name": name,
            "qty": h.qty,
            "avg_cost": h.avg_cost
        })
        
    new_config = {
        "cash_balance": req.cash_balance,
        "holdings": holdings_list
    }
    
    try:
        config.write_json(cache_key, new_config)
        return {"status": "success", "message": "Portfolio config updated successfully"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save portfolio config: {str(e)}")


# -----------------------------------------------------------------------
# Trade Log Endpoints
# -----------------------------------------------------------------------

TRADE_LOG_KEY = "trade_log.json"

def _load_trades() -> list:
    """Load all trades from JSON store, initialize if missing."""
    if not config.json_exists(TRADE_LOG_KEY):
        config.write_json(TRADE_LOG_KEY, {"trades": []})
    data = config.read_json(TRADE_LOG_KEY)
    return data.get("trades", [])

def _save_trades(trades: list) -> None:
    config.write_json(TRADE_LOG_KEY, {"trades": trades})

# Favorite Articles Database Helpers
FAVORITES_KEY = "favorite_articles.json"

def _load_favorites() -> list:
    """Load all favorite articles from JSON store, initialize if missing."""
    if not config.json_exists(FAVORITES_KEY):
        config.write_json(FAVORITES_KEY, {"favorites": []})
    data = config.read_json(FAVORITES_KEY)
    return data.get("favorites", [])

def _save_favorites(favorites: list) -> None:
    config.write_json(FAVORITES_KEY, {"favorites": favorites})

def _sync_portfolio_buy(ticker: str, shares: int, price: float, name: str) -> None:
    """Add/update a holding in portfolio_config.json after a BUY."""
    PCFG = "portfolio_config.json"
    if not config.json_exists(PCFG):
        config.write_json(PCFG, {"cash_balance": 0.0, "holdings": []})
    pcfg = config.read_json(PCFG)
    holdings = pcfg.get("holdings", [])
    existing = next((h for h in holdings if h["ticker"] == ticker), None)
    if existing:
        total_shares = existing["qty"] + shares
        total_cost = existing["qty"] * existing["avg_cost"] + shares * price
        existing["qty"] = total_shares
        existing["avg_cost"] = round(total_cost / total_shares, 4)
    else:
        holdings.append({"ticker": ticker, "name": name, "qty": shares, "avg_cost": price})
    pcfg["holdings"] = holdings
    # Deduct cash if available
    pcfg["cash_balance"] = max(0.0, pcfg.get("cash_balance", 0.0) - shares * price)
    config.write_json(PCFG, pcfg)

def _sync_portfolio_sell(ticker: str, shares: int, price: float) -> None:
    """Reduce/remove a holding in portfolio_config.json after a SELL."""
    PCFG = "portfolio_config.json"
    if not config.json_exists(PCFG):
        return
    pcfg = config.read_json(PCFG)
    holdings = pcfg.get("holdings", [])
    updated = []
    for h in holdings:
        if h["ticker"] == ticker:
            new_qty = h["qty"] - shares
            if new_qty > 0:
                h["qty"] = new_qty
                updated.append(h)
            # If new_qty <= 0, position is fully closed — drop it
        else:
            updated.append(h)
    pcfg["holdings"] = updated
    # Return cash from sale
    pcfg["cash_balance"] = pcfg.get("cash_balance", 0.0) + shares * price
    config.write_json(PCFG, pcfg)

def _compute_realized_pnl(ticker: str, sell_shares: int, sell_price: float, existing_trades: list) -> float:
    """FIFO realized P&L: match sell against oldest BUY lots."""
    buys = sorted(
        [t for t in existing_trades if t["ticker"] == ticker and t["type"] == "BUY"],
        key=lambda x: x["date"]
    )
    remaining = sell_shares
    total_cost = 0.0
    for b in buys:
        if remaining <= 0:
            break
        used = min(b["shares"], remaining)
        total_cost += used * b["price"]
        remaining -= used
    avg_cost = total_cost / sell_shares if sell_shares > 0 else 0.0
    return round((sell_price - avg_cost) * sell_shares, 2)

class TradeRequest(BaseModel):
    date: str           # "YYYY-MM-DD"
    ticker: str
    trade_type: str     # "BUY" or "SELL"
    shares: int
    price: float
    notes: Optional[str] = ""

@app.get("/trades")
def get_trades():
    trades = _load_trades()
    # Sort newest first
    trades_sorted = sorted(trades, key=lambda x: x["date"], reverse=True)
    return {"trades": trades_sorted}

@app.post("/trades")
def add_trade(req: TradeRequest):
    import uuid
    trades = _load_trades()
    ticker = req.ticker.upper().strip()
    trade_type = req.trade_type.upper()
    if trade_type not in ("BUY", "SELL"):
        raise HTTPException(status_code=400, detail="trade_type must be BUY or SELL")

    # Fetch name from yfinance
    name = ticker
    try:
        name = yf.Ticker(ticker).info.get("longName", ticker)
    except Exception:
        pass

    # Compute realized P&L only for SELL
    realized_pnl = None
    if trade_type == "SELL":
        realized_pnl = _compute_realized_pnl(ticker, req.shares, req.price, trades)

    trade_entry = {
        "id": str(uuid.uuid4()),
        "date": req.date,
        "ticker": ticker,
        "name": name,
        "type": trade_type,
        "shares": req.shares,
        "price": req.price,
        "total_value": round(req.shares * req.price, 2),
        "notes": req.notes or "",
        "realized_pnl": realized_pnl
    }

    trades.append(trade_entry)
    _save_trades(trades)

    # Auto-sync portfolio holdings
    if trade_type == "BUY":
        _sync_portfolio_buy(ticker, req.shares, req.price, name)
    else:
        _sync_portfolio_sell(ticker, req.shares, req.price)

    return {"status": "success", "trade": trade_entry}

@app.delete("/trades/{trade_id}")
def delete_trade(trade_id: str):
    trades = _load_trades()
    original_len = len(trades)
    trades = [t for t in trades if t["id"] != trade_id]
    if len(trades) == original_len:
        raise HTTPException(status_code=404, detail="Trade not found")
    _save_trades(trades)
    return {"status": "success", "message": "Trade deleted"}

# -----------------------------------------------------------------------
# Favorite Articles Endpoints
# -----------------------------------------------------------------------

@app.get("/news/favorites")
def get_favorites():
    return _load_favorites()

@app.post("/news/favorites")
def add_favorite(article: FavoriteArticle):
    favorites = _load_favorites()
    
    # Check if already exists, update if exists, otherwise append
    exists = False
    for i, fav in enumerate(favorites):
        if fav.get("id") == article.id:
            favorites[i] = article.dict()
            exists = True
            break
            
    if not exists:
        favorites.append(article.dict())
        
    _save_favorites(favorites)
    return {"status": "success", "article": article}

@app.delete("/news/favorites/{article_id}")
def delete_favorite(article_id: int):
    favorites = _load_favorites()
    original_len = len(favorites)
    favorites = [fav for fav in favorites if fav.get("id") != article_id]
    if len(favorites) == original_len:
        raise HTTPException(status_code=404, detail="Favorite article not found")
    _save_favorites(favorites)
    return {"status": "success", "message": "Article removed from favorites"}

CHAT_HISTORY_KEY = "chat_history.json"

@app.get("/ai/chat/sessions")
def get_chat_sessions():
    try:
        if not config.json_exists(CHAT_HISTORY_KEY):
            return {"sessions": []}
        return config.read_json(CHAT_HISTORY_KEY)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to load chat history: {str(e)}")

@app.post("/ai/chat/sessions")
def save_chat_sessions(payload: dict):
    try:
        config.write_json(CHAT_HISTORY_KEY, payload)
        return {"status": "success"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save chat history: {str(e)}")

class ChatMessage(BaseModel):
    role: str  # "user" or "model"
    content: str

class AIChatRequest(BaseModel):
    message: str
    history: List[ChatMessage] = []

@app.post("/ai/chat")
def ai_chat(req: AIChatRequest):
    # 1. Load portfolio holdings & trades
    holdings_data = []
    cash_balance = 15400.0
    try:
        if config.json_exists("portfolio_config.json"):
            pcfg = config.read_json("portfolio_config.json")
            holdings_data = pcfg.get("holdings", [])
            cash_balance = pcfg.get("cash_balance", 15400.0)
    except Exception as e:
        print(f"Error loading portfolio config for AI: {e}")

    trades_data = []
    try:
        if config.json_exists("trade_log.json"):
            tlog = config.read_json("trade_log.json")
            trades_data = tlog.get("trades", [])
    except Exception as e:
        print(f"Error loading trades log for AI: {e}")

    # 2. Enrich holdings with latest price if available
    try:
        full_holdings = get_portfolio_holdings()
        holdings_enriched = full_holdings.get("holdings", [])
        summary = full_holdings.get("summary", {})
        total_portfolio_value = summary.get("total_value", cash_balance)
    except Exception:
        holdings_enriched = holdings_data
        total_portfolio_value = cash_balance + sum(h.get("qty", 0) * h.get("avg_cost", 0) for h in holdings_data)

    # 3. Calculate portfolio concentration & risk flags
    risk_flags = []
    concentration_details = []
    for h in holdings_enriched:
        mv = h.get("market_value", h.get("qty", 0) * h.get("avg_cost", 0))
        pct = (mv / total_portfolio_value) * 100 if total_portfolio_value > 0 else 0
        concentration_details.append(f"- {h['ticker']}: {pct:.1f}% of portfolio")
        if pct > 25:
            risk_flags.append(f"High concentration risk in {h['ticker']} ({pct:.1f}% of portfolio). Consider diversifying.")
        
        # Check unrealized loss
        gain_loss_pct = h.get("gain_loss_pct", 0.0)
        if gain_loss_pct < -10:
            risk_flags.append(f"{h['ticker']} is down {abs(gain_loss_pct):.1f}% from average cost. Monitor closely.")

    # Sort trades to get 15 most recent
    recent_trades = sorted(trades_data, key=lambda x: x.get("date", ""), reverse=True)[:15]
    recent_trades_text = []
    for t in recent_trades:
        pnl_str = f", realized P&L: ${t['realized_pnl']}" if t.get("realized_pnl") is not None else ""
        recent_trades_text.append(f"- {t.get('date')}: {t.get('type')} {t.get('shares')} {t.get('ticker')} @ ${t.get('price')}{pnl_str} (Notes: {t.get('notes')})")

    # 4. Build System Instruction (System Prompt)
    system_instruction = (
        "You are 'Antigravity Advisor', an expert, highly conservative, risk-aware investment advisor built into the user's Stock Screener app. "
        "Your goal is to guide the user toward high-probability, low-risk setups and actively prevent them from taking on excessive risk. "
        "You have access to the user's live portfolio and trade history. Make your analysis highly personalized based on this data:\n\n"
        f"--- USER PORTFOLIO SUMMARY ---\n"
        f"Cash Balance: ${cash_balance:,.2f}\n"
        f"Total Portfolio Value: ${total_portfolio_value:,.2f}\n"
        "Current Holdings:\n"
    )
    for h in holdings_enriched:
        cost = h.get("cost_basis", h.get("qty", 0) * h.get("avg_cost", 0))
        mv = h.get("market_value", h.get("qty", 0) * h.get("avg_cost", 0))
        pnl = h.get("gain_loss", mv - cost)
        pnl_pct = h.get("gain_loss_pct", 0.0)
        system_instruction += f"- {h['ticker']} ({h.get('name', '')}): {h.get('qty')} shares, Avg Cost: ${h.get('avg_cost'):.2f}, Current Price: ${h.get('current_price', h.get('avg_cost')):.2f}, Market Value: ${mv:,.2f}, Unrealized P&L: ${pnl:+,.2f} ({pnl_pct:+.2f}%)\n"
    
    system_instruction += "\nHoldings Concentration:\n" + ("\n".join(concentration_details) if concentration_details else "No holdings active.") + "\n"
    
    system_instruction += "\nRecent Trade Log History (newest first):\n"
    if recent_trades_text:
        system_instruction += "\n".join(recent_trades_text) + "\n"
    else:
        system_instruction += "No trades logged yet.\n"
        
    system_instruction += (
        "\n--- INVESTMENT ADVICE RULES ---\n"
        "1. Capital Preservation First: Always emphasize keeping losses small (e.g., using 7-8% stop losses) and avoiding high-risk, speculative bets.\n"
        "2. Analyze Exposure: If the user wants to buy something, evaluate their current exposure. If a single stock is already > 25% of their portfolio, advise against adding to it.\n"
        "3. Technical Alignment: Recommend entering positions only when there is technical alignment, such as VCP contracting patterns (Mark Minervini's Stage 2 Trend Template) or MA20 support pullbacks.\n"
        "4. Risk Flags: If you detect high concentration, large unrealized losses, or excessive buying of speculative stocks, highlight these risks explicitly.\n"
        "5. Tone: Be professional, objective, encouraging but realistic, and highly protective of their capital.\n"
        "6. Formatting: Use clear headers, bullet points, and highlight key takeaways. Keep responses concise and structured.\n"
        "7. Disclaimer: Include a disclaimer that this is educational advice and not official financial planning.\n"
    )

    # 5. Check if API key exists or HAS_GENAI is false
    if not HAS_GENAI or not config.GEMINI_API_KEY:
        # Fallback Demo Response Mode
        demo_reply = (
            "⚠️ **Gemini API Key Missing or Package Issue**\n\n"
            "To activate my full AI capabilities, please set your `GEMINI_API_KEY` in the backend `.env.local` file.\n\n"
            "Here is a mock risk assessment based on your current portfolio:\n"
        )
        if risk_flags:
            demo_reply += "\n### 🚨 Portfolio Risk Warnings Detected:\n"
            for rf in risk_flags:
                demo_reply += f"- **{rf}**\n"
        else:
            demo_reply += "\nNo severe risk warnings detected. Portfolio allocations look reasonable!\n"
            
        demo_reply += f"\n### 📊 Portfolio Assessment:\n"
        demo_reply += f"- **Cash Reserves:** ${cash_balance:,.2f} (which provides good liquidity for future setups).\n"
        demo_reply += f"- **Active Exposure:** You have {len(holdings_enriched)} active holdings. "
        if len(holdings_enriched) > 0:
            demo_reply += "Your holdings are " + ", ".join([h['ticker'] for h in holdings_enriched]) + "."
        else:
            demo_reply += "No holdings active right now."
            
        demo_reply += (
            "\n\n*Get an API key for free at [Google AI Studio](https://aistudio.google.com/app/apikey) and insert it in `backend/.env.local` to start chatting with me!*"
        )
        return {"reply": demo_reply, "risk_flags": risk_flags}

    # Call Gemini API
    try:
        model = genai.GenerativeModel('gemini-3.5-flash', system_instruction=system_instruction)
        
        gemini_history = []
        for msg in req.history:
            role = "user" if msg.role == "user" else "model"
            gemini_history.append({
                "role": role,
                "parts": [msg.content]
            })
            
        chat = model.start_chat(history=gemini_history)
        response = chat.send_message(req.message)
        
        return {
            "reply": response.text,
            "risk_flags": risk_flags
        }
    except Exception as e:
        print(f"Gemini API Error: {e}")
        raise HTTPException(status_code=500, detail=f"AI Chatbot Error: {str(e)}")


# News Scraping Cache
# Keys: "list_{category}" or "article_{id}"
# Values: { "data": ..., "timestamp": float }
news_cache = {}
CACHE_TTL = 900          # 15 minutes for news list in seconds
ARTICLE_CACHE_TTL = 86400 # 24 hours for article details in seconds

# Keywords indicating China-domestic focused articles (title/summary filtering)
CHINA_KEYWORDS = [
    # Chinese domestic market
    "A股", "A 股", "沪指", "深指", "上证", "深证", "创业板", "科创板", "北交所",
    # China-specific entities
    "中国证监会", "证监会", "国务院", "人民银行", "央行", "人民币",
    # Domestic companies / sectors frequently covered only for CN market
    "A股存储", "兆易创新", "北京君正", "江波龙", "佰维存储",
    # Geopolitical / political
    "习近平", "中共", "中央", "国常会",
    # Macro domestic policy
    "内地", "大陆", "中资", "中概", "十五五", "五年规划",
    # A-share indices
    "沪深", "沪深300",
]

def extract_ssr_json(html_text: str) -> dict:
    match = re.search(r"__SSR__\s*=\s*(\{.*?\})(;|\s*$|<)", html_text, re.DOTALL)
    if not match:
        raise ValueError("Could not find __SSR__ JSON data in page")
    try:
        return json.loads(match.group(1))
    except Exception as e:
        raise ValueError(f"Failed to parse __SSR__ JSON data: {str(e)}")

@app.get("/news/list")
async def get_news_list(category: str = "global", exclude_china: bool = False):
    global news_cache
    cache_key = f"list_{category}_noChina={exclude_china}"
    now = time.time()
    
    # Return from cache if valid
    if cache_key in news_cache and now - news_cache[cache_key]["timestamp"] < CACHE_TTL:
        return news_cache[cache_key]["data"]
        
    url_map = {
        "global": "https://wallstreetcn.com/",
        "shares": "https://wallstreetcn.com/news/shares",
        "ai": "https://wallstreetcn.com/news/ai"
    }
    
    url = url_map.get(category, "https://wallstreetcn.com/")
    mobile_ua = "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1"
    headers = {
        "User-Agent": mobile_ua,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    }
    
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get(url, headers=headers, follow_redirects=True, timeout=15.0)
            if resp.status_code != 200:
                raise HTTPException(status_code=resp.status_code, detail="Failed to fetch from WallStreetCN")
                
            ssr_data = extract_ssr_json(resp.text)
            items = ssr_data.get("state", {}).get("default", {}).get("children", {}).get("default", {}).get("data", {}).get("items", [])
            
            cleaned_items = []
            for item in items:
                if item.get("resource_type") != "article":
                    continue
                res = item.get("resource", {})
                if not res:
                    continue
                    
                author_data = res.get("author", {})
                author_name = author_data.get("display_name") if isinstance(author_data, dict) else str(author_data)
                
                img_data = res.get("image", {})
                img_url = img_data.get("uri") if isinstance(img_data, dict) else str(img_data)
                
                cleaned_items.append({
                    "id": res.get("id"),
                    "title": res.get("title"),
                    "summary": res.get("content_short"),
                    "author": author_name,
                    "published_at": res.get("display_time"),
                    "image_url": img_url,
                    "url": f"https://wallstreetcn.com/articles/{res.get('id')}"
                })

            # Apply China filter if requested
            if exclude_china:
                def is_china_news(item: dict) -> bool:
                    text = (item.get("title") or "") + (item.get("summary") or "")
                    return any(kw in text for kw in CHINA_KEYWORDS)
                cleaned_items = [item for item in cleaned_items if not is_china_news(item)]
                
            news_cache[cache_key] = {
                "data": cleaned_items,
                "timestamp": now
            }
            return cleaned_items
            
    except Exception as e:
        print(f"Error fetching news list for {category}: {e}")
        if cache_key in news_cache:
            return news_cache[cache_key]["data"]
        raise HTTPException(status_code=500, detail=f"Failed to load news feed: {str(e)}")

@app.get("/news/article/{article_id}")
async def get_news_article(article_id: int):
    global news_cache
    cache_key = f"article_{article_id}"
    now = time.time()
    
    if cache_key in news_cache and now - news_cache[cache_key]["timestamp"] < ARTICLE_CACHE_TTL:
        return news_cache[cache_key]["data"]
        
    url = f"https://wallstreetcn.com/articles/{article_id}"
    mobile_ua = "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1"
    headers = {
        "User-Agent": mobile_ua,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    }
    
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get(url, headers=headers, follow_redirects=True, timeout=15.0)
            if resp.status_code != 200:
                raise HTTPException(status_code=resp.status_code, detail=f"Article not found: {article_id}")
                
            ssr_data = extract_ssr_json(resp.text)
            article = ssr_data.get("state", {}).get("default", {}).get("children", {}).get("default", {}).get("data", {}).get("article", {})
            if not article:
                raise ValueError("Article details not found in Svelte SSR response")
                
            author_data = article.get("author", {})
            author_name = author_data.get("display_name") if isinstance(author_data, dict) else str(author_data)
            
            img_data = article.get("image", {})
            img_url = img_data.get("uri") if isinstance(img_data, dict) else str(img_data)
            
            cleaned_article = {
                "id": article.get("id"),
                "title": article.get("title"),
                "content": article.get("content"),
                "summary": article.get("content_short"),
                "author": author_name,
                "published_at": article.get("display_time"),
                "image_url": img_url,
                "url": url
            }
            
            news_cache[cache_key] = {
                "data": cleaned_article,
                "timestamp": now
            }
            return cleaned_article
            
    except Exception as e:
        print(f"Error fetching news article {article_id}: {e}")
        if cache_key in news_cache:
            return news_cache[cache_key]["data"]
        raise HTTPException(status_code=500, detail=f"Failed to load article: {str(e)}")


async def warm_news_cache_loop():
    """Background task to keep the news feed cache warm and pre-fetch article details."""
    # Wait a few seconds after startup to let the server bind and initialize
    await asyncio.sleep(5)
    while True:
        try:
            print("[INFO] Background task: Warming news cache...")
            for category in ["global", "shares", "ai"]:
                for exclude_china in [False, True]:
                    try:
                        # Fetch and cache list
                        await get_news_list(category=category, exclude_china=exclude_china)
                    except Exception as e:
                        print(f"[WARN] Failed to warm news list for {category} (exclude_china={exclude_china}): {e}")
            
            # Pre-fetch details of top 3 articles for each category to cache them
            for category in ["global", "shares", "ai"]:
                cache_key = f"list_{category}_noChina=False"
                if cache_key in news_cache:
                    items = news_cache[cache_key]["data"]
                    for item in items[:3]:
                        article_id = item.get("id")
                        if article_id:
                            article_cache_key = f"article_{article_id}"
                            # If not already cached, fetch and cache it
                            if article_cache_key not in news_cache:
                                try:
                                    await get_news_article(article_id)
                                    await asyncio.sleep(1.0)  # Rate limiting safety spacer
                                except Exception as e:
                                    print(f"[WARN] Failed to warm article detail for ID {article_id}: {e}")
        except Exception as e:
            print(f"[ERROR] Error in warm_news_cache_loop: {e}")
        
        # Sleep for 5 minutes before warming again
        await asyncio.sleep(300)

@app.on_event("startup")
async def startup_event():
    # Start the background task
    asyncio.create_task(warm_news_cache_loop())


if __name__ == "__main__":

    # Get PORT from environment (Cloud Run requirement), defaulting to 8000
    port = int(os.environ.get("PORT", 8000))
    # Bind to 0.0.0.0 instead of 127.0.0.1 to make the container accessible
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=True)
