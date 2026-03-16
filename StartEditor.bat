@echo off
setlocal EnableDelayedExpansion

echo.
echo   BounceX Editor
echo.

:: ── 1. Find Python ──────────────────────────────────────────────────────────
set PYTHON_CMD=

for %%c in (python python3) do (
    if not defined PYTHON_CMD (
        %%c --version >nul 2>&1
        if !errorlevel! equ 0 (
            for /f "tokens=2" %%v in ('%%c --version 2^>^&1') do (
                set VER=%%v
                if "!VER:~0,1!" == "3" set PYTHON_CMD=%%c
            )
        )
    )
)

if not defined PYTHON_CMD (
    echo   !! Python 3 not found.
    echo.
    set /p INSTALL_PY="  Install Python via winget? (Y/N): "
    if /i "!INSTALL_PY!" == "Y" (
        echo   ^>^> Running winget...
        winget install Python.Python.3.13 --source winget --silent --accept-package-agreements --accept-source-agreements
        if !errorlevel! neq 0 (
            echo   !! winget failed. Install manually: https://www.python.org/downloads/
            echo      Make sure to check "Add Python to PATH" during setup.
            pause
            exit /b 1
        )
        echo   OK Python installed. Please close this window and run again.
        echo      (PATH changes only take effect in a new session.)
        pause
        exit /b 0
    ) else (
        echo   Install manually: https://www.python.org/downloads/
        echo   Make sure to check "Add Python to PATH" during setup.
        pause
        exit /b 1
    )
)
echo   OK Found Python: %PYTHON_CMD%

:: ── 2. Virtual environment ──────────────────────────────────────────────────
if not exist "venv\Scripts\python.exe" (
    echo   ^>^> Creating virtual environment...
    %PYTHON_CMD% -m venv venv
    if !errorlevel! neq 0 (
        echo   !! Failed to create venv.
        pause & exit /b 1
    )
    echo   OK Virtual environment created.
)

set PY=%~dp0venv\Scripts\python.exe
set PIP=%~dp0venv\Scripts\pip.exe

:: ── 3. Install dependencies if needed ───────────────────────────────────────
echo   ^>^> Checking dependencies...
"%PY%" -c "import RangeHTTPServer" >nul 2>&1
if !errorlevel! neq 0 (
    echo   ^>^> Installing requirements.txt...
    "%PIP%" install -r requirements.txt --quiet
    if !errorlevel! neq 0 (
        echo   !! Dependency install failed.
        pause & exit /b 1
    )
    echo   OK Dependencies installed.
) else (
    echo   OK Dependencies already satisfied.
)

:: ── 4. Read port from config.json ───────────────────────────────────────────
for /f "usebackq" %%p in (`"%PY%" -c "import json; print(json.load(open('config.json'))['httpPort'])"`) do set HTTP_PORT=%%p
if not defined HTTP_PORT set HTTP_PORT=8003
echo   OK Port: %HTTP_PORT%

:: ── 5. Detect local IP ──────────────────────────────────────────────────────
set LOCAL_IP=localhost
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /r "IPv4.*[0-9][0-9]*\.[0-9][0-9]*\.[0-9][0-9]*\.[0-9][0-9]*"') do (
    set RAW=%%a
    set RAW=!RAW: =!
    if not "!RAW:~0,3!" == "127" (
        if not defined LOCAL_IP_FOUND (
            set LOCAL_IP=!RAW!
            set LOCAL_IP_FOUND=1
        )
    )
)

:: ── 6. Launch ───────────────────────────────────────────────────────────────
echo.
echo   On your local network, open this URL on any device:
echo   Editor  -^>  http://%LOCAL_IP%:%HTTP_PORT%
echo.
echo   Press Ctrl+C to stop.
echo.

start "" "http://localhost:%HTTP_PORT%/editor.html"

"%PY%" -m RangeHTTPServer "%HTTP_PORT%" --bind 0.0.0.0
