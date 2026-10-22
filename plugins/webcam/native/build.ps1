$ErrorActionPreference = 'Stop'
# Compile with the Windows .NET Framework; no downloaded camera SDK or runtime.
$compilerPath = Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
$sourcePath = Join-Path $PSScriptRoot 'Capture.cs'
$outputPath = Join-Path $PSScriptRoot 'Capture.exe'
& $compilerPath /nologo /target:exe /platform:x64 /reference:System.Drawing.dll /reference:System.Web.Extensions.dll "/out:$outputPath" $sourcePath
if ($LASTEXITCODE -ne 0) { throw 'Webcam capture helper build failed.' }
