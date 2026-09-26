@echo off
REM RBG Candidate — start the local AI server (double-click or run from anywhere).
REM Creates .venv if needed, installs missing server packages, then runs
REM uvicorn on http://127.0.0.1:8000. Leave this window open while you apply.
setlocal
cd /d "%~dp0.."
set "VENV_PY=.venv\Scripts\python.exe"

if not exist "%VENV_PY%" (
  echo [rbg] No .venv found - creating one...
  py -3.11 -m venv .venv 2>nul || python -m venv .venv
  if not exist "%VENV_PY%" (
    echo [rbg] ERROR: could not create .venv. Install Python 3.11+ from python.org and try again.
    pause
    exit /b 1
  )
)

"%VENV_PY%" -c "import fastapi, uvicorn, httpx, pydantic, dotenv" 1>nul 2>nul
if errorlevel 1 (
  echo [rbg] Installing server packages into .venv ^(first run only^)...
  "%VENV_PY%" -m pip install --disable-pip-version-check -r server\requirements.txt
  if errorlevel 1 (
    echo [rbg] ERROR: package install failed - check your internet connection and the messages above.
    pause
    exit /b 1
  )
)

if not exist ".env" (
  echo [rbg] WARNING: no .env file - AI answers need NVIDIA_API_KEY in .env or a key saved in the extension.
)

echo.
echo [rbg] Starting RBG Candidate server on http://127.0.0.1:8000  ^(Ctrl+C to stop^)
echo.
"%VENV_PY%" -m uvicorn server.main:app --host 127.0.0.1 --port 8000
echo.
echo [rbg] Server stopped. If it failed to start, the reason is shown above.
pause
endlocal
