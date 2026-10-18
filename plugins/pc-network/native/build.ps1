$ErrorActionPreference = 'Stop'
# Like the tray build, use Windows' own .NET Framework compiler. The resulting
# executable and readable source stay in this plugin; no SDK is downloaded.
$compilerPath = Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
$sourcePath = Join-Path $PSScriptRoot 'Collector.cs'
$gpuSourcePath = Join-Path $PSScriptRoot 'GpuReadings.cs'
$outputPath = Join-Path $PSScriptRoot 'Collector.exe'
& $compilerPath /nologo /target:exe /platform:x64 /reference:System.Web.Extensions.dll "/out:$outputPath" $sourcePath $gpuSourcePath
if ($LASTEXITCODE -ne 0) { throw 'PC and Network collector build failed.' }
