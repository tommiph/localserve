$ErrorActionPreference = 'Stop'
# Use the Windows framework compiler, as with the tray and PC collector. All
# authored source and the resulting executable remain in this plugin package.
$compilerPath = Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
$sourcePath = Join-Path $PSScriptRoot 'Vault.cs'
$outputPath = Join-Path $PSScriptRoot 'Vault.exe'
& $compilerPath /nologo /target:exe /platform:x64 /reference:System.Web.Extensions.dll /reference:System.Security.dll "/out:$outputPath" $sourcePath
if ($LASTEXITCODE -ne 0) { throw 'TRÅDFRI credential helper build failed.' }


