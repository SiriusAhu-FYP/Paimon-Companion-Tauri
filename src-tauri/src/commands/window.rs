use serde::{Deserialize, Serialize};

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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureWindowRequest {
	pub handle: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FocusWindowRequest {
	pub handle: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SendKeyRequest {
	pub handle: String,
	pub key: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SendMouseRequest {
	pub handle: String,
	pub x: Option<i32>,
	pub y: Option<i32>,
	pub button: Option<String>,
	pub action: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowCapture {
	pub handle: String,
	pub width: u32,
	pub height: u32,
	pub png_base64: String,
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

#[tauri::command]
pub async fn capture_window(request: CaptureWindowRequest) -> Result<WindowCapture, String> {
	#[cfg(target_os = "windows")]
	{
		capture_window_windows(&request.handle)
	}

	#[cfg(not(target_os = "windows"))]
	{
		let _ = request;
		Err("capture_window is only implemented on Windows".to_string())
	}
}

#[tauri::command]
pub async fn focus_window(request: FocusWindowRequest) -> Result<(), String> {
	#[cfg(target_os = "windows")]
	{
		focus_window_windows(&request.handle)
	}

	#[cfg(not(target_os = "windows"))]
	{
		let _ = request;
		Err("focus_window is only implemented on Windows".to_string())
	}
}

#[tauri::command]
pub async fn send_key(request: SendKeyRequest) -> Result<(), String> {
	#[cfg(target_os = "windows")]
	{
		send_key_windows(&request.handle, &request.key)
	}

	#[cfg(not(target_os = "windows"))]
	{
		let _ = request;
		Err("send_key is only implemented on Windows".to_string())
	}
}

#[tauri::command]
pub async fn send_mouse(request: SendMouseRequest) -> Result<(), String> {
	#[cfg(target_os = "windows")]
	{
		send_mouse_windows(request)
	}

	#[cfg(not(target_os = "windows"))]
	{
		let _ = request;
		Err("send_mouse is only implemented on Windows".to_string())
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
fn capture_window_windows(handle: &str) -> Result<WindowCapture, String> {
	use base64::engine::general_purpose::STANDARD;
	use base64::Engine;
	use windows::Win32::Foundation::RECT;
	use windows::Win32::Graphics::Gdi::{
		BitBlt, CAPTUREBLT, CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC,
		DeleteObject, GetWindowDC, HGDIOBJ, ReleaseDC, SRCCOPY, SelectObject,
	};
	use windows::Win32::UI::WindowsAndMessaging::{GetWindowRect, IsWindow};

	let hwnd = parse_hwnd(handle)?;
	if !unsafe { IsWindow(Some(hwnd)) }.as_bool() {
		return Err(format!("invalid window handle: {handle}"));
	}

	let mut rect = RECT::default();
	unsafe { GetWindowRect(hwnd, &mut rect) }.map_err(|err| format!("GetWindowRect failed: {err}"))?;

	let width = (rect.right - rect.left).max(0) as u32;
	let height = (rect.bottom - rect.top).max(0) as u32;
	if width == 0 || height == 0 {
		return Err("target window has zero-sized bounds".to_string());
	}

	let window_dc = unsafe { GetWindowDC(Some(hwnd)) };
	if window_dc.is_invalid() {
		return Err("GetWindowDC returned invalid device context".to_string());
	}

	let memory_dc = unsafe { CreateCompatibleDC(Some(window_dc)) };
	if memory_dc.is_invalid() {
		unsafe {
			ReleaseDC(Some(hwnd), window_dc);
		}
		return Err("CreateCompatibleDC failed".to_string());
	}

	let bitmap = unsafe { CreateCompatibleBitmap(window_dc, width as i32, height as i32) };
	if bitmap.is_invalid() {
		unsafe {
			let _ = DeleteDC(memory_dc);
			ReleaseDC(Some(hwnd), window_dc);
		}
		return Err("CreateCompatibleBitmap failed".to_string());
	}

	let previous = unsafe { SelectObject(memory_dc, HGDIOBJ(bitmap.0)) };
	if previous.is_invalid() {
		unsafe {
			let _ = DeleteObject(HGDIOBJ(bitmap.0));
			let _ = DeleteDC(memory_dc);
			ReleaseDC(Some(hwnd), window_dc);
		}
		return Err("SelectObject failed".to_string());
	}

	let capture_result = unsafe {
		BitBlt(
			memory_dc,
			0,
			0,
			width as i32,
			height as i32,
			Some(window_dc),
			0,
			0,
			SRCCOPY | CAPTUREBLT,
		)
	};

	let pixels_result = capture_result
		.map_err(|err| format!("BitBlt failed: {err}"))
		.and_then(|_| read_bitmap_rgba(memory_dc, bitmap, width, height));

	unsafe {
		SelectObject(memory_dc, previous);
		let _ = DeleteObject(HGDIOBJ(bitmap.0));
		let _ = DeleteDC(memory_dc);
		ReleaseDC(Some(hwnd), window_dc);
	}

	let pixels = pixels_result?;
	let png_bytes = encode_png_rgba(&pixels, width, height)?;

	Ok(WindowCapture {
		handle: handle.to_string(),
		width,
		height,
		png_base64: STANDARD.encode(png_bytes),
	})
}

#[cfg(target_os = "windows")]
fn focus_window_windows(handle: &str) -> Result<(), String> {
	use windows::Win32::UI::Input::KeyboardAndMouse::{SetActiveWindow, SetFocus};
	use windows::Win32::UI::WindowsAndMessaging::{
		BringWindowToTop, IsWindow, SW_RESTORE, SetForegroundWindow, ShowWindow,
	};

	let hwnd = parse_hwnd(handle)?;
	if !unsafe { IsWindow(Some(hwnd)) }.as_bool() {
		return Err(format!("invalid window handle: {handle}"));
	}

	unsafe {
		let _ = ShowWindow(hwnd, SW_RESTORE);
		BringWindowToTop(hwnd).map_err(|err| format!("BringWindowToTop failed: {err}"))?;
		let _ = SetActiveWindow(hwnd);
		let _ = SetFocus(Some(hwnd));
	}

	if !unsafe { SetForegroundWindow(hwnd) }.as_bool() {
		return Err("SetForegroundWindow failed".to_string());
	}

	std::thread::sleep(std::time::Duration::from_millis(50));
	Ok(())
}

#[cfg(target_os = "windows")]
fn send_key_windows(handle: &str, key: &str) -> Result<(), String> {
	use windows::Win32::UI::Input::KeyboardAndMouse::{
		KEYBD_EVENT_FLAGS, KEYEVENTF_KEYUP, keybd_event,
	};

	focus_window_windows(handle)?;

	let (virtual_key, modifiers) = resolve_virtual_key(key)?;

	unsafe {
		for modifier in &modifiers {
			keybd_event(modifier.0 as u8, 0, KEYBD_EVENT_FLAGS(0), 0);
		}

		keybd_event(virtual_key.0 as u8, 0, KEYBD_EVENT_FLAGS(0), 0);
		keybd_event(virtual_key.0 as u8, 0, KEYEVENTF_KEYUP, 0);

		for modifier in modifiers.iter().rev() {
			keybd_event(modifier.0 as u8, 0, KEYEVENTF_KEYUP, 0);
		}
	}

	Ok(())
}

#[cfg(target_os = "windows")]
fn resolve_virtual_key(
	key: &str,
) -> Result<
	(
		windows::Win32::UI::Input::KeyboardAndMouse::VIRTUAL_KEY,
		Vec<windows::Win32::UI::Input::KeyboardAndMouse::VIRTUAL_KEY>,
	),
	String,
> {
	use windows::Win32::UI::Input::KeyboardAndMouse::{
		VK_BACK, VK_CONTROL, VK_DELETE, VK_DOWN, VK_END, VK_ESCAPE, VK_F1, VK_F10, VK_F11,
		VK_F12, VK_F2, VK_F3, VK_F4, VK_F5, VK_F6, VK_F7, VK_F8, VK_F9, VK_HOME, VK_LEFT,
		VK_MENU, VK_NEXT, VK_PRIOR, VK_RETURN, VK_RIGHT, VK_SHIFT, VK_SPACE, VK_TAB, VK_UP,
		VIRTUAL_KEY, VkKeyScanW,
	};

	let normalized = key.trim().to_lowercase();
	if normalized.is_empty() {
		return Err("key cannot be empty".to_string());
	}

	let named = match normalized.as_str() {
		"up" | "arrowup" => Some(VK_UP),
		"down" | "arrowdown" => Some(VK_DOWN),
		"left" | "arrowleft" => Some(VK_LEFT),
		"right" | "arrowright" => Some(VK_RIGHT),
		"enter" | "return" => Some(VK_RETURN),
		"space" => Some(VK_SPACE),
		"escape" | "esc" => Some(VK_ESCAPE),
		"tab" => Some(VK_TAB),
		"backspace" => Some(VK_BACK),
		"delete" | "del" => Some(VK_DELETE),
		"home" => Some(VK_HOME),
		"end" => Some(VK_END),
		"pageup" => Some(VK_PRIOR),
		"pagedown" => Some(VK_NEXT),
		"f1" => Some(VK_F1),
		"f2" => Some(VK_F2),
		"f3" => Some(VK_F3),
		"f4" => Some(VK_F4),
		"f5" => Some(VK_F5),
		"f6" => Some(VK_F6),
		"f7" => Some(VK_F7),
		"f8" => Some(VK_F8),
		"f9" => Some(VK_F9),
		"f10" => Some(VK_F10),
		"f11" => Some(VK_F11),
		"f12" => Some(VK_F12),
		_ => None,
	};

	if let Some(vk) = named {
		return Ok((vk, Vec::new()));
	}

	let mut chars = key.chars();
	let ch = chars.next().ok_or_else(|| "key cannot be empty".to_string())?;
	if chars.next().is_some() {
		return Err(format!("unsupported key token: {key}"));
	}

	let code = unsafe { VkKeyScanW(ch as u16) };
	if code == -1 {
		return Err(format!("failed to resolve virtual key: {key}"));
	}

	let vk = VIRTUAL_KEY((code & 0xff) as u16);
	let shift_state = ((code >> 8) & 0xff) as u8;
	let mut modifiers = Vec::new();

	if shift_state & 1 != 0 {
		modifiers.push(VK_SHIFT);
	}
	if shift_state & 2 != 0 {
		modifiers.push(VK_CONTROL);
	}
	if shift_state & 4 != 0 {
		modifiers.push(VK_MENU);
	}

	Ok((vk, modifiers))
}

#[cfg(target_os = "windows")]
fn send_mouse_windows(request: SendMouseRequest) -> Result<(), String> {
	use windows::Win32::Foundation::RECT;
	use windows::Win32::UI::Input::KeyboardAndMouse::{
		MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP, MOUSEEVENTF_MIDDLEDOWN, MOUSEEVENTF_MIDDLEUP,
		MOUSEEVENTF_RIGHTDOWN, MOUSEEVENTF_RIGHTUP, mouse_event,
	};
	use windows::Win32::UI::WindowsAndMessaging::{GetWindowRect, IsWindow, SetCursorPos};

	focus_window_windows(&request.handle)?;

	let hwnd = parse_hwnd(&request.handle)?;
	if !unsafe { IsWindow(Some(hwnd)) }.as_bool() {
		return Err(format!("invalid window handle: {}", request.handle));
	}

	let mut rect = RECT::default();
	unsafe { GetWindowRect(hwnd, &mut rect) }.map_err(|err| format!("GetWindowRect failed: {err}"))?;

	let width = rect.right - rect.left;
	let height = rect.bottom - rect.top;
	if width <= 0 || height <= 0 {
		return Err("target window has zero-sized bounds".to_string());
	}

	let screen_x = request.x.unwrap_or(width / 2) + rect.left;
	let screen_y = request.y.unwrap_or(height / 2) + rect.top;

	unsafe { SetCursorPos(screen_x, screen_y) }.map_err(|err| format!("SetCursorPos failed: {err}"))?;

	let button = request.button.unwrap_or_else(|| "left".to_string()).to_lowercase();
	let action = request.action.unwrap_or_else(|| "click".to_string()).to_lowercase();

	let (down, up) = match button.as_str() {
		"left" => (MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP),
		"right" => (MOUSEEVENTF_RIGHTDOWN, MOUSEEVENTF_RIGHTUP),
		"middle" => (MOUSEEVENTF_MIDDLEDOWN, MOUSEEVENTF_MIDDLEUP),
		other => return Err(format!("unsupported mouse button: {other}")),
	};

	match action.as_str() {
		"move" => {}
		"down" => unsafe { mouse_event(down, 0, 0, 0, 0) },
		"up" => unsafe { mouse_event(up, 0, 0, 0, 0) },
		"click" => unsafe {
			mouse_event(down, 0, 0, 0, 0);
			mouse_event(up, 0, 0, 0, 0);
		},
		other => return Err(format!("unsupported mouse action: {other}")),
	}

	Ok(())
}

#[cfg(target_os = "windows")]
fn parse_hwnd(handle: &str) -> Result<windows::Win32::Foundation::HWND, String> {
	use windows::Win32::Foundation::HWND;

	let normalized = handle.trim();
	let raw = normalized
		.strip_prefix("0x")
		.or_else(|| normalized.strip_prefix("0X"))
		.unwrap_or(normalized);

	let value = isize::from_str_radix(raw, 16)
		.map_err(|_| format!("failed to parse window handle: {handle}"))?;

	Ok(HWND(value as *mut core::ffi::c_void))
}

#[cfg(target_os = "windows")]
fn read_bitmap_rgba(
	memory_dc: windows::Win32::Graphics::Gdi::HDC,
	bitmap: windows::Win32::Graphics::Gdi::HBITMAP,
	width: u32,
	height: u32,
) -> Result<Vec<u8>, String> {
	use windows::Win32::Graphics::Gdi::{
		BI_RGB, BITMAPINFO, BITMAPINFOHEADER, DIB_RGB_COLORS, GetDIBits,
	};

	let mut bitmap_info = BITMAPINFO::default();
	bitmap_info.bmiHeader = BITMAPINFOHEADER {
		biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
		biWidth: width as i32,
		biHeight: -(height as i32),
		biPlanes: 1,
		biBitCount: 32,
		biCompression: BI_RGB.0,
		..Default::default()
	};

	let mut bgra = vec![0u8; (width * height * 4) as usize];
	let rows = unsafe {
		GetDIBits(
			memory_dc,
			bitmap,
			0,
			height,
			Some(bgra.as_mut_ptr() as *mut core::ffi::c_void),
			&mut bitmap_info,
			DIB_RGB_COLORS,
		)
	};

	if rows == 0 {
		return Err("GetDIBits failed".to_string());
	}

	for pixel in bgra.chunks_exact_mut(4) {
		pixel.swap(0, 2);
		pixel[3] = 255;
	}

	Ok(bgra)
}

#[cfg(target_os = "windows")]
fn encode_png_rgba(rgba: &[u8], width: u32, height: u32) -> Result<Vec<u8>, String> {
	use png::Encoder;

	let mut bytes = Vec::new();
	let mut encoder = Encoder::new(&mut bytes, width, height);
	encoder.set_color(png::ColorType::Rgba);
	encoder.set_depth(png::BitDepth::Eight);

	let mut writer = encoder
		.write_header()
		.map_err(|err| format!("PNG header encoding failed: {err}"))?;
	writer
		.write_image_data(rgba)
		.map_err(|err| format!("PNG image encoding failed: {err}"))?;
	drop(writer);

	Ok(bytes)
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
