import os
import json
import pandas as pd
import numpy as np
import yfinance as yf
from datetime import datetime, timedelta
from scipy.signal import argrelextrema
import ftplib
import time

import io
import requests

import config

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36"
}

def download_exchange_tickers():
    """
    Downloads list of tickers from Nasdaq FTP server.
    Saves/caches them as JSON files.
    """
    # Check if files exist and are fresh (less than 24 hours old)
    one_day_ago = time.time() - 24 * 3600
    if (config.json_exists("nasdaq_tickers.json") and config.get_json_mtime("nasdaq_tickers.json") > one_day_ago and
        config.json_exists("nyse_tickers.json") and config.get_json_mtime("nyse_tickers.json") > one_day_ago and
        config.json_exists("amex_tickers.json") and config.get_json_mtime("amex_tickers.json") > one_day_ago):
        print("Using cached exchange ticker lists.")
        return
        
    print("Connecting to ftp.nasdaqtrader.com to fetch ticker lists...")
    try:
        ftp = ftplib.FTP("ftp.nasdaqtrader.com")
        ftp.login("anonymous", "")
        ftp.cwd("SymbolDirectory")
        
        # Download nasdaqlisted.txt
        nasdaq_data = []
        ftp.retrlines("RETR nasdaqlisted.txt", lambda l: nasdaq_data.append(l))
        
        # Download otherlisted.txt
        other_data = []
        ftp.retrlines("RETR otherlisted.txt", lambda l: other_data.append(l))
        ftp.quit()
        
        # Parse nasdaqlisted.txt
        nasdaq_tickers = []
        if nasdaq_data:
            headers = nasdaq_data[0].split('|')
            symbol_idx = headers.index('Symbol') if 'Symbol' in headers else 0
            etf_idx = headers.index('ETF') if 'ETF' in headers else -1
            test_idx = headers.index('Test Issue') if 'Test Issue' in headers else -1
            
            for line in nasdaq_data[1:]:
                parts = line.split('|')
                if len(parts) <= symbol_idx or parts[symbol_idx] == "":
                    continue
                symbol = parts[symbol_idx]
                
                is_etf = parts[etf_idx] == 'Y' if (etf_idx != -1 and etf_idx < len(parts)) else False
                is_test = parts[test_idx] == 'Y' if (test_idx != -1 and test_idx < len(parts)) else False
                
                if "File Creation Time" in line:
                    continue
                
                if not is_etf and not is_test and symbol.isalpha():
                    nasdaq_tickers.append(symbol)
                    
        # Parse otherlisted.txt
        nyse_tickers = []
        amex_tickers = []
        if other_data:
            headers = other_data[0].split('|')
            symbol_idx = headers.index('ACT Symbol') if 'ACT Symbol' in headers else 0
            exchange_idx = headers.index('Exchange') if 'Exchange' in headers else -1
            etf_idx = headers.index('ETF') if 'ETF' in headers else -1
            test_idx = headers.index('Test Issue') if 'Test Issue' in headers else -1
            
            for line in other_data[1:]:
                parts = line.split('|')
                if len(parts) <= symbol_idx or parts[symbol_idx] == "":
                    continue
                symbol = parts[symbol_idx]
                
                exchange = parts[exchange_idx] if (exchange_idx != -1 and exchange_idx < len(parts)) else ''
                is_etf = parts[etf_idx] == 'Y' if (etf_idx != -1 and etf_idx < len(parts)) else False
                is_test = parts[test_idx] == 'Y' if (test_idx != -1 and test_idx < len(parts)) else False
                
                if "File Creation Time" in line:
                    continue
                
                if not is_etf and not is_test and symbol.isalpha():
                    if exchange == 'N':
                        nyse_tickers.append(symbol)
                    elif exchange == 'A':
                        amex_tickers.append(symbol)
                        
        # Save to cache
        config.write_json("nasdaq_tickers.json", nasdaq_tickers)
        config.write_json("nyse_tickers.json", nyse_tickers)
        config.write_json("amex_tickers.json", amex_tickers)
            
        print(f"Ticker lists downloaded and cached: NASDAQ ({len(nasdaq_tickers)}), NYSE ({len(nyse_tickers)}), AMEX ({len(amex_tickers)})")
        
    except Exception as e:
        print(f"Error fetching ticker lists from FTP: {e}")
        if (config.json_exists("nasdaq_tickers.json") and 
            config.json_exists("nyse_tickers.json") and 
            config.json_exists("amex_tickers.json")):
            print("Using existing cached lists due to download error.")
        else:
            raise e

