import { useCharacter, useEventBus } from "@/hooks";
import { useRef, useEffect, useState, useCallback } from "react";
import { getServices } from "@/services";
import { Live2DRenderer } from "./live2d-renderer";

/**
 * 主窗口 Live2D 预览区域。
 * 使用 Live2DRenderer 核心（与 Stage 窗口共享渲染逻辑）。
 * 订阅 AudioPlayer 的口型数据驱动嘴型参数。
 */
export function Live2DPreview() {
	const { characterId, emotion, isSpeaking } = useCharacter();
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const rendererRef = useRef<Live2DRenderer | null>(null);
	const [loadStatus, setLoadStatus] = useState<"loading" | "ok" | "error">("loading");
	const [errorMsg, setErrorMsg] = useState("");

	useEffect(() => {
		const renderer = new Live2DRenderer();
		rendererRef.current = renderer;

		if (canvasRef.current) {
			renderer.init({
				canvas: canvasRef.current,
				width: 400,
				height: 500,
				modelPath: "/Resources/Hiyori/Hiyori.model3.json",
				scale: 0.15,
			}).then(() => {
				setLoadStatus("ok");
			}).catch((err) => {
				const msg = err instanceof Error ? err.message : String(err);
				setLoadStatus("error");
				setErrorMsg(msg);
			});
		}

		// 订阅口型数据
		const { player } = getServices();
		const unsubMouth = player.onMouthData((value) => {
			rendererRef.current?.setMouthOpenY(value);
		});

		return () => {
			unsubMouth();
			rendererRef.current = null;
			renderer.destroy();
		};
	}, []);

	const onExpression = useCallback(({ expressionName }: { emotion: string; expressionName: string }) => {
		rendererRef.current?.setExpression(expressionName);
	}, []);

	useEventBus("character:expression", onExpression);

	return (
		<section className="live2d-preview">
			<h2>角色预览</h2>
			{loadStatus === "error" ? (
				<div className="live2d-placeholder">
					<p className="placeholder-icon">🎭</p>
					<p>Live2D 加载失败</p>
					<p className="placeholder-info" style={{ color: "#e94560", fontSize: 11 }}>
						{errorMsg}
					</p>
				</div>
			) : (
				<>
					<canvas ref={canvasRef} style={{ width: "100%", maxHeight: "calc(100% - 60px)" }} />
					{loadStatus === "loading" && (
						<p className="placeholder-info">加载模型中...</p>
					)}
				</>
			)}
			<p className="placeholder-info">
				{characterId || "未加载"} · {emotion}
				{isSpeaking ? " · 说话中" : ""}
			</p>
		</section>
	);
}
