import { useCallback, useEffect, useState } from "react";
import {
	Box, Button, ButtonGroup, Typography, Chip, Stack, Divider, Tooltip,
	TextField, Select, MenuItem, FormControl,
} from "@mui/material";
import type { SelectChangeEvent } from "@mui/material";
import LockIcon from "@mui/icons-material/Lock";
import LockOpenIcon from "@mui/icons-material/LockOpen";
import PushPinIcon from "@mui/icons-material/PushPin";
import VisibilityIcon from "@mui/icons-material/Visibility";
import VisibilityOffIcon from "@mui/icons-material/VisibilityOff";
import RestartAltIcon from "@mui/icons-material/RestartAlt";
import CloseIcon from "@mui/icons-material/Close";
import SaveIcon from "@mui/icons-material/Save";
import { HelpTooltip } from "@/components";
import { MODEL_REGISTRY, DEFAULT_MODEL } from "@/features/live2d";
import { getServices } from "@/services";
import {
	broadcastControl, onControlCommand,
	type StageDisplayMode, type ControlCommand, type EyeMode,
} from "@/utils/window-sync";
import {
	loadCustomPresets, saveCustomPresets,
	loadScaleLock, saveScaleLock,
	type SizePreset,
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
	onModeChange: (mode: "docked" | "floating") => void;
	onVisibilityChange: (visible: boolean) => void;
	onAlwaysOnTopChange: (value: boolean) => void;
	onDisplayModeChange: (mode: StageDisplayMode) => void;
}

const BUILT_IN_PRESETS: SizePreset[] = [
	{ label: "1:1 400", w: 400, h: 400 },
	{ label: "3:4 480", w: 480, h: 640 },
	{ label: "\u2b50 9:16 480", w: 480, h: 854 },
	{ label: "\u2b50 9:16 720", w: 720, h: 1280 },
	{ label: "\u2b50 9:16 1080", w: 1080, h: 1920 },
];

