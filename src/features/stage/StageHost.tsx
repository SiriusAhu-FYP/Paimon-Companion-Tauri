import { useCallback, useEffect, useState } from "react";
import {
	Box, Button, ButtonGroup, Typography, Stack, Divider, Tooltip,
	Select, MenuItem, FormControl,
} from "@mui/material";
import type { SelectChangeEvent } from "@mui/material";
import LockIcon from "@mui/icons-material/Lock";
import LockOpenIcon from "@mui/icons-material/LockOpen";
import VisibilityIcon from "@mui/icons-material/Visibility";
import VisibilityOffIcon from "@mui/icons-material/VisibilityOff";
import RestartAltIcon from "@mui/icons-material/RestartAlt";
import CloseIcon from "@mui/icons-material/Close";
import { HelpTooltip } from "@/components";
import { MODEL_REGISTRY, DEFAULT_MODEL } from "@/features/live2d";
import { getServices } from "@/services";
import {
	broadcastControl, onControlCommand,
	type StageDisplayMode, type ControlCommand, type EyeMode,
} from "@/utils/window-sync";
import { requestCloseWorkspacePanel, requestOpenWorkspacePanel } from "@/app/workspace/WorkspaceContext";
import {
	loadScaleLock, saveScaleLock,
} from "@/utils/stage-storage";
import { createLogger } from "@/services/logger";
import { useI18n } from "@/contexts/I18nProvider";

const log = createLogger("stage-host");

function getRegistryExpressions(modelPath: string): string[] {
	return MODEL_REGISTRY.find((model) => model.path === modelPath)?.expressionNames ?? [];
}

interface StageHostProps {
	onShowStage: () => void;
	stageVisible: boolean;
	stageMode: "docked" | "floating";
	alwaysOnTop: boolean;
	displayMode: StageDisplayMode;
	variant?: "product" | "developer";
	onVisibilityChange: (visible: boolean) => void;
	onAlwaysOnTopChange: (value: boolean) => void;
	onDisplayModeChange: (mode: StageDisplayMode) => void;
}

