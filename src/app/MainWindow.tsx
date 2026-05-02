import { useState, useCallback, useEffect, useRef } from "react";
import { Box, Button, IconButton, Menu, MenuItem, Tooltip } from "@mui/material";
import DashboardCustomizeIcon from "@mui/icons-material/DashboardCustomize";
import ViewQuiltIcon from "@mui/icons-material/ViewQuilt";
import CheckIcon from "@mui/icons-material/Check";
import PushPinIcon from "@mui/icons-material/PushPin";
import LightModeIcon from "@mui/icons-material/LightMode";
import DarkModeIcon from "@mui/icons-material/DarkMode";
import TranslateIcon from "@mui/icons-material/Translate";
import { Window, getCurrentWindow } from "@tauri-apps/api/window";
import { LogicalPosition, LogicalSize } from "@tauri-apps/api/dpi";
import { StatusBar } from "@/app/StatusBar";
import { getStoredOpenDockPanels, type DockPanelId } from "@/app/workspace/workspace-layout";
import { DockWorkspace } from "@/app/workspace/DockWorkspace";
import { requestCloseWorkspacePanel, requestOpenWorkspacePanel, requestResetWorkspaceLayout, subscribeWorkspaceLayoutChanged } from "@/app/workspace/WorkspaceContext";
import { broadcastControl, type StageDisplayMode, isTauriEnvironment } from "@/utils/window-sync";
import { createLogger } from "@/services/logger";
import { getServices } from "@/services";
import { useThemeMode } from "@/contexts/JoyThemeProvider";
import { useI18n } from "@/contexts/I18nProvider";

const log = createLogger("main-window");
const UI_STALL_THRESHOLD_MS = 200;
const UI_STALL_THROTTLE_MS = 3000;

interface PanelMenuItem {
	id: DockPanelId;
	label: string;
	fixed?: boolean;
}

