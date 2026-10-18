# Build using Windows' .NET Framework compiler and graphics APIs without runtime
# downloads or installation. Paths resolve from this script's folder.
$ErrorActionPreference = 'Stop'
$trayFolder = $PSScriptRoot
$projectFolder = Split-Path -Parent $trayFolder
$frameworkFolder = Join-Path ([Environment]::GetFolderPath('Windows')) 'Microsoft.NET\Framework64\v4.0.30319'
$compiler = Join-Path $frameworkFolder 'csc.exe'
if (-not (Test-Path -LiteralPath $compiler)) { throw 'The Windows .NET Framework 4 compiler is unavailable.' }
Add-Type -AssemblyName PresentationCore, WindowsBase

function New-LogoIcon([string]$outputFile, [bool]$negative) {
    # Compile the supplied SVG's native vector paths. Nothing is redrawn and the
    # original SVG is untouched. ICO contains multiple transparent PNG sizes.
    [xml]$svg = Get-Content -LiteralPath (Join-Path $projectFolder 'assets/logo.svg') -Raw
    $paths = $svg.SelectNodes('//*[local-name()="path"]')
    $width = [double]$svg.svg.width
    $height = [double]$svg.svg.height
    $images = @()
    foreach ($size in @(16, 20, 24, 32, 48, 64)) {
        $visual = New-Object System.Windows.Media.DrawingVisual
        $drawing = $visual.RenderOpen()
        $scale = [Math]::Min($size / $width, $size / $height)
        $matrix = [System.Windows.Media.Matrix]::new($scale, 0, 0, $scale, (($size - $width * $scale) / 2), (($size - $height * $scale) / 2))
        $drawing.PushTransform(([System.Windows.Media.MatrixTransform]::new($matrix)))
        foreach ($shape in $paths) {
            $brush = if ($negative) { [System.Windows.Media.Brushes]::White } else { [System.Windows.Media.Brushes]::Black }
            if ($shape.GetAttribute('fill').StartsWith('url(')) {
                $gradient = $svg.SelectSingleNode('//*[local-name()="linearGradient"]')
                $brush = New-Object System.Windows.Media.LinearGradientBrush
                $brush.MappingMode = [System.Windows.Media.BrushMappingMode]::Absolute
                $brush.StartPoint = [System.Windows.Point]::new([double]$gradient.x1, [double]$gradient.y1)
                $brush.EndPoint = [System.Windows.Point]::new([double]$gradient.x2, [double]$gradient.y2)
                foreach ($stop in $gradient.ChildNodes) {
                    $channel = if ($negative) { 255 } else { 0 }
                    $color = [System.Windows.Media.Color]::FromArgb([byte]([double]$stop.GetAttribute('stop-opacity') * 255), $channel, $channel, $channel)
                    $brush.GradientStops.Add(([System.Windows.Media.GradientStop]::new($color, [double]$stop.offset)))
                }
            }
            $drawing.DrawGeometry($brush, $null, [System.Windows.Media.Geometry]::Parse($shape.GetAttribute('d')))
        }
        $drawing.Pop()
        $drawing.Close()
        $bitmap = [System.Windows.Media.Imaging.RenderTargetBitmap]::new($size, $size, 96, 96, [System.Windows.Media.PixelFormats]::Pbgra32)
        $bitmap.Render($visual)
        $encoder = New-Object System.Windows.Media.Imaging.PngBitmapEncoder
        $encoder.Frames.Add([System.Windows.Media.Imaging.BitmapFrame]::Create($bitmap))
        $stream = New-Object System.IO.MemoryStream
        $encoder.Save($stream)
        $images += ,@{Size=$size;Bytes=$stream.ToArray()}
        $stream.Dispose()
    }
    $output = [System.IO.File]::Create($outputFile)
    $writer = [System.IO.BinaryWriter]::new($output)
    try {
        $writer.Write([uint16]0); $writer.Write([uint16]1); $writer.Write([uint16]$images.Count)
        $offset = 6 + 16 * $images.Count
        foreach ($image in $images) {
            $writer.Write([byte]$image.Size); $writer.Write([byte]$image.Size)
            $writer.Write([byte]0); $writer.Write([byte]0); $writer.Write([uint16]1); $writer.Write([uint16]32)
            $writer.Write([uint32]$image.Bytes.Length); $writer.Write([uint32]$offset)
            $offset += $image.Bytes.Length
        }
        foreach ($image in $images) { $writer.Write([byte[]]$image.Bytes) }
    } finally { $writer.Dispose() }
}

$iconFolder = Join-Path $trayFolder 'assets'
New-Item -ItemType Directory -Path $iconFolder -Force | Out-Null
New-LogoIcon (Join-Path $iconFolder 'logo.ico') $false
New-LogoIcon (Join-Path $iconFolder 'logo-dark.ico') $true
& $compiler /nologo /target:winexe /optimize+ /platform:x64 "/out:$trayFolder\LocalserveTray.exe" "/win32icon:$iconFolder\logo.ico" /reference:System.dll /reference:System.Core.dll /reference:System.Drawing.dll /reference:System.Windows.Forms.dll /reference:System.Web.Extensions.dll "$trayFolder\LocalserveTray.cs"
if ($LASTEXITCODE -ne 0) { throw 'Tray compilation failed.' }
Write-Output 'Built tray/LocalserveTray.exe and application icons.'

