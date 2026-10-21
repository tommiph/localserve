# Prepare the pinned native compiler locally. No device or service is accessed.
$ErrorActionPreference = 'Stop'
$downloads = Join-Path $PSScriptRoot 'downloads'
New-Item -ItemType Directory -Force $downloads | Out-Null
$archive = Join-Path $downloads 'android-ndk-r25c-windows.zip'
if (!(Test-Path -LiteralPath $archive)) {
    Invoke-WebRequest -Uri 'https://dl.google.com/android/repository/android-ndk-r25c-windows.zip' -OutFile $archive
}
$hash = (Get-FileHash -LiteralPath $archive -Algorithm SHA1).Hash.ToLowerInvariant()
if ($hash -ne '18c4a3cd108916f553b1bedad2672f2c6cd85a10') { throw 'NDK archive checksum mismatch.' }
$packages = Join-Path $PSScriptRoot 'packages'
$extracted = Join-Path $packages 'android-ndk-r25c'
if (!(Test-Path -LiteralPath $extracted)) {
    Expand-Archive -LiteralPath $archive -DestinationPath $packages
}
$destination = Join-Path $PSScriptRoot 'ndk'
if (!(Test-Path -LiteralPath (Join-Path $destination 'toolchains'))) {
    New-Item -ItemType Directory -Force $destination | Out-Null
    Copy-Item -LiteralPath (Join-Path $extracted 'toolchains') -Destination $destination -Recurse
    Copy-Item -LiteralPath (Join-Path $extracted 'NOTICE') -Destination $destination
    Copy-Item -LiteralPath (Join-Path $extracted 'source.properties') -Destination $destination
}
Write-Output 'Project-local Oculus Go native compiler ready.'
