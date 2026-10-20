Add-Type -AssemblyName System.Drawing
$shot = Join-Path $env:TEMP 'login-shot.png'
$bmp = [System.Drawing.Bitmap]::FromFile($shot)
$dpr = 2
$W = $bmp.Width; $H = $bmp.Height
"image ${W}x${H}  (device px, dpr=$dpr)"

function IsWhiteish ($c) { return ($c.R -gt 245 -and $c.G -gt 245 -and $c.B -gt 245) }

# 横向：取几条水平线，找第一个非白像素（左边界）和最后一个非白像素（右边界）
foreach ($cssY in 5, 200, 450, 700, 895) {
  $y = [int]($cssY * $dpr)
  if ($y -ge $H) { continue }
  $first = -1; $last = -1
  for ($x = 0; $x -lt $W; $x++) {
    $c = $bmp.GetPixel($x, $y)
    if (-not (IsWhiteish $c)) { if ($first -lt 0) { $first = $x }; $last = $x }
  }
  "row cssY=$cssY : first=$first ($([math]::Round($first/$dpr,1)) css)  last=$last ($([math]::Round($last/$dpr,1)) css)"
}

# 纵向：取几条竖线，找第一个非白像素（上边界）和最后一个（下边界）
foreach ($cssX in 5, 400, 700, 1100, 1400) {
  $x = [int]($cssX * $dpr)
  if ($x -ge $W) { continue }
  $first = -1; $last = -1
  for ($y = 0; $y -lt $H; $y++) {
    $c = $bmp.GetPixel($x, $y)
    if (-not (IsWhiteish $c)) { if ($first -lt 0) { $first = $y }; $last = $y }
  }
  "col cssX=$cssX : first=$first ($([math]::Round($first/$dpr,1)) css)  last=$last ($([math]::Round($last/$dpr,1)) css)"
}

# 在中间水平线上打印颜色分段，看清各区块边界
$y = [int](450 * $dpr)
$prev = ''; $start = 0
for ($x = 0; $x -lt $W; $x++) {
  $c = $bmp.GetPixel($x, $y)
  $tag = if (IsWhiteish $c) { 'white' } else { 'content' }
  if ($tag -ne $prev) {
    if ($prev -ne '') { "  [$prev] x $start..$($x-1)  css $([math]::Round($start/$dpr,1))..$([math]::Round(($x-1)/$dpr,1))" }
    $prev = $tag; $start = $x
  }
}
"  [$prev] x $start..$($W-1)  css $([math]::Round($start/$dpr,1))..$([math]::Round(($W-1)/$dpr,1))"
$bmp.Dispose()
