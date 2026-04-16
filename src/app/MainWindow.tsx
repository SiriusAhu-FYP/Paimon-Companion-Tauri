import { Suspense, lazy, useState, useCallback, useEffect, useRef } from "react";
import { Box, Button, IconButton, Tooltip } from "@mui/material";
import SettingsIcon from "@mui/icons-material/Settings";
import LightModeIcon from "@mui/icons-material/LightMode";
import DarkModeIcon from "@mui/icons-material/DarkMode";
import AutoStoriesIcon from "@mui/icons-material/AutoStories";
import ScienceIcon from "@mui/icons-material/Science";
import TuneIcon from "@mui/icons-material/Tune";
import TranslateIcon from "@mui/icons-material/Translate";
import { listen } from "@tauri-apps/api/event";
import { LogicalPosition, LogicalSize } from "@tauri-apps/api/dpi";
import { getCurrentWindow, Window } from "@tauri-apps/api/window";
import { StageHost, StageSlot } from "@/features/stage";
import { ControlPanel } from "@/features/control-panel/ControlPanel";
import { ChatPanel } from "@/features/chat";
import { StatusBar } from "@/app/StatusBar";
import { ResizablePane } from "@/components";
import { broadcastControl, type StageDisplayMode, isTauriEnvironment } from "@/utils/window-sync";
import { createLogger } from "@/services/logger";
import { getServices } from "@/services";
import { useThemeMode } from "@/contexts/JoyThemeProvider";
import { useI18n } from "@/contexts/I18nProvider";

const log = createLogger("main-window");
const SettingsPanel = lazy(async () => import("@/features/settings/SettingsPanel").then((module) => ({ default: module.SettingsPanel })));
const KnowledgePanel = lazy(async () => import("@/features/knowledge/KnowledgePanel").then((module) => ({ default: module.KnowledgePanel })));
const WorkbenchPanel = lazy(async () => import("@/features/control-panel/WorkbenchPanel").then((module) => ({ default: module.WorkbenchPanel })));
const EventLog = lazy(async () => import("@/app/EventLog").then((module) => ({ default: module.EventLog })));
const UI_STALL_THRESHOLD_MS = 200;
const UI_STALL_THROTTLE_MS = 3000;

function PanelLoadingState() {
	const { t } = useI18n();
	return (
		<Box sx={{ p: 1.5, color: "text.secondary", fontSize: 12 }}>
			{t("加载中...", "Loading...")}
		</Box>
	);
}

