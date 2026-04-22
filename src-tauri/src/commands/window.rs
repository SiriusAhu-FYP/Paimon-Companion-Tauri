use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowInfo {
	pub handle: String,
	pub title: String,
	pub class_name: String,
	pub process_id: u32,
	pub process_name: String,
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
	pub apply_delegated_viewport: Option<bool>,
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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SendTextRequest {
	pub handle: String,
	pub text: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowCapture {
	pub handle: String,
	pub width: u32,
	pub height: u32,
	pub png_base64: String,
	pub capture_method: String,
	pub quality_score: f32,
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
		focus_window_windows(&request.handle, request.apply_delegated_viewport.unwrap_or(false))
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

#[tauri::command]
pub async fn send_text(request: SendTextRequest) -> Result<(), String> {
	#[cfg(target_os = "windows")]
	{
		send_text_windows(&request.handle, &request.text)
	}

	#[cfg(not(target_os = "windows"))]
	{
		let _ = request;
		Err("send_text is only implemented on Windows".to_string())
	}
}

#[cfg(target_os = "windows")]
fn list_windows_windows() -> Result<Vec<WindowInfo>, String> {
	use windows::Win32::Foundation::{HWND, LPARAM, RECT};
	use windows::Win32::UI::WindowsAndMessaging::{
		EnumWindows, GetWindow, GetWindowLongPtrW, GetWindowRect, GetWindowThreadProcessId,
		IsIconic, IsWindowVisible, GWL_EXSTYLE, GW_OWNER, WS_EX_TOOLWINDOW,
	};
	use windows::core::BOOL;

	struct EnumState {
		windows: Vec<WindowInfo>,
	}

	unsafe extern "system" fn enum_windows_proc(hwnd: HWND, lparam: LPARAM) -> BOOL {
		let state = unsafe { &mut *(lparam.0 as *mut EnumState) };

		let visible = unsafe { IsWindowVisible(hwnd) }.as_bool();
		let minimized = unsafe { IsIconic(hwnd) }.as_bool();

		let owner = unsafe { GetWindow(hwnd, GW_OWNER) }.unwrap_or_default();
		if !owner.0.is_null() {
			return BOOL(1);
		}

		let ex_style = unsafe { GetWindowLongPtrW(hwnd, GWL_EXSTYLE) } as u32;
		if ex_style & WS_EX_TOOLWINDOW.0 != 0 {
			return BOOL(1);
		}

		let mut rect = RECT::default();
		if unsafe { GetWindowRect(hwnd, &mut rect) }.is_err() {
			return BOOL(1);
		}

		if rect.right <= rect.left || rect.bottom <= rect.top {
			return BOOL(1);
		}

		let mut process_id = 0u32;
		unsafe {
			GetWindowThreadProcessId(hwnd, Some(&mut process_id as *mut u32));
		}
		let process_name = get_process_name(process_id).unwrap_or_default();

		let mut title = get_window_text(hwnd).unwrap_or_default();
		if title.trim().is_empty() && !process_name.is_empty() {
			title = format!("[{process_name}]");
		}
		if title.trim().is_empty() {
			return BOOL(1);
		}

		let class_name = get_class_name(hwnd).unwrap_or_default();

		state.windows.push(WindowInfo {
			handle: format!("0x{:X}", hwnd.0 as usize),
			title,
			class_name,
			process_id,
			process_name,
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
		a.minimized
			.cmp(&b.minimized)
			.then_with(|| a.title.to_lowercase().cmp(&b.title.to_lowercase()))
	});

	Ok(state.windows)
}

#[cfg(target_os = "windows")]
fn capture_window_windows(handle: &str) -> Result<WindowCapture, String> {
	use base64::engine::general_purpose::STANDARD;
	use base64::Engine;
	use windows::Win32::Foundation::RECT;
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

	let mut capture = capture_window_pixels(hwnd, width, height)?;
	if let Some((cursor_x, cursor_y)) = resolve_cursor_position_in_window(rect, width, height) {
		overlay_cursor_marker(&mut capture.pixels, width, height, cursor_x, cursor_y);
		capture.method = format!("{}+cursor", capture.method);
	}
	let png_bytes = encode_png_rgba(&capture.pixels, width, height)?;

	Ok(WindowCapture {
		handle: handle.to_string(),
		width,
		height,
		png_base64: STANDARD.encode(png_bytes),
		capture_method: capture.method,
		quality_score: capture.quality_score,
	})
}

#[cfg(target_os = "windows")]
fn resolve_cursor_position_in_window(
	rect: windows::Win32::Foundation::RECT,
	width: u32,
	height: u32,
) -> Option<(i32, i32)> {
	use windows::Win32::Foundation::POINT;
	use windows::Win32::UI::WindowsAndMessaging::GetCursorPos;

	let mut cursor = POINT { x: 0, y: 0 };
	if unsafe { GetCursorPos(&mut cursor) }.is_err() {
		return None;
	}
	let relative_x = cursor.x - rect.left;
	let relative_y = cursor.y - rect.top;
	if relative_x < 0 || relative_y < 0 {
		return None;
	}
	if relative_x >= width as i32 || relative_y >= height as i32 {
		return None;
	}
	Some((relative_x, relative_y))
}

#[cfg(target_os = "windows")]
fn overlay_cursor_marker(
	rgba: &mut [u8],
	width: u32,
	height: u32,
	cursor_x: i32,
	cursor_y: i32,
) {
	const CROSS_HALF: i32 = 13;
	const RING_RADIUS: i32 = 11;
	const CENTER_HALF: i32 = 3;

	for offset in -CROSS_HALF..=CROSS_HALF {
		for thickness in -1..=1 {
			blend_rgba_pixel(
				rgba,
				width,
				height,
				cursor_x + offset,
				cursor_y + thickness,
				[0, 0, 0],
				0.72,
			);
			blend_rgba_pixel(
				rgba,
				width,
				height,
				cursor_x + thickness,
				cursor_y + offset,
				[0, 0, 0],
				0.72,
			);
		}
		blend_rgba_pixel(rgba, width, height, cursor_x + offset, cursor_y, [0, 255, 120], 0.8);
		blend_rgba_pixel(rgba, width, height, cursor_x, cursor_y + offset, [0, 255, 120], 0.8);
	}

	let ring_outer = RING_RADIUS * RING_RADIUS;
	let ring_inner = (RING_RADIUS - 2) * (RING_RADIUS - 2);
	let ring_shadow_outer = (RING_RADIUS + 1) * (RING_RADIUS + 1);
	let ring_shadow_inner = (RING_RADIUS - 3) * (RING_RADIUS - 3);
	for dy in -RING_RADIUS..=RING_RADIUS {
		for dx in -RING_RADIUS..=RING_RADIUS {
			let dist = dx * dx + dy * dy;
			if dist <= ring_shadow_outer && dist >= ring_shadow_inner {
				blend_rgba_pixel(rgba, width, height, cursor_x + dx, cursor_y + dy, [0, 0, 0], 0.68);
			}
			if dist <= ring_outer && dist >= ring_inner {
				blend_rgba_pixel(rgba, width, height, cursor_x + dx, cursor_y + dy, [255, 255, 255], 0.86);
			}
		}
	}

	for dy in -CENTER_HALF..=CENTER_HALF {
		for dx in -CENTER_HALF..=CENTER_HALF {
			blend_rgba_pixel(rgba, width, height, cursor_x + dx, cursor_y + dy, [255, 64, 64], 0.9);
		}
	}
}

#[cfg(target_os = "windows")]
fn blend_rgba_pixel(
	rgba: &mut [u8],
	width: u32,
	height: u32,
	x: i32,
	y: i32,
	color: [u8; 3],
	alpha: f32,
) {
	if x < 0 || y < 0 || x >= width as i32 || y >= height as i32 {
		return;
	}
	let index = ((y as u32 * width + x as u32) * 4) as usize;
	if index + 3 >= rgba.len() {
		return;
	}
	let blend = alpha.clamp(0.0, 1.0);
	for channel in 0..3 {
		let base = rgba[index + channel] as f32;
		let target = color[channel] as f32;
		rgba[index + channel] = ((1.0 - blend) * base + blend * target).round().clamp(0.0, 255.0) as u8;
	}
	rgba[index + 3] = 255;
}

#[cfg(target_os = "windows")]
struct PixelCapture {
	method: String,
	pixels: Vec<u8>,
	quality_score: f32,
}

#[cfg(target_os = "windows")]
fn capture_window_pixels(
	hwnd: windows::Win32::Foundation::HWND,
	width: u32,
	height: u32,
) -> Result<PixelCapture, String> {
	let mut captures = Vec::new();

	if let Ok(capture) = capture_with_print_window(hwnd, width, height, 0x0000_0002) {
		captures.push(capture);
	}

	if let Ok(capture) = capture_with_print_window(hwnd, width, height, 0) {
		captures.push(capture);
	}

	if let Ok(capture) = capture_with_bitblt(hwnd, width, height) {
		captures.push(capture);
	}

	captures
		.into_iter()
		.max_by(|left, right| left.quality_score.total_cmp(&right.quality_score))
		.ok_or_else(|| "all window capture strategies failed".to_string())
}

#[cfg(target_os = "windows")]
fn capture_with_print_window(
	hwnd: windows::Win32::Foundation::HWND,
	width: u32,
	height: u32,
	flags: u32,
) -> Result<PixelCapture, String> {
	use windows::Win32::Graphics::Gdi::GetDC;
	use windows::Win32::Graphics::Gdi::ReleaseDC;
	use windows::Win32::Storage::Xps::{PrintWindow, PRINT_WINDOW_FLAGS};

	let screen_dc = unsafe { GetDC(None) };
	if screen_dc.is_invalid() {
		return Err("GetDC returned invalid device context".to_string());
	}

	let context = CaptureContext::new(screen_dc, width, height)?;
	let printed = unsafe { PrintWindow(hwnd, context.memory_dc, PRINT_WINDOW_FLAGS(flags)) }.as_bool();
	let pixels = if printed {
		read_bitmap_rgba(context.memory_dc, context.bitmap, width, height)?
	} else {
		let err = format!("PrintWindow failed for flags=0x{flags:08X}");
		unsafe {
			ReleaseDC(None, screen_dc);
		}
		drop(context);
		return Err(err);
	};
	drop(context);
	unsafe {
		ReleaseDC(None, screen_dc);
	}

	Ok(PixelCapture {
		method: if flags == 0x0000_0002 {
			"print-window-full".to_string()
		} else {
			"print-window".to_string()
		},
		quality_score: score_rgba_quality(&pixels),
		pixels,
	})
}

#[cfg(target_os = "windows")]
fn capture_with_bitblt(
	hwnd: windows::Win32::Foundation::HWND,
	width: u32,
	height: u32,
) -> Result<PixelCapture, String> {
	use windows::Win32::Graphics::Gdi::{BitBlt, CAPTUREBLT, GetWindowDC, ReleaseDC, SRCCOPY};

	let window_dc = unsafe { GetWindowDC(Some(hwnd)) };
	if window_dc.is_invalid() {
		return Err("GetWindowDC returned invalid device context".to_string());
	}

	let context = CaptureContext::new(window_dc, width, height)?;
	let result = unsafe {
		BitBlt(
			context.memory_dc,
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

	let pixels = result
		.map_err(|err| format!("BitBlt failed: {err}"))
		.and_then(|_| read_bitmap_rgba(context.memory_dc, context.bitmap, width, height))?;

	drop(context);
	unsafe {
		ReleaseDC(Some(hwnd), window_dc);
	}

	Ok(PixelCapture {
		method: "bitblt".to_string(),
		quality_score: score_rgba_quality(&pixels),
		pixels,
	})
}

#[cfg(target_os = "windows")]
struct CaptureContext {
	memory_dc: windows::Win32::Graphics::Gdi::HDC,
	bitmap: windows::Win32::Graphics::Gdi::HBITMAP,
	previous: windows::Win32::Graphics::Gdi::HGDIOBJ,
}

#[cfg(target_os = "windows")]
impl CaptureContext {
	fn new(
		source_dc: windows::Win32::Graphics::Gdi::HDC,
		width: u32,
		height: u32,
	) -> Result<Self, String> {
		use windows::Win32::Graphics::Gdi::{
			CreateCompatibleBitmap, CreateCompatibleDC, HGDIOBJ, SelectObject,
		};

		let memory_dc = unsafe { CreateCompatibleDC(Some(source_dc)) };
		if memory_dc.is_invalid() {
			return Err("CreateCompatibleDC failed".to_string());
		}

		let bitmap = unsafe { CreateCompatibleBitmap(source_dc, width as i32, height as i32) };
		if bitmap.is_invalid() {
			unsafe {
				let _ = windows::Win32::Graphics::Gdi::DeleteDC(memory_dc);
			}
			return Err("CreateCompatibleBitmap failed".to_string());
		}

		let previous = unsafe { SelectObject(memory_dc, HGDIOBJ(bitmap.0)) };
		if previous.is_invalid() {
			unsafe {
				let _ = windows::Win32::Graphics::Gdi::DeleteObject(HGDIOBJ(bitmap.0));
				let _ = windows::Win32::Graphics::Gdi::DeleteDC(memory_dc);
			}
			return Err("SelectObject failed".to_string());
		}

		Ok(Self {
			memory_dc,
			bitmap,
			previous,
		})
	}
}

#[cfg(target_os = "windows")]
impl Drop for CaptureContext {
	fn drop(&mut self) {
		use windows::Win32::Graphics::Gdi::{DeleteDC, DeleteObject, HGDIOBJ, SelectObject};

		unsafe {
			let _ = SelectObject(self.memory_dc, self.previous);
			let _ = DeleteObject(HGDIOBJ(self.bitmap.0));
			let _ = DeleteDC(self.memory_dc);
		}
	}
}

#[cfg(target_os = "windows")]
fn focus_window_windows(handle: &str, apply_delegated_viewport: bool) -> Result<(), String> {
	use windows::Win32::UI::Input::KeyboardAndMouse::{SetActiveWindow, SetFocus};
	use windows::Win32::UI::WindowsAndMessaging::{
		BringWindowToTop, GetForegroundWindow, IsWindow, SetForegroundWindow, SetWindowPos,
		ShowWindow, HWND_NOTOPMOST, HWND_TOPMOST, SWP_NOMOVE, SWP_NOSIZE, SW_RESTORE,
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

	if unsafe { SetForegroundWindow(hwnd) }.as_bool() {
		if apply_delegated_viewport {
			apply_delegated_viewport_windows(hwnd)?;
		}
		std::thread::sleep(std::time::Duration::from_millis(50));
		return Ok(());
	}

	let foreground = unsafe { GetForegroundWindow() };
	if foreground == hwnd {
		if apply_delegated_viewport {
			apply_delegated_viewport_windows(hwnd)?;
		}
		std::thread::sleep(std::time::Duration::from_millis(50));
		return Ok(());
	}

	let foreground_after_promote = unsafe {
		let _ = ShowWindow(hwnd, SW_RESTORE);
		let _ = BringWindowToTop(hwnd);
		let _ = SetWindowPos(hwnd, Some(HWND_TOPMOST), 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE);
		let _ = SetWindowPos(hwnd, Some(HWND_NOTOPMOST), 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE);
		let _ = SetActiveWindow(hwnd);
		let _ = SetFocus(Some(hwnd));
		SetForegroundWindow(hwnd).as_bool()
	};

	if !foreground_after_promote {
		let final_foreground = unsafe { GetForegroundWindow() };
		if final_foreground != hwnd {
			return Err("SetForegroundWindow failed".to_string());
		}
	}

	if apply_delegated_viewport {
		apply_delegated_viewport_windows(hwnd)?;
	}

	std::thread::sleep(std::time::Duration::from_millis(50));
	Ok(())
}

#[cfg(target_os = "windows")]
fn apply_delegated_viewport_windows(hwnd: windows::Win32::Foundation::HWND) -> Result<(), String> {
	use windows::Win32::Graphics::Gdi::{
		GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONEAREST,
	};
	use windows::Win32::UI::WindowsAndMessaging::{
		SetWindowPos, SWP_FRAMECHANGED, SWP_NOACTIVATE, SWP_NOZORDER,
	};

	let monitor = unsafe { MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST) };
	if monitor.0.is_null() {
		return Err("MonitorFromWindow failed".to_string());
	}

	let mut monitor_info = MONITORINFO {
		cbSize: std::mem::size_of::<MONITORINFO>() as u32,
		..Default::default()
	};
	let monitor_info_ok = unsafe { GetMonitorInfoW(monitor, &mut monitor_info as *mut MONITORINFO) }.as_bool();
	if !monitor_info_ok {
		return Err("GetMonitorInfoW failed".to_string());
	}

	let monitor_width = monitor_info.rcMonitor.right - monitor_info.rcMonitor.left;
	let monitor_height = monitor_info.rcMonitor.bottom - monitor_info.rcMonitor.top;
	if monitor_width <= 0 || monitor_height <= 0 {
		return Err("monitor bounds invalid".to_string());
	}

	let (viewport_width, viewport_height) = choose_delegated_viewport_size(monitor_width, monitor_height);
	let offset_x = (monitor_width - viewport_width) / 2;
	let offset_y = (monitor_height - viewport_height) / 2;
	let target_x = monitor_info.rcMonitor.left + offset_x.max(0);
	let target_y = monitor_info.rcMonitor.top + offset_y.max(0);

	unsafe {
		SetWindowPos(
			hwnd,
			None,
			target_x,
			target_y,
			viewport_width,
			viewport_height,
			SWP_NOACTIVATE | SWP_NOZORDER,
		)
	}
	.map_err(|err| format!("SetWindowPos resize failed: {err}"))?;

	std::thread::sleep(std::time::Duration::from_millis(40));
	let (applied_width, applied_height) = get_window_size_windows(hwnd)?;
	let width_delta = (applied_width - viewport_width).abs();
	let height_delta = (applied_height - viewport_height).abs();
	if width_delta > 48 || height_delta > 48 {
		unsafe {
			SetWindowPos(
				hwnd,
				None,
				target_x,
				target_y,
				viewport_width,
				viewport_height,
				SWP_NOACTIVATE | SWP_NOZORDER | SWP_FRAMECHANGED,
			)
		}
		.map_err(|err| format!("SetWindowPos viewport retry failed: {err}"))?;
		std::thread::sleep(std::time::Duration::from_millis(40));
		let (retry_width, retry_height) = get_window_size_windows(hwnd)?;
		let retry_width_delta = (retry_width - viewport_width).abs();
		let retry_height_delta = (retry_height - viewport_height).abs();
		if retry_width_delta > 48 || retry_height_delta > 48 {
			return Err(format!(
				"delegated viewport mismatch after retry: expected={}x{}, actual={}x{}",
				viewport_width, viewport_height, retry_width, retry_height
			));
		}
	}
	Ok(())
}

#[cfg(target_os = "windows")]
fn get_window_size_windows(hwnd: windows::Win32::Foundation::HWND) -> Result<(i32, i32), String> {
	use windows::Win32::Foundation::RECT;
	use windows::Win32::UI::WindowsAndMessaging::GetWindowRect;

	let mut rect = RECT::default();
	unsafe { GetWindowRect(hwnd, &mut rect) }.map_err(|err| format!("GetWindowRect failed: {err}"))?;
	let width = rect.right - rect.left;
	let height = rect.bottom - rect.top;
	if width <= 0 || height <= 0 {
		return Err("window bounds invalid after viewport apply".to_string());
	}
	Ok((width, height))
}

#[cfg(target_os = "windows")]
fn choose_delegated_viewport_size(monitor_width: i32, monitor_height: i32) -> (i32, i32) {
	const PRESET_VIEWPORTS: &[(i32, i32)] = &[(1600, 900), (1366, 768), (1280, 720), (1024, 576)];
	let max_width = (monitor_width - 120).max(640);
	let max_height = (monitor_height - 120).max(360);
	for (width, height) in PRESET_VIEWPORTS {
		if *width <= max_width && *height <= max_height {
			return (*width, *height);
		}
	}

	let mut width = max_width.min((max_height * 16) / 9);
	if width < 640 {
		width = max_width.max(640);
	}
	let mut height = (width * 9) / 16;
	if height > max_height {
		height = max_height;
		width = (height * 16) / 9;
	}
	(width.max(640).min(max_width), height.max(360).min(max_height))
}

#[cfg(target_os = "windows")]
fn send_key_windows(handle: &str, key: &str) -> Result<(), String> {
	use windows::Win32::UI::Input::KeyboardAndMouse::{
		KEYBD_EVENT_FLAGS, KEYEVENTF_KEYUP, keybd_event,
	};

	focus_window_windows(handle, false)?;

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
fn send_text_windows(handle: &str, text: &str) -> Result<(), String> {
	if text.trim().is_empty() {
		return Err("text cannot be empty".to_string());
	}

	let mut clipboard = arboard::Clipboard::new()
		.map_err(|err| format!("clipboard open failed: {err}"))?;
	clipboard
		.set_text(text.to_string())
		.map_err(|err| format!("clipboard write failed: {err}"))?;

	send_key_windows(handle, "Ctrl+V")
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
	let normalized = key.trim();
	if normalized.is_empty() {
		return Err("key cannot be empty".to_string());
	}

	if normalized.contains('+') {
		let tokens = normalized
			.split('+')
			.map(str::trim)
			.filter(|token| !token.is_empty())
			.collect::<Vec<_>>();
		if tokens.len() < 2 {
			return Err(format!("unsupported key token: {key}"));
		}
		let mut modifiers: Vec<windows::Win32::UI::Input::KeyboardAndMouse::VIRTUAL_KEY> = Vec::new();
		for token in tokens.iter().take(tokens.len() - 1) {
			let modifier = parse_modifier_virtual_key_token(token)
				.ok_or_else(|| format!("unsupported modifier token: {token}"))?;
			if !modifiers.iter().any(|existing| existing.0 == modifier.0) {
				modifiers.push(modifier);
			}
		}
		let action_token = tokens[tokens.len() - 1];
		let (virtual_key, inferred_modifiers) = parse_base_virtual_key_token(action_token)?;
		for modifier in inferred_modifiers {
			if !modifiers.iter().any(|existing| existing.0 == modifier.0) {
				modifiers.push(modifier);
			}
		}
		return Ok((virtual_key, modifiers));
	}

	parse_base_virtual_key_token(normalized)
}

#[cfg(target_os = "windows")]
fn parse_base_virtual_key_token(
	token: &str,
) -> Result<
	(
		windows::Win32::UI::Input::KeyboardAndMouse::VIRTUAL_KEY,
		Vec<windows::Win32::UI::Input::KeyboardAndMouse::VIRTUAL_KEY>,
	),
	String,
> {
	use windows::Win32::UI::Input::KeyboardAndMouse::{VK_CONTROL, VK_MENU, VK_SHIFT, VIRTUAL_KEY, VkKeyScanW};
	let normalized = token.trim().to_lowercase();
	if normalized.is_empty() {
		return Err("key cannot be empty".to_string());
	}
	if let Some(named) = parse_named_virtual_key_token(&normalized) {
		return Ok((named, Vec::new()));
	}
	let mut chars = normalized.chars();
	let ch = chars.next().ok_or_else(|| "key cannot be empty".to_string())?;
	if chars.next().is_some() {
		return Err(format!("unsupported key token: {token}"));
	}
	let code = unsafe { VkKeyScanW(ch as u16) };
	if code == -1 {
		return Err(format!("failed to resolve virtual key: {token}"));
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
fn parse_named_virtual_key_token(token: &str) -> Option<windows::Win32::UI::Input::KeyboardAndMouse::VIRTUAL_KEY> {
	use windows::Win32::UI::Input::KeyboardAndMouse::{
		VK_BACK, VK_DELETE, VK_DOWN, VK_END, VK_ESCAPE, VK_F1, VK_F10, VK_F11, VK_F12, VK_F2, VK_F3, VK_F4, VK_F5,
		VK_F6, VK_F7, VK_F8, VK_F9, VK_HOME, VK_LEFT, VK_NEXT, VK_PRIOR, VK_RETURN, VK_RIGHT, VK_SPACE, VK_TAB, VK_UP,
	};
	match token {
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
	}
}

#[cfg(target_os = "windows")]
fn parse_modifier_virtual_key_token(token: &str) -> Option<windows::Win32::UI::Input::KeyboardAndMouse::VIRTUAL_KEY> {
	use windows::Win32::UI::Input::KeyboardAndMouse::{VK_CONTROL, VK_MENU, VK_SHIFT};
	match token.trim().to_lowercase().as_str() {
		"ctrl" | "control" => Some(VK_CONTROL),
		"shift" => Some(VK_SHIFT),
		"alt" | "menu" => Some(VK_MENU),
		_ => None,
	}
}

#[cfg(target_os = "windows")]
fn send_mouse_windows(request: SendMouseRequest) -> Result<(), String> {
	use windows::Win32::Foundation::RECT;
	use windows::Win32::UI::Input::KeyboardAndMouse::{
		MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP, MOUSEEVENTF_MIDDLEDOWN, MOUSEEVENTF_MIDDLEUP,
		MOUSEEVENTF_RIGHTDOWN, MOUSEEVENTF_RIGHTUP, mouse_event,
	};
	use windows::Win32::UI::WindowsAndMessaging::{GetWindowRect, IsWindow, SetCursorPos};

	focus_window_windows(&request.handle, false)?;

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
fn score_rgba_quality(rgba: &[u8]) -> f32 {
	if rgba.len() < 4 {
		return 0.0;
	}

	let stride = 16usize;
	let mut count = 0f32;
	let mut sum = 0f32;
	let mut sum_sq = 0f32;
	let mut min_luma = 255f32;
	let mut max_luma = 0f32;

	for pixel in rgba.chunks_exact(4).step_by(stride) {
		let luma = (pixel[0] as f32 * 0.2126) + (pixel[1] as f32 * 0.7152) + (pixel[2] as f32 * 0.0722);
		sum += luma;
		sum_sq += luma * luma;
		min_luma = min_luma.min(luma);
		max_luma = max_luma.max(luma);
		count += 1.0;
	}

	if count <= 1.0 {
		return 0.0;
	}

	let mean = sum / count;
	let variance = ((sum_sq / count) - (mean * mean)).max(0.0);
	let std_dev = variance.sqrt();
	let spread = ((max_luma - min_luma) / 255.0).clamp(0.0, 1.0);
	let normalized_std_dev = (std_dev / 64.0).clamp(0.0, 1.0);
	let normalized_mean = (mean / 255.0).clamp(0.0, 1.0);
	let brightness_penalty = if normalized_mean < 0.06 { 0.25 } else { 0.0 };

	(0.65 * spread + 0.35 * normalized_std_dev - brightness_penalty).clamp(0.0, 1.0)
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
	use windows::Win32::UI::WindowsAndMessaging::GetWindowTextW;

	let mut buffer = vec![0u16; 1024];
	let copied = unsafe { GetWindowTextW(hwnd, &mut buffer) };
	if copied <= 0 {
		return Ok(String::new());
	}

	Ok(String::from_utf16_lossy(&buffer[..copied as usize]))
}

#[cfg(target_os = "windows")]
fn get_process_name(process_id: u32) -> Result<String, String> {
	use windows::core::PWSTR;
	use windows::Win32::Foundation::CloseHandle;
	use windows::Win32::System::Threading::{
		OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
	};

	if process_id == 0 {
		return Ok(String::new());
	}

	let process = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, process_id) }
		.map_err(|err| format!("OpenProcess failed: {err}"))?;

	let mut buffer = vec![0u16; 260];
	let mut size = buffer.len() as u32;
	let result = unsafe {
		QueryFullProcessImageNameW(
			process,
			PROCESS_NAME_WIN32,
			PWSTR(buffer.as_mut_ptr()),
			&mut size,
		)
	};

	unsafe {
		let _ = CloseHandle(process);
	}

	if result.is_err() || size == 0 {
		return Ok(String::new());
	}

	let full_path = String::from_utf16_lossy(&buffer[..size as usize]);
	let file_name = full_path
		.rsplit(['\\', '/'])
		.next()
		.unwrap_or("")
		.trim()
		.trim_end_matches(".exe")
		.to_string();

	Ok(file_name)
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
