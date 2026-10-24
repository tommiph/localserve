param([ValidateSet('all','controls','scenes')][string]$Target = 'all')
# Render the same circle geometry for local web and native application surfaces.
# PlayStation owns its separate artwork and is not an output of this builder.
$ErrorActionPreference = 'Stop'
$projectFolder = Split-Path -Parent $PSScriptRoot
Add-Type -AssemblyName PresentationCore, WindowsBase
[xml]$logo = Get-Content -LiteralPath (Join-Path $projectFolder 'assets/logo.svg') -Raw
$shape = $logo.SelectSingleNode('//*[local-name()="path"]')
$geometry = [System.Windows.Media.Geometry]::Parse($shape.GetAttribute('d'))
$whitePath = $shape.CloneNode($true)
$whitePath.SetAttribute('fill', '#FFFFFF')
$svg = '<svg xmlns="http://www.w3.org/2000/svg" width="108" height="108" viewBox="0 0 108 108"><rect width="108" height="108" fill="#000000"/>' + $whitePath.OuterXml + '</svg>'
function Write-Icon([string]$relative, [int]$width, [int]$height) {
    $visual = [System.Windows.Media.DrawingVisual]::new()
    $drawing = $visual.RenderOpen()
    $drawing.DrawRectangle([System.Windows.Media.Brushes]::Black, $null, [System.Windows.Rect]::new(0,0,$width,$height))
    $size = [Math]::Min($width,$height)
    $matrix = [System.Windows.Media.Matrix]::new($size/108,0,0,$size/108,($width-$size)/2,($height-$size)/2)
    $drawing.PushTransform([System.Windows.Media.MatrixTransform]::new($matrix))
    $drawing.DrawGeometry([System.Windows.Media.Brushes]::White,$null,$geometry)
    $drawing.Pop(); $drawing.Close()
    $bitmap = [System.Windows.Media.Imaging.RenderTargetBitmap]::new($width,$height,96,96,[System.Windows.Media.PixelFormats]::Pbgra32)
    $bitmap.Render($visual)
    $encoder = [System.Windows.Media.Imaging.PngBitmapEncoder]::new()
    $encoder.Frames.Add([System.Windows.Media.Imaging.BitmapFrame]::Create($bitmap))
    $file = Join-Path $projectFolder $relative
    [System.IO.Directory]::CreateDirectory([System.IO.Path]::GetDirectoryName($file)) | Out-Null
    $stream = [System.IO.File]::Create($file)
    try { $encoder.Save($stream) } finally { $stream.Dispose() }
}
foreach ($name in @('controls','scenes')) {
    if ($Target -ne 'all' -and $Target -ne $name) { continue }
    [System.IO.File]::WriteAllText((Join-Path $projectFolder "assets/$name/app-icon.svg"),$svg,[System.Text.UTF8Encoding]::new($false))
    foreach ($size in @(192,512)) { Write-Icon "assets/$name/app-icon-$size.png" $size $size }
}
if ($Target -eq 'all') {
    [System.IO.File]::WriteAllText((Join-Path $projectFolder 'assets/favicon.svg'),$svg,[System.Text.UTF8Encoding]::new($false))
    Write-Icon 'plugins/sensors/android/res/drawable/app_icon.png' 192 192
    Write-Icon 'plugins/oculus-go/android/res/drawable/icon.png' 512 512
    Write-Icon 'plugins/oculus-go/android/assets/logo.png' 192 192
    Write-Icon 'tv-tizen/app/icon-tv.png' 320 180
    Write-Icon 'tv-tizen/app/launch-icon.png' 320 180
}
Write-Output 'Built application circle icons.'
