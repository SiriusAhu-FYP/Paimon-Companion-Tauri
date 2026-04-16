import { invoke } from "@tauri-apps/api/core";
import { isTauriEnvironment } from "@/utils/window-sync";

export interface DebugCaptureSessionInfo {
	sessionId: string;
	directory: string;
}

export async function startDebugCapture(label?: string): Promise<DebugCaptureSessionInfo> {
	if (!isTauriEnvironment()) {
		throw new Error("debug capture requires Tauri environment");
	}

	return invoke<DebugCaptureSessionInfo>("start_debug_capture", {
		request: {
			label: label ?? null,
		},
	});
}

export async function appendDebugCaptureText(sessionId: string, fileName: string, text: string): Promise<void> {
	if (!isTauriEnvironment()) {
		throw new Error("debug capture requires Tauri environment");
	}

	await invoke("append_debug_capture_text", {
		request: {
			sessionId,
			fileName,
			text,
		},
	});
}

export async function writeDebugCaptureImage(sessionId: string, fileName: string, dataUrl: string): Promise<void> {
	if (!isTauriEnvironment()) {
		throw new Error("debug capture requires Tauri environment");
	}

	await invoke("write_debug_capture_image", {
		request: {
			sessionId,
			fileName,
			dataUrl,
		},
	});
}
