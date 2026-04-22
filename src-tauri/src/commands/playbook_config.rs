use serde::Deserialize;
use serde_json::{Map as JsonMap, Number as JsonNumber, Value as JsonValue};
use std::fs;
use std::path::{Component, Path, PathBuf};
use toml_edit::{Array as TomlArray, DocumentMut, InlineTable, Item, Value as TomlValue};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaybookTomlReadRequest {
	pub relative_path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaybookTomlValueUpdate {
	pub key_path: String,
	pub value: JsonValue,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaybookTomlUpdateRequest {
	pub relative_path: String,
	pub updates: Vec<PlaybookTomlValueUpdate>,
}

#[tauri::command]
pub async fn read_playbook_toml_values(request: PlaybookTomlReadRequest) -> Result<JsonValue, String> {
	let path = resolve_playbook_path(&request.relative_path)?;
	let raw = fs::read_to_string(&path).map_err(|err| format!("failed to read playbook toml: {err}"))?;
	let document = raw
		.parse::<DocumentMut>()
		.map_err(|err| format!("failed to parse playbook toml: {err}"))?;
	Ok(table_to_json(document.as_table()))
}

#[tauri::command]
pub async fn update_playbook_toml_values(request: PlaybookTomlUpdateRequest) -> Result<(), String> {
	let path = resolve_playbook_path(&request.relative_path)?;
	let raw = fs::read_to_string(&path).map_err(|err| format!("failed to read playbook toml: {err}"))?;
	let mut document = raw
		.parse::<DocumentMut>()
		.map_err(|err| format!("failed to parse playbook toml: {err}"))?;
	for update in request.updates.iter() {
		let key_path = sanitize_key_path(&update.key_path)?;
		let value = json_to_toml_value(&update.value)?;
		set_existing_value(document.as_table_mut(), &key_path, &value)?;
	}
	fs::write(&path, document.to_string()).map_err(|err| format!("failed to write playbook toml: {err}"))?;
	Ok(())
}

fn resolve_playbook_path(relative_path: &str) -> Result<PathBuf, String> {
	let sanitized = sanitize_relative_path(relative_path)?;
	let normalized = sanitized.to_string_lossy().replace('\\', "/");
	let allowed_prefixes = [
		"src/config/tasks/",
		"src/config/games/",
		"config/templates/",
	];
	if !allowed_prefixes
		.iter()
		.any(|prefix| normalized.starts_with(prefix))
	{
		return Err("playbook path is outside allowed directories".to_string());
	}
	if !normalized.ends_with(".toml") {
		return Err("playbook path must be a .toml file".to_string());
	}
	let current_dir = std::env::current_dir().map_err(|err| format!("failed to resolve current dir: {err}"))?;
	Ok(current_dir.join(sanitized))
}

fn sanitize_relative_path(path: &str) -> Result<PathBuf, String> {
	let raw = Path::new(path);
	if raw.is_absolute() {
		return Err("absolute paths are not allowed".to_string());
	}
	let mut sanitized = PathBuf::new();
	for component in raw.components() {
		match component {
			Component::Normal(part) => {
				let part = part.to_string_lossy();
				if part.is_empty() || part == "." || part == ".." {
					return Err("invalid playbook path component".to_string());
				}
				sanitized.push(part.as_ref());
			}
			_ => return Err("invalid playbook path".to_string()),
		}
	}
	if sanitized.as_os_str().is_empty() {
		return Err("playbook path cannot be empty".to_string());
	}
	Ok(sanitized)
}

fn sanitize_key_path(path: &str) -> Result<Vec<&str>, String> {
	let segments = path
		.split('.')
		.map(str::trim)
		.filter(|segment| !segment.is_empty())
		.collect::<Vec<_>>();
	if segments.is_empty() {
		return Err("keyPath cannot be empty".to_string());
	}
	Ok(segments)
}

fn set_existing_value(table: &mut toml_edit::Table, path: &[&str], new_value: &TomlValue) -> Result<(), String> {
	let key = path[0];
	let item = table
		.get_mut(key)
		.ok_or_else(|| format!("key path segment not found: {key}"))?;
	if path.len() == 1 {
		return update_item_value(item, new_value.clone(), key);
	}
	match item {
		Item::Table(next_table) => set_existing_value(next_table, &path[1..], new_value),
		_ => Err(format!("key path segment is not a table: {key}")),
	}
}

fn update_item_value(item: &mut Item, replacement_value: TomlValue, leaf_key: &str) -> Result<(), String> {
	match item {
		Item::Value(existing_value) => {
			let existing_decor = existing_value.decor().clone();
			*existing_value = replacement_value;
			*existing_value.decor_mut() = existing_decor;
			Ok(())
		}
		_ => Err(format!("key path does not point to a value: {leaf_key}")),
	}
}

fn json_to_toml_value(value: &JsonValue) -> Result<TomlValue, String> {
	match value {
		JsonValue::Null => Err("null is not supported for TOML value updates".to_string()),
		JsonValue::Bool(flag) => Ok(TomlValue::from(*flag)),
		JsonValue::Number(number) => {
			if let Some(as_i64) = number.as_i64() {
				return Ok(TomlValue::from(as_i64));
			}
			if let Some(as_f64) = number.as_f64() {
				return Ok(TomlValue::from(as_f64));
			}
			Err("number is not representable in TOML".to_string())
		}
		JsonValue::String(text) => Ok(TomlValue::from(text.as_str())),
		JsonValue::Array(values) => {
			let mut array = TomlArray::new();
			for entry in values.iter() {
				array.push(json_to_toml_value(entry)?);
			}
			Ok(TomlValue::Array(array))
		}
		JsonValue::Object(_) => Err("object updates are not supported; update leaf keys only".to_string()),
	}
}

fn table_to_json(table: &toml_edit::Table) -> JsonValue {
	let mut map = JsonMap::new();
	for (key, item) in table.iter() {
		if item.is_none() {
			continue;
		}
		map.insert(key.to_string(), item_to_json(item));
	}
	JsonValue::Object(map)
}

fn item_to_json(item: &Item) -> JsonValue {
	match item {
		Item::None => JsonValue::Null,
		Item::Value(value) => toml_value_to_json(value),
		Item::Table(table) => table_to_json(table),
		Item::ArrayOfTables(array_of_tables) => JsonValue::Array(
			array_of_tables
				.iter()
				.map(table_to_json)
				.collect(),
		),
	}
}

fn toml_value_to_json(value: &TomlValue) -> JsonValue {
	match value {
		TomlValue::String(text) => JsonValue::String(text.value().to_string()),
		TomlValue::Integer(value) => JsonValue::Number(JsonNumber::from(*value.value())),
		TomlValue::Float(value) => JsonNumber::from_f64(*value.value())
			.map(JsonValue::Number)
			.unwrap_or(JsonValue::Null),
		TomlValue::Boolean(flag) => JsonValue::Bool(*flag.value()),
		TomlValue::Datetime(datetime) => JsonValue::String(datetime.to_string()),
		TomlValue::Array(array) => JsonValue::Array(array.iter().map(toml_value_to_json).collect()),
		TomlValue::InlineTable(inline_table) => inline_table_to_json(inline_table),
	}
}

fn inline_table_to_json(table: &InlineTable) -> JsonValue {
	let mut map = JsonMap::new();
	for (key, value) in table.iter() {
		map.insert(key.to_string(), toml_value_to_json(value));
	}
	JsonValue::Object(map)
}
