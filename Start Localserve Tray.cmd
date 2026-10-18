@echo off
rem Paths follow the installation folder, never a machine-specific location.
cd /d "%~dp0"
rem Initialize missing private settings without replacing existing values.
"runtime\node.exe" "tools\initialize-settings.mjs"
if errorlevel 1 exit /b 1
start "" "tray\LocalserveTray.exe"
