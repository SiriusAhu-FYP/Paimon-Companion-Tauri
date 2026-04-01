import { isTauriEnvironment } from "@/utils/window-sync";
import { createLogger } from "@/services/logger";
import type {
	HostMouseAction,
	HostMouseButton,
	HostWindowCapture,
	HostWindowInfo,
} from "@/types";

const log = createLogger("system-service");

export async function listWindows(): Promise<HostWindowInfo[]> {
	if (!isTauriEnvironment()) {
		throw new Error("listWindows requires Tauri environment");
	}

	const { invoke } = await import("@tauri-apps/api/core");
	const windows = await invoke<HostWindowInfo[]>("list_windows");

	log.info(`listed ${windows.length} desktop windows`);
	return windows;
}

export async function captureWindow(handle: string): Promise<HostWindowCapture> {
	if (!isTauriEnvironment()) {
		throw new Error("captureWindow requires Tauri environment");
	}

	const { invoke } = await import("@tauri-apps/api/core");
	const capture = await invoke<HostWindowCapture>("capture_window", {
		request: { handle },
	});

	log.info(`captured window ${handle} (${capture.width}x${capture.height})`);
	return capture;
}

export async function focusWindow(handle: string): Promise<void> {
	if (!isTauriEnvironment()) {
		throw new Error("focusWindow requires Tauri environment");
	}

	const { invoke } = await import("@tauri-apps/api/core");
	await invoke("focus_window", {
		request: { handle },
	});

	log.info(`focused window ${handle}`);
}

export async function sendHostKey(handle: string, key: string): Promise<void> {
	if (!isTauriEnvironment()) {
		throw new Error("sendHostKey requires Tauri environment");
	}

	const { invoke } = await import("@tauri-apps/api/core");
	await invoke("send_key", {
		request: { handle, key },
	});

	log.info(`sent key ${key} to ${handle}`);
}

export async function sendHostMouse(
	handle: string,
	options?: {
		x?: number;
		y?: number;
		button?: HostMouseButton;
		action?: HostMouseAction;
	},
): Promise<void> {
	if (!isTauriEnvironment()) {
		throw new Error("sendHostMouse requires Tauri environment");
	}

	const { invoke } = await import("@tauri-apps/api/core");
	await invoke("send_mouse", {
		request: {
			handle,
			x: options?.x ?? null,
			y: options?.y ?? null,
			button: options?.button ?? null,
			action: options?.action ?? null,
		},
	});

	log.info(`sent mouse ${options?.action ?? "click"}:${options?.button ?? "left"} to ${handle}`);
}