def get_exchange_tickers(exchange_name):
    """
    Returns the ticker list for the given exchange name ('nasdaq', 'nyse', or 'amex').
    """
    download_exchange_tickers()
    cache_file = f"{exchange_name.lower()}_tickers.json"
    if config.json_exists(cache_file):
        return config.read_json(cache_file)
    return []

def get_sp500_tickers():
    # --- Source 1: Wikipedia ---
    try:
        url = "https://en.wikipedia.org/wiki/List_of_S%26P_500_companies"
        resp = requests.get(url, headers=HEADERS, timeout=15)
        tables = pd.read_html(io.StringIO(resp.text))
        tickers = _parse_tickers_from_tables(tables)
        if len(tickers) >= 400:
            print(f"[S&P 500] Wikipedia: {len(tickers)} tickers scraped.")
            return tickers
        print(f"[S&P 500] Wikipedia returned only {len(tickers)} -- trying Nasdaq.com...")
    except Exception as e:
        print(f"[S&P 500] Wikipedia failed: {e} -- trying Nasdaq.com...")

    # --- Source 2: Official Nasdaq API ---
    try:
        url = "https://api.nasdaq.com/api/quote/list-type/sp500"
        headers = {**HEADERS, "Accept": "application/json"}
        resp = requests.get(url, headers=headers, timeout=15)
        data = resp.json()
        rows = data.get("data", {}).get("data", {}).get("rows", [])
        tickers = [r["symbol"].strip() for r in rows if r.get("symbol", "").strip()]
        if len(tickers) >= 400:
            print(f"[S&P 500] Nasdaq.com API: {len(tickers)} tickers scraped.")
            return tickers
        print(f"[S&P 500] Nasdaq.com returned only {len(tickers)} -- using fallback.")
    except Exception as e:
        print(f"[S&P 500] Nasdaq.com failed: {e} -- using NASDAQ-100 fallback.")

    # --- Source 3: Fallback to static list (for Cloud Run) ---
    print(f"[S&P 500] All sources failed. Falling back to static S&P 500 list.")
    if hasattr(config, "SP_500_FALLBACK"):
        return config.SP_500_FALLBACK
    return config.NASDAQ_100_FALLBACK

def _parse_tickers_from_tables(tables, col_names=('Ticker', 'Symbol')):
    """Helper: extract tickers from all tables that have any of the given column names."""
    all_tickers = []
    for t in tables:
        for col in col_names:
            if col in t.columns:
                for sym in t[col].tolist():
                    if isinstance(sym, str):
                        sym = sym.strip().replace('.', '-')
                        if sym and sym[0].isalpha():
                            all_tickers.append(sym)
                break
    # Deduplicate while preserving order
    seen = set()
    return [t for t in all_tickers if not (t in seen or seen.add(t))]


def get_nasdaq100_tickers():
    # --- Source 1: Wikipedia ---
    try:
        url = "https://en.wikipedia.org/wiki/Nasdaq-100"
        resp = requests.get(url, headers=HEADERS, timeout=15)
        unique = _parse_tickers_from_tables(pd.read_html(io.StringIO(resp.text)))
        if len(unique) >= 50:
            print(f"[Nasdaq-100] Wikipedia: {len(unique)} tickers scraped.")
            return unique
        print(f"[Nasdaq-100] Wikipedia returned only {len(unique)} tickers -- trying Nasdaq.com...")
    except Exception as e:
        print(f"[Nasdaq-100] Wikipedia failed: {e} -- trying Nasdaq.com...")

    # --- Source 2: Official Nasdaq website ---
    try:
        url = "https://api.nasdaq.com/api/quote/list-type/nasdaq100"
        headers = {**HEADERS, "Accept": "application/json"}
        resp = requests.get(url, headers=headers, timeout=15)
        data = resp.json()
        rows = data.get("data", {}).get("data", {}).get("rows", [])
        tickers = [r["symbol"].strip() for r in rows if r.get("symbol", "").strip()]
        if len(tickers) >= 50:
            print(f"[Nasdaq-100] Nasdaq.com API: {len(tickers)} tickers scraped.")
            return tickers
        print(f"[Nasdaq-100] Nasdaq.com returned only {len(tickers)} -- using hardcoded fallback.")
    except Exception as e:
        print(f"[Nasdaq-100] Nasdaq.com failed: {e} -- using hardcoded fallback.")

    # --- Source 3: Hardcoded fallback (last resort) ---
    print(f"[Nasdaq-100] Using hardcoded fallback ({len(config.NASDAQ_100_FALLBACK)} tickers).")
    return config.NASDAQ_100_FALLBACK


