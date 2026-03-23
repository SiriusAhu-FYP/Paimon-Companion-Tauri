import type { CharacterState } from "@/types/character";
import type { RuntimeMode } from "@/types/runtime";
import { createLogger } from "@/services/logger";

const log = createLogger("window-sync");

export interface SyncPayload {
	character: CharacterState;
	runtimeMode: RuntimeMode;
	timestamp: number;
	expressionEmotion?: string;
}

export type StageDisplayMode = "clean" | "interactive";

export interface StageState {
	mode: "docked" | "floating";
	alwaysOnTop: boolean;
	displayMode: StageDisplayMode;
	visible: boolean;
}

export type EyeMode = "fixed" | "follow-mouse" | "random-path";

export type ControlCommand =
	| { type: "request-state" }
	| { type: "hide-stage" }
	| { type: "show-stage" }
	| { type: "reset-position" }
	| { type: "set-mode"; mode: "docked" | "floating" }
	| { type: "set-always-on-top"; value: boolean }
	| { type: "set-display-mode"; displayMode: StageDisplayMode }
	| { type: "sync-state"; state: StageState }
	| { type: "set-model"; modelPath: string }
	| { type: "set-expression"; expressionName: string }
	| { type: "report-expressions"; expressions: string[] }
	| { type: "set-scale-lock"; locked: boolean }
	| { type: "set-eye-mode"; mode: EyeMode }
	| { type: "set-size"; width: number; height: number }
	| { type: "reset-zoom" };

// ── Tauri 事件 vs BroadcastChannel 自适应 ──

let isTauri = false;
let tauriEmit: ((event: string, payload: unknown) => Promise<void>) | null = null;
let tauriListen: ((event: string, handler: (event: { payload: unknown }) => void) => Promise<() => void>) | null = null;

async function initTauriEvents() {
	const hasTauriRuntime = "__TAURI_INTERNALS__" in window;
	if (!hasTauriRuntime) {
		isTauri = false;
		log.info("using BroadcastChannel for sync (browser mode)");
		return;
	}

	try {
		const mod = await import("@tauri-apps/api/event");
		tauriEmit = mod.emit;
		tauriListen = mod.listen;
		isTauri = true;
		log.info("using Tauri IPC for cross-window sync");
	} catch {
		isTauri = false;
		log.info("Tauri IPC init failed, falling back to BroadcastChannel");
	}
}

const tauriReady = initTauriEvents();

// ── 通用发送/监听封装 ──

async function emitEvent(channel: string, data: unknown) {
	await tauriReady;
	if (isTauri && tauriEmit) {
		await tauriEmit(channel, data);
	} else {
		getBroadcastChannel(channel).postMessage(data);
	}
}

async function listenEvent<T>(channel: string, callback: (data: T) => void): Promise<() => void> {
	await tauriReady;
	if (isTauri && tauriListen) {
		return tauriListen(channel, (event) => {
			callback(event.payload as T);
		});
	} else {
		const ch = getBroadcastChannel(channel);
		const handler = (event: MessageEvent<T>) => callback(event.data);
		ch.addEventListener("message", handler);
		return () => ch.removeEventListener("message", handler);
	}
}

const bcCache = new Map<string, BroadcastChannel>();
function getBroadcastChannel(name: string): BroadcastChannel {
	let ch = bcCache.get(name);
	if (!ch) {
		ch = new BroadcastChannel(name);
		bcCache.set(name, ch);
	}
	return ch;
}

// ── 状态同步 ──

export function broadcastState(state: SyncPayload) {
	emitEvent("paimon:state-sync", state).catch(() => {});
}

export async function onStateSync(callback: (state: SyncPayload) => void): Promise<() => void> {
	return listenEvent<SyncPayload>("paimon:state-sync", callback);
}

// ── 口型同步（高频） ──

export function broadcastMouth(value: number) {
	emitEvent("paimon:mouth-sync", value).catch(() => {});
}

export async function onMouthSync(callback: (value: number) => void): Promise<() => void> {
	return listenEvent<number>("paimon:mouth-sync", callback);
}

// ── 控制通道 ──

export function broadcastControl(cmd: ControlCommand) {
	emitEvent("paimon:control", cmd).catch(() => {});
}

export async function onControlCommand(callback: (cmd: ControlCommand) => void): Promise<() => void> {
	return listenEvent<ControlCommand>("paimon:control", callback);
}
