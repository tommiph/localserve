# Render the supplied PS5 vector wordmark with Windows WPF. No font, network
# request or downloaded renderer is required for reproducible local icons.
$ErrorActionPreference='Stop'
Add-Type -AssemblyName PresentationCore, WindowsBase
$projectFolder=Split-Path -Parent $PSScriptRoot
$assetFolder=Join-Path $projectFolder 'assets/playstation-mode'
$appFolder=Join-Path $projectFolder 'tv-tizen/playstation/app'
[xml]$sourceLogo=Get-Content -LiteralPath (Join-Path $assetFolder 'ps5-logo.svg') -Raw
$shapes=$sourceLogo.SelectNodes('//*[local-name()="path"]')
foreach($kind in @('wordmark','icon')) {
  $width=if($kind -eq 'icon'){512}else{1000}
  $height=if($kind -eq 'icon'){288}else{218}
  $scale=if($kind -eq 'icon'){440/990.96}else{1000/990.96}
  $left=($width-990.96*$scale)/2
  $top=($height-215.56*$scale)/2
  $visual=[System.Windows.Media.DrawingVisual]::new();$drawing=$visual.RenderOpen()
  if($kind -eq 'icon') {
    $brush=[System.Windows.Media.LinearGradientBrush]::new([System.Windows.Media.Color]::FromRgb(23,76,164),[System.Windows.Media.Color]::FromRgb(4,14,40),45)
    $drawing.DrawRectangle($brush,$null,[System.Windows.Rect]::new(0,0,$width,$height))
    $border=[System.Windows.Media.Pen]::new([System.Windows.Media.SolidColorBrush]::new([System.Windows.Media.Color]::FromRgb(94,158,255)),3)
    $drawing.DrawRectangle($null,$border,[System.Windows.Rect]::new(10,10,$width-20,$height-20))
  }
  $drawing.PushTransform([System.Windows.Media.MatrixTransform]::new([System.Windows.Media.Matrix]::new($scale,0,0,$scale,$left,$top)))
  foreach($shape in $shapes) {$drawing.DrawGeometry([System.Windows.Media.Brushes]::White,$null,[System.Windows.Media.Geometry]::Parse($shape.GetAttribute('d')))}
  $drawing.Pop();$drawing.Close()
  $bitmap=[System.Windows.Media.Imaging.RenderTargetBitmap]::new($width,$height,96,96,[System.Windows.Media.PixelFormats]::Pbgra32);$bitmap.Render($visual)
  $encoder=[System.Windows.Media.Imaging.PngBitmapEncoder]::new();$encoder.Frames.Add([System.Windows.Media.Imaging.BitmapFrame]::Create($bitmap))
  $stream=[IO.File]::Create((Join-Path $assetFolder ($kind+'.png')))
  try {$encoder.Save($stream)} finally {$stream.Dispose()}
  Copy-Item -LiteralPath (Join-Path $assetFolder ($kind+'.png')) -Destination (Join-Path $appFolder ($kind+'.png')) -Force
}
Write-Output 'Built PlayStation wordmark and Tizen launcher icon.'