export function StageHost({
	onShowStage,
	stageVisible,
	stageMode,
	displayMode,
	variant = "developer",
	onVisibilityChange,
	onAlwaysOnTopChange,
	onDisplayModeChange,
}: StageHostProps) {
	const { t } = useI18n();
	const { character } = getServices();
	const [scaleLocked, setScaleLocked] = useState(loadScaleLock);
	const [eyeMode, setEyeMode] = useState<EyeMode>("random-path");

	// 模型 / 表情控制（从 ControlPanel 迁移至此）
	const [selectedModel, setSelectedModel] = useState(DEFAULT_MODEL.path);
	const [expressions, setExpressions] = useState<string[]>([]);

	// 监听 Stage 侧的 sync-state 和 report-expressions
	useEffect(() => {
		let cleanup: (() => void) | null = null;
		onControlCommand((cmd: ControlCommand) => {
			if (cmd.type === "sync-state") {
				onAlwaysOnTopChange(cmd.state.alwaysOnTop);
				onDisplayModeChange(cmd.state.displayMode);
				if (cmd.state.visible !== stageVisible) {
					onVisibilityChange(cmd.state.visible);
				}
			}
			if (cmd.type === "report-expressions") {
				setExpressions(cmd.expressions);
				log.info(`received ${cmd.expressions.length} expressions from stage`);
			}
		}).then((unsub) => {
			cleanup = unsub;
			broadcastControl({ type: "request-expressions" });
		});
		return () => { cleanup?.(); };
	}, []);

	const handleModelChange = useCallback((event: SelectChangeEvent) => {
		const path = event.target.value;
		setSelectedModel(path);
		setExpressions(getRegistryExpressions(path));
		character.setActiveModel(path);
		broadcastControl({ type: "set-model", modelPath: path });
	}, [character]);

	useEffect(() => {
		setExpressions((current) => (current.length > 0 ? current : getRegistryExpressions(selectedModel)));
	}, [selectedModel]);

	useEffect(() => {
		character.setActiveModel(selectedModel);
	}, [character, selectedModel]);

	const handleExpression = useCallback((name: string) => {
		broadcastControl({ type: "set-expression", expressionName: name });
	}, []);

	const handleClose = useCallback(() => {
		broadcastControl({ type: "hide-stage" });
		onVisibilityChange(false);
	}, [onVisibilityChange]);

	const handleReset = useCallback(() => {
		broadcastControl({ type: "reset-position" });
	}, []);

	const handleToggleAttachStage = useCallback(() => {
		if (stageMode === "docked") {
			requestCloseWorkspacePanel("stage-slot");
			return;
		}

		requestOpenWorkspacePanel("stage-slot");
		if (!stageVisible) {
			onShowStage();
		}
	}, [onShowStage, stageMode, stageVisible]);

	const handleToggleDisplayMode = useCallback(() => {
		const next: StageDisplayMode = displayMode === "interactive" ? "static" : "interactive";
		onDisplayModeChange(next);
		broadcastControl({ type: "set-display-mode", displayMode: next });
	}, [displayMode, onDisplayModeChange]);

	// 透明穿透：窗口完全透明且不可点击，但 Live2D 仍在渲染（仍可被窗口捕获）
	const [passthrough, setPassthrough] = useState(false);
	const handleTogglePassthrough = useCallback(() => {
		const next = !passthrough;
		setPassthrough(next);
		broadcastControl({ type: "set-passthrough", enabled: next });
	}, [passthrough]);

	const handleToggleScaleLock = useCallback(() => {
		const next = !scaleLocked;
		setScaleLocked(next);
		saveScaleLock(next);
		broadcastControl({ type: "set-scale-lock", locked: next });
	}, [scaleLocked]);

	const handleSetEyeMode = useCallback((mode: EyeMode) => {
		setEyeMode(mode);
		broadcastControl({ type: "set-eye-mode", mode });
	}, []);

	const showAdvancedControls = variant === "developer";

	const EYE_MODES: { mode: EyeMode; label: string }[] = [
		{ mode: "fixed", label: t("静止", "Fixed") },
		{ mode: "follow-mouse", label: t("跟随", "Follow") },
		{ mode: "random-path", label: t("随机", "Random") },
	];

	return (
		<Box sx={{ display: "flex", flexDirection: "column", height: "100%", p: 1.5, gap: 1 }}>
			<Typography variant="subtitle2" sx={{ color: "primary.main", fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5 }}>
				{t("舞台", "Stage")}
			</Typography>

			{showAdvancedControls && (
				<>
					<Box>
						<Stack direction="row" alignItems="center" sx={{ mb: 0.5 }}>
							<Typography variant="caption" color="text.secondary" fontWeight={600}>{t("模型", "Model")}</Typography>
							<HelpTooltip title={t("切换 Live2D 模型。切换后 Stage 窗口会重新加载", "Switch the Live2D model. The Stage window reloads after switching.")} />
						</Stack>
						<FormControl size="small" fullWidth>
							<Select
								value={selectedModel}
								onChange={handleModelChange}
								sx={{ fontSize: 12 }}
							>
								{MODEL_REGISTRY.map((m) => (
									<MenuItem key={m.path} value={m.path} sx={{ fontSize: 12 }}>
										{m.name}
									</MenuItem>
								))}
							</Select>
						</FormControl>
					</Box>

					{expressions.length > 0 && (
						<Box>
							<Stack direction="row" alignItems="center" sx={{ mb: 0.5 }}>
								<Typography variant="caption" color="text.secondary" fontWeight={600}>{t("表情", "Expressions")}</Typography>
								<HelpTooltip title={t("模型自带的表情文件。点击后 Stage 中的模型会切换表情", "Built-in model expressions. Click to switch the model expression in Stage.")} />
							</Stack>
							<Box sx={{
								display: "flex",
								flexWrap: "wrap",
								gap: 0.5,
								maxHeight: 80,
								overflowY: "auto",
								p: 0.5,
								bgcolor: "background.paper",
								borderRadius: 1,
							}}>
								{expressions.map((e) => (
									<Button
										key={e}
										size="small"
										variant="outlined"
										onClick={() => handleExpression(e)}
										sx={{ fontSize: 10, px: 1, py: 0.25, minWidth: 0, textTransform: "none" }}
									>
										{e}
									</Button>
								))}
							</Box>
						</Box>
					)}

					<Divider />
				</>
			)}

			{/* 窗口控制 */}
			<Box>
				<Stack direction="row" alignItems="center" sx={{ mb: 0.5 }}>
					<Typography variant="caption" color="text.secondary" fontWeight={600}>{t("窗口", "Window")}</Typography>
					<HelpTooltip title={t("控制 Stage 播出窗口的显示与隐藏", "Show or hide the Stage window.")} />
				</Stack>
				<Stack direction="row" spacing={0.5}>
					{!stageVisible ? (
						<Button variant="contained" size="small" onClick={onShowStage} startIcon={<VisibilityIcon />}>
							{t("启动", "Show")}
						</Button>
					) : (
						<Button variant="outlined" size="small" onClick={handleClose} startIcon={<CloseIcon />}>
								{t("关闭", "Hide")}
							</Button>
					)}
					<Tooltip title={t("将 Stage 窗口移回默认位置", "Move the Stage window back to its default position")}>
						<span>
							<Button variant="outlined" size="small" onClick={handleReset} disabled={!stageVisible} startIcon={<RestartAltIcon />}>
								{t("重置", "Reset")}
							</Button>
						</span>
					</Tooltip>
				</Stack>
				<Tooltip title={t("将舞台贴靠回工作区，或切回悬浮窗口。", "Dock the stage back into the workspace, or return it to a floating window.")}>
					<span>
						<Button
							variant={stageMode === "docked" ? "contained" : "outlined"}
							size="small"
							fullWidth
							onClick={handleToggleAttachStage}
							sx={{ mt: 0.75 }}
						>
							{stageMode === "docked" ? t("取消贴靠", "Detach Stage") : t("贴靠舞台", "Attach Stage")}
						</Button>
					</span>
				</Tooltip>
			</Box>

			{/* 显示模式 */}
			<Box>
				<Stack direction="row" alignItems="center" sx={{ mb: 0.5 }}>
					<Typography variant="caption" color="text.secondary" fontWeight={600}>{t("Interactive", "Interactive")}</Typography>
					<HelpTooltip title={t("开启时可拖动舞台窗口并使用滑轮缩放；关闭后不可拖动、不可缩放。", "When enabled, the stage window can be dragged and zoomed with the mouse wheel. When disabled, dragging and zooming are blocked.")} />
				</Stack>
				<Button
					variant={displayMode === "interactive" ? "contained" : "outlined"}
					size="small"
					fullWidth
					onClick={handleToggleDisplayMode}
				>
					{displayMode === "interactive" ? t("已开启", "Enabled") : t("已关闭", "Disabled")}
				</Button>
			</Box>

		{/* 透明穿透 */}
		{showAdvancedControls && stageVisible && (
			<Box>
				<Stack direction="row" alignItems="center" sx={{ mb: 0.5 }}>
					<Typography variant="caption" color="text.secondary" fontWeight={600}>{t("穿透", "Passthrough")}</Typography>
					<HelpTooltip title={t("开启后 Stage 窗口完全透明且不可被点击，但 Live2D 仍在渲染，仍可被桌面录制或窗口捕获。通过此按钮恢复。", "Makes the Stage window transparent and click-through while still rendering. Use the button again to restore it.")} />
				</Stack>
				<Button
					variant={passthrough ? "contained" : "outlined"}
					size="small"
					fullWidth
					onClick={handleTogglePassthrough}
					startIcon={passthrough ? <VisibilityOffIcon /> : <VisibilityIcon />}
					color={passthrough ? "warning" : "inherit"}
				>
					{passthrough ? t("穿透中（点击恢复）", "Passthrough (click to restore)") : t("开启穿透", "Enable Passthrough")}
				</Button>
			</Box>
		)}

		{showAdvancedControls && <Divider />}

		{/* 缩放锁定 */}
		{showAdvancedControls && (
			<Box>
				<Stack direction="row" alignItems="center" sx={{ mb: 0.5 }}>
					<Typography variant="caption" color="text.secondary" fontWeight={600}>{t("缩放", "Zoom")}</Typography>
					<HelpTooltip title={t("在 Stage 窗口中使用鼠标滚轮可缩放模型。锁定后禁止滚轮缩放。", "Use the mouse wheel in the Stage window to zoom. Locking disables wheel zoom.")} />
				</Stack>
			<Stack direction="row" spacing={0.5}>
				<Button
					variant={scaleLocked ? "contained" : "outlined"}
					size="small"
					sx={{ flex: 1 }}
					onClick={handleToggleScaleLock}
					startIcon={scaleLocked ? <LockIcon /> : <LockOpenIcon />}
					color={scaleLocked ? "warning" : "inherit"}
				>
					{scaleLocked ? t("已锁定", "Locked") : t("未锁定", "Unlocked")}
				</Button>
				<Tooltip title={t("重置缩放比例为默认值", "Reset zoom to the default value")}>
					<Button
						variant="outlined"
						size="small"
						onClick={() => broadcastControl({ type: "reset-zoom" })}
						startIcon={<RestartAltIcon />}
					>
						{t("重置", "Reset")}
					</Button>
				</Tooltip>
			</Stack>
			</Box>
		)}

			{showAdvancedControls && (
				<Box>
					<Stack direction="row" alignItems="center" sx={{ mb: 0.5 }}>
						<Typography variant="caption" color="text.secondary" fontWeight={600}>{t("眼神", "Eyes")}</Typography>
						<HelpTooltip title={t("静止：注视前方；跟随：跟随鼠标位置；随机：沿自然路径随机注视", "Fixed looks forward; follow tracks the pointer; random follows a natural path.")} />
					</Stack>
					<ButtonGroup size="small" fullWidth>
						{EYE_MODES.map(({ mode, label }) => (
							<Button
								key={mode}
								variant={eyeMode === mode ? "contained" : "outlined"}
								onClick={() => handleSetEyeMode(mode)}
							>
								{label}
							</Button>
						))}
					</ButtonGroup>
				</Box>
			)}

		</Box>
	);
}
