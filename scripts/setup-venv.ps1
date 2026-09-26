# RBG Candidate — venv-only setup (never touches system Python).
# Run: powershell -ExecutionPolicy Bypass -File scripts\setup-venv.ps1
$ErrorActionPreference = "Stop"
$VenvPy = Join-Path $PSScriptRoot "..\.venv\Scripts\python.exe"
if (-not (Test-Path $VenvPy)) { throw "venv python not found at $VenvPy" }
& $VenvPy --version
& $VenvPy -m pip install --upgrade pip
& $VenvPy -m pip install -r (Join-Path $PSScriptRoot "..\server\requirements-dev.txt")
& $VenvPy -m pip list --format=columns
& $VenvPy -c "import fastapi, uvicorn, httpx, pydantic, jose, dotenv, pytest, respx; print('venv imports OK')"
