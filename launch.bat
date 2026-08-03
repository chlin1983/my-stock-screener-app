@echo off
echo Starting Stock Investment App...

:: Start the Python FastAPI backend in a new command prompt window
start "Stock Screener Backend" cmd /k "cd backend && python main.py"

:: Start the Vite/React frontend dev server in another command prompt window
start "Stock Screener Frontend" cmd /k "cd frontend && npm run dev"

echo.
echo Both servers have been launched in separate windows!
echo - Backend: http://127.0.0.1:8000
echo - Frontend: http://localhost:5173/
echo.

:: Wait briefly to ensure the frontend server has started, then open the browser
timeout /t 3 /nobreak > NUL
start http://localhost:5173/

pause
