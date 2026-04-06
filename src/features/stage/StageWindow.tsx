import { useRef, useEffect, useState, useCallback } from "react";
import { LogicalPosition, LogicalSize } from "@tauri-apps/api/dpi";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
	onMouthSync, onControlCommand,
	broadcastControl, isTauriEnvironment,
	type ControlCommand, type StageDisplayMode,
} from "@/utils/window-sync";
import CloseIcon from "@mui/icons-material/Close";
import { Live2DRenderer, DEFAULT_MODEL, MODEL_REGISTRY } from "@/features/live2d";
import type { EyeMode } from "@/features/live2d";
import { createLogger } from "@/services/logger";
import {
	saveZoom, loadZoom,
	loadModelExpression, saveModelExpression,
} from "@/utils/stage-storage";

const log = createLogger("stage-window");

function resolveExpressionNames(modelPath: string, renderer: Live2DRenderer): string[] {
	const reported = renderer.getExpressionNames();
	if (reported.length > 0) return reported;
	return MODEL_REGISTRY.find((model) => model.path === modelPath)?.expressionNames ?? [];
}

export function StageWindow() {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const rendererRef = useRef<Live2DRenderer | null>(null);
	const [loadStatus, setLoadStatus] = useState<"loading" | "ok" | "error">("loading");
	const [loadErrorMessage, setLoadErrorMessage] = useState<string | null>(null);
	const [showControls, setShowControls] = useState(false);
	const [stageMode, setStageMode] = useState<"docked" | "floating">("docked");
	const [alwaysOnTop, setAlwaysOnTop] = useState(false);
	const [displayMode, setDisplayMode] = useState<StageDisplayMode>("clean");
	const currentModelPath = useRef(DEFAULT_MODEL.path);
	const [scaleLocked, setScaleLocked] = useState(false);
	const eyeModeRef = useRef<EyeMode>("random-path");
	const [eyeMode, setEyeModeState] = useState<EyeMode>("random-path");

	const setEyeMode = useCallback((mode: EyeMode) => {
		eyeModeRef.current = mode;
		setEyeModeState(mode);
		rendererRef.current?.setEyeMode(mode);
	}, []);

	const syncStateToHost = useCallback((overrides?: Partial<{
		mode: "docked" | "floating";
		alwaysOnTop: boolean;
		displayMode: StageDisplayMode;
		visible: boolean;
	}>) => {
		broadcastControl({
			type: "sync-state",
			state: {
				mode: overrides?.mode ?? stageMode,
				alwaysOnTop: overrides?.alwaysOnTop ?? alwaysOnTop,
				displayMode: overrides?.displayMode ?? displayMode,
				visible: overrides?.visible ?? true,
			},
		});
	}, [stageMode, alwaysOnTop, displayMode]);

	useEffect(() => {
		if (!isTauriEnvironment()) return;

		async function applyAlwaysOnTop() {
			try {
				const win = getCurrentWindow();
				if (stageMode === "docked") {
					await win.setAlwaysOnTop(false);
					await win.setSkipTaskbar(true);
				} else {
					await win.setAlwaysOnTop(alwaysOnTop);
					await win.setSkipTaskbar(false);
				}
			} catch (err) {
				log.warn("applyAlwaysOnTop failed", err);
			}
		}
		applyAlwaysOnTop();
	}, [stageMode, alwaysOnTop]);

	useEffect(() => {
		if (!isTauriEnvironment()) return;

		async function applyCursorEvents() {
			try {
				const win = getCurrentWindow();
				const shouldIgnore = displayMode === "clean" && stageMode === "docked";
				await win.setIgnoreCursorEvents(shouldIgnore);
			} catch (err) {
				log.warn("setIgnoreCursorEvents failed", err);
			}
		}
		applyCursorEvents();
	}, [displayMode, stageMode]);

	// 初始加载（创建 renderer + app）
	const initRenderer = useCallback(async (modelPath: string) => {
		if (!canvasRef.current) return;

		setLoadStatus("loading");
		setLoadErrorMessage(null);
		const renderer = new Live2DRenderer();
		rendererRef.current = renderer;
		currentModelPath.current = modelPath;

		try {
			await renderer.init({
				canvas: canvasRef.current,
				width: window.innerWidth,
				height: window.innerHeight,
				modelPath,
				autoFit: true,
			});
			renderer.setEyeMode(eyeModeRef.current);
			const savedZoom = loadZoom();
			if (savedZoom !== 1) renderer.setZoom(savedZoom);
			const rememberedExpression = loadModelExpression(modelPath);
			if (rememberedExpression) {
				await renderer.setExpression(rememberedExpression);
			}
			setLoadStatus("ok");
			log.info(`model loaded: ${modelPath}`);

			const expressions = resolveExpressionNames(modelPath, renderer);
			broadcastControl({ type: "report-expressions", expressions });
		} catch (err) {
			setLoadStatus("error");
			setLoadErrorMessage(err instanceof Error ? err.message : String(err));
			log.error("model load failed", err);
			renderer.destroy();
			rendererRef.current = null;
		}
	}, []);

	// 切换模型（复用已有 renderer/app，只换模型）
	const switchModel = useCallback(async (modelPath: string) => {
		const renderer = rendererRef.current;
		if (!renderer) {
			await initRenderer(modelPath);
			return;
		}

		currentModelPath.current = modelPath;
		setLoadStatus("loading");
		setLoadErrorMessage(null);

		try {
			await renderer.switchModel(modelPath);
			renderer.setEyeMode(eyeModeRef.current);
			const savedZoom = loadZoom();
			if (savedZoom !== 1) renderer.setZoom(savedZoom);
			const rememberedExpression = loadModelExpression(modelPath);
			if (rememberedExpression) {
				await renderer.setExpression(rememberedExpression);
			}
			setLoadStatus("ok");
			log.info(`model switched: ${modelPath}`);

			const expressions = resolveExpressionNames(modelPath, renderer);
			broadcastControl({ type: "report-expressions", expressions });
		} catch (err) {
			setLoadStatus("error");
			setLoadErrorMessage(err instanceof Error ? err.message : String(err));
			log.error("model switch failed", err);
		}
	}, [initRenderer]);

	const handleControlCommand = useCallback(async (cmd: ControlCommand) => {
		try {
			const win = getCurrentWindow();

			switch (cmd.type) {
			case "request-expressions": {
				const renderer = rendererRef.current;
				if (!renderer) break;
				const expressions = resolveExpressionNames(currentModelPath.current, renderer);
				broadcastControl({ type: "report-expressions", expressions });
				break;
			}
			case "hide-stage":
				rendererRef.current?.destroy();
				rendererRef.current = null;
				await win.hide();
				break;
			case "show-stage":
				if (!rendererRef.current) {
					// 替换 canvas：旧 canvas 的 WebGL context 已损坏，必须换新元素才能重建
					if (canvasRef.current) {
						const parent = canvasRef.current.parentElement;
						if (parent) {
							const wasPassthrough = canvasRef.current.style.opacity === "0";
							const newCanvas = document.createElement("canvas");
							newCanvas.style.width = "100vw";
							newCanvas.style.height = "100vh";
							newCanvas.style.display = "block";
							if (wasPassthrough) newCanvas.style.opacity = "0";
							const oldCanvas = canvasRef.current;
							parent.insertBefore(newCanvas, oldCanvas);
							oldCanvas.remove();
							canvasRef.current = newCanvas;
						}
					}
					await initRenderer(currentModelPath.current);
				}
				await win.show();
				await win.setFocus();
				break;
			case "reset-position":
				try {
					await win.setPosition(new LogicalPosition(100, 100));
				} catch { /* */ }
				break;
			case "set-mode":
				setStageMode(cmd.mode);
				break;
			case "set-always-on-top":
				setAlwaysOnTop(cmd.value);
				break;
			case "restore-always-on-top":
				break;
			case "set-display-mode":
				setDisplayMode(cmd.displayMode);
				break;
			case "set-model":
				if (cmd.modelPath !== currentModelPath.current) {
					await switchModel(cmd.modelPath);
				}
				break;
			case "set-expression":
				if (rendererRef.current) {
					const ok = await rendererRef.current.setExpression(cmd.expressionName);
					if (ok) {
						saveModelExpression(currentModelPath.current, cmd.expressionName);
					}
				}
				break;
			case "set-scale-lock":
				setScaleLocked(cmd.locked);
				break;
			case "set-eye-mode":
				setEyeMode(cmd.mode);
				break;
			case "set-pointer":
				rendererRef.current?.focusMouse(cmd.x, cmd.y);
				break;
			case "set-size":
				try {
					await win.setSize(new LogicalSize(cmd.width, cmd.height));
				} catch { /* */ }
				break;
			case "reset-zoom":
				rendererRef.current?.resetZoom();
				saveZoom(1);
				break;
			case "set-passthrough":
				await win.setIgnoreCursorEvents(cmd.enabled);
				if (canvasRef.current) {
					canvasRef.current.style.opacity = cmd.enabled ? "0" : "1";
				}
				break;
			}
		} catch {
			if (cmd.type === "hide-stage") {
				rendererRef.current?.destroy();
				rendererRef.current = null;
				try { window.close(); } catch { /* fallback */ }
			}
		}
	}, [switchModel, setEyeMode, initRenderer]);

	// 初始化——只运行一次
	useEffect(() => {
		document.documentElement.style.background = "transparent";
		document.body.style.background = "transparent";

		const cleanups: (() => void)[] = [];

		async function setup() {
			await initRenderer(DEFAULT_MODEL.path);

			broadcastControl({ type: "request-state" });

			const unsubMouth = await onMouthSync((value: number) => {
				rendererRef.current?.setMouthOpenY(value);
			});
			cleanups.push(unsubMouth);

			const unsubControl = await onControlCommand((cmd: ControlCommand) => {
				handleControlCommand(cmd);
			});
			cleanups.push(unsubControl);
		}

		setup();

		const handleResize = () => {
			rendererRef.current?.resize(window.innerWidth, window.innerHeight);
		};
		window.addEventListener("resize", handleResize);

		return () => {
			window.removeEventListener("resize", handleResize);
			cleanups.forEach((fn) => fn());
			rendererRef.current?.destroy();
			rendererRef.current = null;
		};
	}, [initRenderer, handleControlCommand]);

	// 滚轮缩放
	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas) return;

		const handleWheel = (e: WheelEvent) => {
			if (scaleLocked) return;
			e.preventDefault();
			const delta = e.deltaY < 0 ? 1 : -1;
			rendererRef.current?.applyZoomDelta(delta);
			const zoom = rendererRef.current?.getZoom();
			if (zoom !== undefined) saveZoom(zoom);
		};

		canvas.addEventListener("wheel", handleWheel, { passive: false });
		return () => canvas.removeEventListener("wheel", handleWheel);
	}, [scaleLocked]);

	// 鼠标跟随（follow-mouse 模式）
	useEffect(() => {
		if (eyeMode !== "follow-mouse") return;

		const handleMouseMove = (e: MouseEvent) => {
			rendererRef.current?.focusMouse(e.clientX, e.clientY);
		};
		window.addEventListener("mousemove", handleMouseMove);
		return () => window.removeEventListener("mousemove", handleMouseMove);
	}, [eyeMode]);

	const handleClose = useCallback(async () => {
		try {
			rendererRef.current?.destroy();
			rendererRef.current = null;

			syncStateToHost({ visible: false });
			await getCurrentWindow().hide();
		} catch {
			rendererRef.current?.destroy();
			rendererRef.current = null;
			try { window.close(); } catch { /* fallback */ }
		}
	}, [syncStateToHost]);

	const toggleMode = useCallback(() => {
		const next = stageMode === "docked" ? "floating" : "docked";
		setStageMode(next);
		broadcastControl({ type: "set-mode", mode: next });
		syncStateToHost({ mode: next });
	}, [stageMode, syncStateToHost]);

	const toggleDisplayMode = useCallback(() => {
		const next: StageDisplayMode = displayMode === "clean" ? "interactive" : "clean";
		setDisplayMode(next);
		broadcastControl({ type: "set-display-mode", displayMode: next });
		syncStateToHost({ displayMode: next });
	}, [displayMode, syncStateToHost]);

	const isFloating = stageMode === "floating";
	const shouldShowToolbar = displayMode === "interactive" && showControls;

	return (
		<div
			className="stage-window"
			onMouseEnter={() => setShowControls(true)}
			onMouseLeave={() => setShowControls(false)}
		>
			{displayMode === "interactive" && (
				<div
					className={`stage-toolbar ${shouldShowToolbar ? "stage-toolbar-visible" : ""}`}
					{...(isFloating ? { "data-tauri-drag-region": true } : {})}
				>
					<span
						className="stage-toolbar-label"
						{...(isFloating ? { "data-tauri-drag-region": true } : {})}
					>
						{isFloating ? "⋮⋮ 浮动" : "贴靠"}
					</span>
					<div className="stage-toolbar-actions">
						<button className="stage-tb-btn" onClick={toggleMode} title="切换模式">
							{isFloating ? "⊞ 贴靠" : "⇱ 浮动"}
						</button>
						<button className="stage-tb-btn" onClick={toggleDisplayMode} title="切换为 clean 模式">
							clean
						</button>
						<button className="stage-tb-btn stage-tb-close" onClick={handleClose} title="关闭">
							<CloseIcon sx={{ fontSize: 16 }} />
						</button>
					</div>
				</div>
			)}

			{loadStatus === "error" ? (
				<div style={{ color: "#F87171", textAlign: "center", marginTop: 40, padding: "0 16px" }}>
					<p style={{ marginBottom: 8 }}>Live2D 加载失败</p>
					<p style={{ fontSize: 12, opacity: 0.85 }}>{loadErrorMessage ?? "未知错误"}</p>
				</div>
			) : (
				<canvas
					ref={canvasRef}
					style={{ width: "100vw", height: "100vh", display: "block" }}
				/>
			)}
		</div>
	);
}
