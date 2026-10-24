# Rebuild the Scenes app icons from Localserve's supplied SVG path geometry.
# Windows WPF is already used by tray/build.ps1; no downloaded renderer is used.
$ErrorActionPreference = 'Stop'
$projectFolder = Split-Path -Parent $PSScriptRoot
$outputFolder = Join-Path $projectFolder 'assets/scenes'
New-Item -ItemType Directory -Force -Path $outputFolder | Out-Null
Add-Type -AssemblyName PresentationCore, WindowsBase
[xml]$sourceLogo = Get-Content -LiteralPath (Join-Path $projectFolder 'assets/logo.svg') -Raw
$shapes = $sourceLogo.SelectNodes('//*[local-name()="path"]')
$sourceGradient = $sourceLogo.SelectSingleNode('//*[local-name()="linearGradient"]')
$logoWidth = [double]$sourceLogo.svg.width
$logoHeight = [double]$sourceLogo.svg.height
$culture = [System.Globalization.CultureInfo]::InvariantCulture

function Get-IconGeometry([int]$size) {
    # The entire rectangular logo fits Android's central maskable safe circle.
    $scale = $size * 0.66 / $logoWidth
    return @{
        Scale = $scale
        X = ($size - $logoWidth * $scale) / 2
        Y = ($size - $logoHeight * $scale) / 2
    }
}

# A vector favicon and PNG launcher icons use the same black paths/white square.
$geometry = Get-IconGeometry 512
$gradient = $sourceGradient.CloneNode($true)
foreach ($stop in $gradient.ChildNodes) { $stop.SetAttribute('stop-color', 'black') }
$blackPaths = foreach ($shape in $shapes) {
    $copy = $shape.CloneNode($true)
    if (-not $copy.GetAttribute('fill').StartsWith('url(')) { $copy.SetAttribute('fill', 'black') }
    $copy.OuterXml
}
$transform = 'translate({0} {1}) scale({2})' -f $geometry.X.ToString($culture), $geometry.Y.ToString($culture), $geometry.Scale.ToString($culture)
$svg = @"
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <!-- Generated from assets/logo.svg; preserve the original file unchanged. -->
  <rect width="512" height="512" fill="white"/>
  <defs>$($gradient.OuterXml)</defs>
  <g transform="$transform">$($blackPaths -join "`n")</g>
</svg>
"@
[System.IO.File]::WriteAllText((Join-Path $outputFolder 'app-icon.svg'), $svg, [System.Text.UTF8Encoding]::new($false))

foreach ($size in @(192, 512)) {
    $geometry = Get-IconGeometry $size
    $visual = [System.Windows.Media.DrawingVisual]::new()
    $drawing = $visual.RenderOpen()
    $drawing.DrawRectangle([System.Windows.Media.Brushes]::White, $null, [System.Windows.Rect]::new(0, 0, $size, $size))
    $matrix = [System.Windows.Media.Matrix]::new($geometry.Scale, 0, 0, $geometry.Scale, $geometry.X, $geometry.Y)
    $drawing.PushTransform([System.Windows.Media.MatrixTransform]::new($matrix))
    foreach ($shape in $shapes) {
        $brush = [System.Windows.Media.Brushes]::Black
        if ($shape.GetAttribute('fill').StartsWith('url(')) {
            $brush = [System.Windows.Media.LinearGradientBrush]::new()
            $brush.MappingMode = [System.Windows.Media.BrushMappingMode]::Absolute
            $brush.StartPoint = [System.Windows.Point]::new([double]$sourceGradient.x1, [double]$sourceGradient.y1)
            $brush.EndPoint = [System.Windows.Point]::new([double]$sourceGradient.x2, [double]$sourceGradient.y2)
            foreach ($stop in $sourceGradient.ChildNodes) {
                $alpha = [byte]([double]$stop.GetAttribute('stop-opacity') * 255)
                $color = [System.Windows.Media.Color]::FromArgb($alpha, 0, 0, 0)
                $brush.GradientStops.Add([System.Windows.Media.GradientStop]::new($color, [double]$stop.offset))
            }
        }
        $drawing.DrawGeometry($brush, $null, [System.Windows.Media.Geometry]::Parse($shape.GetAttribute('d')))
    }
    $drawing.Pop()
    $drawing.Close()
    $bitmap = [System.Windows.Media.Imaging.RenderTargetBitmap]::new($size, $size, 96, 96, [System.Windows.Media.PixelFormats]::Pbgra32)
    $bitmap.Render($visual)
    $encoder = [System.Windows.Media.Imaging.PngBitmapEncoder]::new()
    $encoder.Frames.Add([System.Windows.Media.Imaging.BitmapFrame]::Create($bitmap))
    $stream = [System.IO.File]::Create((Join-Path $outputFolder "app-icon-$size.png"))
    try { $encoder.Save($stream) } finally { $stream.Dispose() }
}
New-Item -ItemType Directory -Force -Path (Join-Path $projectFolder 'apps/scenes/res/drawable') | Out-Null
Copy-Item -LiteralPath (Join-Path $outputFolder 'app-icon-512.png') -Destination (Join-Path $projectFolder 'apps/scenes/res/drawable/scenes_icon.png')
Copy-Item -LiteralPath (Join-Path $projectFolder 'assets/controls/app-icon-512.png') -Destination (Join-Path $projectFolder 'apps/scenes/res/drawable/scenes_splash.png')
Write-Output 'Built white Scenes launcher icons and black splash artwork.'
