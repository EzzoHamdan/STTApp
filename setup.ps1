# setup.ps1 — Windows setup script for Court STT
# Run with:  .\setup.ps1
# Requires:  Python 3.10+ installed and on PATH

$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  Court STT — Windows Setup" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

# ── 1. Check Python ───────────────────────────────────────────────────────────
Write-Host "[ 1/5 ] Checking Python..." -ForegroundColor Yellow
try {
    $pyVersion = python --version 2>&1
    if ($pyVersion -match "Python (\d+)\.(\d+)") {
        $major = [int]$Matches[1]
        $minor = [int]$Matches[2]
        if ($major -lt 3 -or ($major -eq 3 -and $minor -lt 10)) {
            Write-Host "  ERROR: Python 3.10+ required. Found: $pyVersion" -ForegroundColor Red
            exit 1
        }
        Write-Host "  OK: $pyVersion" -ForegroundColor Green
    }
} catch {
    Write-Host "  ERROR: Python not found. Install from https://python.org" -ForegroundColor Red
    exit 1
}

# ── 2. Create virtual environment ─────────────────────────────────────────────
Write-Host ""
Write-Host "[ 2/5 ] Creating virtual environment (.venv)..." -ForegroundColor Yellow
if (Test-Path ".venv") {
    Write-Host "  .venv already exists — skipping creation." -ForegroundColor DarkGray
} else {
    python -m venv .venv
    Write-Host "  Created .venv" -ForegroundColor Green
}

# ── 3. Activate + upgrade pip ─────────────────────────────────────────────────
Write-Host ""
Write-Host "[ 3/5 ] Activating environment & upgrading pip..." -ForegroundColor Yellow
& .\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip --quiet
Write-Host "  pip upgraded." -ForegroundColor Green

# ── 4. Install dependencies ───────────────────────────────────────────────────
Write-Host ""
Write-Host "[ 4/5 ] Installing dependencies..." -ForegroundColor Yellow
pip install -r requirements.txt
Write-Host "  Dependencies installed." -ForegroundColor Green

# ── 5. Check / create .env ───────────────────────────────────────────────────
Write-Host ""
Write-Host "[ 5/5 ] Checking .env..." -ForegroundColor Yellow
if (Test-Path ".env") {
    Write-Host "  .env found." -ForegroundColor Green
} else {
    Copy-Item ".env.example" ".env" -ErrorAction SilentlyContinue
    if (-not (Test-Path ".env")) {
        # Create a blank template
        @"
AZURE_SPEECH_KEY=YOUR_KEY_HERE
AZURE_SPEECH_REGION=uaenorth
AZURE_SPEECH_LANGUAGE=ar-JO
"@ | Out-File -FilePath ".env" -Encoding utf8
    }
    Write-Host "  .env created from template. Fill in your Azure key!" -ForegroundColor Yellow
}

# ── Done ───────────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "============================================" -ForegroundColor Green
Write-Host "  Setup complete!" -ForegroundColor Green
Write-Host "============================================" -ForegroundColor Green
Write-Host ""
Write-Host "  IMPORTANT: Make sure .env has your Azure credentials." -ForegroundColor Yellow
Write-Host ""
Write-Host "  To start the web app:" -ForegroundColor White
Write-Host "    .\.venv\Scripts\Activate.ps1" -ForegroundColor Cyan
Write-Host "    python server.py" -ForegroundColor Cyan
Write-Host "    Then open: http://localhost:8000" -ForegroundColor Cyan
Write-Host ""
Write-Host "  To run a quick mic test:" -ForegroundColor White
Write-Host "    python test_mic.py" -ForegroundColor Cyan
Write-Host ""
Write-Host "  To launch all 3 speaker terminals at once:" -ForegroundColor White
Write-Host "    .\launch_court_session.ps1" -ForegroundColor Cyan
Write-Host ""
