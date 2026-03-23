import { useState, useCallback, useEffect, useRef } from "react";
import { Box } from "@mui/material";
import { StageHost, StageSlot } from "@/features/stage";
import { ControlPanel } from "@/features/control-panel";
import { ChatPanel } from "@/features/chat";
import { EventLog } from "@/app/EventLog";
import { StatusBar } from "@/app/StatusBar";
import { type StageDisplayMode } from "@/utils/window-sync";
import { createLogger } from "@/services/logger";

const log = createLogger("main-window");

export function MainWindow() {
	const [stageVisible, setStageVisible] = useState(false);
	const [stageMode, setStageMode] = useState<"docked" | "floating">("docked");
	const [alwaysOnTop, setAlwaysOnTop] = useState(false);
	const [displayMode, setDisplayMode] = useState<StageDisplayMode>("interactive");
	const [eventLogOpen, setEventLogOpen] = useState(false);

	// docked 跟随所需的 refs
	const slotRectRef = useRef<DOMRect | null>(null);
	const unlistenMoveRef = useRef<(() => void) | null>(null);
	const unlistenResizeRef = useRef<(() => void) | null>(null);

	const handleSlotRectChange = useCallback((rect: DOMRect) => {
		slotRectRef.current = rect;
	}, []);

	// syncStagePosition 使用 StageSlot 的实际 DOM rect
	const syncStagePosition = useCallback(async () => {
		const rect = slotRectRef.current;
		if (!rect) return;

		try {
			const { Window } = await import("@tauri-apps/api/window");
			const { LogicalPosition, LogicalSize } = await import("@tauri-apps/api/dpi");
			const mainWin = await Window.getByLabel("main");
			const stageWin = await Window.getByLabel("stage");
			if (!mainWin || !stageWin) return;

			const mainPos = await mainWin.outerPosition();
			const sf = await mainWin.scaleFactor();

			const mainLogX = mainPos.x / sf;
			const mainLogY = mainPos.y / sf;

			// rect.x/y 是相对于 viewport 的，加上主窗口逻辑位置得到屏幕位置
			// Tauri 窗口有标题栏偏移——decorations:true 时约 30px
			const titleBarH = 30;
			const stageX = mainLogX + rect.x;
			const stageY = mainLogY + rect.y + titleBarH;
			const stageW = rect.width;
			const stageH = rect.height;

			await stageWin.setPosition(new LogicalPosition(stageX, stageY));
			if (stageW > 50 && stageH > 50) {
				await stageWin.setSize(new LogicalSize(stageW, stageH));
			}
		} catch (err) {
			log.warn("sync stage position failed", err);
		}
	}, []);

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
				const { listen } = await import("@tauri-apps/api/event");

				let rafId = 0;
				const scheduleSync = () => {
					if (rafId) return;
					rafId = requestAnimationFrame(async () => {
						rafId = 0;
						if (cancelled) return;
						await syncStagePosition();
					});
				};

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
	}, [stageMode, stageVisible, syncStagePosition]);

	const handleShowStage = useCallback(async () => {
		try {
			const { Window } = await import("@tauri-apps/api/window");
			const stageWin = await Window.getByLabel("stage");
			if (stageWin) {
				await stageWin.show();
				await stageWin.setFocus();
				setStageVisible(true);
				if (stageMode === "docked") {
					await syncStagePosition();
				}
			}
		} catch (err) {
			log.error("show stage failed", err);
		}
	}, [stageMode, syncStagePosition]);

	const handleModeChange = useCallback(async (mode: "docked" | "floating") => {
		setStageMode(mode);
		if (mode === "floating" && stageVisible) {
			try {
				const { Window } = await import("@tauri-apps/api/window");
				const { LogicalSize } = await import("@tauri-apps/api/dpi");
				const stageWin = await Window.getByLabel("stage");
				if (stageWin) {
					await stageWin.setSize(new LogicalSize(800, 600));
				}
			} catch { /* browser */ }
		}
	}, [stageVisible]);

	return (
		<Box sx={{ display: "flex", flexDirection: "column", height: "100vh", overflow: "hidden" }}>
			{/* Header */}
			<Box sx={{
				px: 2, py: 1,
				bgcolor: "background.paper",
				borderBottom: "1px solid",
				borderColor: "secondary.main",
				flexShrink: 0,
			}}>
				<Box component="h1" sx={{ fontSize: 18, fontWeight: 600, color: "primary.main", m: 0 }}>
					Paimon Live
				</Box>
			</Box>

			{/* Main content — 四栏 */}
			<Box sx={{ display: "flex", flex: 1, minHeight: 0 }}>
				{/* 左栏: Stage 控制面板 */}
				<Box sx={{
					width: 240, minWidth: 200, flexShrink: 0,
					borderRight: "1px solid", borderColor: "secondary.main",
					overflowY: "auto",
				}}>
					<StageHost
						stageVisible={stageVisible}
						stageMode={stageMode}
						alwaysOnTop={alwaysOnTop}
						displayMode={displayMode}
						onShowStage={handleShowStage}
						onModeChange={handleModeChange}
						onVisibilityChange={setStageVisible}
						onAlwaysOnTopChange={setAlwaysOnTop}
						onDisplayModeChange={setDisplayMode}
					/>
				</Box>

				{/* 中间左: Stage 模型贴靠区 */}
				<Box sx={{
					width: 350, minWidth: 280, flexShrink: 0,
					borderRight: "1px solid", borderColor: "secondary.main",
				}}>
					<StageSlot
						visible={stageVisible}
						mode={stageMode}
						displayMode={displayMode}
						onRectChange={handleSlotRectChange}
					/>
				</Box>

				{/* 中间: 对话面板 */}
				<Box sx={{
					flex: 1, minWidth: 0,
					borderRight: "1px solid", borderColor: "secondary.main",
					overflowY: "auto",
				}}>
					<ChatPanel />
				</Box>

				{/* 右栏: 控制面板 */}
				<Box sx={{ width: 280, minWidth: 220, flexShrink: 0, overflowY: "auto" }}>
					<ControlPanel />
				</Box>
			</Box>

			{/* 底部状态栏 */}
			<StatusBar
				stageVisible={stageVisible}
				stageMode={stageMode}
				displayMode={displayMode}
				eventLogOpen={eventLogOpen}
				onToggleEventLog={() => setEventLogOpen((v) => !v)}
			/>

			{/* 可折叠事件日志 */}
			{eventLogOpen && (
				<Box sx={{
					height: 180, flexShrink: 0,
					borderTop: "1px solid", borderColor: "secondary.main",
					overflowY: "auto",
					bgcolor: "#0f0f23",
				}}>
					<EventLog />
				</Box>
			)}
		</Box>
	);
}
