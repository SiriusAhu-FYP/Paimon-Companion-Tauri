import { Box, Typography, Chip, Stack } from "@mui/material";
import type { StageDisplayMode } from "@/utils/window-sync";
import { useRuntime, useCharacter, useFunctional } from "@/hooks";
import { useI18n } from "@/contexts/I18nProvider";

interface StatusBarProps {
	stageVisible: boolean;
	stageMode: "docked" | "floating";
	displayMode: StageDisplayMode;
}

export function StatusBar({
	stageVisible,
	stageMode,
	displayMode,
}: StatusBarProps) {
	const { mode } = useRuntime();
	const { emotion, isSpeaking } = useCharacter();
	const { state: functionalState } = useFunctional();
	const { t } = useI18n();

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
					{t("舞台", "Stage")}:
				</Typography>
				<Chip
					label={stageVisible ? t("播出中", "Visible") : t("关闭", "Hidden")}
					size="small"
					color={stageVisible ? "success" : "default"}
					sx={{ height: 18, fontSize: 10, "& .MuiChip-label": { px: 0.75 } }}
				/>
				<Chip
					label={stageMode === "docked" ? t("贴靠", "Docked") : t("浮动", "Floating")}
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
						{t("说话中", "Speaking")}
					</Typography>
				)}
			</Stack>

			{/* 右侧弹性空间 */}
			<Box sx={{ flex: 1 }} />

			{functionalState.selectedTarget && (
				<Typography variant="caption" color="text.secondary" sx={{ fontSize: 11 }}>
					{t("目标", "Target")}: {functionalState.selectedTarget.title}
				</Typography>
			)}

			{functionalState.activeTaskId && (
				<Chip
					label={t("功能任务运行中", "Functional Task Running")}
					size="small"
					color="warning"
					sx={{ height: 18, fontSize: 10, "& .MuiChip-label": { px: 0.75 } }}
				/>
			)}

			<Typography
				variant="caption"
				color="text.secondary"
				sx={{
					fontSize: 11,
					maxWidth: 280,
					overflow: "hidden",
					textOverflow: "ellipsis",
					whiteSpace: "nowrap",
				}}
			>
				{functionalState.activeTaskId
					? t("托管执行中", "Delegated execution in progress")
					: t("陪伴待机中", "Companion standing by")}
			</Typography>
		</Box>
	);
}
