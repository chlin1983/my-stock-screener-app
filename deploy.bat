@echo off
echo Building and Deploying Stock Screener App to Firebase...
echo.

:: Navigate to the frontend directory and run the deploy script
cd /d "%~dp0frontend"
call npm run deploy

echo.
if %ERRORLEVEL% NEQ 0 (
    color 0C
    echo [ERROR] Deployment failed! Please check the logs above.
) else (
    color 0A
    echo [SUCCESS] Deploy complete!
    echo Live site: https://my-stock-screener-app.web.app
)

echo.
pause
