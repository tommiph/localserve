# Archive/extract only a named distribution workspace. Native .NET ZIP support
# includes dotfiles such as .gitignore, unlike some Compress-Archive workflows.
param(
    [Parameter(Mandatory=$true)][ValidateSet('Create','Extract')][string]$Mode,
    [Parameter(Mandatory=$true)][string]$Source,
    [Parameter(Mandatory=$true)][string]$Destination
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
if ($Mode -eq 'Create') {
    if (Test-Path -LiteralPath $Destination) { throw 'Archive already exists.' }
    [System.IO.Compression.ZipFile]::CreateFromDirectory(
        $Source, $Destination, [System.IO.Compression.CompressionLevel]::Optimal, $true)
} else {
    $zip = [System.IO.Compression.ZipFile]::OpenRead($Source)
    try {
        # Refuse unexpected names before extraction, even though our own builder
        # creates the archive. Keep the verifier useful for the delivered ZIP.
        foreach ($entry in $zip.Entries) {
            $name = $entry.FullName.Replace('\','/')
            if (-not $name.StartsWith('Localserve/') -or $name -match '(^|/)\.\.(/|$)|:|^/') {
                throw 'Archive contains an unsafe or unexpected entry.'
            }
        }
    } finally { $zip.Dispose() }
    [System.IO.Compression.ZipFile]::ExtractToDirectory($Source, $Destination)
}
