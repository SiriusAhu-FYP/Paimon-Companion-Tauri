import { useState } from "react";
import { useRuntime } from "@/hooks";
import { useCharacter } from "@/hooks";
import { getServices } from "@/services";
import { mockVoicePipeline, mockExternalEvents } from "@/utils/mock";
import { createLogger } from "@/services/logger";

const log = createLogger("control-panel");

const EMOTIONS = ["neutral", "happy", "sad", "angry", "surprised"];

export function ControlPanel() {
	const { mode, stop, resume } = useRuntime();
	const { characterId, emotion, isSpeaking, setEmotion } = useCharacter();

	const handleMockPipeline = () => {
		const { bus, runtime } = getServices();
		mockVoicePipeline(bus, runtime);
	};

	const handleMockExternal = () => {
		const { externalInput } = getServices();
		mockExternalEvents(externalInput);
	};

	const [micStatus, setMicStatus] = useState<"idle" | "ok" | "denied" | "error">("idle");
	const handleMicTest = async () => {
		try {
			const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
			const ctx = new AudioContext();
			const source = ctx.createMediaStreamSource(stream);
			const analyser = ctx.createAnalyser();
			analyser.fftSize = 256;
			source.connect(analyser);

			const dataArray = new Uint8Array(analyser.frequencyBinCount);
			analyser.getByteFrequencyData(dataArray);
			const avg = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
			log.info(`mic test OK — avg volume: ${avg.toFixed(1)}`);

			stream.getTracks().forEach((t) => t.stop());
			ctx.close();
			setMicStatus("ok");
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			log.error("mic test failed", msg);
			setMicStatus(msg.includes("denied") || msg.includes("NotAllowed") ? "denied" : "error");
		}
	};

	return (
		<section className="control-panel">
			<h2>控制面板</h2>

			<div className={`control-section ${mode === "stopped" ? "control-stopped" : ""}`}>
				<h3>运行状态</h3>
				<p>
					模式：<strong>{mode}</strong>
					{mode === "stopped" && <span className="badge-stopped"> STOPPED</span>}
				</p>
				<div className="control-actions">
					<button onClick={stop} disabled={mode === "stopped"}>急停</button>
					<button onClick={resume} disabled={mode === "auto"}>恢复</button>
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

			<div className="control-section">
				<h3>Spike 验证</h3>
				<div className="control-actions">
					<button onClick={handleMicTest}>麦克风测试</button>
					<span style={{ fontSize: 11, marginLeft: 6 }}>
						{micStatus === "ok" && "✅ 成功"}
						{micStatus === "denied" && "❌ 权限被拒绝"}
						{micStatus === "error" && "❌ 出错"}
					</span>
				</div>
			</div>

			<div className="control-section">
				<h3>Mock 测试</h3>
				<div className="control-actions">
					<button onClick={handleMockPipeline}>模拟语音链路</button>
					<button onClick={handleMockExternal}>模拟外部事件</button>
				</div>
			</div>
		</section>
	);
}