def get_dow30_tickers():
    # --- Source 1: Wikipedia ---
    try:
        url = "https://en.wikipedia.org/wiki/Dow_Jones_Industrial_Average"
        resp = requests.get(url, headers=HEADERS, timeout=15)
        tickers = _parse_tickers_from_tables(pd.read_html(io.StringIO(resp.text)))
        if len(tickers) >= 25:
            print(f"[Dow 30] Wikipedia: {len(tickers)} tickers scraped.")
            return tickers
        print(f"[Dow 30] Wikipedia returned only {len(tickers)} -- trying Nasdaq.com...")
    except Exception as e:
        print(f"[Dow 30] Wikipedia failed: {e} -- trying Nasdaq.com...")

    # --- Source 2: Official Nasdaq API ---
    try:
        url = "https://api.nasdaq.com/api/quote/list-type/dow_jones"
        headers = {**HEADERS, "Accept": "application/json"}
        resp = requests.get(url, headers=headers, timeout=15)
        data = resp.json()
        rows = data.get("data", {}).get("data", {}).get("rows", [])
        tickers = [r["symbol"].strip() for r in rows if r.get("symbol", "").strip()]
        if len(tickers) >= 25:
            print(f"[Dow 30] Nasdaq.com API: {len(tickers)} tickers scraped.")
            return tickers
        print(f"[Dow 30] Nasdaq.com returned only {len(tickers)} -- using hardcoded fallback.")
    except Exception as e:
        print(f"[Dow 30] Nasdaq.com failed: {e} -- using hardcoded fallback.")

    # --- Source 3: Hardcoded fallback (last resort) ---
    print(f"[Dow 30] Using hardcoded fallback ({len(config.DOW_30_FALLBACK)} tickers).")
    return config.DOW_30_FALLBACK

def check_trend_template(df):
    """
    Mark Minervini's Trend Template criteria to identify Stage 2 uptrends.
    Requires at least 252 days of historical daily data.
    """
    if len(df) < 250:
        return False
        
    close = df["Close"].iloc[-1]
    
    # Calculate Moving Averages
    ma50 = df["Close"].rolling(window=50).mean().iloc[-1]
    ma150 = df["Close"].rolling(window=150).mean().iloc[-1]
    ma200 = df["Close"].rolling(window=200).mean().iloc[-1]
    
    # Calculate 20-day ago MA200 to check trend direction
    ma200_series = df["Close"].rolling(window=200).mean()
    ma200_20d_ago = ma200_series.iloc[-20]
    
    # 52-Week High & Low (approx 252 trading days)
    high_52w = df["High"].iloc[-252:].max()
    low_52w = df["Low"].iloc[-252:].min()
    
    # Criteria Checks:
    # 1. Price is above 150-day and 200-day MAs
    c1 = close > ma150 and close > ma200
    # 2. 150-day MA is above 200-day MA
    c2 = ma150 > ma200
    # 3. 200-day MA is trending up for at least 1 month
    c3 = ma200 > ma200_20d_ago
    # 4. 50-day MA is above 150-day and 200-day MAs
    c4 = ma50 > ma150 and ma50 > ma200
    # 5. Price is above 50-day MA
    c5 = close > ma50
    # 6. Price is at least 30% above 52-week low
    c6 = close >= 1.30 * low_52w
    # 7. Price is within 25% of 52-week high
    c7 = close >= 0.75 * high_52w
    
    return all([c1, c2, c3, c4, c5, c6, c7])

