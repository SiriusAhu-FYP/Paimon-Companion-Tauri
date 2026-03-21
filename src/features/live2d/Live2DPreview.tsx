import { useCharacter } from "@/hooks";
import { useRef, useEffect, useState } from "react";
import { createLogger } from "@/services/logger";

const log = createLogger("live2d-preview");

/**
 * Live2D 预览区域：使用 PIXI + pixi-live2d-display 渲染模型。
 * 加载失败时降级回文字占位。
 */
export function Live2DPreview() {
	const { characterId, emotion, isSpeaking } = useCharacter();
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const [loadStatus, setLoadStatus] = useState<"loading" | "ok" | "error">("loading");
	const [errorMsg, setErrorMsg] = useState("");

	useEffect(() => {
		let app: import("pixi.js").Application | null = null;
		let cancelled = false;

		async function init() {
			try {
				const PIXI = await import("pixi.js");
				const { Live2DModel } = await import("pixi-live2d-display/cubism4");

				if (cancelled || !canvasRef.current) return;

				// pixi-live2d-display 需要注册到 PIXI
				const reg = (Live2DModel as unknown as Record<string, (...args: unknown[]) => void>).registerTicker;
				if (reg) reg(PIXI.Ticker);

				app = new PIXI.Application({
					view: canvasRef.current,
					width: 400,
					height: 500,
					backgroundAlpha: 0,
					autoStart: true,
				});

				const model = await Live2DModel.from("/Resources/Hiyori/Hiyori.model3.json");
				if (cancelled) return;

				model.scale.set(0.15);
				model.anchor.set(0.5, 0.5);
				model.x = 200;
				model.y = 300;

				app.stage.addChild(model as unknown as import("pixi.js").DisplayObject);

				setLoadStatus("ok");
				log.info("Live2D model loaded: Hiyori");
			} catch (err) {
				if (cancelled) return;
				const msg = err instanceof Error ? err.message : String(err);
				log.error("Live2D load failed", msg);
				setLoadStatus("error");
				setErrorMsg(msg);
			}
		}

		init();

		return () => {
			cancelled = true;
			if (app) {
				try { app.destroy(true); } catch { /* */ }
			}
		};
	}, []);

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
