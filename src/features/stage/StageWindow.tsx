import { useRef, useEffect, useState, useCallback } from "react";
import {
	onMouthSync, onControlCommand,
	broadcastControl, isTauriEnvironment,
	type ControlCommand, type StageDisplayMode,
} from "@/utils/window-sync";
import { Live2DRenderer, DEFAULT_MODEL } from "@/features/live2d";
import type { EyeMode } from "@/features/live2d";
import { createLogger } from "@/services/logger";
import { saveZoom, loadZoom } from "@/utils/stage-storage";

const log = createLogger("stage-window");

export function StageWindow() {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const rendererRef = useRef<Live2DRenderer | null>(null);
	const [loadStatus, setLoadStatus] = useState<"loading" | "ok" | "error">("loading");
	const [showControls, setShowControls] = useState(false);
	const [stageMode, setStageMode] = useState<"docked" | "floating">("docked");
	const [alwaysOnTop, setAlwaysOnTop] = useState(false);
	const [displayMode, setDisplayMode] = useState<StageDisplayMode>("clean");
	const currentModelPath = useRef(DEFAULT_MODEL.path);
	const [scaleLocked, setScaleLocked] = useState(false);
	const eyeModeRef = useRef<EyeMode>("random-path");
	const [eyeMode, setEyeModeState] = useState<EyeMode>("random-path");
	/** 记录被 Settings 等临时抑制前的 alwaysOnTop 值 */
	const suppressedRef = useRef<boolean | null>(null);

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
				const { getCurrentWindow } = await import("@tauri-apps/api/window");
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
				const { getCurrentWindow } = await import("@tauri-apps/api/window");
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
			setLoadStatus("ok");
			log.info(`model loaded: ${modelPath}`);

			const expressions = renderer.getExpressionNames();
			broadcastControl({ type: "report-expressions", expressions });
		} catch (err) {
			setLoadStatus("error");
			log.error("model load failed", err);
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

		try {
			await renderer.switchModel(modelPath);
			renderer.setEyeMode(eyeModeRef.current);
			const savedZoom = loadZoom();
			if (savedZoom !== 1) renderer.setZoom(savedZoom);
			setLoadStatus("ok");
			log.info(`model switched: ${modelPath}`);

			const expressions = renderer.getExpressionNames();
			broadcastControl({ type: "report-expressions", expressions });
		} catch (err) {
			setLoadStatus("error");
			log.error("model switch failed", err);
		}
	}, [initRenderer]);

	const handleControlCommand = useCallback(async (cmd: ControlCommand) => {
		try {
			const { getCurrentWindow } = await import("@tauri-apps/api/window");
			const win = getCurrentWindow();

			switch (cmd.type) {
				case "hide-stage":
					rendererRef.current?.destroy();
					rendererRef.current = null;
					await win.hide();
					break;
				case "show-stage":
					if (!rendererRef.current) {
						await initRenderer(currentModelPath.current);
					}
					await win.show();
					await win.setFocus();
					break;
				case "reset-position":
					try {
						const { LogicalPosition } = await import("@tauri-apps/api/dpi");
						await win.setPosition(new LogicalPosition(100, 100));
					} catch { /* */ }
					break;
				case "set-mode":
					setStageMode(cmd.mode);
					break;
			case "set-always-on-top":
				setAlwaysOnTop(cmd.value);
				break;
			case "suppress-always-on-top":
				if (stageMode === "floating") {
					suppressedRef.current = alwaysOnTop;
					await win.setAlwaysOnTop(false);
				}
				break;
			case "restore-always-on-top":
				if (stageMode === "floating" && suppressedRef.current !== null) {
					const restored = suppressedRef.current;
					suppressedRef.current = null;
					await win.setAlwaysOnTop(restored);
				}
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
					rendererRef.current?.setExpression(cmd.expressionName);
					break;
				case "set-scale-lock":
					setScaleLocked(cmd.locked);
					break;
				case "set-eye-mode":
					setEyeMode(cmd.mode);
					break;
				case "set-size":
					try {
						const { LogicalSize } = await import("@tauri-apps/api/dpi");
						await win.setSize(new LogicalSize(cmd.width, cmd.height));
					} catch { /* */ }
					break;
				case "reset-zoom":
					rendererRef.current?.resetZoom();
					saveZoom(1);
					break;
			}
		} catch {
			if (cmd.type === "hide-stage") {
				rendererRef.current?.destroy();
				rendererRef.current = null;
				try { window.close(); } catch { /* fallback */ }
			}
		}
	}, [switchModel, setEyeMode, initRenderer, stageMode, alwaysOnTop]);

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
			const { getCurrentWindow } = await import("@tauri-apps/api/window");
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
								✕
							</button>
					</div>
				</div>
			)}

			{loadStatus === "error" ? (
				<p style={{ color: "#e94560", textAlign: "center", marginTop: 40 }}>
					Live2D 加载失败
				</p>
			) : (
				<canvas
					ref={canvasRef}
					style={{ width: "100vw", height: "100vh", display: "block" }}
				/>
			)}
		</div>
	);
}
