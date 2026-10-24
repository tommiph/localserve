# Build the shared remote launcher assets from the application circle mark.
& (Join-Path $PSScriptRoot 'build-app-icons.ps1') -Target controls
if ($LASTEXITCODE) { exit $LASTEXITCODE }
