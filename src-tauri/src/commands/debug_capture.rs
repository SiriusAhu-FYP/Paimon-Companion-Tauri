use base64::Engine;
use serde::{Deserialize, Serialize};
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartDebugCaptureRequest {
	pub label: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DebugCaptureSessionInfo {
	pub session_id: String,
	pub directory: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppendDebugCaptureTextRequest {
	pub session_id: String,
	pub file_name: String,
	pub text: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteDebugCaptureImageRequest {
	pub session_id: String,
	pub file_name: String,
	pub data_url: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportDebugCaptureSessionRequest {
	pub session_id: String,
	pub label: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DebugCaptureExportInfo {
	pub export_id: String,
	pub directory: String,
	pub file_count: usize,
	pub total_bytes: u64,
}

#[tauri::command]
pub async fn start_debug_capture(request: StartDebugCaptureRequest) -> Result<DebugCaptureSessionInfo, String> {
	let session_id = build_session_id(request.label.as_deref());
	let session_dir = get_session_dir(&session_id)?;
	fs::create_dir_all(&session_dir).map_err(|err| format!("failed to create debug capture directory: {err}"))?;
	fs::create_dir_all(session_dir.join("images")).map_err(|err| format!("failed to create image directory: {err}"))?;

	Ok(DebugCaptureSessionInfo {
		session_id,
		directory: session_dir.to_string_lossy().to_string(),
	})
}

#[tauri::command]
pub async fn append_debug_capture_text(request: AppendDebugCaptureTextRequest) -> Result<(), String> {
	let path = resolve_session_path(&request.session_id, &request.file_name)?;
	if let Some(parent) = path.parent() {
		fs::create_dir_all(parent).map_err(|err| format!("failed to create parent directory: {err}"))?;
	}

	let mut file = OpenOptions::new()
		.create(true)
		.append(true)
		.open(&path)
		.map_err(|err| format!("failed to open debug capture file: {err}"))?;
	file
		.write_all(request.text.as_bytes())
		.map_err(|err| format!("failed to append debug capture text: {err}"))?;
	Ok(())
}

#[tauri::command]
pub async fn write_debug_capture_image(request: WriteDebugCaptureImageRequest) -> Result<(), String> {
	let path = resolve_session_path(&request.session_id, &request.file_name)?;
	if let Some(parent) = path.parent() {
		fs::create_dir_all(parent).map_err(|err| format!("failed to create image parent directory: {err}"))?;
	}

	let bytes = decode_data_url(&request.data_url)?;
	fs::write(&path, bytes).map_err(|err| format!("failed to write debug capture image: {err}"))?;
	Ok(())
}

#[tauri::command]
pub async fn export_debug_capture_session(request: ExportDebugCaptureSessionRequest) -> Result<DebugCaptureExportInfo, String> {
	let session_id = sanitize_label(&request.session_id);
	let source_dir = get_session_dir(&session_id)?;
	if !source_dir.exists() {
		return Err(format!("debug capture session not found: {session_id}"));
	}
	let export_root = get_exports_root()?;
	fs::create_dir_all(&export_root).map_err(|err| format!("failed to create export root: {err}"))?;

	let suffix = sanitize_label(request.label.as_deref().unwrap_or("export"));
	let export_id = format!("{session_id}-export-{}", chrono_like_timestamp());
	let export_dir = export_root.join(if suffix == "export" {
		export_id.clone()
	} else {
		format!("{export_id}-{suffix}")
	});
	fs::create_dir_all(&export_dir).map_err(|err| format!("failed to create export directory: {err}"))?;

	let stats = copy_directory_recursive(&source_dir, &export_dir)?;

	Ok(DebugCaptureExportInfo {
		export_id: export_dir
			.file_name()
			.and_then(|v| v.to_str())
			.unwrap_or(&export_id)
			.to_string(),
		directory: export_dir.to_string_lossy().to_string(),
		file_count: stats.file_count,
		total_bytes: stats.total_bytes,
	})
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DebugCaptureSessionSummary {
	pub session_id: String,
	pub label: String,
	pub created_at: String,
}

#[tauri::command]
pub async fn list_debug_capture_sessions() -> Result<Vec<DebugCaptureSessionSummary>, String> {
	let root = get_logs_root()?;
	if !root.exists() {
		return Ok(Vec::new());
	}
	let mut sessions: Vec<DebugCaptureSessionSummary> = Vec::new();
	let entries = fs::read_dir(&root).map_err(|err| format!("failed to read logs root: {err}"))?;
	for entry in entries {
		let entry = entry.map_err(|err| format!("failed to iterate logs: {err}"))?;
		if !entry.path().is_dir() {
			continue;
		}
		let name = entry.file_name().to_string_lossy().to_string();
		let parts: Vec<&str> = name.splitn(3, '-').collect();
		let created_at = if parts.len() >= 2 {
			format!("{}-{}", parts[0], parts[1])
		} else {
			name.clone()
		};
		let label = if parts.len() >= 3 { parts[2..].join("-") } else { "manual".to_string() };
		sessions.push(DebugCaptureSessionSummary {
			session_id: name,
			label,
			created_at,
		});
	}
	sessions.sort_by(|a, b| b.session_id.cmp(&a.session_id));
	Ok(sessions)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadDebugCaptureFileRequest {
	pub session_id: String,
	pub file_name: String,
}

#[tauri::command]
pub async fn read_debug_capture_file(request: ReadDebugCaptureFileRequest) -> Result<String, String> {
	let path = resolve_session_path(&request.session_id, &request.file_name)?;
	fs::read_to_string(&path).map_err(|err| format!("failed to read file: {err}"))
}

fn get_logs_root() -> Result<PathBuf, String> {
	let current_dir = std::env::current_dir().map_err(|err| format!("failed to resolve current dir: {err}"))?;
	Ok(current_dir.join("logs").join("debug-captures"))
}

fn get_exports_root() -> Result<PathBuf, String> {
	let current_dir = std::env::current_dir().map_err(|err| format!("failed to resolve current dir: {err}"))?;
	Ok(current_dir.join("logs").join("debug-capture-exports"))
}

fn get_session_dir(session_id: &str) -> Result<PathBuf, String> {
	Ok(get_logs_root()?.join(sanitize_label(session_id)))
}

fn resolve_session_path(session_id: &str, file_name: &str) -> Result<PathBuf, String> {
	let session_dir = get_session_dir(session_id)?;
	let relative = sanitize_relative_path(file_name)?;
	Ok(session_dir.join(relative))
}

fn sanitize_relative_path(file_name: &str) -> Result<PathBuf, String> {
	let raw = Path::new(file_name);
	if raw.is_absolute() {
		return Err("absolute paths are not allowed".to_string());
	}

	let mut sanitized = PathBuf::new();
	for component in raw.components() {
		use std::path::Component;
		match component {
			Component::Normal(part) => {
				let part = part.to_string_lossy();
				if part.is_empty() || part == "." || part == ".." {
					return Err("invalid debug capture path component".to_string());
				}
				let cleaned = part
					.chars()
					.map(|ch| match ch {
						'\\' | '/' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
						_ => ch,
					})
					.collect::<String>();
				sanitized.push(cleaned);
			}
			_ => return Err("invalid debug capture path".to_string()),
		}
	}

	if sanitized.as_os_str().is_empty() {
		return Err("debug capture path cannot be empty".to_string());
	}

	Ok(sanitized)
}

fn build_session_id(label: Option<&str>) -> String {
	let timestamp = chrono_like_timestamp();
	let suffix = sanitize_label(label.unwrap_or("manual"));
	format!("{timestamp}-{suffix}")
}

fn sanitize_label(raw: &str) -> String {
	let cleaned = raw
		.trim()
		.to_lowercase()
		.chars()
		.map(|ch| {
			if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
				ch
			} else {
				'-'
			}
		})
		.collect::<String>();
	let cleaned = cleaned.trim_matches('-');
	if cleaned.is_empty() {
		"manual".to_string()
	} else {
		cleaned.to_string()
	}
}

fn chrono_like_timestamp() -> String {
	let now = chrono::Local::now();
	now.format("%Y%m%d-%H%M%S-%3f").to_string()
}

fn decode_data_url(data_url: &str) -> Result<Vec<u8>, String> {
	let (_, encoded) = data_url
		.split_once(',')
		.ok_or_else(|| "invalid data url".to_string())?;
	base64::engine::general_purpose::STANDARD
		.decode(encoded)
		.map_err(|err| format!("failed to decode base64 image: {err}"))
}

#[derive(Default)]
struct CopyStats {
	file_count: usize,
	total_bytes: u64,
}

fn copy_directory_recursive(source: &Path, target: &Path) -> Result<CopyStats, String> {
	let mut stats = CopyStats::default();
	let entries = fs::read_dir(source).map_err(|err| format!("failed to read source directory: {err}"))?;
	for entry in entries {
		let entry = entry.map_err(|err| format!("failed to iterate source directory: {err}"))?;
		let source_path = entry.path();
		let target_path = target.join(entry.file_name());
		if source_path.is_dir() {
			fs::create_dir_all(&target_path).map_err(|err| format!("failed to create export subdirectory: {err}"))?;
			let nested = copy_directory_recursive(&source_path, &target_path)?;
			stats.file_count += nested.file_count;
			stats.total_bytes = stats.total_bytes.saturating_add(nested.total_bytes);
			continue;
		}
		let copied = fs::copy(&source_path, &target_path).map_err(|err| format!("failed to export file: {err}"))?;
		stats.file_count += 1;
		stats.total_bytes = stats.total_bytes.saturating_add(copied);
	}
	Ok(stats)
}
