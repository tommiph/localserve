# Project-local Android command-line build tools. Nothing is added to PATH,
# installed globally, or connected to an Android device by this script.
$ErrorActionPreference = 'Stop'
$toolRoot = $PSScriptRoot
$downloads = Join-Path $toolRoot 'downloads'
New-Item -ItemType Directory -Force $downloads | Out-Null
$packages = @(
    @{ Name='jdk'; File='jdk17.zip'; Url='https://github.com/adoptium/temurin17-binaries/releases/download/jdk-17.0.20.1%2B1/OpenJDK17U-jdk_x64_windows_hotspot_17.0.20.1_1.zip'; Algorithm='SHA256'; Hash='e53a79c3c3d86865bd7e787903884331068e71321714ffd44f145785affc7cb0' },
    @{ Name='build-tools'; File='build-tools_r35_windows.zip'; Url='https://dl.google.com/android/repository/build-tools_r35_windows.zip'; Algorithm='SHA1'; Hash='af059bb67cf7786f45ee0db85e2d24985df1b4b6' },
    @{ Name='platform'; File='platform-35_r02.zip'; Url='https://dl.google.com/android/repository/platform-35_r02.zip'; Algorithm='SHA1'; Hash='0bb560a90a7a2cbd0dd8348224d518b638fe7949' }
)
foreach ($package in $packages) {
    $archive = Join-Path $downloads $package.File
    if (!(Test-Path -LiteralPath $archive)) {
        Write-Output ('Downloading ' + $package.Name)
        Invoke-WebRequest -Uri $package.Url -OutFile $archive
    }
    $actual = (Get-FileHash -LiteralPath $archive -Algorithm $package.Algorithm).Hash.ToLowerInvariant()
    if ($actual -ne $package.Hash) { throw ('Upstream hash mismatch: ' + $package.File) }
    $destination = Join-Path $toolRoot $package.Name
    if (!(Test-Path -LiteralPath $destination)) {
        Write-Output ('Extracting ' + $package.Name)
        Expand-Archive -LiteralPath $archive -DestinationPath $destination
    }
}
Write-Output 'Local Android build tools ready.'
