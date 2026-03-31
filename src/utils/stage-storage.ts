/**
 * Stage 相关的 localStorage 持久化工具。
 * 所有 Stage 持久化读写统一在此管理，避免散落在组件文件中。
 */

const ZOOM_KEY = "paimon-companion-tauri:stage-zoom";
const CUSTOM_PRESETS_KEY = "paimon-companion-tauri:custom-size-presets";
const SCALE_LOCK_KEY = "paimon-companion-tauri:stage-scale-lock";

// ── 缩放比例 ──

export function saveZoom(zoom: number): void {
	try { localStorage.setItem(ZOOM_KEY, String(zoom)); } catch { /* */ }
}

export function loadZoom(): number {
	try {
		const v = localStorage.getItem(ZOOM_KEY);
		if (v) { const n = parseFloat(v); if (n > 0) return n; }
	} catch { /* */ }
	return 1;
}

// ── 缩放锁定 ──

export function saveScaleLock(locked: boolean): void {
	try { localStorage.setItem(SCALE_LOCK_KEY, locked ? "1" : "0"); } catch { /* */ }
}

export function loadScaleLock(): boolean {
	try {
		return localStorage.getItem(SCALE_LOCK_KEY) === "1";
	} catch {
		return false;
	}
}

// ── 自定义尺寸预设 ──

export interface SizePreset {
	label: string;
	w: number;
	h: number;
	custom?: boolean;
}

export function loadCustomPresets(): SizePreset[] {
	try {
		const raw = localStorage.getItem(CUSTOM_PRESETS_KEY);
		if (!raw) return [];
		return JSON.parse(raw) as SizePreset[];
	} catch {
		return [];
	}
}

export function saveCustomPresets(presets: SizePreset[]): void {
	localStorage.setItem(CUSTOM_PRESETS_KEY, JSON.stringify(presets));
}
