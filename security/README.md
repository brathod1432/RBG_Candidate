# Security — Threat Detection & Hardening

Security utilities and threat detection for RBG Candidate.

## Purpose
MITRE ATT&CK-mapped threat hunting, IOC sweeping, anomaly detection (z-score), and secure coding patterns.

## Development
```bash
cd security
..\.venv\Scripts\python.exe -m pip install -r ..\server\requirements.txt
```

## Testing
```bash
cd security
..\.venv\Scripts\pytest -v
```

## Usage
Import modules from `security.src` in server routes or background workers.
No standalone entrypoint — library only.