<#
.SYNOPSIS
    Launches a full court session — 3 terminals for Judge, Lawyer_1, Lawyer_2.

.DESCRIPTION
    Generates a unique session ID, initialises the session, then opens
    3 separate PowerShell windows each running run_speaker.py.

.USAGE
    .\launch_court_session.ps1
#>

Set-Location $PSScriptRoot

# Generate session ID
$sessionId = python -c "from court_stt.session import SessionManager; mgr=SessionManager(); sid=mgr.generate_id(); mgr.init_session(sid, ['Judge','Lawyer_1','Lawyer_2']); print(sid)"

Write-Host ""
Write-Host "  ================================================" -ForegroundColor Cyan
Write-Host "   Court STT Session: $sessionId" -ForegroundColor Green
Write-Host "  ================================================" -ForegroundColor Cyan
Write-Host ""

$roles = @("Judge", "Lawyer_1", "Lawyer_2")

foreach ($role in $roles) {
    $title = "$role - $sessionId"
    Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location '$PSScriptRoot'; court-stt-speaker --role $role --session $sessionId" -WindowStyle Normal
    Write-Host "  Started: $role" -ForegroundColor Yellow
    Start-Sleep -Seconds 2
}

Write-Host ""
Write-Host "  All speakers launched!" -ForegroundColor Green
Write-Host ""
Write-Host "  When finished, stop each window (Ctrl+C) then run:" -ForegroundColor White
Write-Host "    court-stt-merge --session $sessionId --end" -ForegroundColor Cyan
Write-Host ""

# Save session ID for convenience
$sessionId | Out-File -FilePath "$PSScriptRoot\last_session_id.txt" -Encoding utf8
Write-Host "  Session ID saved to last_session_id.txt" -ForegroundColor DarkGray
Write-Host ""
