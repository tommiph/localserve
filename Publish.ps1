# Publish verified source and matching preview downloads from a clean snapshot.
[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][ValidatePattern('^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$')][string]$Repository,
  [Parameter(Mandatory=$true)][string]$MessageFile,
  [Parameter(Mandatory=$true)][string]$NotesFile,
  [string]$GitHubCli = 'gh',
  [string]$GitHubConfig = '',
  [switch]$Resume,
  [switch]$PrepareOnly
)
$ErrorActionPreference = 'Stop'
Push-Location -LiteralPath $PSScriptRoot
try {
  $publishArguments = @('tools/distribution/publish.mjs','--repository',$Repository,'--message-file',$MessageFile,'--notes-file',$NotesFile,'--gh',$GitHubCli)
  if ($GitHubConfig) { $publishArguments += @('--gh-config',$GitHubConfig) }
  if ($Resume) { $publishArguments += '--resume' }
  if ($PrepareOnly) { $publishArguments += '--prepare-only' }
  & '.\runtime\node.exe' @publishArguments
  if ($LASTEXITCODE -ne 0) { throw 'Publication stopped. Review the reported failure before resuming.' }
} finally { Pop-Location }