export function StageHost({
	onShowStage,
	stageVisible,
	stageMode,
	alwaysOnTop,
	displayMode,
	variant = "developer",
	onModeChange,
	onVisibilityChange,
	onAlwaysOnTopChange,
	onDisplayModeChange,
}: StageHostProps) {
	const { t } = useI18n();
	const { character } = getServices();
	const [scaleLocked, setScaleLocked] = useState(loadScaleLock);
	const [eyeMode, setEyeMode] = useState<EyeMode>("random-path");
	const [customPresets, setCustomPresets] = useState<SizePreset[]>(loadCustomPresets);
	const [showSaveInput, setShowSaveInput] = useState(false);
	const [saveLabel, setSaveLabel] = useState("");
	const [saveW, setSaveW] = useState("");
	const [saveH, setSaveH] = useState("");

	// 模型 / 表情控制（从 ControlPanel 迁移至此）
	const [selectedModel, setSelectedModel] = useState(DEFAULT_MODEL.path);
	const [expressions, setExpressions] = useState<string[]>([]);

	// 监听 Stage 侧的 sync-state 和 report-expressions
	useEffect(() => {
		let cleanup: (() => void) | null = null;
		onControlCommand((cmd: ControlCommand) => {
			if (cmd.type === "sync-state") {
				onModeChange(cmd.state.mode);
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

	const handleSetMode = useCallback((mode: "docked" | "floating") => {
		onModeChange(mode);
		broadcastControl({ type: "set-mode", mode });
	}, [onModeChange]);

	const handleToggleAlwaysOnTop = useCallback(() => {
		if (stageMode === "docked") return;
		const next = !alwaysOnTop;
		onAlwaysOnTopChange(next);
		broadcastControl({ type: "set-always-on-top", value: next });
	}, [stageMode, alwaysOnTop, onAlwaysOnTopChange]);

	const handleToggleDisplayMode = useCallback(() => {
		const next: StageDisplayMode = displayMode === "clean" ? "interactive" : "clean";
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

	const handleApplyPreset = useCallback((w: number, h: number) => {
		broadcastControl({ type: "set-size", width: w, height: h });
	}, []);

	const handleSaveCustomPreset = useCallback(() => {
		const w = parseInt(saveW, 10);
		const h = parseInt(saveH, 10);
		if (!w || !h || w < 100 || h < 100) return;
		const label = saveLabel.trim() || `${w}x${h}`;
		const preset: SizePreset = { label, w, h, custom: true };
		const updated = [...customPresets, preset];
		setCustomPresets(updated);
		saveCustomPresets(updated);
		setShowSaveInput(false);
		setSaveLabel("");
		setSaveW("");
		setSaveH("");
	}, [saveLabel, saveW, saveH, customPresets]);

	const handleDeleteCustomPreset = useCallback((index: number) => {
		const updated = customPresets.filter((_, i) => i !== index);
		setCustomPresets(updated);
		saveCustomPresets(updated);
	}, [customPresets]);

	const isDocked = stageMode === "docked";
	const isFloating = stageMode === "floating";
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
			</Box>

			{/* 模式切换 */}
			<Box>
				<Stack direction="row" alignItems="center" sx={{ mb: 0.5 }}>
					<Typography variant="caption" color="text.secondary" fontWeight={600}>{t("模式", "Mode")}</Typography>
					<HelpTooltip title={t("贴靠：Stage 固定在主界面模型区域；浮动：Stage 可自由移动", "Docked keeps Stage in the main model area; floating allows free movement.")} />
				</Stack>
				<ButtonGroup size="small" fullWidth>
					<Button variant={isDocked ? "contained" : "outlined"} onClick={() => handleSetMode("docked")}>
						{t("贴靠", "Docked")}
					</Button>
					<Button variant={!isDocked ? "contained" : "outlined"} onClick={() => handleSetMode("floating")}>
						{t("浮动", "Floating")}
					</Button>
				</ButtonGroup>
			</Box>

			{/* 置顶 */}
			<Box>
				<Stack direction="row" alignItems="center" sx={{ mb: 0.5 }}>
					<Typography variant="caption" color="text.secondary" fontWeight={600}>{t("置顶", "Always On Top")}</Typography>
					<HelpTooltip title={t("置顶：Stage 窗口压在其他应用之上。贴靠模式下由 pin 关系自动管理，置顶锁定。", "Always on top keeps Stage above other windows. Docked mode manages this automatically.")} />
				</Stack>
				<Tooltip title={isDocked ? t("贴靠模式下置顶由 pin 关系自动管理", "Docked mode manages always-on-top automatically") : ""}>
					<span>
						<Button
							variant={alwaysOnTop && !isDocked ? "contained" : "outlined"}
							size="small"
							fullWidth
							disabled={isDocked}
							onClick={handleToggleAlwaysOnTop}
							startIcon={isDocked ? <LockIcon /> : <PushPinIcon />}
						>
							{isDocked ? t("已锁定", "Locked") : alwaysOnTop ? t("置顶: 开", "Top: On") : t("置顶: 关", "Top: Off")}
						</Button>
					</span>
				</Tooltip>
			</Box>

			{/* 显示模式 */}
			<Box>
				<Stack direction="row" alignItems="center" sx={{ mb: 0.5 }}>
					<Typography variant="caption" color="text.secondary" fontWeight={600}>{t("显示", "Display")}</Typography>
					<HelpTooltip title={t("clean：纯净播出画面，控制条隐藏；interactive：hover 显示控制条", "clean hides the toolbar; interactive shows controls on hover.")} />
				</Stack>
				<ButtonGroup size="small" fullWidth>
					<Button variant={displayMode === "interactive" ? "contained" : "outlined"} onClick={() => {
						if (displayMode !== "interactive") handleToggleDisplayMode();
					}}>
						interactive
					</Button>
					<Button variant={displayMode === "clean" ? "contained" : "outlined"} onClick={() => {
						if (displayMode !== "clean") handleToggleDisplayMode();
					}}>
						clean
					</Button>
				</ButtonGroup>
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

			{/* 浮动模式 — 窗口尺寸预设 */}
			{showAdvancedControls && isFloating && stageVisible && (
				<>
					<Divider />
					<Box>
						<Stack direction="row" alignItems="center" sx={{ mb: 0.5 }}>
							<Typography variant="caption" color="text.secondary" fontWeight={600}>{t("窗口尺寸", "Window Size")}</Typography>
							<HelpTooltip title={t("调整 Stage 窗口大小以获得更好的窗口捕获清晰度。窗口越大，捕获通常越清晰。", "Adjust the Stage size for clearer capture. Larger windows are usually clearer.")} />
						</Stack>

						{/* 内置预设 */}
						<Stack direction="row" flexWrap="wrap" gap={0.5} sx={{ mb: 0.5 }}>
							{BUILT_IN_PRESETS.map((p) => (
								<Chip
									key={p.label}
									label={p.label}
									size="small"
									variant="outlined"
									onClick={() => handleApplyPreset(p.w, p.h)}
									sx={{ cursor: "pointer", fontSize: 10, height: 22 }}
								/>
							))}
						</Stack>

						{/* 自定义预设 */}
						{customPresets.length > 0 && (
							<Stack direction="row" flexWrap="wrap" gap={0.5} sx={{ mb: 0.5 }}>
								{customPresets.map((p, i) => (
									<Chip
										key={i}
										label={p.label}
										size="small"
										color="primary"
										variant="outlined"
										onClick={() => handleApplyPreset(p.w, p.h)}
										onDelete={() => handleDeleteCustomPreset(i)}
										deleteIcon={<CloseIcon sx={{ fontSize: 12 }} />}
										sx={{ cursor: "pointer", fontSize: 10, height: 22 }}
									/>
								))}
							</Stack>
						)}

						{/* 保存当前 / 自定义输入 */}
						{!showSaveInput ? (
							<Button
								size="small"
								variant="text"
								startIcon={<SaveIcon />}
								onClick={() => setShowSaveInput(true)}
								sx={{ fontSize: 11, textTransform: "none" }}
							>
								{t("保存自定义尺寸", "Save Custom Size")}
							</Button>
						) : (
							<Stack spacing={0.5}>
								<Stack direction="row" spacing={0.5}>
									<TextField
										size="small"
										placeholder={t("名称", "Name")}
										value={saveLabel}
										onChange={(e) => setSaveLabel(e.target.value)}
										sx={{ flex: 1, "& input": { fontSize: 11, py: 0.5 } }}
									/>
								</Stack>
								<Stack direction="row" spacing={0.5} alignItems="center">
									<TextField
										size="small"
										placeholder={t("宽", "Width")}
										type="number"
										value={saveW}
										onChange={(e) => setSaveW(e.target.value)}
										sx={{ flex: 1, "& input": { fontSize: 11, py: 0.5 } }}
									/>
									<Typography variant="caption" color="text.secondary">x</Typography>
									<TextField
										size="small"
										placeholder={t("高", "Height")}
										type="number"
										value={saveH}
										onChange={(e) => setSaveH(e.target.value)}
										sx={{ flex: 1, "& input": { fontSize: 11, py: 0.5 } }}
									/>
								</Stack>
								<Stack direction="row" spacing={0.5}>
									<Button size="small" variant="contained" onClick={handleSaveCustomPreset} sx={{ fontSize: 11 }}>
										{t("保存", "Save")}
									</Button>
									<Button size="small" variant="text" onClick={() => setShowSaveInput(false)} sx={{ fontSize: 11 }}>
										{t("取消", "Cancel")}
									</Button>
								</Stack>
							</Stack>
						)}
					</Box>
				</>
			)}
		</Box>
	);
}
