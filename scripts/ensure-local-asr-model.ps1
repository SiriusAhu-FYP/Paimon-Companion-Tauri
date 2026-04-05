$ErrorActionPreference = "Stop"

$modelName = "sherpa-onnx-streaming-zipformer-small-bilingual-zh-en-2023-02-16"
$modelUrl = "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/$modelName.tar.bz2"
$resourceRoot = Join-Path $PSScriptRoot "..\\src-tauri\\resources\\asr"
$modelDir = Join-Path $resourceRoot $modelName
$archivePath = Join-Path $resourceRoot "$modelName.tar.bz2"
$nativeArchiveName = "sherpa-onnx-v1.12.34-win-x64-static-MT-Release-lib.tar.bz2"
$nativeArchiveUrl = "https://github.com/k2-fsa/sherpa-onnx/releases/download/v1.12.34/$nativeArchiveName"
$nativeArchiveRoot = Join-Path $PSScriptRoot "..\\src-tauri\\vendor\\sherpa-onnx"
$nativeArchivePath = Join-Path $nativeArchiveRoot $nativeArchiveName

if (Test-Path $modelDir) {
	Write-Host "local ASR model already present: $modelDir"
} else {
	New-Item -ItemType Directory -Force -Path $resourceRoot | Out-Null

	Write-Host "downloading local ASR model: $modelUrl"
	Invoke-WebRequest -Uri $modelUrl -OutFile $archivePath

	Write-Host "extracting local ASR model..."
	tar -xf $archivePath -C $resourceRoot

	Remove-Item $archivePath -Force
	Write-Host "local ASR model ready: $modelDir"
}

New-Item -ItemType Directory -Force -Path $nativeArchiveRoot | Out-Null

if (Test-Path $nativeArchivePath) {
	Write-Host "local sherpa native archive already present: $nativeArchivePath"
	exit 0
}

Write-Host "downloading sherpa native archive: $nativeArchiveUrl"
Invoke-WebRequest -Uri $nativeArchiveUrl -OutFile $nativeArchivePath
Write-Host "local sherpa native archive ready: $nativeArchivePath"
