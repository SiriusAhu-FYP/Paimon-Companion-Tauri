import { useCharacter } from "@/hooks";

/**
 * Phase 1 占位：Live2D 预览区域。
 * 真实 PIXI + pixi-live2d-display 集成在 spike 验证后再接入。
 */
export function Live2DPreview() {
	const { characterId, emotion, isSpeaking } = useCharacter();

	return (
		<section className="live2d-preview">
			<h2>角色预览</h2>
			<div className="live2d-placeholder">
				<p className="placeholder-icon">🎭</p>
				<p>Live2D 渲染区域</p>
				<p className="placeholder-info">
					{characterId ? characterId : "未加载"}
					{" · "}
					{emotion}
					{isSpeaking ? " · 说话中" : ""}
				</p>
			</div>
		</section>
	);
}
