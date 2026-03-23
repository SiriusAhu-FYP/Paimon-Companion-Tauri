import { useRef, useEffect, useState, useCallback } from "react";
import {
	onMouthSync, onControlCommand,
	broadcastControl,
	type ControlCommand, type StageDisplayMode,
} from "@/utils/window-sync";
import { Live2DRenderer, DEFAULT_MODEL } from "@/features/live2d";
import { createLogger } from "@/services/logger";

const log = createLogger("stage-window");

export function StageWindow() {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const rendererRef = useRef<Live2DRenderer | null>(null);
	const [loadStatus, setLoadStatus] = useState<"loading" | "ok" | "error">("loading");
	const [showControls, setShowControls] = useState(false);
	const [stageMode, setStageMode] = useState<"docked" | "floating">("docked");
	const [alwaysOnTop, setAlwaysOnTop] = useState(false);
	const [displayMode, setDisplayMode] = useState<StageDisplayMode>("interactive");
	const currentModelPath = useRef(DEFAULT_MODEL.path);

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
		const hasTauri = "__TAURI_INTERNALS__" in window;
		if (!hasTauri) return;

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
		const hasTauri = "__TAURI_INTERNALS__" in window;
		if (!hasTauri) return;

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

	const loadModel = useCallback(async (modelPath: string) => {
		const oldRenderer = rendererRef.current;
		if (oldRenderer) {
			oldRenderer.destroy();
			rendererRef.current = null;
		}

		if (!canvasRef.current) return;

		setLoadStatus("loading");
		const renderer = new Live2DRenderer();
		rendererRef.current = renderer;
		currentModelPath.current = modelPath;

		const w = window.innerWidth;
		const h = window.innerHeight;

		try {
			await renderer.init({
				canvas: canvasRef.current,
				width: w,
				height: h,
				modelPath,
				autoFit: true,
			});
			setLoadStatus("ok");
			log.info(`model loaded: ${modelPath}`);

			// 汇报模型支持的表情给主窗口
			const expressions = renderer.getExpressionNames();
			broadcastControl({ type: "report-expressions", expressions });
		} catch (err) {
			setLoadStatus("error");
			log.error("model load failed", err);
		}
	}, []);

	// 初始化
	useEffect(() => {
		document.documentElement.style.background = "transparent";
		document.body.style.background = "transparent";

		const cleanups: (() => void)[] = [];

		async function setup() {
			await loadModel(DEFAULT_MODEL.path);

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
	}, [loadModel]);

	const handleControlCommand = useCallback(async (cmd: ControlCommand) => {
		try {
			const { getCurrentWindow } = await import("@tauri-apps/api/window");
			const win = getCurrentWindow();

			switch (cmd.type) {
				case "hide-stage":
					await win.hide();
					break;
				case "show-stage":
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
				case "set-display-mode":
					setDisplayMode(cmd.displayMode);
					break;
				case "set-model":
					if (cmd.modelPath !== currentModelPath.current) {
						await loadModel(cmd.modelPath);
					}
					break;
				case "set-expression":
					rendererRef.current?.setExpression(cmd.expressionName);
					break;
			}
		} catch {
			if (cmd.type === "hide-stage") window.close();
		}
	}, [loadModel]);

	const handleHide = useCallback(async () => {
		try {
			const { getCurrentWindow } = await import("@tauri-apps/api/window");
			await getCurrentWindow().hide();
			syncStateToHost({ visible: false });
		} catch {
			window.close();
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
						<button className="stage-tb-btn stage-tb-close" onClick={handleHide} title="隐藏">
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
