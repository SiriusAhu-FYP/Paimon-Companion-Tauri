import { useState, useEffect } from "react";
import { onStateSync, type SyncPayload } from "@/utils/window-sync";
import type { CharacterState } from "@/types/character";

/**
 * OBS 舞台窗口：透明背景，仅显示角色和可选字幕。
 * 通过 BroadcastChannel 从主窗口接收状态同步。
 * Phase 1 占位——真实 Live2D 渲染待 spike 验证后接入。
 */
export function StageWindow() {
	const [charState, setCharState] = useState<CharacterState>({
		characterId: "",
		emotion: "neutral",
		isSpeaking: false,
		activeModel: null,
	});
	const [runtimeMode, setRuntimeMode] = useState("auto");
	const [lastSync, setLastSync] = useState<number | null>(null);

	useEffect(() => {
		// 舞台窗口：透明背景
		document.documentElement.style.background = "transparent";
		document.body.style.background = "transparent";

		const unsub = onStateSync((payload: SyncPayload) => {
			setCharState(payload.character);
			setRuntimeMode(payload.runtimeMode);
			setLastSync(payload.timestamp);
		});
		return unsub;
	}, []);

	return (
		<div className="stage-window">
			<div className="stage-character">
				<p className="stage-placeholder-icon">🎭</p>
				<p className="stage-info">
					{charState.emotion}
					{charState.isSpeaking ? " · 🔊" : ""}
				</p>
				<p className="stage-info">
					runtime: {runtimeMode}
				</p>
				{lastSync && (
					<p className="stage-info" style={{ fontSize: 10, opacity: 0.5 }}>
						last sync: {new Date(lastSync).toLocaleTimeString()}
					</p>
				)}
			</div>
		</div>
	);
}
