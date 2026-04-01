import { Box, Typography, IconButton, Tooltip, Chip, Stack } from "@mui/material";
import TerminalIcon from "@mui/icons-material/Terminal";
import type { StageDisplayMode } from "@/utils/window-sync";
import { useRuntime, useCharacter, useFunctional } from "@/hooks";

interface StatusBarProps {
	stageVisible: boolean;
	stageMode: "docked" | "floating";
	displayMode: StageDisplayMode;
	eventLogOpen: boolean;
	onToggleEventLog: () => void;
}

export function StatusBar({
	stageVisible,
	stageMode,
	displayMode,
	eventLogOpen,
	onToggleEventLog,
}: StatusBarProps) {
	const { mode } = useRuntime();
	const { emotion, isSpeaking } = useCharacter();
	const { state: functionalState } = useFunctional();

	return (
		<Box sx={{
			height: 28,
			display: "flex",
			alignItems: "center",
			px: 1.5,
			gap: 2,
			bgcolor: "background.paper",
			borderTop: "1px solid",
			borderColor: "secondary.main",
			userSelect: "none",
			flexShrink: 0,
		}}>
			{/* 运行模式 */}
			<Stack direction="row" spacing={0.5} alignItems="center">
				<Box sx={{
					width: 6, height: 6, borderRadius: "50%",
					bgcolor: mode === "stopped" ? "error.main" : "success.main",
				}} />
				<Typography variant="caption" color="text.secondary" sx={{ fontSize: 11 }}>
					{mode}
				</Typography>
			</Stack>

			{/* Stage 状态 */}
			<Stack direction="row" spacing={0.5} alignItems="center">
				<Typography variant="caption" color="text.secondary" sx={{ fontSize: 11 }}>
					Stage:
				</Typography>
				<Chip
					label={stageVisible ? "播出中" : "关闭"}
					size="small"
					color={stageVisible ? "success" : "default"}
					sx={{ height: 18, fontSize: 10, "& .MuiChip-label": { px: 0.75 } }}
				/>
				<Chip
					label={stageMode === "docked" ? "贴靠" : "浮动"}
					size="small"
					variant="outlined"
					sx={{ height: 18, fontSize: 10, "& .MuiChip-label": { px: 0.75 } }}
				/>
				<Chip
					label={displayMode}
					size="small"
					variant="outlined"
					sx={{ height: 18, fontSize: 10, "& .MuiChip-label": { px: 0.75 } }}
				/>
			</Stack>

			{/* 角色情绪 */}
			<Stack direction="row" spacing={0.5} alignItems="center">
				<Typography variant="caption" color="text.secondary" sx={{ fontSize: 11 }}>
					{emotion}
				</Typography>
				{isSpeaking && (
					<Typography variant="caption" sx={{ color: "primary.main", fontSize: 10, animation: "pulse 1.5s ease-in-out infinite" }}>
						说话中
					</Typography>
				)}
			</Stack>

			{/* 右侧弹性空间 */}
			<Box sx={{ flex: 1 }} />

			{functionalState.selectedTarget && (
				<Typography variant="caption" color="text.secondary" sx={{ fontSize: 11 }}>
					Target: {functionalState.selectedTarget.title}
				</Typography>
			)}

			{functionalState.activeTaskId && (
				<Chip
					label="Functional Task Running"
					size="small"
					color="warning"
					sx={{ height: 18, fontSize: 10, "& .MuiChip-label": { px: 0.75 } }}
				/>
			)}

			{/* 事件日志开关 */}
			<Tooltip title={eventLogOpen ? "关闭事件日志" : "打开事件日志"}>
				<IconButton
					size="small"
					onClick={onToggleEventLog}
					sx={{
						p: 0.25,
						color: eventLogOpen ? "primary.main" : "text.secondary",
					}}
				>
					<TerminalIcon sx={{ fontSize: 16 }} />
				</IconButton>
			</Tooltip>
		</Box>
	);
}
