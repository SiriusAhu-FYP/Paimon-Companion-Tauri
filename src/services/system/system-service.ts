import { isTauriEnvironment } from "@/utils/window-sync";
import { createLogger } from "@/services/logger";
import type { HostWindowInfo } from "@/types";

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