def check_ma20_pullback(df, params):
    """
    Check if a stock has pullbacked to touch its 20-day Simple Moving Average (SMA).
    """
    if len(df) < 200:
        return {"is_pullback": False, "reason": "Not enough data"}
        
    close = df["Close"].iloc[-1]
    open_p = df["Open"].iloc[-1]
    high = df["High"].iloc[-1]
    low = df["Low"].iloc[-1]
    
    ma20_series = df["Close"].rolling(window=20).mean()
    ma20 = ma20_series.iloc[-1]
    
    # 1. Trend Filter (Uptrend check)
    if params["trend_filter"]:
        ma50 = df["Close"].rolling(window=50).mean().iloc[-1]
        ma200 = df["Close"].rolling(window=200).mean().iloc[-1]
        if close < ma200 or ma50 < ma200:
            return {"is_pullback": False, "reason": "Failed uptrend filter"}
            
    # 2. Short-term Pullback (Falling days)
    min_days = params["min_pullback_days"]
    pullback_days = 0
    for i in range(1, min_days + 1):
        if df["Close"].iloc[-i] < df["Close"].iloc[-(i+1)] or df["Close"].iloc[-i] < df["Open"].iloc[-i]:
            pullback_days += 1
            
    if pullback_days < min_days:
        return {"is_pullback": False, "reason": f"Only {pullback_days}/{min_days} recent falling days"}
        
    # 3. MA20 Touch within Tolerance
    tol = params["tolerance_pct"] / 100.0
    
    # Low touched MA20
    touched_ma20 = low <= ma20 * (1 + tol)
    # Close holds support (does not break deeply below MA20)
    closed_above_ma20 = close >= ma20 * (1 - tol)
    
    # Price is close to MA20
    is_close_to_ma20 = abs(close - ma20) / ma20 <= tol * 2.5
    
    if touched_ma20 and closed_above_ma20 and (close >= ma20 or is_close_to_ma20):
        dist_pct = ((close - ma20) / ma20) * 100
        return {
            "is_pullback": True,
            "ma20": round(float(ma20), 2),
            "close": round(float(close), 2),
            "low": round(float(low), 2),
            "high": round(float(high), 2),
            "distance_pct": round(float(dist_pct), 2)
        }
        
    return {"is_pullback": False, "reason": "No MA20 touch within tolerance"}

