use serde::Serialize;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowInfo {
	pub handle: String,
	pub title: String,
	pub class_name: String,
	pub process_id: u32,
	pub visible: bool,
	pub minimized: bool,
}

#[tauri::command]
pub async fn list_windows() -> Result<Vec<WindowInfo>, String> {
	#[cfg(target_os = "windows")]
	{
		list_windows_windows()
	}

	#[cfg(not(target_os = "windows"))]
	{
		Err("list_windows is only implemented on Windows".to_string())
	}
}

#[cfg(target_os = "windows")]
fn list_windows_windows() -> Result<Vec<WindowInfo>, String> {
	use windows::Win32::Foundation::{HWND, LPARAM};
	use windows::Win32::UI::WindowsAndMessaging::{
		EnumWindows, GetWindowThreadProcessId, IsIconic, IsWindowVisible,
	};
	use windows::core::BOOL;

	struct EnumState {
		windows: Vec<WindowInfo>,
	}

	unsafe extern "system" fn enum_windows_proc(hwnd: HWND, lparam: LPARAM) -> BOOL {
		let state = unsafe { &mut *(lparam.0 as *mut EnumState) };

		let title = get_window_text(hwnd).unwrap_or_default();
		if title.trim().is_empty() {
			return BOOL(1);
		}

		let class_name = get_class_name(hwnd).unwrap_or_default();
		let visible = unsafe { IsWindowVisible(hwnd) }.as_bool();
		let minimized = unsafe { IsIconic(hwnd) }.as_bool();

		let mut process_id = 0u32;
		unsafe {
			GetWindowThreadProcessId(hwnd, Some(&mut process_id as *mut u32));
		}

		state.windows.push(WindowInfo {
			handle: format!("0x{:X}", hwnd.0 as usize),
			title,
			class_name,
			process_id,
			visible,
			minimized,
		});

		BOOL(1)
	}

	let mut state = EnumState { windows: Vec::new() };
	let state_ptr = &mut state as *mut EnumState;

	unsafe { EnumWindows(Some(enum_windows_proc), LPARAM(state_ptr as isize)) }
		.map_err(|err| format!("EnumWindows failed: {err}"))?;

	state.windows.sort_by(|a, b| {
		b.visible
			.cmp(&a.visible)
			.then_with(|| a.title.to_lowercase().cmp(&b.title.to_lowercase()))
	});

	Ok(state.windows)
}

#[cfg(target_os = "windows")]
fn get_window_text(hwnd: windows::Win32::Foundation::HWND) -> Result<String, String> {
	use windows::Win32::UI::WindowsAndMessaging::{GetWindowTextLengthW, GetWindowTextW};

	let len = unsafe { GetWindowTextLengthW(hwnd) };
	if len <= 0 {
		return Ok(String::new());
	}

	let mut buffer = vec![0u16; len as usize + 1];
	let copied = unsafe { GetWindowTextW(hwnd, &mut buffer) };
	if copied <= 0 {
		return Ok(String::new());
	}

	Ok(String::from_utf16_lossy(&buffer[..copied as usize]))
}

#[cfg(target_os = "windows")]
fn get_class_name(hwnd: windows::Win32::Foundation::HWND) -> Result<String, String> {
	use windows::Win32::UI::WindowsAndMessaging::GetClassNameW;

	let mut buffer = vec![0u16; 256];
	let copied = unsafe { GetClassNameW(hwnd, &mut buffer) };
	if copied <= 0 {
		return Ok(String::new());
	}

	Ok(String::from_utf16_lossy(&buffer[..copied as usize]))
}
