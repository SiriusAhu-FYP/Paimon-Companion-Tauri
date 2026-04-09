import { useCharacter, useEventBus } from "@/hooks";
import { useRef, useEffect, useState, useCallback } from "react";
import { createLogger } from "@/services/logger";

const log = createLogger("live2d-preview");

// 情绪 → Cubism 参数覆盖映射（Hiyori 模型无 Expressions 文件，用参数直接驱动）
const EMOTION_PARAMS: Record<string, Record<string, number>> = {
	neutral: {},
	happy: {
		ParamMouthForm: 1,
		ParamEyeLSmile: 1,
		ParamEyeRSmile: 1,
	},
	sad: {
		ParamEyeLOpen: 0.35,
		ParamEyeROpen: 0.35,
		ParamMouthForm: -0.6,
		ParamBrowLY: -0.6,
		ParamBrowRY: -0.6,
	},
	angry: {
		ParamBrowLY: -1,
		ParamBrowRY: -1,
		ParamEyeLOpen: 0.6,
		ParamEyeROpen: 0.6,
		ParamMouthForm: -0.4,
		ParamAngleZ: -5,
	},
	delighted: {
		ParamMouthForm: 1,
		ParamEyeLSmile: 1,
		ParamEyeRSmile: 1,
		ParamEyeLOpen: 1.15,
		ParamEyeROpen: 1.15,
		ParamMouthOpenY: 0.45,
		ParamBrowLY: 0.2,
		ParamBrowRY: 0.2,
	},
	alarmed: {
		ParamEyeLOpen: 1.3,
		ParamEyeROpen: 1.3,
		ParamMouthOpenY: 0.6,
		ParamBrowLY: 0.8,
		ParamBrowRY: 0.8,
	},
	dazed: {
		ParamEyeLOpen: 0.45,
		ParamEyeROpen: 0.45,
		ParamMouthOpenY: 0.18,
		ParamMouthForm: -0.15,
		ParamAngleZ: -3,
	},
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyModel = any;

function applyEmotionParams(model: AnyModel, emotion: string) {
	const overrides = EMOTION_PARAMS[emotion] ?? {};
	try {
		const coreModel = model.internalModel?.coreModel;
		if (!coreModel) return;
		const rawModel = coreModel._model;
		if (!rawModel?.parameters) return;
		const { ids, values, count } = rawModel.parameters;
		for (let i = 0; i < count; i++) {
			if (ids[i] in overrides) {
				values[i] = overrides[ids[i]];
			}
		}
	} catch {
		// 某些模型结构不同，忽略
	}
}

/**
 * Live2D 预览区域：使用 PIXI + pixi-live2d-display 渲染模型。
 * 订阅 character:expression 事件，将情绪映射为 Cubism 参数覆盖。
 */
export function Live2DPreview() {
	const { characterId, emotion, isSpeaking } = useCharacter();
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const modelRef = useRef<AnyModel>(null);
	const emotionRef = useRef("neutral");
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
				modelRef.current = model;

				// 每帧施加情绪参数覆盖（idle 动画会重置参数，需要持续覆盖）
				app.ticker.add(() => {
					if (modelRef.current && emotionRef.current !== "neutral") {
						applyEmotionParams(modelRef.current, emotionRef.current);
					}
				});

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
			modelRef.current = null;
			if (app) {
				try { app.destroy(true); } catch { /* */ }
			}
		};
	}, []);

	// 响应 character:expression 事件——真正驱动 Live2D 表情切换
	const onExpression = useCallback(({ emotion: newEmotion }: { emotion: string; expressionName: string }) => {
		emotionRef.current = newEmotion;

		const model = modelRef.current;
		if (!model) return;

		// 播放一个动作作为切换时的视觉反馈
		try {
			if (newEmotion === "happy" || newEmotion === "delighted") {
				model.motion("TapBody", 0);
			} else if (newEmotion === "alarmed") {
				model.motion("TapBody", 1);
			} else if (newEmotion !== "neutral") {
				model.motion("Idle", Math.floor(Math.random() * 9));
			}
		} catch { /* motion 播放失败不阻塞 */ }

		log.info(`expression applied: ${newEmotion}`);
	}, []);

	useEventBus("character:expression", onExpression);

	return (
		<section className="live2d-preview">
			<h2>角色预览</h2>
			{loadStatus === "error" ? (
				<div className="live2d-placeholder">
					<p className="placeholder-icon"><svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#888" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="5"/><path d="M3 21c0-4.97 4.03-9 9-9s9 4.03 9 9"/></svg></p>
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
