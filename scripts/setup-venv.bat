@echo off
REM RBG Candidate — venv setup (never touches system Python).
REM Installs the server's runtime packages first, then dev/test tools, so a
REM dev-tool problem can never leave the server without its packages.
setlocal
cd /d "%~dp0.."
set "VENV_PY=.venv\Scripts\python.exe"
if not exist "%VENV_PY%" (
  echo Creating .venv ...
  py -3.11 -m venv .venv 2>nul || python -m venv .venv
)
if not exist "%VENV_PY%" (
  echo ERROR: venv python not found at %VENV_PY%
  exit /b 1
)
"%VENV_PY%" --version
"%VENV_PY%" -m pip install --upgrade pip
"%VENV_PY%" -m pip install -r server\requirements.txt || exit /b 1
"%VENV_PY%" -c "import fastapi, uvicorn, httpx, pydantic, dotenv; print('server packages OK')" || exit /b 1
"%VENV_PY%" -m pip install -r server\requirements-dev.txt
"%VENV_PY%" -c "import pytest, respx; print('test packages OK')"
endlocal