def check_vcp(df, params):
    """
    Check if a stock matches the Volatility Contraction Pattern (VCP) criteria.
    """
    # 1. Trend Template Filter
    if params["trend_template"] and not check_trend_template(df):
        return {"is_vcp": False, "reason": "Failed Stage 2 Trend Template"}
        
    window = params["consolidation_days"]
    if len(df) < window:
        return {"is_vcp": False, "reason": "Insufficient data lookup window"}
        
    sub_df = df.iloc[-window:].copy()
    close_prices = sub_df["Close"].values
    
    # Smooth close prices using 5-day EMA to filter daily noise
    smoothed = sub_df["Close"].ewm(span=5, adjust=False).mean().values
    
    # Find local extrema (peaks and troughs)
    # We find peaks/troughs with a window order of 5
    peak_indexes = argrelextrema(smoothed, np.greater_equal, order=5)[0]
    trough_indexes = argrelextrema(smoothed, np.less_equal, order=5)[0]
    
    extrema = []
    for idx in peak_indexes:
        extrema.append(("peak", idx, smoothed[idx]))
    for idx in trough_indexes:
        extrema.append(("trough", idx, smoothed[idx]))
        
    extrema.sort(key=lambda x: x[1])
    
    # Refine extrema (remove consecutive peaks or troughs)
    refined_extrema = []
    for ext in extrema:
        if not refined_extrema:
            refined_extrema.append(ext)
        else:
            prev_type, prev_idx, prev_val = refined_extrema[-1]
            curr_type, curr_idx, curr_val = ext
            if prev_type == curr_type:
                # Keep the more extreme one
                if curr_type == "peak" and curr_val > prev_val:
                    refined_extrema[-1] = ext
                elif curr_type == "trough" and curr_val < prev_val:
                    refined_extrema[-1] = ext
            else:
                refined_extrema.append(ext)
                
    # Calculate contraction depths (from a peak to the subsequent trough)
    contractions = []
    for i in range(len(refined_extrema) - 1):
        if refined_extrema[i][0] == "peak" and refined_extrema[i+1][0] == "trough":
            peak_val = refined_extrema[i][2]
            trough_val = refined_extrema[i+1][2]
            depth = (peak_val - trough_val) / peak_val
            contractions.append({
                "peak_idx": int(refined_extrema[i][1]),
                "trough_idx": int(refined_extrema[i+1][1]),
                "peak_val": round(float(peak_val), 2),
                "trough_val": round(float(trough_val), 2),
                "depth_pct": round(float(depth * 100), 2)
            })
            
    # Filter contractions that are negligible (e.g. < 1.5%)
    contractions = [c for c in contractions if c["depth_pct"] > 1.5]
    
    if len(contractions) < params["min_contractions"]:
        return {"is_vcp": False, "reason": f"Too few contractions found ({len(contractions)})"}
        
    # Cap contractions to evaluate
    num_c = min(len(contractions), params["max_contractions"])
    recent_contractions = contractions[-num_c:]
    
    # Verify contraction: Depth of pullbacks should be progressively decreasing
    depths = [c["depth_pct"] for c in recent_contractions]
    is_contracting = True
    for i in range(1, len(depths)):
        # Allow a slight leniency of 1% for market noise
        if depths[i] >= depths[i-1] + 1.0:
            is_contracting = False
            break
            
    if not is_contracting:
        return {"is_vcp": False, "reason": f"Contractions not contracting: {[round(d, 1) for d in depths]}"}
        
    # Check tightness of the final contraction
    final_tightness = depths[-1]
    if final_tightness > params["max_tightness_pct"]:
        return {"is_vcp": False, "reason": f"Final contraction too loose: {round(final_tightness, 1)}% > {params['max_tightness_pct']}%"}
        
    # Volume Dry-up Check
    avg_vol_5d = sub_df["Volume"].iloc[-5:].mean()
    avg_vol_50d = sub_df["Volume"].iloc[-50:].mean()
    volume_dryup_ratio = (avg_vol_5d / avg_vol_50d) * 100
    
    if volume_dryup_ratio > params["volume_dryup_pct"]:
        return {"is_vcp": False, "reason": f"Volume dry-up insufficient: {round(volume_dryup_ratio, 1)}% > {params['volume_dryup_pct']}%"}
        
    # Price tightness over the last 10 trading days
    last_10d_high = sub_df["High"].iloc[-10:].max()
    last_10d_low = sub_df["Low"].iloc[-10:].min()
    last_10d_range = (last_10d_high - last_10d_low) / sub_df["Close"].iloc[-1] * 100
    
    if last_10d_range > 12.0:
        return {"is_vcp": False, "reason": f"Pivot range too wide: {round(last_10d_range, 1)}%"}
        
    return {
        "is_vcp": True,
        "contractions": recent_contractions,
        "depths": depths,
        "final_tightness": round(final_tightness, 2),
        "volume_dryup_ratio": round(volume_dryup_ratio, 2),
        "last_10d_range": round(last_10d_range, 2)
    }

def calculate_ema(series, period):
    """
    Calculate Exponential Moving Average for a pandas Series.
    Returns a pandas Series of EMA values.
    """
    return series.ewm(span=period, adjust=False).mean()


