import { useCharacter } from "@/hooks";

/**
 * OBS 舞台窗口：透明背景，仅显示角色和可选字幕。
 * Phase 1 占位——真实 Live2D 渲染待 spike 验证后接入。
 */
export function StageWindow() {
	const { characterId, emotion, isSpeaking } = useCharacter();

	return (
		<div className="stage-window">
			<div className="stage-character">
				<p className="stage-placeholder-icon">🎭</p>
				<p className="stage-info">
					{characterId || "未加载"} · {emotion}
					{isSpeaking ? " · 🔊" : ""}
				</p>
			</div>
		</div>
	);
}
