import { useEffect, useState } from "react";
import { Box, Typography, Chip, Stack, IconButton, Tooltip } from "@mui/material";
import TerminalIcon from "@mui/icons-material/Terminal";
import type { StageDisplayMode } from "@/utils/window-sync";
import { useRuntime, useCharacter, useFunctional, useEventLog } from "@/hooks";
import { useI18n } from "@/contexts/I18nProvider";
import { getStoredOpenDockPanels } from "@/app/workspace/workspace-layout";
import {
	requestCloseWorkspacePanel,
	requestOpenWorkspacePanel,
	subscribeWorkspaceClosePanel,
	subscribeWorkspaceOpenPanel,
	subscribeWorkspaceResetLayout,
} from "@/app/workspace/WorkspaceContext";

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
	const { latestEntry } = useEventLog(1, {
		showDebug: false,
		mode: "latest",
		includeTotalTrackedEntries: false,
	});
	const { t } = useI18n();
	const [isEventLogOpen, setIsEventLogOpen] = useState(() => getStoredOpenDockPanels().has("event-log"));

	useEffect(() => {
		const syncFromStorage = () => {
			setIsEventLogOpen(getStoredOpenDockPanels().has("event-log"));
		};

		const unsubOpen = subscribeWorkspaceOpenPanel((panelId) => {
			if (panelId === "event-log") {
				setIsEventLogOpen(true);
			}
		});
		const unsubClose = subscribeWorkspaceClosePanel((panelId) => {
			if (panelId === "event-log") {
				setIsEventLogOpen(false);
			}
		});
		const unsubReset = subscribeWorkspaceResetLayout(syncFromStorage);

		return () => {
			unsubOpen();
			unsubClose();
			unsubReset();
		};
	}, []);

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
			<Stack direction="row" spacing={0.5} alignItems="center">
				<Box sx={{
					width: 6, height: 6, borderRadius: "50%",
					bgcolor: mode === "stopped" ? "error.main" : "success.main",
				}} />
				<Typography variant="caption" color="text.secondary" sx={{ fontSize: 11 }}>
					{mode}
				</Typography>
			</Stack>

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

			<Tooltip title={isEventLogOpen ? t("关闭日志", "Hide Log") : t("打开日志", "Show Log")}>
				<IconButton
					size="small"
					onClick={() => {
						if (isEventLogOpen) {
							setIsEventLogOpen(false);
							requestCloseWorkspacePanel("event-log");
						} else {
							setIsEventLogOpen(true);
							requestOpenWorkspacePanel("event-log");
						}
					}}
					sx={{
						color: isEventLogOpen ? "primary.main" : "text.secondary",
						p: 0.5,
					}}
				>
					<TerminalIcon sx={{ fontSize: 15 }} />
				</IconButton>
			</Tooltip>

			<Typography
				variant="caption"
				color="text.secondary"
				sx={{
					fontSize: 11,
					maxWidth: 320,
					overflow: "hidden",
					textOverflow: "ellipsis",
					whiteSpace: "nowrap",
				}}
				title={latestEntry?.payloadPreviewText ?? t("暂无事件", "No events yet")}
			>
				{latestEntry
					? `${t("最近事件", "Latest")}: ${latestEntry.summary}`
					: (functionalState.activeTaskId
						? t("托管执行中", "Delegated execution in progress")
						: t("陪伴待机中", "Companion standing by"))}
			</Typography>
		</Box>
	);
}
