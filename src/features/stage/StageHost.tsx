import { useCallback, useEffect } from "react";
import {
	Box, Button, ButtonGroup, Typography, Chip, Stack, Divider, Tooltip,
} from "@mui/material";
import LockIcon from "@mui/icons-material/Lock";
import PushPinIcon from "@mui/icons-material/PushPin";
import VisibilityIcon from "@mui/icons-material/Visibility";
import VisibilityOffIcon from "@mui/icons-material/VisibilityOff";
import RestartAltIcon from "@mui/icons-material/RestartAlt";
import { useCharacter } from "@/hooks";
import { HelpTooltip } from "@/components";
import {
	broadcastControl, onControlCommand,
	type StageDisplayMode, type ControlCommand,
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

/**
 * Stage 控制面板——不含模型预览区域，纯状态显示 + 控制入口。
 * 状态由父组件 MainWindow 管理并通过 props 传入，实现与 StageSlot 的联动。
 */
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

	const isDocked = stageMode === "docked";

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

			{/* 置顶 — 始终可见，docked 时锁定 */}
			<Box>
				<Stack direction="row" alignItems="center" sx={{ mb: 0.5 }}>
					<Typography variant="caption" color="text.secondary" fontWeight={600}>置顶</Typography>
					<HelpTooltip title="置顶：Stage 窗口压在其他应用之上。贴靠模式下由 pin 关系保证不被主窗口遮挡，置顶锁定。" />
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
		</Box>
	);
}
