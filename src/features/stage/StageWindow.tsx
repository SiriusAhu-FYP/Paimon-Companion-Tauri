import { useRef, useEffect, useState, useCallback } from "react";
import {
	onStateSync, onMouthSync, onControlCommand,
	broadcastControl,
	type SyncPayload, type ControlCommand, type StageDisplayMode,
} from "@/utils/window-sync";
import { Live2DRenderer } from "@/features/live2d";
import { createLogger } from "@/services/logger";

const log = createLogger("stage-window");

/**
 * OBS 舞台窗口——唯一的 Live2D 渲染实例。
 *
 * 窗口语义：
 * - docked：pinToApp 激活，Stage 始终在主窗口之上（setAlwaysOnTop），不可拖拽
 * - floating：可拖拽，alwaysOnTop 可独立切换
 *
 * 显示模式：
 * - clean：控制条完全隐藏，适合 OBS 播出
 * - interactive：hover 时显示控制条，便于操作
 */
export function StageWindow() {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const rendererRef = useRef<Live2DRenderer | null>(null);
	const [loadStatus, setLoadStatus] = useState<"loading" | "ok" | "error">("loading");
	const [showControls, setShowControls] = useState(false);
	const [stageMode, setStageMode] = useState<"docked" | "floating">("docked");
	const [alwaysOnTop, setAlwaysOnTop] = useState(false);
	const [displayMode, setDisplayMode] = useState<StageDisplayMode>("interactive");

	// pinToApp 由 Tauri parent 关系实现（tauri.conf.json 中 stage.parent = "main"）
	// Win32 owned window 保证：Stage 始终在 main 之上，main 最小化时 Stage 跟随隐藏
	// 此处只控制 alwaysOnTop（是否压在其他应用之上）
	useEffect(() => {
		const hasTauri = "__TAURI_INTERNALS__" in window;
		if (!hasTauri) return;

		async function applyAlwaysOnTop() {
			try {
				const { getCurrentWindow } = await import("@tauri-apps/api/window");
				const win = getCurrentWindow();
				// docked 模式不需要 alwaysOnTop（parent 关系已保证在 main 之上）
				// floating 模式下由用户控制
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
		document.documentElement.style.background = "transparent";
		document.body.style.background = "transparent";

		const renderer = new Live2DRenderer();
		rendererRef.current = renderer;

		const cleanups: (() => void)[] = [];

		async function setup() {
			if (!canvasRef.current) return;

			const w = window.innerWidth;
			const h = window.innerHeight;

			try {
				await renderer.init({
					canvas: canvasRef.current,
					width: w,
					height: h,
					modelPath: "/Resources/Hiyori/Hiyori.model3.json",
					autoFit: true,
				});
				setLoadStatus("ok");
				log.info("stage Live2D loaded");
			} catch (err) {
				setLoadStatus("error");
				log.error("stage Live2D failed", err);
				return;
			}

			broadcastControl({ type: "request-state" });

			const unsubState = await onStateSync((payload: SyncPayload) => {
				const r = rendererRef.current;
				if (!r) return;
				if (payload.expressionEmotion) {
					r.setEmotion(payload.expressionEmotion);
				}
			});
			cleanups.push(unsubState);

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
			rendererRef.current = null;
			renderer.destroy();
		};
	}, []);

	const handleControlCommand = useCallback(async (cmd: ControlCommand) => {
		try {
			const { getCurrentWindow } = await import("@tauri-apps/api/window");
			const win = getCurrentWindow();

			switch (cmd.type) {
				case "hide-stage":
					await win.hide();
					log.info("stage hidden");
					break;
				case "show-stage":
					await win.show();
					await win.setFocus();
					log.info("stage shown");
					break;
				case "reset-position":
					try {
						const { LogicalPosition } = await import("@tauri-apps/api/dpi");
						await win.setPosition(new LogicalPosition(100, 100));
						log.info("stage position reset");
					} catch {
						log.warn("setPosition failed");
					}
					break;
				case "set-mode":
					setStageMode(cmd.mode);
					log.info(`stage mode → ${cmd.mode}`);
					break;
				case "set-always-on-top":
					setAlwaysOnTop(cmd.value);
					log.info(`alwaysOnTop → ${cmd.value}`);
					break;
				case "set-display-mode":
					setDisplayMode(cmd.displayMode);
					log.info(`display mode → ${cmd.displayMode}`);
					break;
			}
		} catch {
			if (cmd.type === "hide-stage") window.close();
		}
	}, []);

	const handleHide = useCallback(async () => {
		try {
			const { getCurrentWindow } = await import("@tauri-apps/api/window");
			await getCurrentWindow().hide();
		} catch {
			window.close();
		}
	}, []);

	const toggleMode = useCallback(() => {
		const next = stageMode === "docked" ? "floating" : "docked";
		setStageMode(next);
		broadcastControl({ type: "set-mode", mode: next });
	}, [stageMode]);

	const toggleDisplayMode = useCallback(() => {
		const next = displayMode === "clean" ? "interactive" : "clean";
		setDisplayMode(next);
		broadcastControl({ type: "set-display-mode", displayMode: next });
	}, [displayMode]);

	const isFloating = stageMode === "floating";

	// clean 模式：控制条完全不渲染
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
					style={{ width: "100%", height: "100%", display: "block" }}
				/>
			)}
		</div>
	);
}
