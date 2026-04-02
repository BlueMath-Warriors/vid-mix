# Pin to same @ffmpeg/core version as bundled ffmpeg-core.js (0.12.6)
$ErrorActionPreference = "Stop"
$Version = "0.12.6"
$OutDir = Join-Path $PSScriptRoot "..\static\libs\ffmpeg"
$Url = "https://unpkg.com/@ffmpeg/core@${Version}/dist/esm/ffmpeg-core.wasm"
$Dest = Join-Path $OutDir "ffmpeg-core.wasm"
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
Write-Host "Downloading $Url -> $Dest"
Invoke-WebRequest -Uri $Url -OutFile $Dest -UseBasicParsing
Write-Host "Done. Size:" (Get-Item $Dest).Length
