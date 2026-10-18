# One-time, administrator-only firewall setup for this installation's LAN URL.
# Does not change the network category, disable the firewall, or alter other rules.
param(
    [Parameter(Mandatory=$true)][string]$LocalAddress,
    [Parameter(Mandatory=$true)][string]$RemoteSubnet,
    [Parameter(Mandatory=$true)][ValidateRange(1,65535)][int]$Port
)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$logFolder = Join-Path $projectRoot 'data/tray'
New-Item -ItemType Directory -Path $logFolder -Force | Out-Null
$resultFile = Join-Path $logFolder 'lan-firewall.json'
try {
    $localIP = [System.Net.IPAddress]::Parse($LocalAddress)
    $parts = $localIP.GetAddressBytes()
    if ($parts.Length -ne 4 -or -not ($parts[0] -eq 10 -or ($parts[0] -eq 172 -and $parts[1] -ge 16 -and $parts[1] -le 31) -or ($parts[0] -eq 192 -and $parts[1] -eq 168))) { throw 'Use a private IPv4 LAN address.' }
    $interface = Get-NetIPAddress -IPAddress $LocalAddress -AddressFamily IPv4 -ErrorAction Stop
    $prefix = [int]$interface.PrefixLength
    $networkBytes = [byte[]]::new(4)
    for ($index = 0; $index -lt 4; $index++) {
        $bits = [Math]::Max(0, [Math]::Min(8, $prefix - 8 * $index))
        $mask = if ($bits -eq 0) { 0 } else { 256 - [Math]::Pow(2, 8 - $bits) }
        $networkBytes[$index] = $parts[$index] -band [int]$mask
    }
    $expectedSubnet = ([System.Net.IPAddress]::new($networkBytes)).ToString() + '/' + $prefix
    if ($RemoteSubnet -ne $expectedSubnet) { throw 'The remote subnet must match this host interface.' }
    $savedConfig = Get-Content -LiteralPath (Join-Path $projectRoot 'config.json') -Raw | ConvertFrom-Json
    if ($savedConfig.listen.host -ne $LocalAddress -or $savedConfig.listen.port -ne $Port) { throw 'Configure the matching Localserve LAN address/port first.' }
    $principal = [Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Windows administrator permission is required.' }
    $sha = [Security.Cryptography.SHA256]::Create()
    try { $identity = ([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($projectRoot.ToLowerInvariant())))).Replace('-','').ToLowerInvariant().Substring(0,24) } finally { $sha.Dispose() }
    $ruleName = "Localserve-LAN-$identity-$Port"
    $ruleArguments = @{Name=$ruleName;DisplayName="Localserve LAN TCP $Port";Direction='Inbound';Action='Allow';Enabled='True';Profile='Private';Protocol='TCP';LocalPort=$Port;LocalAddress=$LocalAddress;RemoteAddress=$RemoteSubnet;Program=(Join-Path $projectRoot 'runtime/node.exe');EdgeTraversalPolicy='Block';Description='This Localserve installation only; private LAN subnet, fixed TCP port and bundled runtime.'}
    # Apply only on Private networks, scoped to the exact address and subnet.
    # Never change the network category or broaden another network's rules.
    if (Get-NetFirewallRule -Name $ruleName -ErrorAction SilentlyContinue) {
        $ruleArguments.Remove('DisplayName')
        Set-NetFirewallRule @ruleArguments | Out-Null
    } else { New-NetFirewallRule @ruleArguments | Out-Null }
    @{ok=$true;rule=$ruleName;localAddress=$LocalAddress;remoteSubnet=$RemoteSubnet;port=$Port} | ConvertTo-Json | Set-Content -LiteralPath $resultFile -Encoding utf8
} catch {
    @{ok=$false;error=$_.Exception.Message} | ConvertTo-Json | Set-Content -LiteralPath $resultFile -Encoding utf8
    throw
}
