import { useState, useCallback, useEffect, useRef } from "react";
import { Box, IconButton, Tooltip } from "@mui/material";
import SettingsIcon from "@mui/icons-material/Settings";
import LightModeIcon from "@mui/icons-material/LightMode";
import DarkModeIcon from "@mui/icons-material/DarkMode";
import AutoStoriesIcon from "@mui/icons-material/AutoStories";
import { StageHost, StageSlot } from "@/features/stage";
import { ControlPanel } from "@/features/control-panel";
import { SettingsPanel } from "@/features/settings";
import { KnowledgePanel } from "@/features/knowledge";
import { ChatPanel } from "@/features/chat";
import { EventLog } from "@/app/EventLog";
import { StatusBar } from "@/app/StatusBar";
import { type StageDisplayMode, isTauriEnvironment } from "@/utils/window-sync";
import { createLogger } from "@/services/logger";
import { useThemeMode } from "@/contexts/JoyThemeProvider";

const log = createLogger("main-window");

export function MainWindow() {
	const { mode, setMode } = useThemeMode();
	const [stageVisible, setStageVisible] = useState(true);
	const [stageMode, setStageMode] = useState<"docked" | "floating">("docked");
	const [alwaysOnTop, setAlwaysOnTop] = useState(false);
	const [displayMode, setDisplayMode] = useState<StageDisplayMode>("clean");
	const [eventLogOpen, setEventLogOpen] = useState(false);
	const [showSettings, setShowSettings] = useState(false);
	const [showKnowledge, setShowKnowledge] = useState(false);

	const slotRectRef = useRef<DOMRect | null>(null);
	const unlistenMoveRef = useRef<(() => void) | null>(null);
	const unlistenResizeRef = useRef<(() => void) | null>(null);
	const syncDebounceRef = useRef(0);
	const stageModeRef = useRef(stageMode);
	const stageVisibleRef = useRef(stageVisible);

	stageModeRef.current = stageMode;
	stageVisibleRef.current = stageVisible;

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

	const debouncedSync = useCallback(() => {
		if (syncDebounceRef.current) cancelAnimationFrame(syncDebounceRef.current);
		syncDebounceRef.current = requestAnimationFrame(() => {
			syncDebounceRef.current = 0;
			if (stageModeRef.current === "docked" && stageVisibleRef.current) {
				syncStagePosition();
			}
		});
	}, [syncStagePosition]);

	const handleSlotRectChange = useCallback((rect: DOMRect) => {
		slotRectRef.current = rect;
		debouncedSync();
	}, [debouncedSync]);

	// docked 跟随主窗口 move/resize
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
			if (!isTauriEnvironment()) return;

			try {
				const { getCurrentWindow } = await import("@tauri-apps/api/window");
				const mainWin = getCurrentWindow();
				const { listen } = await import("@tauri-apps/api/event");

				if (cancelled) return;

				const unMove = await listen("tauri://move", () => {
					if (mainWin.label === "main") debouncedSync();
				});
				const unResize = await listen("tauri://resize", () => {
					if (mainWin.label === "main") debouncedSync();
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
	}, [stageMode, stageVisible, syncStagePosition, debouncedSync]);

	const handleShowStage = useCallback(async () => {
		try {
			const { Window } = await import("@tauri-apps/api/window");
			const { broadcastControl } = await import("@/utils/window-sync");
			const stageWin = await Window.getByLabel("stage");
			if (stageWin) {
				broadcastControl({ type: "show-stage" });
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

	// Tauri 环境下自动启动 Stage（clean + docked 默认展示 L2D）
	useEffect(() => {
		if (!isTauriEnvironment()) return;
		handleShowStage();
	}, [handleShowStage]);

	const handleModeChange = useCallback(async (mode: "docked" | "floating") => {
		setStageMode(mode);
	}, []);

	const showSlot = stageVisible && stageMode === "docked";

	return (
		<Box sx={{ display: "flex", flexDirection: "column", height: "100vh", overflow: "hidden" }}>
			{/* Header */}
			<Box sx={{
				px: 2, py: 1,
				bgcolor: "background.paper",
				borderBottom: "1px solid",
				borderColor: "secondary.main",
				flexShrink: 0,
				display: "flex",
				alignItems: "center",
				justifyContent: "space-between",
			}}>
				<Box component="h1" sx={{ fontSize: 18, fontWeight: 600, color: "primary.main", m: 0 }}>
					Paimon Companion Tauri
				</Box>
				<Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
					<Tooltip title={mode === "dark" ? "切换亮色" : "切换暗色"}>
						<IconButton
							size="small"
							onClick={() => setMode(mode === "dark" ? "light" : "dark")}
							sx={{ color: "text.secondary" }}
						>
							{mode === "dark" ? <LightModeIcon fontSize="small" /> : <DarkModeIcon fontSize="small" />}
						</IconButton>
					</Tooltip>
					<Tooltip title="知识库">
						<IconButton
							size="small"
							onClick={() => { setShowKnowledge(true); setShowSettings(false); }}
							sx={{ color: showKnowledge ? "primary.main" : "text.secondary" }}
						>
							<AutoStoriesIcon fontSize="small" />
						</IconButton>
					</Tooltip>
					<Tooltip title="设置">
						<IconButton
							size="small"
							onClick={() => { setShowSettings(true); setShowKnowledge(false); }}
							sx={{ color: showSettings ? "primary.main" : "text.secondary" }}
						>
							<SettingsIcon fontSize="small" />
						</IconButton>
					</Tooltip>
				</Box>
			</Box>

			{/* Main content */}
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

				{/* 中间左: Stage 模型贴靠区（仅 docked + visible 时显示） */}
				{showSlot && (
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
				)}

				{/* 中间: 对话面板 */}
				<Box sx={{
					flex: 1, minWidth: 0,
					borderRight: "1px solid", borderColor: "secondary.main",
					overflowY: "auto",
				}}>
					<ChatPanel />
				</Box>

				{/* 右栏: 控制面板 / 设置 / 知识库 */}
				<Box sx={{ width: 280, minWidth: 220, flexShrink: 0, overflowY: "auto", display: "flex", flexDirection: "column" }}>
					{showSettings ? (
						<SettingsPanel onClose={() => setShowSettings(false)} />
					) : showKnowledge ? (
						<KnowledgePanel onClose={() => setShowKnowledge(false)} />
					) : (
						<ControlPanel />
					)}
				</Box>
			</Box>

			{/* 可折叠事件日志（在状态栏上方） */}
			{eventLogOpen && (
				<Box sx={{
					height: 180, flexShrink: 0,
					borderTop: "1px solid", borderColor: "secondary.main",
					overflowY: "auto",
					bgcolor: "background.default",
				}}>
					<EventLog />
				</Box>
			)}

			{/* 底部状态栏——始终在最底部 */}
			<StatusBar
				stageVisible={stageVisible}
				stageMode={stageMode}
				displayMode={displayMode}
				eventLogOpen={eventLogOpen}
				onToggleEventLog={() => setEventLogOpen((v) => !v)}
			/>
		</Box>
	);
}