export function MainWindow() {
	const { mode, setMode } = useThemeMode();
	const { locale, setLocale, t } = useI18n();
	const [stageVisible, setStageVisible] = useState(true);
	const [stageMode, setStageMode] = useState<"docked" | "floating">("docked");
	const [alwaysOnTop, setAlwaysOnTop] = useState(false);
	const [displayMode, setDisplayMode] = useState<StageDisplayMode>("clean");
	const [showStagePanel, setShowStagePanel] = useState(true);
	const [showChatPanel, setShowChatPanel] = useState(true);
	const [eventLogOpen, setEventLogOpen] = useState(false);
	const [rightPanel, setRightPanel] = useState<"companion" | "workbench" | "settings" | "knowledge">("companion");

	const slotRectRef = useRef<DOMRect | null>(null);
	const unlistenMoveRef = useRef<(() => void) | null>(null);
	const unlistenResizeRef = useRef<(() => void) | null>(null);
	const syncDebounceRef = useRef(0);
	const suspendDockedSyncRef = useRef(false);
	const stageModeRef = useRef(stageMode);
	const stageVisibleRef = useRef(stageVisible);

	stageModeRef.current = stageMode;
	stageVisibleRef.current = stageVisible;

	const syncStagePosition = useCallback(async () => {
		const rect = slotRectRef.current;
		if (!rect) return;

		try {
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
			if (!suspendDockedSyncRef.current && stageModeRef.current === "docked" && stageVisibleRef.current) {
				syncStagePosition();
			}
		});
	}, [syncStagePosition]);

	const handleSlotRectChange = useCallback((rect: DOMRect) => {
		slotRectRef.current = rect;
		debouncedSync();
	}, [debouncedSync]);

	useEffect(() => {
		if (stageMode !== "docked" || !stageVisible) return;

		const handleMouseMove = (event: MouseEvent) => {
			const rect = slotRectRef.current;
			if (!rect) return;

			const localX = event.clientX - rect.left;
			const localY = event.clientY - rect.top;
			if (localX < 0 || localY < 0 || localX > rect.width || localY > rect.height) return;

			broadcastControl({ type: "set-pointer", x: localX, y: localY });
		};

		window.addEventListener("mousemove", handleMouseMove);
		return () => window.removeEventListener("mousemove", handleMouseMove);
	}, [stageMode, stageVisible]);

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
				const mainWin = getCurrentWindow();

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

	useEffect(() => {
		const { bus } = getServices();
		let rafId = 0;
		let previousTs = performance.now();
		let lastEmittedAt = 0;
		let active = true;

		const tick = (timestamp: number) => {
			if (!active) return;
			const delta = timestamp - previousTs;
			previousTs = timestamp;

			if (delta >= UI_STALL_THRESHOLD_MS && timestamp - lastEmittedAt >= UI_STALL_THROTTLE_MS) {
				lastEmittedAt = timestamp;
				bus.emit("system:ui-stall", {
					durationMs: delta,
					thresholdMs: UI_STALL_THRESHOLD_MS,
				});
			}

			rafId = requestAnimationFrame(tick);
		};

		rafId = requestAnimationFrame(tick);
		return () => {
			active = false;
			if (rafId) cancelAnimationFrame(rafId);
		};
	}, []);

	const handleModeChange = useCallback(async (mode: "docked" | "floating") => {
		setStageMode(mode);
	}, []);

	const showSlot = stageVisible && stageMode === "docked";
	const rightPanelContent = rightPanel === "settings"
		? <SettingsPanel onClose={() => setRightPanel("companion")} />
		: rightPanel === "knowledge"
			? <KnowledgePanel onClose={() => setRightPanel("companion")} />
			: rightPanel === "workbench"
				? <WorkbenchPanel />
				: <ControlPanel />;

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
				<Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
					<Box component="h1" sx={{ fontSize: 18, fontWeight: 600, color: "primary.main", m: 0 }}>
						Paimon Companion Tauri
					</Box>
					<Button
						size="small"
						variant={showStagePanel ? "contained" : "outlined"}
						onClick={() => setShowStagePanel((current) => !current)}
						sx={{ minWidth: 0, px: 1.25, py: 0.35, fontSize: 11, lineHeight: 1 }}
					>
						{t("舞台", "Stage")}
					</Button>
					<Button
						size="small"
						variant={showChatPanel ? "contained" : "outlined"}
						onClick={() => setShowChatPanel((current) => !current)}
						sx={{ minWidth: 0, px: 1.25, py: 0.35, fontSize: 11, lineHeight: 1 }}
					>
						{t("对话", "Chat")}
					</Button>
				</Box>
				<Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
					<Tooltip title={t("切换语言", "Switch language")}>
						<Button
							size="small"
							variant="outlined"
							startIcon={<TranslateIcon sx={{ fontSize: 14 }} />}
							onClick={() => setLocale(locale === "zh" ? "en" : "zh")}
							sx={{
								minWidth: 0,
								px: 1,
								py: 0.35,
								fontSize: 11,
								lineHeight: 1,
								mr: 0.5,
							}}
						>
							{locale === "zh" ? "EN" : "中文"}
						</Button>
					</Tooltip>
					<Tooltip title={mode === "dark" ? t("切换亮色", "Switch to light mode") : t("切换暗色", "Switch to dark mode")}>
						<IconButton
							size="small"
							onClick={() => setMode(mode === "dark" ? "light" : "dark")}
							sx={{ color: "text.secondary" }}
						>
							{mode === "dark" ? <LightModeIcon fontSize="small" /> : <DarkModeIcon fontSize="small" />}
						</IconButton>
					</Tooltip>
					<Tooltip title={t("控制面板", "Control Panel")}>
						<IconButton
							size="small"
							onClick={() => setRightPanel("companion")}
							sx={{ color: rightPanel === "companion" ? "primary.main" : "text.secondary" }}
						>
							<TuneIcon fontSize="small" />
						</IconButton>
					</Tooltip>
					<Tooltip title={t("知识库", "Knowledge")}>
						<IconButton
							size="small"
							onClick={() => setRightPanel("knowledge")}
							sx={{ color: rightPanel === "knowledge" ? "primary.main" : "text.secondary" }}
						>
							<AutoStoriesIcon fontSize="small" />
						</IconButton>
					</Tooltip>
					<Tooltip title={t("开发工作台", "Developer Workbench")}>
						<IconButton
							size="small"
							onClick={() => setRightPanel("workbench")}
							sx={{ color: rightPanel === "workbench" ? "primary.main" : "text.secondary" }}
						>
							<ScienceIcon fontSize="small" />
						</IconButton>
					</Tooltip>
					<Tooltip title={t("设置", "Settings")}>
						<IconButton
							size="small"
							onClick={() => setRightPanel("settings")}
							sx={{ color: rightPanel === "settings" ? "primary.main" : "text.secondary" }}
						>
							<SettingsIcon fontSize="small" />
						</IconButton>
					</Tooltip>
				</Box>
			</Box>

			{/* Main content */}
			<Box sx={{ display: "flex", flex: 1, minHeight: 0, overflow: "hidden" }}>
				{/* 左栏: Stage 控制面板 */}
				{showStagePanel && (
					<ResizablePane
						axis="x"
						storageKey="stage-panel-width"
						initialSize={240}
						minSize={200}
						maxSize={360}
						handlePlacement="end"
						className="resizable-pane resizable-pane-horizontal"
						handleClassName="resizable-pane-handle resizable-pane-handle-horizontal"
						style={{
							flexShrink: 0,
							borderRight: "1px solid var(--mui-palette-secondary-main, rgba(255,255,255,0.12))",
							overflow: "hidden",
						}}
					>
						<Box sx={{ height: "100%", overflowY: "auto" }}>
							<StageHost
								stageVisible={stageVisible}
								stageMode={stageMode}
								alwaysOnTop={alwaysOnTop}
								displayMode={displayMode}
								variant="developer"
								onShowStage={handleShowStage}
								onModeChange={handleModeChange}
								onVisibilityChange={setStageVisible}
								onAlwaysOnTopChange={setAlwaysOnTop}
								onDisplayModeChange={setDisplayMode}
							/>
						</Box>
					</ResizablePane>
				)}

				{/* 中间左: Stage 模型贴靠区（仅 docked + visible 时显示） */}
				{showSlot && (
					<ResizablePane
						axis="x"
						storageKey="stage-slot-width"
						initialSize={350}
						minSize={260}
						maxSize={640}
						handlePlacement="end"
						className="resizable-pane resizable-pane-horizontal"
						handleClassName="resizable-pane-handle resizable-pane-handle-horizontal"
						style={{
							flexShrink: 0,
							borderRight: "1px solid var(--mui-palette-secondary-main, rgba(255,255,255,0.12))",
							overflow: "hidden",
						}}
					>
						<StageSlot
							visible={stageVisible}
							mode={stageMode}
							displayMode={displayMode}
							onRectChange={handleSlotRectChange}
						/>
					</ResizablePane>
				)}

				{/* 中间: 对话面板 */}
				{showChatPanel && (
					<ResizablePane
						axis="x"
						storageKey="chat-panel-width"
						initialSize={560}
						minSize={360}
						maxSize={960}
						handlePlacement="end"
						className="resizable-pane resizable-pane-horizontal"
						handleClassName="resizable-pane-handle resizable-pane-handle-horizontal"
						style={{
							flex: "1 1 auto",
							minWidth: 0,
							borderRight: "1px solid var(--mui-palette-secondary-main, rgba(255,255,255,0.12))",
							overflow: "hidden",
						}}
					>
						<Box sx={{ height: "100%", overflowY: "auto" }}>
							<ChatPanel />
						</Box>
					</ResizablePane>
				)}

				{/* 右栏: 控制面板 / 设置 / 知识库 */}
				<ResizablePane
					axis="x"
					storageKey="right-panel-width"
					initialSize={rightPanel === "workbench" ? 420 : 280}
					minSize={240}
					maxSize={640}
					handlePlacement="start"
					className="resizable-pane resizable-pane-horizontal"
					handleClassName="resizable-pane-handle resizable-pane-handle-horizontal"
					style={{
						flexShrink: 0,
						overflow: "hidden",
					}}
				>
					<Box sx={{ height: "100%", overflowY: "auto", display: "flex", flexDirection: "column" }}>
						<Suspense fallback={<PanelLoadingState />}>
							{rightPanelContent}
						</Suspense>
					</Box>
				</ResizablePane>
			</Box>

			{eventLogOpen && (
				<ResizablePane
					axis="y"
					storageKey="event-log-height"
					initialSize={260}
					minSize={180}
					maxSize={520}
					handlePlacement="start"
					className="resizable-pane resizable-pane-vertical"
					handleClassName="resizable-pane-handle resizable-pane-handle-vertical"
					style={{
						flexShrink: 0,
						borderTop: "1px solid var(--mui-palette-secondary-main, rgba(255,255,255,0.12))",
						background: "var(--mui-palette-background-default, transparent)",
						overflow: "hidden",
					}}
					onResizeStart={() => {
						suspendDockedSyncRef.current = true;
					}}
					onResizeEnd={() => {
						suspendDockedSyncRef.current = false;
						debouncedSync();
					}}
				>
					<Suspense fallback={<PanelLoadingState />}>
						<EventLog />
					</Suspense>
				</ResizablePane>
			)}

			{/* 底部状态栏——始终在最底部 */}
			<StatusBar
				stageVisible={stageVisible}
				stageMode={stageMode}
				displayMode={displayMode}
				eventLogOpen={eventLogOpen}
				onToggleEventLog={() => setEventLogOpen((current) => !current)}
			/>
		</Box>
	);
}
