use std::{
	path::{Path, PathBuf},
	sync::{Mutex, OnceLock},
};

use serde::{Deserialize, Serialize};
use sherpa_onnx::{OnlineRecognizer, OnlineRecognizerConfig};
use tauri::{AppHandle, Manager};

const MODEL_NAME: &str = "sherpa-onnx-streaming-zipformer-small-bilingual-zh-en-2023-02-16";
const MODEL_ROOT: &str = "asr";

static SHERPA_RECOGNIZER: OnceLock<Mutex<OnlineRecognizer>> = OnceLock::new();

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalSherpaTranscribeRequest {
	pub sample_rate: i32,
	pub samples: Vec<f32>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalSherpaHealthResponse {
	pub label: String,
	pub model_name: String,
	pub model_dir: String,
}

fn resolve_model_dir(app: &AppHandle) -> Result<PathBuf, String> {
	let candidate = app
		.path()
		.resource_dir()
		.map_err(|err| format!("failed to resolve Tauri resource dir: {err}"))?
		.join(MODEL_ROOT)
		.join(MODEL_NAME);

	if candidate.exists() {
		return Ok(candidate);
	}

	let workspace_fallback = std::env::current_dir()
		.map_err(|err| format!("failed to resolve current dir: {err}"))?
		.join("src-tauri")
		.join("resources")
		.join(MODEL_ROOT)
		.join(MODEL_NAME);

	if workspace_fallback.exists() {
		return Ok(workspace_fallback);
	}

	Err(format!(
		"local sherpa model directory not found: {}",
		workspace_fallback.display()
	))
}

fn required_file(path: &Path) -> Result<String, String> {
	if !path.exists() {
		return Err(format!("missing required model file: {}", path.display()));
	}
	Ok(path.to_string_lossy().into_owned())
}

fn create_recognizer(app: &AppHandle) -> Result<OnlineRecognizer, String> {
	let model_dir = resolve_model_dir(app)?;
	let mut config = OnlineRecognizerConfig::default();
	config.model_config.transducer.encoder = Some(required_file(&model_dir.join("encoder-epoch-99-avg-1.onnx"))?);
	config.model_config.transducer.decoder = Some(required_file(&model_dir.join("decoder-epoch-99-avg-1.onnx"))?);
	config.model_config.transducer.joiner = Some(required_file(&model_dir.join("joiner-epoch-99-avg-1.onnx"))?);
	config.model_config.tokens = Some(required_file(&model_dir.join("tokens.txt"))?);
	config.model_config.provider = Some("cpu".to_string());
	config.model_config.num_threads = 2;
	config.enable_endpoint = true;
	config.decoding_method = Some("greedy_search".to_string());

	OnlineRecognizer::create(&config)
		.ok_or_else(|| "failed to create local sherpa recognizer".to_string())
}

fn get_recognizer(app: &AppHandle) -> Result<&Mutex<OnlineRecognizer>, String> {
	if let Some(recognizer) = SHERPA_RECOGNIZER.get() {
		return Ok(recognizer);
	}

	let recognizer = create_recognizer(app)?;
	let _ = SHERPA_RECOGNIZER.set(Mutex::new(recognizer));
	SHERPA_RECOGNIZER
		.get()
		.ok_or_else(|| "failed to store local sherpa recognizer".to_string())
}

#[tauri::command]
pub fn local_sherpa_healthcheck(app: AppHandle) -> Result<LocalSherpaHealthResponse, String> {
	let model_dir = resolve_model_dir(&app)?;
	let _ = get_recognizer(&app)?;

	Ok(LocalSherpaHealthResponse {
		label: "Local sherpa-onnx ASR".to_string(),
		model_name: MODEL_NAME.to_string(),
		model_dir: model_dir.display().to_string(),
	})
}

#[tauri::command]
pub fn local_sherpa_transcribe(
	app: AppHandle,
	request: LocalSherpaTranscribeRequest,
) -> Result<String, String> {
	if request.samples.is_empty() {
		return Err("local sherpa received empty PCM samples".to_string());
	}

	let recognizer = get_recognizer(&app)?;
	let recognizer = recognizer
		.lock()
		.map_err(|_| "local sherpa recognizer lock poisoned".to_string())?;

	let stream = recognizer.create_stream();
	stream.accept_waveform(request.sample_rate, &request.samples);
	stream.input_finished();

	while recognizer.is_ready(&stream) {
		recognizer.decode(&stream);
	}

	let result = recognizer
		.get_result(&stream)
		.ok_or_else(|| "local sherpa did not return a recognition result".to_string())?;

	Ok(result.text.trim().to_string())
}
