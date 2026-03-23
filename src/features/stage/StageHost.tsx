import { useState, useCallback, useEffect, useRef } from "react";
import { useCharacter } from "@/hooks";
import { broadcastControl, type StageDisplayMode } from "@/utils/window-sync";
import { createLogger } from "@/services/logger";

const log = createLogger("stage-host");

/**
 * 主界面 Stage 停靠区域。
 *
 * 控制 Stage 窗口的：模式(docked/floating)、显示/隐藏、alwaysOnTop、显示模式(clean/interactive)。
 * docked 模式下监听主窗口 move/resize 驱动 Stage 跟随。
 */
export function StageHost() {
	const { emotion, isSpeaking } = useCharacter();
	const [stageVisible, setStageVisible] = useState(false);
	const [stageMode, setStageMode] = useState<"docked" | "floating">("docked");
	const [alwaysOnTop, setAlwaysOnTop] = useState(false);
	const [displayMode, setDisplayMode] = useState<StageDisplayMode>("interactive");
	const hostRef = useRef<HTMLDivElement>(null);
	const unlistenMoveRef = useRef<(() => void) | null>(null);
	const unlistenResizeRef = useRef<(() => void) | null>(null);

	// docked 跟随
	useEffect(() => {
		if (stageMode !== "docked" || !stageVisible) {
			unlistenMoveRef.current?.();
			unlistenMoveRef.current = null;
			unlistenResizeRef.current?.();
			unlistenResizeRef.current = null;
			return;
		}

		let cancelled = false;

		async function startFollow() {
			const hasTauri = "__TAURI_INTERNALS__" in window;
			if (!hasTauri) return;

			try {
				const { getCurrentWindow } = await import("@tauri-apps/api/window");
				const mainWin = getCurrentWindow();

				let rafId = 0;
				const scheduleSync = () => {
					if (rafId) return;
					rafId = requestAnimationFrame(async () => {
						rafId = 0;
						if (cancelled) return;
						await syncStagePosition();
					});
				};

				const { listen } = await import("@tauri-apps/api/event");
				if (cancelled) return;

				const unMove = await listen("tauri://move", () => {
					if (mainWin.label === "main") scheduleSync();
				});
				const unResize = await listen("tauri://resize", () => {
					if (mainWin.label === "main") scheduleSync();
				});

				if (cancelled) {
					unMove();
					unResize();
					return;
				}

				unlistenMoveRef.current = unMove;
				unlistenResizeRef.current = unResize;

				await syncStagePosition();
			} catch (err) {
				log.warn("docked follow setup failed", err);
			}
		}

		startFollow();

		return () => {
			cancelled = true;
			unlistenMoveRef.current?.();
			unlistenMoveRef.current = null;
			unlistenResizeRef.current?.();
			unlistenResizeRef.current = null;
		};
	}, [stageMode, stageVisible]);

	const syncStagePosition = useCallback(async () => {
		try {
			const { Window } = await import("@tauri-apps/api/window");
			const { LogicalPosition, LogicalSize } = await import("@tauri-apps/api/dpi");
			const mainWin = await Window.getByLabel("main");
			const stageWin = await Window.getByLabel("stage");
			if (!mainWin || !stageWin) return;

			const mainPos = await mainWin.outerPosition();
			const mainSize = await mainWin.outerSize();
			const sf = await mainWin.scaleFactor();

			const mainLogX = mainPos.x / sf;
			const mainLogY = mainPos.y / sf;
			const mainLogH = mainSize.height / sf;

			const headerH = 40;
			const footerH = 180;
			const slotW = 300;
			const slotH = mainLogH - headerH - footerH;

			const stageX = mainLogX + 1;
			const stageY = mainLogY + headerH;

			await stageWin.setPosition(new LogicalPosition(stageX, stageY));

			if (slotW > 100 && slotH > 100) {
				await stageWin.setSize(new LogicalSize(slotW - 2, slotH));
			}
		} catch (err) {
			log.warn("sync stage position failed", err);
		}
	}, []);

	const handleShowStage = useCallback(async () => {
		try {
			const { Window } = await import("@tauri-apps/api/window");
			const stageWin = await Window.getByLabel("stage");
			if (stageWin) {
				await stageWin.show();
				await stageWin.setFocus();
				setStageVisible(true);
				log.info("stage shown");

				if (stageMode === "docked") {
					await syncStagePosition();
				}
			}
		} catch (err) {
			log.error("show stage failed", err);
		}
	}, [stageMode, syncStagePosition]);

	const handleHideStage = useCallback(() => {
		broadcastControl({ type: "hide-stage" });
		setStageVisible(false);
	}, []);

	const handleResetPosition = useCallback(() => {
		broadcastControl({ type: "reset-position" });
	}, []);

	const handleSetMode = useCallback(async (mode: "docked" | "floating") => {
		setStageMode(mode);
		broadcastControl({ type: "set-mode", mode });

		if (mode === "docked" && stageVisible) {
			await syncStagePosition();
		} else if (mode === "floating") {
			try {
				const { Window } = await import("@tauri-apps/api/window");
				const { LogicalSize } = await import("@tauri-apps/api/dpi");
				const stageWin = await Window.getByLabel("stage");
				if (stageWin) {
					await stageWin.setSize(new LogicalSize(800, 600));
				}
			} catch { /* 浏览器环境忽略 */ }
		}
	}, [stageVisible, syncStagePosition]);

	const handleToggleAlwaysOnTop = useCallback(() => {
		const next = !alwaysOnTop;
		setAlwaysOnTop(next);
		broadcastControl({ type: "set-always-on-top", value: next });
	}, [alwaysOnTop]);

	const handleToggleDisplayMode = useCallback(() => {
		const next: StageDisplayMode = displayMode === "clean" ? "interactive" : "clean";
		setDisplayMode(next);
		broadcastControl({ type: "set-display-mode", displayMode: next });
	}, [displayMode]);

	return (
		<section className="stage-host" ref={hostRef}>
			<h2>Stage</h2>

			{/* 状态区 */}
			<div className="stage-host-status">
				<div className="stage-host-state-row">
					<span className={`stage-host-indicator ${stageVisible ? "indicator-on" : ""}`} />
					<span>{stageVisible ? "播出中" : "未启动"}</span>
				</div>
				<div className="stage-host-state-row">
					<span className="stage-host-mode-label">
						{stageMode === "docked" ? "贴靠" : "浮动"}
					</span>
					{stageMode === "docked" && (
						<span className="stage-host-pin-label">pin</span>
					)}
					{stageMode === "floating" && alwaysOnTop && (
						<span className="stage-host-pin-label">置顶</span>
					)}
					<span className="stage-host-mode-label">
						{displayMode === "clean" ? "clean" : "interactive"}
					</span>
				</div>
				<div className="stage-host-state-row stage-host-char-info">
					<span>{emotion}</span>
					{isSpeaking && <span className="stage-host-speaking">说话中</span>}
				</div>
			</div>

			{/* docked 占位区域 */}
			<div className={`stage-host-slot ${stageMode === "docked" && stageVisible ? "slot-active" : ""}`}>
				{stageMode === "docked" && stageVisible ? (
					<p className="slot-hint">Stage 覆盖此区域</p>
				) : stageMode === "docked" && !stageVisible ? (
					<p className="slot-hint">点击「启动」显示 Stage</p>
				) : (
					<p className="slot-hint">浮动模式 — 独立窗口</p>
				)}
			</div>

			{/* 控制按钮 */}
			<div className="stage-host-controls">
				<h3>窗口</h3>
				<div className="control-actions">
					{!stageVisible ? (
						<button onClick={handleShowStage}>启动</button>
					) : (
						<button onClick={handleHideStage}>隐藏</button>
					)}
					<button onClick={handleResetPosition} disabled={!stageVisible}>重置</button>
				</div>

				<h3>模式</h3>
				<div className="control-actions">
					<button
						onClick={() => handleSetMode("docked")}
						className={stageMode === "docked" ? "active" : ""}
					>
						贴靠
					</button>
					<button
						onClick={() => handleSetMode("floating")}
						className={stageMode === "floating" ? "active" : ""}
					>
						浮动
					</button>
				</div>

				{stageMode === "floating" && (
					<>
						<h3>置顶</h3>
						<div className="control-actions">
							<button
								onClick={handleToggleAlwaysOnTop}
								className={alwaysOnTop ? "active" : ""}
							>
								{alwaysOnTop ? "置顶: 开" : "置顶: 关"}
							</button>
						</div>
					</>
				)}

				<h3>显示</h3>
				<div className="control-actions">
					<button
						onClick={handleToggleDisplayMode}
						className={displayMode === "clean" ? "active" : ""}
					>
						{displayMode === "clean" ? "clean 模式" : "interactive 模式"}
					</button>
				</div>
			</div>
		</section>
	);
}
