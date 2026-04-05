$ErrorActionPreference = "Stop"

$modelName = "sherpa-onnx-streaming-zipformer-small-bilingual-zh-en-2023-02-16"
$modelUrl = "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/$modelName.tar.bz2"
$resourceRoot = Join-Path $PSScriptRoot "..\\src-tauri\\resources\\asr"
$modelDir = Join-Path $resourceRoot $modelName
$archivePath = Join-Path $resourceRoot "$modelName.tar.bz2"

if (Test-Path $modelDir) {
	Write-Host "local ASR model already present: $modelDir"
	exit 0
}

New-Item -ItemType Directory -Force -Path $resourceRoot | Out-Null

Write-Host "downloading local ASR model: $modelUrl"
Invoke-WebRequest -Uri $modelUrl -OutFile $archivePath

Write-Host "extracting local ASR model..."
tar -xf $archivePath -C $resourceRoot

Remove-Item $archivePath -Force
Write-Host "local ASR model ready: $modelDir"
