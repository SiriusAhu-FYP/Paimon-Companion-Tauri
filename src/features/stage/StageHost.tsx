import { useCallback, useEffect, useState } from "react";
import {
	Box, Button, ButtonGroup, Typography, Chip, Stack, Divider, Tooltip,
	TextField,
} from "@mui/material";
import LockIcon from "@mui/icons-material/Lock";
import LockOpenIcon from "@mui/icons-material/LockOpen";
import PushPinIcon from "@mui/icons-material/PushPin";
import VisibilityIcon from "@mui/icons-material/Visibility";
import VisibilityOffIcon from "@mui/icons-material/VisibilityOff";
import RestartAltIcon from "@mui/icons-material/RestartAlt";
import CloseIcon from "@mui/icons-material/Close";
import SaveIcon from "@mui/icons-material/Save";
import { useCharacter } from "@/hooks";
import { HelpTooltip } from "@/components";
import {
	broadcastControl, onControlCommand,
	type StageDisplayMode, type ControlCommand, type EyeMode,
} from "@/utils/window-sync";

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

interface SizePreset {
	label: string;
	w: number;
	h: number;
	custom?: boolean;
}

const BUILT_IN_PRESETS: SizePreset[] = [
	{ label: "1:1 400", w: 400, h: 400 },
	{ label: "4:3 640", w: 640, h: 480 },
	{ label: "16:9 720p", w: 1280, h: 720 },
	{ label: "16:9 1080p", w: 1920, h: 1080 },
	{ label: "9:16 480", w: 480, h: 854 },
];

const CUSTOM_PRESETS_KEY = "paimon-live:custom-size-presets";

function loadCustomPresets(): SizePreset[] {
	try {
		const raw = localStorage.getItem(CUSTOM_PRESETS_KEY);
		if (!raw) return [];
		return JSON.parse(raw) as SizePreset[];
	} catch {
		return [];
	}
}

function saveCustomPresets(presets: SizePreset[]) {
	localStorage.setItem(CUSTOM_PRESETS_KEY, JSON.stringify(presets));
}

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
	const { emotion, isSpeaking } = useCharacter();
	const [scaleLocked, setScaleLocked] = useState(false);
	const [eyeMode, setEyeMode] = useState<EyeMode>("random-path");
	const [customPresets, setCustomPresets] = useState<SizePreset[]>(loadCustomPresets);
	const [showSaveInput, setShowSaveInput] = useState(false);
	const [saveLabel, setSaveLabel] = useState("");
	const [saveW, setSaveW] = useState("");
	const [saveH, setSaveH] = useState("");

	// 监听 Stage 侧的 sync-state 回报
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
		}).then((unsub) => { cleanup = unsub; });
		return () => { cleanup?.(); };
	}, []);

	const handleHide = useCallback(() => {
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

			{/* 状态指示 */}
			<Box sx={{ bgcolor: "background.paper", borderRadius: 1, p: 1 }}>
				<Stack direction="row" spacing={0.5} alignItems="center" sx={{ mb: 0.5 }}>
					<Box sx={{
						width: 8, height: 8, borderRadius: "50%",
						bgcolor: stageVisible ? "success.main" : "text.disabled",
						boxShadow: stageVisible ? "0 0 4px #4caf50" : "none",
					}} />
					<Typography variant="caption">
						{stageVisible ? "播出中" : "未启动"}
					</Typography>
				</Stack>
				<Stack direction="row" spacing={0.5} flexWrap="wrap">
					<Chip label={isDocked ? "贴靠" : "浮动"} size="small" variant="outlined" sx={{ height: 20, fontSize: 11 }} />
					{isDocked && <Chip label="pin" size="small" color="success" sx={{ height: 20, fontSize: 10 }} />}
					{!isDocked && alwaysOnTop && <Chip label="置顶" size="small" color="success" sx={{ height: 20, fontSize: 10 }} />}
					<Chip label={displayMode} size="small" variant="outlined" sx={{ height: 20, fontSize: 11 }} />
				</Stack>
				<Stack direction="row" spacing={0.5} alignItems="center" sx={{ mt: 0.5 }}>
					<Typography variant="caption" color="text.secondary">{emotion}</Typography>
					{isSpeaking && (
						<Typography variant="caption" sx={{ color: "primary.main", animation: "pulse 1.5s ease-in-out infinite" }}>
							说话中
						</Typography>
					)}
				</Stack>
			</Box>

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
						<Button variant="outlined" size="small" onClick={handleHide} startIcon={<VisibilityOffIcon />}>
							隐藏
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
				<Button
					variant={scaleLocked ? "contained" : "outlined"}
					size="small"
					fullWidth
					onClick={handleToggleScaleLock}
					startIcon={scaleLocked ? <LockIcon /> : <LockOpenIcon />}
					color={scaleLocked ? "warning" : "inherit"}
				>
					{scaleLocked ? "缩放已锁定" : "缩放未锁定"}
				</Button>
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
