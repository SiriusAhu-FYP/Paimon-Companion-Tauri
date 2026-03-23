import { getCurrentWindow } from "@tauri-apps/api/window";

/**
 * 获取当前窗口标签。优先 URL 参数 `?window=stage`（浏览器调试用），
 * 否则从 Tauri API 读取，非 Tauri 环境默认 "main"。
 *
 * 模块级缓存——整个应用生命周期内只计算一次。
 */
function resolveWindowLabel(): string {
	const urlOverride = new URLSearchParams(window.location.search).get("window");
	if (urlOverride === "stage") return "stage";

	try {
		return getCurrentWindow().label;
	} catch {
		return "main";
	}
}

export const windowLabel = resolveWindowLabel();
