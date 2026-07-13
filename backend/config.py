import os
import json

# Paths
BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# Load environment variables from .env.local (if it exists)
ENV_FILE = os.path.join(BASE_DIR, ".env.local")
if os.path.exists(ENV_FILE):
    with open(ENV_FILE, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, _, value = line.partition("=")
                os.environ.setdefault(key.strip(), value.strip())

# Check storage environment configuration
STORAGE_TYPE = os.environ.get("STORAGE_TYPE", "local").lower()  # 'local' or 'gcs'
GCS_BUCKET_NAME = os.environ.get("GCS_BUCKET_NAME", "")
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")

# Local cache paths
LOCAL_CACHE_DIR = os.path.join(BASE_DIR, "cache")
LOCAL_STOCK_DATA_CACHE_DIR = os.path.join(LOCAL_CACHE_DIR, "stocks")

# For backward compatibility
CACHE_DIR = LOCAL_CACHE_DIR
STOCK_DATA_CACHE_DIR = LOCAL_STOCK_DATA_CACHE_DIR
SCAN_RESULTS_FILE = os.path.join(CACHE_DIR, "scan_results.json")

# Ensure local directories exist if running locally
if STORAGE_TYPE == "local":
    os.makedirs(LOCAL_CACHE_DIR, exist_ok=True)
    os.makedirs(LOCAL_STOCK_DATA_CACHE_DIR, exist_ok=True)

# --- GCS Helper Client ---
_gcs_client = None
_gcs_bucket = None

def _get_gcs_bucket():
    global _gcs_client, _gcs_bucket
    if STORAGE_TYPE != "gcs" or not GCS_BUCKET_NAME:
        return None
    if _gcs_bucket is None:
        try:
            from google.cloud import storage
            _gcs_client = storage.Client()
            _gcs_bucket = _gcs_client.bucket(GCS_BUCKET_NAME)
        except Exception as e:
            print(f"Error initializing GCS client: {e}")
            return None
    return _gcs_bucket

# --- Helper Functions for File Operations ---

def json_exists(relative_path: str) -> bool:
    """Checks if a JSON file exists (either locally or in GCS)."""
    if STORAGE_TYPE == "gcs":
        bucket = _get_gcs_bucket()
        if bucket:
            path = relative_path.replace("\\", "/").lstrip("./")
            blob = bucket.blob(path)
            return blob.exists()
    
    local_path = os.path.join(LOCAL_CACHE_DIR, relative_path)
    return os.path.exists(local_path)

def get_json_mtime(relative_path: str) -> float:
    """Gets the modification time of a JSON file."""
    if STORAGE_TYPE == "gcs":
        bucket = _get_gcs_bucket()
        if bucket:
            path = relative_path.replace("\\", "/").lstrip("./")
            blob = bucket.blob(path)
            if blob.exists():
                blob.reload()  # Update metadata
                if blob.updated:
                    return blob.updated.timestamp()
            return 0.0
            
    local_path = os.path.join(LOCAL_CACHE_DIR, relative_path)
    if os.path.exists(local_path):
        return os.path.getmtime(local_path)
    return 0.0

def read_json(relative_path: str) -> dict:
    """Reads a JSON file from local or GCS storage."""
    if STORAGE_TYPE == "gcs":
        bucket = _get_gcs_bucket()
        if bucket:
            path = relative_path.replace("\\", "/").lstrip("./")
            blob = bucket.blob(path)
            if blob.exists():
                data_str = blob.download_as_text(encoding="utf-8")
                return json.loads(data_str)
            raise FileNotFoundError(f"GCS object {path} not found.")
            
    local_path = os.path.join(LOCAL_CACHE_DIR, relative_path)
    with open(local_path, "r", encoding="utf-8") as f:
        return json.load(f)

def write_json(relative_path: str, data: dict, indent: int = None) -> None:
    """Writes a JSON file to local or GCS storage."""
    if STORAGE_TYPE == "gcs":
        bucket = _get_gcs_bucket()
        if bucket:
            path = relative_path.replace("\\", "/").lstrip("./")
            blob = bucket.blob(path)
            data_str = json.dumps(data, indent=indent)
            blob.upload_from_string(data_str, content_type="application/json")
            return
            
    local_path = os.path.join(LOCAL_CACHE_DIR, relative_path)
    os.makedirs(os.path.dirname(local_path), exist_ok=True)
    with open(local_path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=indent)


# Default Strategy Parameters
MA20_PULLBACK_PARAMS = {
    "tolerance_pct": 0.5,        # Distance from MA20 (0.5% tolerance)
    "min_pullback_days": 2,      # Minimum consecutive down/flat days
    "trend_filter": True         # Ensure price is above MA200 and MA50 > MA200
}

VCP_PARAMS = {
    "trend_template": True,      # Enforce Mark Minervini's Stage 2 Trend Template
    "max_tightness_pct": 8.0,    # Final contraction must be <= 8% wide
    "volume_dryup_pct": 65.0,    # Last 5 days avg volume must be <= 65% of 50-day avg volume
    "min_contractions": 2,       # Minimum number of contractions (T's)
    "max_contractions": 4,       # Maximum number of contractions
    "consolidation_days": 100,   # Lookback period for VCP pattern
}

# GMMA (Guppy Multiple Moving Average) Parameters
# Short-term group: EMA 3, 5, 8, 10, 12, 15  (represents short-term traders)
# Long-term group:  EMA 30, 35, 40, 45, 50, 60 (represents long-term investors)
GMMA_PARAMS = {
    "require_bullish_alignment": True,   # Short-term group must be entirely above long-term group
    "crossover_lookback_days": 10,       # Days to look back for a recent bullish crossover event
    "min_separation_pct": 0.5,           # Min % spread between the groups to avoid whipsaw signals
    "short_periods": [3, 5, 8, 10, 12, 15],   # Short-term EMA periods (traders)
    "long_periods": [30, 35, 40, 45, 50, 60],  # Long-term EMA periods (investors)
}

# Fallback Ticker Lists (if Wikipedia scraping fails)
DOW_30_FALLBACK = [
    "AAPL", "AMZN", "AXP", "BA", "CAT", "CSCO", "CVX", "DIS", "GS", "HD",
    "HON", "IBM", "INTC", "JNJ", "JPM", "KO", "MCD", "MMM", "MRK", "MSFT",
    "NKE", "PG", "CRM", "TRV", "UNH", "VZ", "V", "WMT", "DIS", "AXP"
]

NASDAQ_100_FALLBACK = [
    # Top 10 by market cap
    "AAPL", "MSFT", "NVDA", "AMZN", "META", "GOOGL", "GOOG", "TSLA", "AVGO", "COST",
    # 11-20
    "NFLX", "ASML", "AZN", "PEP", "LIN", "QCOM", "CSCO", "TXN", "ISRG", "AMGN",
    # 21-30
    "INTU", "HON", "CMCSA", "VRTX", "AMAT", "BKNG", "ADI", "MU", "REGN", "GILD",
    # 31-40
    "PANW", "LRCX", "KLAC", "MDLZ", "CDNS", "SNPS", "SBUX", "CTAS", "MELI", "FTNT",
    # 41-50
    "ORLY", "NXPI", "INTC", "ADSK", "MAR", "KDP", "WDAY", "PAYX", "PCAR", "ROST",
    # 51-60
    "IDXX", "CPRT", "FAST", "EA", "GEHC", "CRWD", "DXCM", "MRVL", "VRSK", "ABNB",
    # 61-70
    "ROP", "MNST", "ODFL", "DLTR", "AEP", "BIIB", "TEAM", "KHC", "FANG", "EXC",
    # 71-80  (ANSS removed — acquired by Synopsys Jan 2024)
    "CTSH", "DDOG", "TTD", "MRNA", "ON", "ZS", "CEG", "XEL", "CSGP", "CCEP",
    # 81-90
    "TTWO", "SIRI", "ILMN", "ALGN", "MDB", "ARM", "DASH", "SMCI", "PLTR", "AMD",
    # 91-101
    "ADP", "ADBE", "CDW", "GFS", "MCHP", "PDD", "PYPL", "WBD", "MSTR", "APP", "COIN",
]

DEFAULT_WATCHLIST = ["AAPL", "MSFT", "NVDA", "AMZN", "TSLA", "META", "NFLX", "AMD", "SMCI", "PLTR"]
