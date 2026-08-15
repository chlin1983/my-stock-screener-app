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

# If GOOGLE_APPLICATION_CREDENTIALS is set but the file does not exist,
# remove it to allow fallback to Application Default Credentials (ADC) on Cloud Run/GCP.
creds_path = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS")
if creds_path and not os.path.exists(creds_path):
    print(f"Warning: GOOGLE_APPLICATION_CREDENTIALS file not found at '{creds_path}'. "
          "Removing from environment to fallback to Application Default Credentials (ADC).")
    os.environ.pop("GOOGLE_APPLICATION_CREDENTIALS", None)

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
    """Checks if a JSON file exists (either locally or in GCS). Prioritizes local cache."""
    local_path = os.path.join(LOCAL_CACHE_DIR, relative_path)
    if os.path.exists(local_path):
        return True
        
    if STORAGE_TYPE == "gcs":
        bucket = _get_gcs_bucket()
        if bucket:
            path = relative_path.replace("\\", "/").lstrip("./")
            blob = bucket.get_blob(path)
            return blob is not None
            
    return False

def get_json_mtime(relative_path: str) -> float:
    """Gets the modification time of a JSON file. Prioritizes local cache."""
    local_path = os.path.join(LOCAL_CACHE_DIR, relative_path)
    if os.path.exists(local_path):
        return os.path.getmtime(local_path)
        
    if STORAGE_TYPE == "gcs":
        bucket = _get_gcs_bucket()
        if bucket:
            path = relative_path.replace("\\", "/").lstrip("./")
            blob = bucket.get_blob(path)
            if blob and blob.updated:
                return blob.updated.timestamp()
            
    return 0.0
def read_json_raw(relative_path: str) -> str:
    """Reads a JSON file as a raw string, ensuring fresh data from GCS if configured."""
    local_path = os.path.join(LOCAL_CACHE_DIR, relative_path)
    
    # If using GCS, ALWAYS fetch from GCS to ensure we get the latest nightly scan
    if STORAGE_TYPE == "gcs":
        bucket = _get_gcs_bucket()
        if bucket:
            path = relative_path.replace("\\", "/").lstrip("./")
            blob = bucket.get_blob(path)
            if blob:
                data_str = blob.download_as_text(encoding="utf-8")
                # Save a local copy just in case, but we won't rely on it next time
                os.makedirs(os.path.dirname(local_path), exist_ok=True)
                with open(local_path, "w", encoding="utf-8") as f:
                    f.write(data_str)
                return data_str
            raise FileNotFoundError(f"GCS object {path} not found.")
            
    # If not using GCS or as a fallback for local dev, read from local cache
    if os.path.exists(local_path):
        with open(local_path, "r", encoding="utf-8") as f:
            return f.read()
            
    raise FileNotFoundError(f"Local file {local_path} not found.")

def read_json(relative_path: str) -> dict:
    """Reads a JSON file from local or GCS storage and returns a dict."""
    data_str = read_json_raw(relative_path)
    return json.loads(data_str)

def write_json(relative_path: str, data: dict, indent: int = None) -> None:
    """Writes a JSON file to local storage, and optionally to GCS."""
    local_path = os.path.join(LOCAL_CACHE_DIR, relative_path)
    os.makedirs(os.path.dirname(local_path), exist_ok=True)
    with open(local_path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=indent)

    if STORAGE_TYPE == "gcs":
        bucket = _get_gcs_bucket()
        if bucket:
            path = relative_path.replace("\\", "/").lstrip("./")
            blob = bucket.blob(path)
            data_str = json.dumps(data, indent=indent)
            blob.upload_from_string(data_str, content_type="application/json")


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