def check_gmma(df, params):
    """
    Guppy Multiple Moving Average (GMMA) strategy check.
    
    Short-term group (traders): EMA 3, 5, 8, 10, 12, 15
    Long-term group (investors): EMA 30, 35, 40, 45, 50, 60

    Signals:
    - Bullish crossover: short-term group recently crossed above the long-term group
    - Bullish alignment: short-term group is currently entirely above the long-term group
    """
    short_periods = params["short_periods"]
    long_periods  = params["long_periods"]
    lookback      = params["crossover_lookback_days"]
    min_sep_pct   = params["min_separation_pct"] / 100.0
    req_alignment = params["require_bullish_alignment"]

    # Need at least max(long_periods) * 3 bars for EMA to stabilise
    min_bars = max(long_periods) * 3
    if len(df) < min_bars:
        return {"is_gmma": False, "reason": "Insufficient data for GMMA calculation"}

    close = df["Close"]

    # --- Calculate all 12 EMAs ---
    short_emas = {p: calculate_ema(close, p) for p in short_periods}
    long_emas  = {p: calculate_ema(close, p) for p in long_periods}

    # --- Current values (last bar) ---
    short_vals = [float(short_emas[p].iloc[-1]) for p in short_periods]
    long_vals  = [float(long_emas[p].iloc[-1])  for p in long_periods]

    # --- Check current bullish alignment ---
    # Short group entirely above long group means min(short) > max(long)
    min_short = min(short_vals)
    max_long  = max(long_vals)
    is_bullish_aligned = min_short > max_long

    # --- Check separation between groups ---
    # Using shortest short-EMA vs longest long-EMA as representative spread
    shortest_short = float(short_emas[short_periods[0]].iloc[-1])
    longest_long   = float(long_emas[long_periods[-1]].iloc[-1])
    if longest_long > 0:
        separation_pct = (shortest_short - longest_long) / longest_long
    else:
        separation_pct = 0.0

    # --- Detect bullish crossover within lookback window ---
    # A crossover is defined as: N days ago short group was below long group,
    # and now (or more recently) it crossed above.
    crossover_day = None
    for i in range(1, min(lookback + 1, len(df))):
        # Values i days ago
        short_vals_prev = [float(short_emas[p].iloc[-(i+1)]) for p in short_periods]
        long_vals_prev  = [float(long_emas[p].iloc[-(i+1)])  for p in long_periods]
        # Values i-1 days ago (one day later)
        short_vals_curr = [float(short_emas[p].iloc[-i]) for p in short_periods]
        long_vals_curr  = [float(long_emas[p].iloc[-i])  for p in long_periods]

        was_below = min(short_vals_prev) < max(long_vals_prev)
        is_above  = min(short_vals_curr) > max(long_vals_curr)
        if was_below and is_above:
            crossover_day = i
            break

    had_recent_crossover = crossover_day is not None

    # --- Check filters ---
    reason = None
    if req_alignment and not is_bullish_aligned:
        reason = f"Short group not above long group (min_short={min_short:.2f}, max_long={max_long:.2f})"
    elif is_bullish_aligned and separation_pct < min_sep_pct:
        reason = f"Group separation too narrow ({separation_pct*100:.2f}% < {min_sep_pct*100:.2f}%)"
    elif not is_bullish_aligned and not had_recent_crossover:
        reason = "No bullish alignment and no recent crossover detected"

    is_gmma = (reason is None)

    # --- Build EMA snapshot for chart rendering ---
    short_ema_values = {str(p): round(float(short_emas[p].iloc[-1]), 4) for p in short_periods}
    long_ema_values  = {str(p): round(float(long_emas[p].iloc[-1]), 4)  for p in long_periods}

    return {
        "is_gmma": is_gmma,
        "reason": reason,
        "is_bullish_aligned": is_bullish_aligned,
        "had_recent_crossover": had_recent_crossover,
        "crossover_days_ago": crossover_day,
        "separation_pct": round(separation_pct * 100, 2),
        "short_ema_values": short_ema_values,
        "long_ema_values": long_ema_values,
        "min_short": round(min_short, 4),
        "max_long": round(max_long, 4),
    }


