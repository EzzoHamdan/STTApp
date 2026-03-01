#!/usr/bin/env bash
# launch_court_session.sh — macOS / Linux launcher
# Opens 3 separate terminal windows for Judge, Lawyer_1, Lawyer_2.
#
# Usage:
#   chmod +x launch_court_session.sh
#   ./launch_court_session.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# ── Activate venv ─────────────────────────────────────────────────────────────
if [ ! -f ".venv/bin/activate" ]; then
    echo "ERROR: .venv not found. Run ./setup.sh first."
    exit 1
fi
source .venv/bin/activate

# ── Generate session ID ───────────────────────────────────────────────────────
SESSION_ID=$(python -c "
from court_stt.session import SessionManager
mgr = SessionManager()
sid = mgr.generate_id()
mgr.init_session(sid, ['Judge','Lawyer_1','Lawyer_2'])
print(sid)
")

echo ""
echo "  ================================================"
echo "   Court STT Session: $SESSION_ID"
echo "  ================================================"
echo ""

# Save for convenience
echo "$SESSION_ID" > "$SCRIPT_DIR/last_session_id.txt"

# ── Open terminals per OS ─────────────────────────────────────────────────────
open_terminal() {
    local ROLE="$1"
    local CMD="source '$SCRIPT_DIR/.venv/bin/activate' && court-stt-speaker --role $ROLE --session $SESSION_ID; exec bash"

    if [[ "$OSTYPE" == "darwin"* ]]; then
        # macOS — use AppleScript to open a new Terminal tab
        osascript <<EOF
tell application "Terminal"
    do script "$CMD"
    activate
end tell
EOF
    elif command -v gnome-terminal &>/dev/null; then
        gnome-terminal --title="$ROLE - $SESSION_ID" -- bash -c "$CMD"
    elif command -v xterm &>/dev/null; then
        xterm -title "$ROLE - $SESSION_ID" -e bash -c "$CMD" &
    else
        echo "  Cannot open terminal window for $ROLE. Run manually:"
        echo "    source .venv/bin/activate && court-stt-speaker --role $ROLE --session $SESSION_ID"
    fi
    sleep 1
}

for ROLE in Judge Lawyer_1 Lawyer_2; do
    echo "  Starting: $ROLE"
    open_terminal "$ROLE"
done

echo ""
echo "  All 3 speaker windows launched."
echo "  Session ID: $SESSION_ID   (also saved in last_session_id.txt)"
echo ""
echo "  When done, stop each window (Ctrl+C) then merge:"
echo "    court-stt-merge --session $SESSION_ID --end"
echo ""