export function MainWindow() {
	const { mode, setMode } = useThemeMode();
	const { locale, setLocale, t } = useI18n();
	const [stageVisible, setStageVisible] = useState(true);
	const [stageMode, setStageMode] = useState<"docked" | "floating">("floating");
	const [alwaysOnTop, setAlwaysOnTop] = useState(false);
	const [displayMode, setDisplayMode] = useState<StageDisplayMode>("static");
	const [stageSlotOpen, setStageSlotOpen] = useState(false);
	const [stageSlotRect, setStageSlotRect] = useState<DOMRect | null>(null);
	const [panelsMenuAnchor, setPanelsMenuAnchor] = useState<null | HTMLElement>(null);
	const [openPanelsSnapshot, setOpenPanelsSnapshot] = useState<Set<DockPanelId>>(() => getStoredOpenDockPanels());
	const stageModeRef = useRef(stageMode);
	const stageVisibleRef = useRef(stageVisible);
	const syncDebounceRef = useRef(0);
	const lastDockedBoundsRef = useRef<{ x: number; y: number; width: number; height: number } | null>(null);

	stageModeRef.current = stageMode;
	stageVisibleRef.current = stageVisible;

	const handleShowStage = useCallback(async () => {
		try {
			const stageWin = await Window.getByLabel("stage");
			if (stageWin) {
				broadcastControl({ type: "show-stage" });
				broadcastControl({ type: "set-mode", mode: stageMode });
				await stageWin.show();
				await stageWin.setFocus();
				setStageVisible(true);
			}
		} catch (err) {
			log.error("show stage failed", err);
		}
	}, [stageMode]);

	useEffect(() => {
		if (!isTauriEnvironment()) return;
		handleShowStage();
	}, [handleShowStage]);

	const syncDockedStageBounds = useCallback(async (
		rectOverride?: DOMRect | null,
		options?: { force?: boolean },
	) => {
		const rect = rectOverride ?? stageSlotRect;
		if (!isTauriEnvironment() || stageMode !== "docked" || !rect) return;

		try {
			const mainWin = await Window.getByLabel("main");
			const stageWin = await Window.getByLabel("stage");
			if (!mainWin || !stageWin) return;

			const outerPosition = await mainWin.outerPosition();
			const innerPosition = await mainWin.innerPosition();
			const scaleFactor = await mainWin.scaleFactor();
			const outerLogicalPosition = outerPosition.toLogical(scaleFactor);
			const innerLogicalPosition = innerPosition.toLogical(scaleFactor);
			const contentOffsetX = innerLogicalPosition.x - outerLogicalPosition.x;
			const contentOffsetY = innerLogicalPosition.y - outerLogicalPosition.y;
			const nextBounds = {
				x: outerLogicalPosition.x + contentOffsetX + rect.left,
				y: outerLogicalPosition.y + contentOffsetY + rect.top,
				width: rect.width,
				height: rect.height,
			};
			const previousBounds = lastDockedBoundsRef.current;
			const stageScaleFactor = await stageWin.scaleFactor();
			const stageOuterPosition = await stageWin.outerPosition();
			const stageInnerSize = await stageWin.innerSize();
			const actualBounds = {
				x: stageOuterPosition.toLogical(stageScaleFactor).x,
				y: stageOuterPosition.toLogical(stageScaleFactor).y,
				width: stageInnerSize.toLogical(stageScaleFactor).width,
				height: stageInnerSize.toLogical(stageScaleFactor).height,
			};
			const desiredBoundsUnchanged = previousBounds
				&& Math.abs(previousBounds.x - nextBounds.x) < 0.5
				&& Math.abs(previousBounds.y - nextBounds.y) < 0.5
				&& Math.abs(previousBounds.width - nextBounds.width) < 0.5
				&& Math.abs(previousBounds.height - nextBounds.height) < 0.5;
			const actualBoundsMatch = Math.abs(actualBounds.x - nextBounds.x) < 0.5
				&& Math.abs(actualBounds.y - nextBounds.y) < 0.5
				&& Math.abs(actualBounds.width - nextBounds.width) < 0.5
				&& Math.abs(actualBounds.height - nextBounds.height) < 0.5;

			if (!options?.force && desiredBoundsUnchanged && actualBoundsMatch) {
				return;
			}

			if (
				options?.force
				|| !actualBoundsMatch
				|| Math.abs(actualBounds.x - nextBounds.x) >= 0.5
				|| Math.abs(actualBounds.y - nextBounds.y) >= 0.5
			) {
				await stageWin.setPosition(new LogicalPosition(nextBounds.x, nextBounds.y));
			}

			if (
				rect.width > 50
				&& rect.height > 50
				&& (
					options?.force
					|| !actualBoundsMatch
					|| Math.abs(actualBounds.width - nextBounds.width) >= 0.5
					|| Math.abs(actualBounds.height - nextBounds.height) >= 0.5
				)
			) {
				await stageWin.setSize(new LogicalSize(nextBounds.width, nextBounds.height));
			}

			lastDockedBoundsRef.current = nextBounds;
		} catch (err) {
			log.warn("sync docked stage bounds failed", err);
		}
	}, [stageMode, stageSlotRect]);

	const debouncedSyncDockedStageBounds = useCallback((rectOverride?: DOMRect | null, force = false) => {
		if (syncDebounceRef.current) {
			cancelAnimationFrame(syncDebounceRef.current);
		}

		syncDebounceRef.current = requestAnimationFrame(() => {
			syncDebounceRef.current = 0;
			if (stageModeRef.current === "docked" && stageVisibleRef.current) {
				void syncDockedStageBounds(rectOverride, { force });
			}
		});
	}, [syncDockedStageBounds]);

	const handleStageSlotRectChange = useCallback((rect: DOMRect | null) => {
		setStageSlotRect((current) => {
			if (!rect && !current) {
				return current;
			}
			if (
				rect
				&& current
				&& Math.abs(current.left - rect.left) < 0.5
				&& Math.abs(current.top - rect.top) < 0.5
				&& Math.abs(current.width - rect.width) < 0.5
				&& Math.abs(current.height - rect.height) < 0.5
			) {
				return current;
			}
			return rect;
		});
		if (rect) {
			debouncedSyncDockedStageBounds(rect, true);
		}
	}, [debouncedSyncDockedStageBounds]);

	const handleRedockStage = useCallback(() => {
		debouncedSyncDockedStageBounds(stageSlotRect, true);
	}, [debouncedSyncDockedStageBounds, stageSlotRect]);

	useEffect(() => {
		const nextMode = stageSlotOpen ? "docked" : "floating";
		broadcastControl({ type: "set-mode", mode: nextMode });
		setStageMode((current) => {
			if (current === nextMode) return current;
			return nextMode;
		});
		if (nextMode === "docked") {
			debouncedSyncDockedStageBounds(stageSlotRect, true);
		}
	}, [stageSlotOpen, debouncedSyncDockedStageBounds, stageSlotRect]);

	useEffect(() => {
		if (stageMode !== "docked") {
			lastDockedBoundsRef.current = null;
		}
	}, [stageMode]);

	useEffect(() => {
		if (stageMode !== "docked") return;
		void syncDockedStageBounds(undefined, { force: true });
	}, [stageMode, stageSlotRect, stageVisible, syncDockedStageBounds]);

	useEffect(() => {
		if (!isTauriEnvironment() || !stageSlotOpen) return;

		let unlistenMove: (() => void) | null = null;
		let unlistenResize: (() => void) | null = null;
		let disposed = false;

		(async () => {
			try {
				const currentWin = getCurrentWindow();
				unlistenMove = await currentWin.onMoved(() => {
					debouncedSyncDockedStageBounds();
				});
				unlistenResize = await currentWin.onResized(() => {
					debouncedSyncDockedStageBounds();
				});
			} catch (err) {
				if (!disposed) {
					log.warn("subscribe main window dock listeners failed", err);
				}
			}
		})();

		return () => {
			disposed = true;
			unlistenMove?.();
			unlistenResize?.();
		};
	}, [stageSlotOpen, debouncedSyncDockedStageBounds]);

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

	const handleOpenPanel = useCallback((panelId: Parameters<typeof requestOpenWorkspacePanel>[0]) => {
		requestOpenWorkspacePanel(panelId);
	}, []);

	const handleResetLayout = useCallback(() => {
		requestResetWorkspaceLayout();
	}, []);

	const closePanelsMenu = useCallback(() => setPanelsMenuAnchor(null), []);
	const panelMenuItems: readonly PanelMenuItem[] = [
		{ id: "control-panel", label: t("控制面板", "Control Panel"), fixed: true },
		{ id: "stage-controls", label: t("舞台面板", "Stage Panel") },
		{ id: "delegation-timeline", label: t("托管时间轴", "Delegation Timeline") },
		{ id: "chat", label: t("对话", "Chat") },
		{ id: "knowledge", label: t("知识库", "Knowledge") },
		{ id: "workbench", label: t("开发工作台", "Workbench") },
		{ id: "settings", label: t("设置", "Settings") },
		{ id: "event-log", label: t("日志", "Event Log") },
	] as const;

	useEffect(() => {
		const syncSnapshot = () => setOpenPanelsSnapshot(getStoredOpenDockPanels());
		return subscribeWorkspaceLayoutChanged(syncSnapshot);
	}, []);

	return (
		<Box sx={{ display: "flex", flexDirection: "column", height: "100vh", overflow: "hidden" }}>
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
				<Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
					<Button
						size="small"
						startIcon={<DashboardCustomizeIcon sx={{ fontSize: 15 }} />}
						onClick={(event) => {
							setOpenPanelsSnapshot(getStoredOpenDockPanels());
							setPanelsMenuAnchor(event.currentTarget);
						}}
						sx={{ minWidth: 0, px: 1.25, fontSize: 12, textTransform: "none", color: "text.secondary" }}
					>
						{t("面板", "Panels")}
					</Button>
					<Button
						size="small"
						startIcon={<ViewQuiltIcon sx={{ fontSize: 15 }} />}
						onClick={handleResetLayout}
						sx={{ minWidth: 0, px: 1.25, fontSize: 12, textTransform: "none", color: "text.secondary" }}
					>
						{t("重置布局", "Reset Layout")}
					</Button>
				</Box>
				<Box sx={{ flex: 1, alignSelf: "stretch" }} data-tauri-drag-region />
				<Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
					<Tooltip title={t("切换语言", "Switch language")}>
						<IconButton
							size="small"
							onClick={() => setLocale(locale === "zh" ? "en" : "zh")}
							sx={{
								color: "text.secondary",
								position: "relative",
							}}
						>
							<TranslateIcon fontSize="small" />
							<Box
								component="span"
								sx={{
									position: "absolute",
									right: 2,
									bottom: 1,
									fontSize: 8,
									lineHeight: 1,
									fontWeight: 700,
									color: "primary.main",
								}}
							>
								{locale === "zh" ? "EN" : "中"}
							</Box>
						</IconButton>
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
				</Box>
			</Box>

			<Menu
				anchorEl={panelsMenuAnchor}
				open={Boolean(panelsMenuAnchor)}
				onClose={closePanelsMenu}
				slotProps={{ paper: { onMouseLeave: closePanelsMenu } }}
			>
				{panelMenuItems.map((panel) => {
					const isOpen = openPanelsSnapshot.has(panel.id);
					return (
						<MenuItem key={panel.id} onClick={() => {
							if (panel.fixed) {
								return;
							}
							if (isOpen) {
								requestCloseWorkspacePanel(panel.id);
								setOpenPanelsSnapshot((current) => {
									const next = new Set(current);
									next.delete(panel.id);
									return next;
								});
							} else {
								handleOpenPanel(panel.id);
								setOpenPanelsSnapshot((current) => {
									const next = new Set(current);
									next.add(panel.id);
									return next;
								});
							}
						}}>
							<Box sx={{ width: 18, display: "inline-flex", alignItems: "center", justifyContent: "center", mr: 0.75, color: panel.fixed ? "warning.main" : "primary.main" }}>
								{panel.fixed
									? <PushPinIcon sx={{ fontSize: 15 }} />
									: isOpen ? <CheckIcon sx={{ fontSize: 16 }} /> : null}
							</Box>
							<span>{panel.label}</span>
						</MenuItem>
					);
				})}
			</Menu>

			<DockWorkspace
				stageVisible={stageVisible}
				stageMode={stageMode}
				alwaysOnTop={alwaysOnTop}
				displayMode={displayMode}
				onShowStage={handleShowStage}
				onVisibilityChange={setStageVisible}
				onAlwaysOnTopChange={setAlwaysOnTop}
				onDisplayModeChange={setDisplayMode}
				onResetDockedStage={handleRedockStage}
				onStageSlotOpenChange={setStageSlotOpen}
				onStageSlotRectChange={handleStageSlotRectChange}
			/>

			<StatusBar
				stageVisible={stageVisible}
				stageMode={stageMode}
				displayMode={displayMode}
			/>
		</Box>
	);
}