def run_scan(universe_name="nasdaq100", custom_tickers=None, ma20_params=None, vcp_params=None, gmma_params=None):
    """
    Main scanner orchestrator.
    Downloads data for the selected universe and returns lists of matching stocks.
    """
    if ma20_params is None:
        ma20_params = config.MA20_PULLBACK_PARAMS
    if vcp_params is None:
        vcp_params = config.VCP_PARAMS
    if gmma_params is None:
        gmma_params = config.GMMA_PARAMS
        
    # 1. Fetch Tickers
    universe_lower = universe_name.lower()
    if "dow" in universe_lower:
        tickers = get_dow30_tickers()
        if not tickers:
            tickers = config.DOW_30_FALLBACK
    elif "nasdaq100" in universe_lower or "nasdaq_100" in universe_lower:
        tickers = get_nasdaq100_tickers()
        if not tickers:
            tickers = config.NASDAQ_100_FALLBACK
    elif "nasdaq" in universe_lower:
        tickers = get_exchange_tickers("nasdaq")
    elif "nyse" in universe_lower:
        tickers = get_exchange_tickers("nyse")
    elif "amex" in universe_lower:
        tickers = get_exchange_tickers("amex")
    elif "sp500" in universe_lower or "s&p" in universe_lower or "500" in universe_lower:
        tickers = get_sp500_tickers()
        if not tickers:
            # Fall back to Nasdaq 100 constituents if Wikipedia fails completely
            tickers = config.NASDAQ_100_FALLBACK
    elif "all_index" in universe_lower or "allindex" in universe_lower:
        print("Fetching All Index tickers (Dow Jones + Nasdaq 100 + S&P 500)...")
        dow_t = get_dow30_tickers()
        nas_t = get_nasdaq100_tickers()
        sp_t  = get_sp500_tickers()
        if not dow_t: dow_t = config.DOW_30_FALLBACK
        if not nas_t: nas_t = config.NASDAQ_100_FALLBACK
        if not sp_t:  sp_t = getattr(config, "SP_500_FALLBACK", config.NASDAQ_100_FALLBACK)
        tickers = dow_t + nas_t + sp_t
    elif "all_usa" in universe_lower or "usa" in universe_lower:
        # Combine all three major US exchanges
        print("Fetching All USA tickers (NASDAQ + NYSE + AMEX)...")
        nasdaq_t = get_exchange_tickers("nasdaq")
        nyse_t   = get_exchange_tickers("nyse")
        amex_t   = get_exchange_tickers("amex")
        tickers  = nasdaq_t + nyse_t + amex_t
        if not tickers:
            tickers = config.NASDAQ_100_FALLBACK
    elif "custom" in universe_lower or "watchlist" in universe_lower:
        if custom_tickers:
            tickers = custom_tickers
        else:
            try:
                if config.json_exists("custom_watchlists.json"):
                    wl_data = config.read_json("custom_watchlists.json")
                    all_t = []
                    for wl in wl_data.get("watchlists", []):
                        all_t.extend(wl.get("tickers", []))
                    tickers = list(set(all_t)) if all_t else config.DEFAULT_WATCHLIST
                else:
                    tickers = config.DEFAULT_WATCHLIST
            except Exception as e:
                print(f"Error reading custom_watchlists.json: {e}")
                tickers = config.DEFAULT_WATCHLIST
    else:
        tickers = config.DEFAULT_WATCHLIST
        
    tickers = sorted(list(set(tickers)))
    print(f"Scanning {len(tickers)} tickers in universe '{universe_name}'...")
    
    ma20_alerts = []
    vcp_alerts = []
    gmma_alerts = []
    gmma_all = []
    failed_stocks = []
    
    # 2. Download Data in batches of 200 to prevent API timeouts or rate limits
    batch_size = 200
    for start_idx in range(0, len(tickers), batch_size):
        batch_tickers = tickers[start_idx : start_idx + batch_size]
        print(f"Downloading batch {start_idx // batch_size + 1} of {(len(tickers) - 1) // batch_size + 1} ({len(batch_tickers)} tickers)...")
        
        try:
            data = yf.download(batch_tickers, period="4y", interval="1d", group_by="ticker", progress=False)
        except Exception as e:
            print(f"Failed to download batch {start_idx // batch_size + 1}: {e}")
            for ticker in batch_tickers:
                failed_stocks.append({"ticker": ticker, "error": f"Batch download failed: {str(e)}"})
            continue
            
        for ticker in batch_tickers:
            try:
                # Handle single ticker downloads (which return different DataFrame shape than multi-ticker)
                if len(batch_tickers) == 1:
                    ticker_df = data
                else:
                    if ticker not in data.columns.levels[0]:
                        continue
                    ticker_df = data[ticker].dropna()
                    
                if len(ticker_df) < 250:
                    continue
                    
                close_price = float(ticker_df["Close"].iloc[-1])
                volume = float(ticker_df["Volume"].iloc[-1])
                
                # Check MA20 Pullback
                ma20_res = check_ma20_pullback(ticker_df, ma20_params)
                if ma20_res["is_pullback"]:
                    ma20_alerts.append({
                        "ticker": ticker,
                        "close": close_price,
                        "volume": volume,
                        "ma20": ma20_res["ma20"],
                        "low": ma20_res["low"],
                        "distance_pct": ma20_res["distance_pct"]
                    })
                    
                # Check VCP
                vcp_res = check_vcp(ticker_df, vcp_params)
                if vcp_res["is_vcp"]:
                    vcp_alerts.append({
                        "ticker": ticker,
                        "close": close_price,
                        "volume": volume,
                        "depths": vcp_res["depths"],
                        "final_tightness": vcp_res["final_tightness"],
                        "volume_dryup_ratio": vcp_res["volume_dryup_ratio"],
                        "last_10d_range": vcp_res["last_10d_range"],
                        "contractions": vcp_res["contractions"]
                    })
                    
                # Check GMMA
                gmma_res = check_gmma(ticker_df, gmma_params)
                if "short_ema_values" in gmma_res:
                    gmma_detail = {
                        "ticker": ticker,
                        "close": close_price,
                        "volume": volume,
                        "is_bullish_aligned": gmma_res["is_bullish_aligned"],
                        "had_recent_crossover": gmma_res["had_recent_crossover"],
                        "crossover_days_ago": gmma_res["crossover_days_ago"],
                        "separation_pct": gmma_res["separation_pct"],
                        "short_ema_values": gmma_res["short_ema_values"],
                        "long_ema_values": gmma_res["long_ema_values"],
                    }
                    if universe_name.lower() in ["custom", "watchlist", "all_index"]:
                        gmma_all.append(gmma_detail)
                    
                    if gmma_res["is_gmma"]:
                        gmma_alerts.append(gmma_detail)

                # Cache stock historical data for chart panel retrieval
                # To keep things fast, we store historical prices of alerts in the cache
                # and all custom watchlist stocks so they can be viewed on the chart
                if (ma20_res["is_pullback"] or 
                    vcp_res["is_vcp"] or 
                    gmma_res["is_gmma"] or 
                    (universe_name.lower() in ["custom", "watchlist", "custom watchlist", "all_index"] and "short_ema_values" in gmma_res)):
                    hist_data = {
                        "dates": [d.strftime("%Y-%m-%d") for d in ticker_df.index],
                        "open": ticker_df["Open"].tolist(),
                        "high": ticker_df["High"].tolist(),
                        "low": ticker_df["Low"].tolist(),
                        "close": ticker_df["Close"].tolist(),
                        "volume": ticker_df["Volume"].tolist(),
                        "fetched_4y": True
                    }
                    config.write_json(f"stocks/{ticker}.json", hist_data)
                        
            except Exception as e:
                failed_stocks.append({"ticker": ticker, "error": str(e)})
            
    # Resolve company names for alerts
    unique_tickers = list(set(
        [a["ticker"] for a in ma20_alerts] +
        [a["ticker"] for a in vcp_alerts] +
        [a["ticker"] for a in gmma_alerts] +
        [a["ticker"] for a in gmma_all]
    ))
    ticker_names = {}
    print(f"Pre-caching company details for {len(unique_tickers)} tickers...")
    import concurrent.futures
    import json
    from main import get_stock_details
    from fastapi.responses import Response
    
    def fetch_detail(t):
        try:
            res = get_stock_details(t)
            if isinstance(res, Response):
                data = json.loads(res.body)
                return t, data.get("name", t)
            elif isinstance(res, dict):
                return t, res.get("name", t)
        except Exception as e:
            print(f"Error fetching detail for {t}: {e}")
        return t, t
        
    with concurrent.futures.ThreadPoolExecutor(max_workers=20) as executor:
        results = list(executor.map(fetch_detail, unique_tickers))
        
    for t, name in results:
        ticker_names[t] = name
            
    for a in ma20_alerts:
        a["name"] = ticker_names.get(a["ticker"], a["ticker"])
    for a in vcp_alerts:
        a["name"] = ticker_names.get(a["ticker"], a["ticker"])
    for a in gmma_alerts:
        a["name"] = ticker_names.get(a["ticker"], a["ticker"])
    for a in gmma_all:
        a["name"] = ticker_names.get(a["ticker"], a["ticker"])

    scan_results = {
        "timestamp": datetime.now().isoformat(),
        "universe": universe_name,
        "scanned_count": len(tickers),
        "ma20_alerts": ma20_alerts,
        "vcp_alerts": vcp_alerts,
        "gmma_alerts": gmma_alerts,
        "gmma_all": gmma_all,
        "failed_stocks": failed_stocks
    }
    
    # Save results to cache file
    config.write_json("scan_results.json", scan_results, indent=2)
    config.write_json(f"scan_results_{universe_name.lower()}.json", scan_results, indent=2)
    
    return scan_results
