"""
scanner_job.py — Standalone Local Scan Runner
==============================================
Run this script directly on your local PC to perform a stock scan and
save results to Google Cloud Storage (GCS). No FastAPI server needed.

Usage:
    python scanner_job.py [universe]

    universe: watchlist | dow30 | nasdaq100 | sp500 | nasdaq | nyse | amex | all_usa
              (default: interactive prompt)

Examples:
    python scanner_job.py
    python scanner_job.py nasdaq100
    python scanner_job.py all_usa
    python scanner_job.py sp500

Or just double-click run_scan.bat for a menu-driven experience.
"""

import os
import sys
import time
from datetime import datetime

# ---------------------------------------------------------------------------
# 1. Load environment variables from .env.local (if it exists)
# ---------------------------------------------------------------------------
ENV_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env.local")
if os.path.exists(ENV_FILE):
    with open(ENV_FILE, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, _, value = line.partition("=")
                os.environ.setdefault(key.strip(), value.strip())
    print(f"[INFO] Loaded environment from .env.local")
else:
    print(f"[WARN] No .env.local found — using shell environment variables.")

# ---------------------------------------------------------------------------
# 2. Validate required environment variables
# ---------------------------------------------------------------------------
STORAGE_TYPE = os.environ.get("STORAGE_TYPE", "local").lower()
GCS_BUCKET   = os.environ.get("GCS_BUCKET_NAME", "")

print()
print("=" * 60)
print("  My Stock Screener — Local Scan Runner")
print("=" * 60)
print(f"  Storage Mode  : {STORAGE_TYPE.upper()}")
if STORAGE_TYPE == "gcs":
    if not GCS_BUCKET:
        print()
        print("[ERROR] GCS_BUCKET_NAME is not set.")
        print("        Please add it to backend/.env.local")
        print("        See .env.local.example for reference.")
        if sys.stdin and sys.stdin.isatty():
            try:
                input("\nPress Enter to exit...")
            except EOFError:
                pass
        sys.exit(1)
    print(f"  GCS Bucket    : {GCS_BUCKET}")
    GOOGLE_CREDS = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS", "")
    if GOOGLE_CREDS:
        print(f"  GCP Creds     : {GOOGLE_CREDS}")
    else:
        print("  GCP Creds     : (Application Default Credentials)")
else:
    print("  Results saved : locally in backend/cache/")
    print("  [TIP] Set STORAGE_TYPE=gcs in .env.local to sync across PCs")

# ---------------------------------------------------------------------------
# 3. Parse universe argument or show interactive menu
# ---------------------------------------------------------------------------
VALID_UNIVERSES = [
    ("dow30",     "Dow Jones 30         (~30 stocks, very fast)"),
    ("nasdaq100", "Nasdaq 100           (~100 stocks, fast)      <-- recommended"),
    ("sp500",     "S&P 500              (~500 stocks, moderate)"),
    ("nasdaq",    "Full NASDAQ Exchange (~4,000 stocks, slow)"),
    ("nyse",      "Full NYSE Exchange   (~2,500 stocks, slow)"),
    ("amex",      "AMEX Exchange        (~500 stocks, moderate)"),
    ("all_usa",   "All USA              (~8,000 stocks, very slow first run)"),
    ("watchlist", "Custom Watchlist     (tickers in config.py DEFAULT_WATCHLIST)"),
]
UNIVERSE_KEYS = [u[0] for u in VALID_UNIVERSES]

universe = None

# Check for command-line argument
if len(sys.argv) > 1:
    arg = sys.argv[1].lower().strip()
    if arg in UNIVERSE_KEYS:
        universe = arg
    else:
        print(f"\n[ERROR] Unknown universe '{arg}'")
        print(f"        Valid options: {', '.join(UNIVERSE_KEYS)}")
        sys.exit(1)

# Interactive prompt if no argument provided
if universe is None:
    print()
    print("Select universe to scan:")
    print()
    for i, (key, desc) in enumerate(VALID_UNIVERSES, 1):
        print(f"  [{i}] {desc}")
    print()

    while True:
        choice = input("Enter number or name (default=2 for nasdaq100): ").strip()

        if choice == "":
            universe = "nasdaq100"
            break
        elif choice.isdigit():
            idx = int(choice) - 1
            if 0 <= idx < len(VALID_UNIVERSES):
                universe = VALID_UNIVERSES[idx][0]
                break
            else:
                print(f"[ERROR] Please enter a number between 1 and {len(VALID_UNIVERSES)}")
        elif choice.lower() in UNIVERSE_KEYS:
            universe = choice.lower()
            break
        else:
            print(f"[ERROR] Unknown input '{choice}'. Try a number or universe name.")

print()
print(f"[INFO] Universe selected : {universe.upper()}")
print("-" * 60)

# ---------------------------------------------------------------------------
# 4. Import scanner modules (after env vars are set so config.py picks them up)
# ---------------------------------------------------------------------------
try:
    import config
    import scanner
except ImportError as e:
    print(f"\n[ERROR] Could not import scanner modules: {e}")
    print("        Make sure you run this from inside the backend/ directory,")
    print("        or use the provided run_scan.bat launcher.")
    if sys.stdin and sys.stdin.isatty():
        try:
            input("\nPress Enter to exit...")
        except EOFError:
            pass
    sys.exit(1)

# ---------------------------------------------------------------------------
# 5. Run the scan
# ---------------------------------------------------------------------------
start_time = time.time()
print(f"[{datetime.now().strftime('%H:%M:%S')}] Scan started...\n")

try:
    results = scanner.run_scan(
        universe_name=universe,
        ma20_params=config.MA20_PULLBACK_PARAMS,
        vcp_params=config.VCP_PARAMS,
        gmma_params=config.GMMA_PARAMS,
    )
except KeyboardInterrupt:
    print("\n\n[INTERRUPTED] Scan cancelled by user (Ctrl+C).")
    if sys.stdin and sys.stdin.isatty():
        try:
            input("\nPress Enter to exit...")
        except EOFError:
            pass
    sys.exit(0)
except Exception as e:
    print(f"\n[ERROR] Scan failed: {e}")
    import traceback
    traceback.print_exc()
    if sys.stdin and sys.stdin.isatty():
        try:
            input("\nPress Enter to exit...")
        except EOFError:
            pass
    sys.exit(1)

# ---------------------------------------------------------------------------
# 6. Print results summary
# ---------------------------------------------------------------------------
elapsed  = time.time() - start_time
mins, secs = divmod(int(elapsed), 60)

print()
print("=" * 60)
print("  [SUCCESS] SCAN COMPLETE")
print("=" * 60)
print(f"  Universe      : {results.get('universe', universe)}")
print(f"  Stocks Scanned: {results.get('scanned_count', 0):,}")
print(f"  MA20 Alerts   : {len(results.get('ma20_alerts', []))}")
print(f"  VCP Alerts    : {len(results.get('vcp_alerts', []))}")
print(f"  GMMA Alerts   : {len(results.get('gmma_alerts', []))}")
print(f"  Failed        : {len(results.get('failed_stocks', []))}")
print(f"  Time Taken    : {mins}m {secs}s")
print()

if STORAGE_TYPE == "gcs":
    print(f"  [GCS] Results pushed to GCS bucket: gs://{GCS_BUCKET}/")
    print(f"     -> Open your Firebase app on ANY PC to view results")
else:
    cache_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "cache", "scan_results.json")
    print(f"  [LOCAL] Results saved locally:")
    print(f"     {cache_path}")
    print()
    print(f"  [TIP] Set STORAGE_TYPE=gcs in .env.local to share")
    print(f"        results across all your PCs via your Firebase app.")

print("=" * 60)
print()
if sys.stdin and sys.stdin.isatty():
    try:
        input("Press Enter to close this window...")
    except EOFError:
        pass
