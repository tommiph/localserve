# Keep the pinned official compiler portable and inside the project. The
# compiler's own shortcuts, associations and uninstall registration are omitted.
$ErrorActionPreference = 'Stop'
$compilerLock = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'compiler-lock.json') -Raw | ConvertFrom-Json
$compilerFolder = Join-Path $PSScriptRoot 'compiler'
$downloadFolder = Join-Path $PSScriptRoot 'downloads'
New-Item -ItemType Directory -Path $downloadFolder -Force | Out-Null
$downloadFile = Join-Path $downloadFolder 'innosetup-7.1.0-x64.exe'
if (-not (Test-Path -LiteralPath $downloadFile)) { Invoke-WebRequest -Uri $compilerLock.url -OutFile $downloadFile }
if ((Get-FileHash -LiteralPath $downloadFile -Algorithm SHA256).Hash.ToLowerInvariant() -ne $compilerLock.sha256) { throw 'Compiler download checksum mismatch.' }
$signature = Get-AuthenticodeSignature -LiteralPath $downloadFile
if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'CN=Pyrsys B\.V\.') { throw 'Compiler publisher signature is not valid.' }
if (-not (Test-Path -LiteralPath (Join-Path $compilerFolder 'ISCC.exe'))) {
    $arguments = @('/PORTABLE=1','/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART','/CURRENTUSER','/NOICONS','/TASKS=',('/DIR="' + $compilerFolder + '"'))
    $process = Start-Process -FilePath $downloadFile -ArgumentList $arguments -WindowStyle Hidden -Wait -PassThru
    if ($process.ExitCode -ne 0) { throw 'Portable compiler preparation failed.' }
}
Write-Output 'Project-local Inno Setup compiler is ready.'
