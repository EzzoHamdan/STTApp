@echo off
REM ============================================================
REM  launch_court_session.bat
REM  Opens 3 terminal windows — one per speaker — all sharing
REM  the same court session ID.
REM ============================================================

cd /d "%~dp0"

REM Generate a session ID by running the session manager
FOR /F "tokens=*" %%i IN ('python -c "from session_manager import generate_session_id, init_session; sid=generate_session_id(); init_session(sid, ['Judge','Lawyer_1','Lawyer_2']); print(sid)"') DO SET SESSION_ID=%%i

echo.
echo  ============================================
echo   Court Session: %SESSION_ID%
echo  ============================================
echo.
echo  Starting 3 terminals (Judge, Lawyer_1, Lawyer_2)...
echo  Press Ctrl+C in each window to stop that speaker.
echo  After stopping all, run:
echo    python merge_transcripts.py --session %SESSION_ID% --end
echo  ============================================
echo.

start "Judge - %SESSION_ID%" cmd /k "python run_speaker.py --role Judge --session %SESSION_ID%"
timeout /t 2 >nul
start "Lawyer_1 - %SESSION_ID%" cmd /k "python run_speaker.py --role Lawyer_1 --session %SESSION_ID%"
timeout /t 2 >nul
start "Lawyer_2 - %SESSION_ID%" cmd /k "python run_speaker.py --role Lawyer_2 --session %SESSION_ID%"

echo.
echo  All 3 speaker windows launched.
echo  Session ID: %SESSION_ID%
echo.
echo  When done, merge with:
echo    python merge_transcripts.py --session %SESSION_ID% --end
echo.
pause
