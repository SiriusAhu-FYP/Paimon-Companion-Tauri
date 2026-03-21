import { useRuntime } from "@/hooks";
import { useCharacter } from "@/hooks";

const EMOTIONS = ["neutral", "happy", "sad", "angry", "surprised"];

export function ControlPanel() {
	const { mode, stop, resume } = useRuntime();
	const { characterId, emotion, isSpeaking, setEmotion } = useCharacter();

	return (
		<section className="control-panel">
			<h2>控制面板</h2>

			<div className="control-section">
				<h3>运行状态</h3>
				<p>
					模式：<strong>{mode}</strong>
				</p>
				<div className="control-actions">
					<button onClick={stop} disabled={mode === "stopped"}>
						急停
					</button>
					<button onClick={resume} disabled={mode === "auto"}>
						恢复
					</button>
				</div>
			</div>

			<div className="control-section">
				<h3>角色状态</h3>
				<p>角色：{characterId || "未加载"}</p>
				<p>情绪：{emotion}</p>
				<p>说话中：{isSpeaking ? "是" : "否"}</p>
			</div>

			<div className="control-section">
				<h3>表情切换</h3>
				<div className="emotion-buttons">
					{EMOTIONS.map((e) => (
						<button
							key={e}
							onClick={() => setEmotion(e)}
							className={emotion === e ? "active" : ""}
						>
							{e}
						</button>
					))}
				</div>
			</div>
		</section>
	);
}
