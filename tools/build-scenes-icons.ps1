# Build the scene selector's shared application assets.
& (Join-Path $PSScriptRoot 'build-app-icons.ps1') -Target scenes
if ($LASTEXITCODE) { exit $LASTEXITCODE }
