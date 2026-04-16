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
import { broadcastControl, type StageDisplayMode, isTauriEnvironment } from "@/utils/window-sync";
import { createLogger } from "@/services/logger";
import { getServices } from "@/services";
import { useThemeMode } from "@/contexts/JoyThemeProvider";
import { useI18n } from "@/contexts/I18nProvider";

const log = createLogger("main-window");
const SettingsPanel = lazy(async () => import("@/features/settings/SettingsPanel").then((module) => ({ default: module.SettingsPanel })));
const KnowledgePanel = lazy(async () => import("@/features/knowledge/KnowledgePanel").then((module) => ({ default: module.KnowledgePanel })));
const WorkbenchPanel = lazy(async () => import("@/features/control-panel/WorkbenchPanel").then((module) => ({ default: module.WorkbenchPanel })));
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
				? (
					<WorkbenchPanel
						stageHostProps={{
							stageVisible,
							stageMode,
							alwaysOnTop,
							displayMode,
							onShowStage: handleShowStage,
							onModeChange: handleModeChange,
							onVisibilityChange: setStageVisible,
							onAlwaysOnTopChange: setAlwaysOnTop,
							onDisplayModeChange: setDisplayMode,
						}}
					/>
				)
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
				<Box component="h1" sx={{ fontSize: 18, fontWeight: 600, color: "primary.main", m: 0 }}>
					Paimon Companion Tauri
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
						variant="product"
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
				<Box
					sx={{
						width: rightPanel === "workbench" ? 420 : 280,
						minWidth: rightPanel === "workbench" ? 320 : 220,
						flexShrink: 0,
						overflowY: "auto",
						display: "flex",
						flexDirection: "column",
					}}
				>
					<Suspense fallback={<PanelLoadingState />}>
						{rightPanelContent}
					</Suspense>
				</Box>
			</Box>

			{/* 底部状态栏——始终在最底部 */}
			<StatusBar
				stageVisible={stageVisible}
				stageMode={stageMode}
				displayMode={displayMode}
			/>
		</Box>
	);
}
