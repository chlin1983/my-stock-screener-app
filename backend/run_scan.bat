@echo off
REM Switch terminal to UTF-8 to display special characters correctly
chcp 65001 >nul
set PYTHONIOENCODING=utf-8
title My Stock Screener - Local Scan Runner
color 0A

echo.
echo ============================================================
echo   My Stock Screener - Local Scan Runner
echo ============================================================
echo.

REM ---------------------------------------------------------------
REM  Change to the backend directory (same folder as this .bat file)
REM ---------------------------------------------------------------
cd /d "%~dp0"

REM ---------------------------------------------------------------
REM  Check Python is available
REM ---------------------------------------------------------------
where python >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Python not found in PATH.
    echo         Please install Python 3.10+ and add it to your PATH.
    echo.
    pause
    exit /b 1
)

REM ---------------------------------------------------------------
REM  Check required packages are installed
REM ---------------------------------------------------------------
python -c "import yfinance, pandas, numpy, scipy, fastapi, google.cloud.storage" >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [INFO] Installing required packages from requirements.txt...
    echo.
    pip install -r requirements.txt
    if %ERRORLEVEL% NEQ 0 (
        echo.
        echo [ERROR] Failed to install packages.
        pause
        exit /b 1
    )
    echo.
)

REM ---------------------------------------------------------------
REM  Run the scan job (passes any command-line args along)
REM  e.g. run_scan.bat nasdaq100
REM       run_scan.bat all_usa
REM ---------------------------------------------------------------
python scanner_job.py %*

REM ---------------------------------------------------------------
REM  The Python script already calls input("Press Enter to close...")
REM  so the window stays open after completion or error.
REM ---------------------------------------------------------------
