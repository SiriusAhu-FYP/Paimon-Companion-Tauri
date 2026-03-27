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
import RestartAltIcon from "@mui/icons-material/RestartAlt";
import CloseIcon from "@mui/icons-material/Close";
import SaveIcon from "@mui/icons-material/Save";
import { HelpTooltip } from "@/components";
import { MODEL_REGISTRY, DEFAULT_MODEL } from "@/features/live2d";
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

const log = createLogger("stage-host");

interface StageHostProps {
	onShowStage: () => void;
	stageVisible: boolean;
	stageMode: "docked" | "floating";
	alwaysOnTop: boolean;
	displayMode: StageDisplayMode;
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
	onModeChange,
	onVisibilityChange,
	onAlwaysOnTopChange,
	onDisplayModeChange,
}: StageHostProps) {
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
		}).then((unsub) => { cleanup = unsub; });
		return () => { cleanup?.(); };
	}, []);

	const handleModelChange = useCallback((event: SelectChangeEvent) => {
		const path = event.target.value;
		setSelectedModel(path);
		setExpressions([]);
		broadcastControl({ type: "set-model", modelPath: path });
	}, []);

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

	const EYE_MODES: { mode: EyeMode; label: string }[] = [
		{ mode: "fixed", label: "静止" },
		{ mode: "follow-mouse", label: "跟随" },
		{ mode: "random-path", label: "随机" },
	];

	return (
		<Box sx={{ display: "flex", flexDirection: "column", height: "100%", p: 1.5, gap: 1 }}>
			<Typography variant="subtitle2" sx={{ color: "primary.main", fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5 }}>
				Stage
			</Typography>

			{/* 模型切换 */}
			<Box>
				<Stack direction="row" alignItems="center" sx={{ mb: 0.5 }}>
					<Typography variant="caption" color="text.secondary" fontWeight={600}>模型</Typography>
					<HelpTooltip title="切换 Live2D 模型。切换后 Stage 窗口会重新加载" />
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

		{/* 表情切换 */}
		{expressions.length > 0 && (
			<Box>
				<Stack direction="row" alignItems="center" sx={{ mb: 0.5 }}>
					<Typography variant="caption" color="text.secondary" fontWeight={600}>表情</Typography>
					<HelpTooltip title="模型自带的表情文件。点击后 Stage 中的模型会切换表情" />
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

			{/* 窗口控制 */}
			<Box>
				<Stack direction="row" alignItems="center" sx={{ mb: 0.5 }}>
					<Typography variant="caption" color="text.secondary" fontWeight={600}>窗口</Typography>
					<HelpTooltip title="控制 Stage 播出窗口的显示与隐藏" />
				</Stack>
				<Stack direction="row" spacing={0.5}>
					{!stageVisible ? (
						<Button variant="contained" size="small" onClick={onShowStage} startIcon={<VisibilityIcon />}>
							启动
						</Button>
					) : (
						<Button variant="outlined" size="small" onClick={handleClose} startIcon={<CloseIcon />}>
								关闭
							</Button>
					)}
					<Tooltip title="将 Stage 窗口移回默认位置">
						<span>
							<Button variant="outlined" size="small" onClick={handleReset} disabled={!stageVisible} startIcon={<RestartAltIcon />}>
								重置
							</Button>
						</span>
					</Tooltip>
				</Stack>
			</Box>

			{/* 模式切换 */}
			<Box>
				<Stack direction="row" alignItems="center" sx={{ mb: 0.5 }}>
					<Typography variant="caption" color="text.secondary" fontWeight={600}>模式</Typography>
					<HelpTooltip title="贴靠：Stage 固定在主界面模型区域；浮动：Stage 可自由移动" />
				</Stack>
				<ButtonGroup size="small" fullWidth>
					<Button variant={isDocked ? "contained" : "outlined"} onClick={() => handleSetMode("docked")}>
						贴靠
					</Button>
					<Button variant={!isDocked ? "contained" : "outlined"} onClick={() => handleSetMode("floating")}>
						浮动
					</Button>
				</ButtonGroup>
			</Box>

			{/* 置顶 */}
			<Box>
				<Stack direction="row" alignItems="center" sx={{ mb: 0.5 }}>
					<Typography variant="caption" color="text.secondary" fontWeight={600}>置顶</Typography>
					<HelpTooltip title="置顶：Stage 窗口压在其他应用之上。贴靠模式下由 pin 关系自动管理，置顶锁定。" />
				</Stack>
				<Tooltip title={isDocked ? "贴靠模式下置顶由 pin 关系自动管理" : ""}>
					<span>
						<Button
							variant={alwaysOnTop && !isDocked ? "contained" : "outlined"}
							size="small"
							fullWidth
							disabled={isDocked}
							onClick={handleToggleAlwaysOnTop}
							startIcon={isDocked ? <LockIcon /> : <PushPinIcon />}
						>
							{isDocked ? "已锁定" : alwaysOnTop ? "置顶: 开" : "置顶: 关"}
						</Button>
					</span>
				</Tooltip>
			</Box>

			{/* 显示模式 */}
			<Box>
				<Stack direction="row" alignItems="center" sx={{ mb: 0.5 }}>
					<Typography variant="caption" color="text.secondary" fontWeight={600}>显示</Typography>
					<HelpTooltip title="clean：纯净播出画面，控制条隐藏；interactive：hover 显示控制条" />
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

			<Divider />

			{/* 缩放锁定 */}
			<Box>
				<Stack direction="row" alignItems="center" sx={{ mb: 0.5 }}>
					<Typography variant="caption" color="text.secondary" fontWeight={600}>缩放</Typography>
					<HelpTooltip title="在 Stage 窗口中使用鼠标滚轮可缩放模型。锁定后禁止滚轮缩放。" />
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
					{scaleLocked ? "已锁定" : "未锁定"}
				</Button>
				<Tooltip title="重置缩放比例为默认值">
					<Button
						variant="outlined"
						size="small"
						onClick={() => broadcastControl({ type: "reset-zoom" })}
						startIcon={<RestartAltIcon />}
					>
						重置
					</Button>
				</Tooltip>
			</Stack>
			</Box>

			{/* 眼神模式 */}
			<Box>
				<Stack direction="row" alignItems="center" sx={{ mb: 0.5 }}>
					<Typography variant="caption" color="text.secondary" fontWeight={600}>眼神</Typography>
					<HelpTooltip title="静止：注视前方；跟随：跟随鼠标位置；随机：沿自然路径随机注视" />
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

			{/* 浮动模式 — 窗口尺寸预设 */}
			{isFloating && stageVisible && (
				<>
					<Divider />
					<Box>
						<Stack direction="row" alignItems="center" sx={{ mb: 0.5 }}>
							<Typography variant="caption" color="text.secondary" fontWeight={600}>窗口尺寸</Typography>
							<HelpTooltip title="调整 Stage 窗口大小以获得最佳 OBS 捕获清晰度。窗口越大，捕获越清晰。" />
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
								保存自定义尺寸
							</Button>
						) : (
							<Stack spacing={0.5}>
								<Stack direction="row" spacing={0.5}>
									<TextField
										size="small"
										placeholder="名称"
										value={saveLabel}
										onChange={(e) => setSaveLabel(e.target.value)}
										sx={{ flex: 1, "& input": { fontSize: 11, py: 0.5 } }}
									/>
								</Stack>
								<Stack direction="row" spacing={0.5} alignItems="center">
									<TextField
										size="small"
										placeholder="宽"
										type="number"
										value={saveW}
										onChange={(e) => setSaveW(e.target.value)}
										sx={{ flex: 1, "& input": { fontSize: 11, py: 0.5 } }}
									/>
									<Typography variant="caption" color="text.secondary">x</Typography>
									<TextField
										size="small"
										placeholder="高"
										type="number"
										value={saveH}
										onChange={(e) => setSaveH(e.target.value)}
										sx={{ flex: 1, "& input": { fontSize: 11, py: 0.5 } }}
									/>
								</Stack>
								<Stack direction="row" spacing={0.5}>
									<Button size="small" variant="contained" onClick={handleSaveCustomPreset} sx={{ fontSize: 11 }}>
										保存
									</Button>
									<Button size="small" variant="text" onClick={() => setShowSaveInput(false)} sx={{ fontSize: 11 }}>
										取消
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
