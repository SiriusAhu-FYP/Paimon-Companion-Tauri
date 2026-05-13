use serde::{Deserialize, Serialize};
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartDelegationScratchpadRequest {
	pub label: Option<String>,
	pub mirror_debug_session_id: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DelegationScratchpadSessionInfo {
	pub scratchpad_id: String,
	pub directory: String,
	pub mirror_directory: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteDelegationScratchpadTextRequest {
	pub scratchpad_id: String,
	pub relative_path: String,
	pub text: String,
	pub append: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadDelegationScratchpadTextRequest {
	pub scratchpad_id: String,
	pub relative_path: String,
	pub max_chars: Option<usize>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ScratchpadMeta {
	scratchpad_id: String,
	created_at: String,
	mirror_debug_session_id: Option<String>,
}

const META_FILE_NAME: &str = "_meta.json";

#[tauri::command]
pub async fn start_delegation_scratchpad(
	request: StartDelegationScratchpadRequest,
) -> Result<DelegationScratchpadSessionInfo, String> {
	let scratchpad_id = build_scratchpad_id(request.label.as_deref());
	let scratchpad_dir = get_scratchpad_dir(&scratchpad_id)?;
	fs::create_dir_all(&scratchpad_dir).map_err(|err| format!("failed to create scratchpad directory: {err}"))?;
	fs::create_dir_all(scratchpad_dir.join("shared"))
		.map_err(|err| format!("failed to create scratchpad shared directory: {err}"))?;
	fs::create_dir_all(scratchpad_dir.join("roles"))
		.map_err(|err| format!("failed to create scratchpad roles directory: {err}"))?;

	let mirror_debug_session_id = request
		.mirror_debug_session_id
		.as_deref()
		.map(str::trim)
		.filter(|value| !value.is_empty())
		.map(str::to_string);
	let mirror_directory = mirror_debug_session_id
		.as_deref()
		.and_then(|session_id| resolve_mirror_dir(session_id, &scratchpad_id).ok());
	if let Some(mirror_dir) = mirror_directory.as_ref() {
		fs::create_dir_all(mirror_dir).map_err(|err| format!("failed to create mirror scratchpad directory: {err}"))?;
	}

	let meta = ScratchpadMeta {
		scratchpad_id: scratchpad_id.clone(),
		created_at: chrono::Local::now().to_rfc3339(),
		mirror_debug_session_id,
	};
	write_meta(&scratchpad_dir, &meta)?;

	Ok(DelegationScratchpadSessionInfo {
		scratchpad_id,
		directory: scratchpad_dir.to_string_lossy().to_string(),
		mirror_directory: mirror_directory.map(|dir| dir.to_string_lossy().to_string()),
	})
}

#[tauri::command]
pub async fn write_delegation_scratchpad_text(request: WriteDelegationScratchpadTextRequest) -> Result<(), String> {
	let target_path = resolve_scratchpad_path(&request.scratchpad_id, &request.relative_path)?;
	write_text(&target_path, &request.text, request.append.unwrap_or(true))?;

	let scratchpad_dir = get_scratchpad_dir(&request.scratchpad_id)?;
	let meta = read_meta(&scratchpad_dir)?;
	if let Some(debug_session_id) = meta.mirror_debug_session_id.as_deref() {
		if let Ok(mirror_dir) = resolve_mirror_dir(debug_session_id, &request.scratchpad_id) {
			let mirror_relative_path = sanitize_relative_path(&request.relative_path)?;
			let mirror_target_path = mirror_dir.join(mirror_relative_path);
			let _ = write_text(&mirror_target_path, &request.text, request.append.unwrap_or(true));
		}
	}

	Ok(())
}

#[tauri::command]
pub async fn read_delegation_scratchpad_text(request: ReadDelegationScratchpadTextRequest) -> Result<String, String> {
	let target_path = resolve_scratchpad_path(&request.scratchpad_id, &request.relative_path)?;
	let content = fs::read_to_string(&target_path).map_err(|err| format!("failed to read scratchpad text: {err}"))?;
	if let Some(limit) = request.max_chars {
		return Ok(take_last_chars(&content, limit));
	}
	Ok(content)
}

pub fn cleanup_stale_delegation_scratchpads(max_age_hours: u64) -> Result<(), String> {
	let root = get_scratchpads_root()?;
	if !root.exists() {
		return Ok(());
	}
	if !root.is_dir() {
		return Err("scratchpads root is not a directory".to_string());
	}
	let expiry = Duration::from_secs(max_age_hours.saturating_mul(3600));
	let now = SystemTime::now();
	let entries = fs::read_dir(&root).map_err(|err| format!("failed to read scratchpads root: {err}"))?;
	for entry in entries {
		let entry = match entry {
			Ok(value) => value,
			Err(_) => continue,
		};
		let path = entry.path();
		if !path.is_dir() {
			continue;
		}
		let metadata = match entry.metadata() {
			Ok(value) => value,
			Err(_) => continue,
		};
		let modified_at = metadata
			.modified()
			.or_else(|_| metadata.created())
			.unwrap_or(now);
		let age = now.duration_since(modified_at).unwrap_or(Duration::from_secs(0));
		if age > expiry {
			let _ = fs::remove_dir_all(path);
		}
	}
	Ok(())
}

fn get_scratchpads_root() -> Result<PathBuf, String> {
	let current_dir = std::env::current_dir().map_err(|err| format!("failed to resolve current dir: {err}"))?;
	Ok(current_dir.join("logs").join("delegation-scratchpads"))
}

fn get_scratchpad_dir(scratchpad_id: &str) -> Result<PathBuf, String> {
	let sanitized_id = sanitize_scratchpad_id(scratchpad_id)?;
	Ok(get_scratchpads_root()?.join(sanitized_id))
}

fn resolve_scratchpad_path(scratchpad_id: &str, relative_path: &str) -> Result<PathBuf, String> {
	let scratchpad_dir = get_scratchpad_dir(scratchpad_id)?;
	let relative = sanitize_relative_path(relative_path)?;
	Ok(scratchpad_dir.join(relative))
}

fn resolve_mirror_dir(debug_session_id: &str, scratchpad_id: &str) -> Result<PathBuf, String> {
	let debug_session_dir = get_debug_capture_session_dir(debug_session_id)?;
	let sanitized_id = sanitize_scratchpad_id(scratchpad_id)?;
	Ok(debug_session_dir.join("delegation-scratchpads").join(sanitized_id))
}

fn get_debug_capture_session_dir(session_id: &str) -> Result<PathBuf, String> {
	let current_dir = std::env::current_dir().map_err(|err| format!("failed to resolve current dir: {err}"))?;
	let sanitized = sanitize_label(session_id);
	Ok(current_dir.join("logs").join("debug-captures").join(sanitized))
}

fn sanitize_scratchpad_id(raw: &str) -> Result<String, String> {
	let sanitized = sanitize_label(raw);
	if sanitized.is_empty() {
		return Err("scratchpad id is empty".to_string());
	}
	Ok(sanitized)
}

fn sanitize_relative_path(path: &str) -> Result<PathBuf, String> {
	let raw = Path::new(path);
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
					return Err("invalid scratchpad path component".to_string());
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
			_ => return Err("invalid scratchpad path".to_string()),
		}
	}
	if sanitized.as_os_str().is_empty() {
		return Err("scratchpad path cannot be empty".to_string());
	}
	Ok(sanitized)
}

fn build_scratchpad_id(label: Option<&str>) -> String {
	let timestamp = chrono::Local::now().format("%Y%m%d-%H%M%S-%3f").to_string();
	let suffix = sanitize_label(label.unwrap_or("delegation"));
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
		"delegation".to_string()
	} else {
		cleaned.to_string()
	}
}

fn write_text(path: &Path, text: &str, append: bool) -> Result<(), String> {
	if let Some(parent) = path.parent() {
		fs::create_dir_all(parent).map_err(|err| format!("failed to create scratchpad parent directory: {err}"))?;
	}
	if append {
		let mut file = OpenOptions::new()
			.create(true)
			.append(true)
			.open(path)
			.map_err(|err| format!("failed to open scratchpad file for append: {err}"))?;
		file
			.write_all(text.as_bytes())
			.map_err(|err| format!("failed to append scratchpad file: {err}"))?;
		return Ok(());
	}
	fs::write(path, text).map_err(|err| format!("failed to write scratchpad file: {err}"))
}

fn write_meta(scratchpad_dir: &Path, meta: &ScratchpadMeta) -> Result<(), String> {
	let meta_path = scratchpad_dir.join(META_FILE_NAME);
	let serialized = serde_json::to_string_pretty(meta).map_err(|err| format!("failed to serialize scratchpad meta: {err}"))?;
	fs::write(meta_path, serialized).map_err(|err| format!("failed to write scratchpad meta: {err}"))
}

fn read_meta(scratchpad_dir: &Path) -> Result<ScratchpadMeta, String> {
	let meta_path = scratchpad_dir.join(META_FILE_NAME);
	let raw = fs::read_to_string(meta_path).map_err(|err| format!("failed to read scratchpad meta: {err}"))?;
	serde_json::from_str::<ScratchpadMeta>(&raw).map_err(|err| format!("failed to parse scratchpad meta: {err}"))
}

fn take_last_chars(text: &str, max_chars: usize) -> String {
	if max_chars == 0 {
		return String::new();
	}
	let char_count = text.chars().count();
	if char_count <= max_chars {
		return text.to_string();
	}
	text
		.chars()
		.skip(char_count - max_chars)
		.collect::<String>()
}
