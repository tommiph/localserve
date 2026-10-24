# Read-only discovery of one explicitly selected attached IPv4 network.
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$inputData = [Console]::ReadLine() | ConvertFrom-Json
$local = [System.Net.IPAddress]::Parse($inputData.localAddress)
if ($local.AddressFamily -ne [System.Net.Sockets.AddressFamily]::InterNetwork) { throw 'IPv4 is required.' }
$adapter = @(Get-NetIPAddress -AddressFamily IPv4 | Where-Object IPAddress -eq $local.ToString())
if ($adapter.Count -ne 1) { throw 'The network adapter changed.' }
$prefix = $local.ToString().Substring(0, $local.ToString().LastIndexOf('.') + 1)
$addresses = @($inputData.addresses)
if ($addresses.Count -gt 254) { throw 'Too many addresses.' }
foreach ($address in $addresses) {
  $parsed = [System.Net.IPAddress]::Parse($address)
  if ($parsed.AddressFamily -ne [System.Net.Sockets.AddressFamily]::InterNetwork -or !$address.StartsWith($prefix)) { throw 'Address outside the selected network.' }
}
$responding = New-Object System.Collections.Generic.List[string]
for ($offset = 0; $offset -lt $addresses.Count; $offset += 16) {
  $batch = @()
  foreach ($address in $addresses[$offset..([Math]::Min($offset + 15, $addresses.Count - 1))]) {
    $ping = New-Object System.Net.NetworkInformation.Ping
    $batch += @{ Address = $address; Ping = $ping; Task = $ping.SendPingAsync($address, 350) }
  }
  foreach ($item in $batch) {
    try { if ($item.Task.GetAwaiter().GetResult().Status -eq 'Success') { $responding.Add($item.Address) } }
    catch { } # A missing ICMP reply does not establish that a device is offline.
    finally { $item.Ping.Dispose() }
  }
}
$neighbors = @(Get-NetNeighbor -InterfaceIndex $adapter[0].InterfaceIndex -AddressFamily IPv4 | Where-Object { $addresses -contains $_.IPAddress } | ForEach-Object {
  @{ address = $_.IPAddress; mac = $_.LinkLayerAddress; state = [string]$_.State }
})
@{ responding = @($responding.ToArray()); neighbors = $neighbors } | ConvertTo-Json -Depth 4 -Compress
