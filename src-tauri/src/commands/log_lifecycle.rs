use chrono::NaiveDateTime;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

const DEBUG_CAPTURE_TTL_DAYS: u64 = 30;
const EXPORT_TTL_DAYS: u64 = 30;
const DEBUG_CAPTURE_MAX_TOTAL_BYTES: u64 = 2 * 1024 * 1024 * 1024; // 2GB

#[derive(Debug, Clone)]
struct DirStat {
    path: PathBuf,
    timestamp_ms: i64,
    size_bytes: u64,
}

pub fn run_startup_log_lifecycle() -> Result<(), String> {
    let logs_root = resolve_logs_root()?;
    cleanup_debug_capture_logs(&logs_root.join("debug-captures"))?;
    super::delegation_scratchpad::cleanup_stale_delegation_scratchpads(24)?;
    cleanup_export_logs(&logs_root.join("debug-capture-exports"))?;
    Ok(())
}

fn resolve_logs_root() -> Result<PathBuf, String> {
    let current_dir =
        std::env::current_dir().map_err(|err| format!("failed to resolve current dir: {err}"))?;
    Ok(current_dir.join("logs"))
}

fn cleanup_debug_capture_logs(root: &Path) -> Result<(), String> {
    if !root.exists() {
        return Ok(());
    }
    let now_ms = now_timestamp_ms();
    let ttl_ms = duration_to_ms(Duration::from_secs(
        DEBUG_CAPTURE_TTL_DAYS.saturating_mul(24 * 3600),
    ));
    let mut keepers: Vec<DirStat> = Vec::new();

    for entry in safe_read_dir(root)? {
        if !entry.path().is_dir() {
            continue;
        }
        let session_name = entry.file_name().to_string_lossy().to_string();
        if should_preserve_named_capture(&session_name) {
            continue;
        }
        let timestamp_ms = parse_session_timestamp_ms(&session_name)
            .unwrap_or_else(|| metadata_timestamp_ms(&entry.path()).unwrap_or(now_ms));
        if now_ms.saturating_sub(timestamp_ms) > ttl_ms {
            let _ = fs::remove_dir_all(entry.path());
            continue;
        }
        let size_bytes = dir_size_bytes(&entry.path())?;
        keepers.push(DirStat {
            path: entry.path(),
            timestamp_ms,
            size_bytes,
        });
    }

    let mut total_size = keepers.iter().map(|d| d.size_bytes).sum::<u64>();
    if total_size <= DEBUG_CAPTURE_MAX_TOTAL_BYTES {
        return Ok(());
    }

    keepers.sort_by_key(|d| d.timestamp_ms);
    for dir in keepers {
        if total_size <= DEBUG_CAPTURE_MAX_TOTAL_BYTES {
            break;
        }
        let _ = fs::remove_dir_all(&dir.path);
        total_size = total_size.saturating_sub(dir.size_bytes);
    }
    Ok(())
}

fn cleanup_export_logs(root: &Path) -> Result<(), String> {
    if !root.exists() {
        return Ok(());
    }
    let now_ms = now_timestamp_ms();
    let ttl_ms = duration_to_ms(Duration::from_secs(
        EXPORT_TTL_DAYS.saturating_mul(24 * 3600),
    ));
    for entry in safe_read_dir(root)? {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        let timestamp_ms = parse_export_timestamp_ms(&name)
            .unwrap_or_else(|| metadata_timestamp_ms(&path).unwrap_or(now_ms));
        if now_ms.saturating_sub(timestamp_ms) > ttl_ms {
            let _ = fs::remove_dir_all(path);
        }
    }
    Ok(())
}

fn safe_read_dir(path: &Path) -> Result<Vec<fs::DirEntry>, String> {
    let entries = fs::read_dir(path)
        .map_err(|err| format!("failed to read directory {}: {err}", path.to_string_lossy()))?;
    Ok(entries.filter_map(Result::ok).collect())
}

fn parse_session_timestamp_ms(name: &str) -> Option<i64> {
    // session id format: YYYYMMDD-HHMMSS-sss-label
    let mut split = name.splitn(4, '-');
    let date = split.next()?;
    let time = split.next()?;
    let millis = split.next()?;
    let raw = format!("{date}-{time}-{millis}");
    let parsed = NaiveDateTime::parse_from_str(&raw, "%Y%m%d-%H%M%S-%3f").ok()?;
    Some(parsed.and_utc().timestamp_millis())
}

fn is_standard_session_name(name: &str) -> bool {
    parse_session_timestamp_ms(name).is_some()
}

fn should_preserve_named_capture(name: &str) -> bool {
    !is_standard_session_name(name)
}

fn parse_export_timestamp_ms(name: &str) -> Option<i64> {
    // export id format: <session-id>-export-YYYYMMDD-HHMMSS-sss
    let marker = "-export-";
    let idx = name.rfind(marker)?;
    let raw = &name[idx + marker.len()..];
    let parsed = NaiveDateTime::parse_from_str(raw, "%Y%m%d-%H%M%S-%3f").ok()?;
    Some(parsed.and_utc().timestamp_millis())
}

fn metadata_timestamp_ms(path: &Path) -> Option<i64> {
    let metadata = fs::metadata(path).ok()?;
    let modified = metadata.modified().or_else(|_| metadata.created()).ok()?;
    let millis = modified.duration_since(UNIX_EPOCH).ok()?.as_millis();
    i64::try_from(millis).ok()
}

fn now_timestamp_ms() -> i64 {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or(Duration::from_secs(0))
        .as_millis();
    i64::try_from(millis).unwrap_or(i64::MAX)
}

fn duration_to_ms(duration: Duration) -> i64 {
    let millis = duration.as_millis();
    i64::try_from(millis).unwrap_or(i64::MAX)
}

fn dir_size_bytes(path: &Path) -> Result<u64, String> {
    let mut total: u64 = 0;
    for entry in safe_read_dir(path)? {
        let child = entry.path();
        if child.is_dir() {
            total = total.saturating_add(dir_size_bytes(&child)?);
            continue;
        }
        let size = entry.metadata().map(|m| m.len()).unwrap_or(0);
        total = total.saturating_add(size);
    }
    Ok(total)
}
