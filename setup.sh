#!/usr/bin/env bash
# setup.sh — macOS / Linux setup script for Court STT
#
# Usage:
#   chmod +x setup.sh
#   ./setup.sh
#
# Requirements: Python 3.10+ installed

set -e

CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
GRAY='\033[0;90m'
NC='\033[0m' # No Color

echo ""
echo -e "${CYAN}============================================${NC}"
echo -e "${CYAN}  Court STT — macOS / Linux Setup${NC}"
echo -e "${CYAN}============================================${NC}"
echo ""

# ── 1. Find Python 3.10+ ──────────────────────────────────────────────────────
echo -e "${YELLOW}[ 1/5 ] Checking Python...${NC}"

PYTHON=""
for cmd in python3.12 python3.11 python3.10 python3 python; do
    if command -v "$cmd" &>/dev/null; then
        VERSION=$("$cmd" -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')
        MAJOR=$(echo "$VERSION" | cut -d. -f1)
        MINOR=$(echo "$VERSION" | cut -d. -f2)
        if [ "$MAJOR" -gt 3 ] || { [ "$MAJOR" -eq 3 ] && [ "$MINOR" -ge 10 ]; }; then
            PYTHON="$cmd"
            break
        fi
    fi
done

if [ -z "$PYTHON" ]; then
    echo -e "${RED}  ERROR: Python 3.10+ not found.${NC}"
    echo "  Install via: brew install python (macOS) or sudo apt install python3 (Ubuntu)"
    exit 1
fi

echo -e "${GREEN}  OK: $($PYTHON --version) → $PYTHON${NC}"

# ── 2. Create virtual environment ─────────────────────────────────────────────
echo ""
echo -e "${YELLOW}[ 2/5 ] Creating virtual environment (.venv)...${NC}"
if [ -d ".venv" ]; then
    echo -e "${GRAY}  .venv already exists — skipping creation.${NC}"
else
    "$PYTHON" -m venv .venv
    echo -e "${GREEN}  Created .venv${NC}"
fi

# ── 3. Activate + upgrade pip ─────────────────────────────────────────────────
echo ""
echo -e "${YELLOW}[ 3/5 ] Activating environment & upgrading pip...${NC}"
# shellcheck disable=SC1091
source .venv/bin/activate
pip install --upgrade pip --quiet
echo -e "${GREEN}  pip upgraded.${NC}"

# ── 4. Install dependencies ───────────────────────────────────────────────────
echo ""
echo -e "${YELLOW}[ 4/5 ] Installing dependencies...${NC}"
pip install -r requirements.txt
echo -e "${GREEN}  Dependencies installed.${NC}"

# ── 5. Check / create .env ───────────────────────────────────────────────────
echo ""
echo -e "${YELLOW}[ 5/5 ] Checking .env...${NC}"
if [ -f ".env" ]; then
    echo -e "${GREEN}  .env found.${NC}"
else
    if [ -f ".env.example" ]; then
        cp .env.example .env
    else
        cat > .env <<'EOF'
AZURE_SPEECH_KEY=YOUR_KEY_HERE
AZURE_SPEECH_REGION=uaenorth
AZURE_SPEECH_LANGUAGE=ar-JO
EOF
    fi
    echo -e "${YELLOW}  .env created from template. Fill in your Azure key!${NC}"
fi

# ── Microphone note for macOS ─────────────────────────────────────────────────
if [[ "$OSTYPE" == "darwin"* ]]; then
    echo ""
    echo -e "${YELLOW}  macOS note:${NC} If you see a microphone permission error,"
    echo "  go to System Settings → Privacy & Security → Microphone"
    echo "  and grant access to Terminal (or your terminal app)."
fi

# ── Done ───────────────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}============================================${NC}"
echo -e "${GREEN}  Setup complete!${NC}"
echo -e "${GREEN}============================================${NC}"
echo ""
echo -e "  ${YELLOW}IMPORTANT:${NC} Make sure .env has your Azure credentials."
echo ""
echo "  To start the web app:"
echo -e "    ${CYAN}source .venv/bin/activate${NC}"
echo -e "    ${CYAN}python server.py${NC}"
echo -e "    Then open: ${CYAN}http://localhost:8000${NC}"
echo ""
echo "  To run a quick mic test:"
echo -e "    ${CYAN}python test_mic.py${NC}"
echo ""
echo "  To launch all 3 speaker terminals (uses 3 separate tabs/windows):"
echo -e "    ${CYAN}./launch_court_session.sh${NC}"
echo ""