SP_500_FALLBACK = [
    # 1-10
    "MMM", "AOS", "ABT", "ABBV", "ACN", "ADBE", "AMD", "AES", "AFL", "A",
    # 11-20
    "APD", "ABNB", "AKAM", "ALB", "ARE", "ALGN", "ALLE", "LNT", "ALL", "GOOGL",
    # 21-30
    "GOOG", "MO", "AMZN", "AMCR", "AEE", "AEP", "AXP", "AIG", "AMT", "AWK",
    # 31-40
    "AMP", "AME", "AMGN", "APH", "ADI", "AON", "APA", "APO", "AAPL", "AMAT",
    # 41-50
    "APP", "APTV", "ACGL", "ADM", "ARES", "ANET", "AJG", "AIZ", "T", "ATO",
    # 51-60
    "ADSK", "ADP", "AZO", "AVB", "AVY", "AXON", "BKR", "BALL", "BAC", "BAX",
    # 61-70
    "BDX", "BRK-B", "BBY", "TECH", "BIIB", "BLK", "BX", "XYZ", "BNY", "BA",
    # 71-80
    "BKNG", "BSX", "BMY", "AVGO", "BR", "BRO", "BF-B", "BLDR", "BG", "BXP",
    # 81-90
    "CHRW", "CDNS", "CPT", "COF", "CAH", "CCL", "CARR", "CVNA", "CASY", "CAT",
    # 91-100
    "CBOE", "CBRE", "CDW", "COR", "CNC", "CNP", "CF", "CRL", "SCHW", "CHTR",
    # 101-110
    "CVX", "CMG", "CB", "CHD", "CIEN", "CI", "CINF", "CTAS", "CSCO", "C",
    # 111-120
    "CFG", "CLX", "CME", "CMS", "KO", "CTSH", "COHR", "COIN", "CL", "CMCSA",
    # 121-130
    "FIX", "COP", "ED", "STZ", "CEG", "COO", "CPRT", "GLW", "CPAY", "CTVA",
    # 131-140
    "CSGP", "COST", "CRH", "CRWD", "CCI", "CSX", "CMI", "CVS", "DHR", "DRI",
    # 141-150
    "DDOG", "DVA", "DECK", "DE", "DELL", "DAL", "DVN", "DXCM", "FANG", "DLR",
    # 151-160
    "DG", "DLTR", "D", "DPZ", "DASH", "DOV", "DOW", "DHI", "DTE", "DUK",
    # 161-170
    "DD", "ETN", "EBAY", "ECHO", "ECL", "EIX", "EW", "EA", "ELV", "EME",
    # 171-180
    "EMR", "ETR", "EOG", "EQT", "EFX", "EQIX", "EQR", "ERIE", "ESS", "EL",
    # 181-190
    "EG", "EVRG", "ES", "EXC", "EXE", "EXPE", "EXPD", "EXR", "XOM", "FFIV",
    # 191-200
    "FDS", "FICO", "FAST", "FRT", "FDX", "FDXF", "FIS", "FITB", "FSLR", "FE",
    # 201-210
    "FISV", "FLEX", "F", "FTNT", "FTV", "FOXA", "FOX", "BEN", "FCX", "GRMN",
    # 211-220
    "IT", "GE", "GEHC", "GEV", "GEN", "GNRC", "GD", "GIS", "GM", "GPC",
    # 221-230
    "GILD", "GPN", "GL", "GDDY", "GS", "HAL", "HIG", "HAS", "HCA", "DOC",
    # 231-240
    "HSIC", "HSY", "HPE", "HLT", "HD", "HONA", "HON", "HRL", "HST", "HWM",
    # 241-250
    "HPQ", "HUBB", "HUM", "HBAN", "HII", "IBM", "IEX", "IDXX", "ITW", "INCY",
    # 251-260
    "IR", "PODD", "INTC", "IBKR", "ICE", "IFF", "IP", "INTU", "ISRG", "IVZ",
    # 261-270
    "INVH", "IQV", "IRM", "JBHT", "JBL", "JKHY", "J", "JNJ", "JCI", "JPM",
    # 271-280
    "KVUE", "KDP", "KEY", "KEYS", "KMB", "KIM", "KMI", "KKR", "KLAC", "KHC",
    # 281-290
    "KR", "LHX", "LH", "LRCX", "LVS", "LDOS", "LEN", "LII", "LLY", "LIN",
    # 291-300
    "LYV", "LMT", "L", "LOW", "LULU", "LITE", "LYB", "MTB", "MPC", "MAR",
    # 301-310
    "MRSH", "MLM", "MRVL", "MAS", "MA", "MKC", "MCD", "MCK", "MDT", "MRK",
    # 311-320
    "META", "MET", "MTD", "MGM", "MCHP", "MU", "MSFT", "MAA", "MRNA", "TAP",
    # 321-330
    "MDLZ", "MPWR", "MNST", "MCO", "MS", "MOS", "MSI", "MSCI", "NDAQ", "NTAP",
    # 331-340
    "NFLX", "NEM", "NWSA", "NWS", "NEE", "NKE", "NI", "NDSN", "NSC", "NTRS",
    # 341-350
    "NOC", "NCLH", "NRG", "NUE", "NVDA", "NVR", "NXPI", "ORLY", "OXY", "ODFL",
    # 351-360
    "OMC", "ON", "OKE", "ORCL", "OTIS", "PCAR", "PKG", "PLTR", "PANW", "PSKY",
    # 361-370
    "PH", "PAYX", "PYPL", "PNR", "PEP", "PFE", "PCG", "PM", "PSX", "PNW",
    # 371-380
    "PNC", "PPG", "PPL", "PFG", "PG", "PGR", "PLD", "PRU", "PEG", "PTC",
    # 381-390
    "PSA", "PHM", "PWR", "QCOM", "DGX", "Q", "RL", "RJF", "RTX", "O",
    # 391-400
    "REG", "REGN", "RF", "RSG", "RMD", "RVTY", "HOOD", "ROK", "ROL", "ROP",
    # 401-410
    "ROST", "RCL", "SPGI", "CRM", "SNDK", "SBAC", "SLB", "STX", "SRE", "NOW",
    # 411-420
    "SHW", "SPG", "SWKS", "SJM", "SW", "SNA", "SOLV", "SO", "LUV", "SWK",
    # 421-430
    "SBUX", "STT", "STLD", "STE", "SYK", "SMCI", "SYF", "SNPS", "SYY", "TMUS",
    # 431-440
    "TROW", "TTWO", "TPR", "TRGP", "TGT", "TEL", "TDY", "TER", "TSLA", "TXN",
    # 441-450
    "TPL", "TXT", "TMO", "TJX", "TKO", "TTD", "TSCO", "TT", "TDG", "TRV",
    # 451-460
    "TRMB", "TFC", "TYL", "TSN", "USB", "UBER", "UDR", "ULTA", "UNP", "UAL",
    # 461-470
    "UPS", "URI", "UNH", "UHS", "VLO", "VEEV", "VTR", "VLTO", "VRSN", "VRSK",
    # 471-480
    "VZ", "VRTX", "VRT", "VTRS", "VICI", "V", "VST", "VMC", "WRB", "GWW",
    # 481-490
    "WAB", "WMT", "DIS", "WBD", "WM", "WAT", "WEC", "WFC", "WELL", "WST",
    # 491-500
    "WDC", "WY", "WSM", "WMB", "WTW", "WDAY", "WYNN", "XEL", "XYL", "YUM",
    # 501-503
    "ZBRA", "ZBH", "ZTS",
]

