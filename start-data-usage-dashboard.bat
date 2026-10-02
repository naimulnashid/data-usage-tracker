@echo off
setlocal

REM ---------------------------------------------------------------------------
REM Starts the Data Usage Dashboard and opens it in your browser.
REM
REM You do not normally need this: scripts\install-autostart.ps1 registers a
REM logon task that starts the dashboard hidden at every sign-in. This is for
REM starting it by hand, or for seeing the output when something is wrong.
REM
REM It builds ONLY when there is no build to serve. After changing anything the
REM dashboard serves, run `npm run build` yourself -- neither this script nor
REM the logon task will notice the change for you. See docs/DESIGN.md,
REM "Running the dashboard". Set FORCE_BUILD=1 before running this to rebuild
REM anyway.
REM
REM Keep this window open - closing it stops the dashboard.
REM ---------------------------------------------------------------------------

cd /d "%~dp0"

set "PORT=7843"
set "URL=http://localhost:%PORT%"

where npm >nul 2>&1
if errorlevel 1 (
    echo ERROR: npm was not found on your PATH.
    echo Install Node.js 22+ from https://nodejs.org and try again.
    echo.
    pause
    exit /b 1
)

REM --- Is something already serving the port? --------------------------------
REM Beyond the obvious "the logon task already started it", `npm run dev` binds
REM 7843 as well - and a `next build` underneath a live server replaces chunks
REM it holds open, killing it on the next request. Exiting here means this
REM window can never do that to one. The pause keeps the window up long enough
REM to read why nothing started.
netstat -ano | findstr /r /c:"LISTENING" | findstr /c:":%PORT% " >nul 2>&1
if not errorlevel 1 (
    echo The dashboard is already running on port %PORT%.
    echo.
    echo NOTE: this window did not start it - something else is already serving
    echo that port. Most likely the "Start Data Usage Dashboard" logon task, or
    echo an "npm run dev" you left running. Nothing to do; opening the browser.
    echo Run stop-dashboard.bat first if you want this window to serve it instead.
    start "" "%URL%"
    echo.
    pause
    exit /b 0
)

REM --- A build must exist, but is never rebuilt just because src\ moved on. ---
REM ensure-build.ps1 is the same check the logon task runs, so both launchers
REM agree on what "there is a build" means. It installs dependencies too, if
REM node_modules is missing, and warns when the build predates the source.
set "FORCE="
if not "%FORCE_BUILD%"=="" set "FORCE=-Force"
powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\ensure-build.ps1" %FORCE%
if errorlevel 1 goto :failed

REM --- Open the browser once the server actually answers. ---------------------
REM `next start` binds the port only when it is ready to serve, so a listening
REM port is the honest signal. Opening the browser up front, as this used to,
REM just races the server and shows a connection error on a cold start - which
REM is exactly the start that needed the wait.
REM
REM /b keeps it in this console, so closing the window takes the waiter with it.
echo Starting on %URL% ...
echo Waiting for the server, then opening your browser...
start "" /b powershell -NoProfile -ExecutionPolicy Bypass -Command "$deadline = (Get-Date).AddSeconds(180); while ((Get-Date) -lt $deadline) { if (Get-NetTCPConnection -LocalPort %PORT% -State Listen -ErrorAction SilentlyContinue) { Start-Process '%URL%'; exit 0 }; Start-Sleep -Milliseconds 400 }; Write-Host 'The server did not start within 3 minutes - see the output above.'; exit 1"

call npm start
exit /b 0

:failed
echo.
echo Something went wrong. See the output above.
pause
exit /b 1
