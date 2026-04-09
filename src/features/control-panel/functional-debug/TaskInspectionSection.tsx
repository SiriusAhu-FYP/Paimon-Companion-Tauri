import { Box, Button, Chip, Stack, Typography } from "@mui/material";
import { useMemo, useState } from "react";
import type { FunctionalRuntimeState, FunctionalTaskRecord } from "@/types";
import {
	formatDuration,
	formatTime,
	getTaskStatusColor,
	PlaceholderSnapshot,
	SnapshotCard,
} from "./shared";

interface TaskInspectionSectionProps {
	functionalState: FunctionalRuntimeState;
	onClearTaskHistory: () => void;
}

export function TaskInspectionSection(props: TaskInspectionSectionProps) {
	const [selectedTaskId, setSelectedTaskId] = useState<string | null>(props.functionalState.latestTask?.id ?? null);

	const taskOptions = useMemo(
		() => [props.functionalState.latestTask, ...props.functionalState.taskHistory]
			.filter((task, index, array): task is FunctionalTaskRecord => Boolean(task) && array.findIndex((item) => item?.id === task?.id) === index)
			.slice(0, 6),
		[props.functionalState.latestTask, props.functionalState.taskHistory],
	);

	const selectedTask = useMemo(() => {
		if (selectedTaskId && props.functionalState.latestTask?.id === selectedTaskId) {
			return props.functionalState.latestTask;
		}
		return props.functionalState.taskHistory.find((task) => task.id === selectedTaskId)
			?? props.functionalState.latestTask
			?? null;
	}, [props.functionalState.latestTask, props.functionalState.taskHistory, selectedTaskId]);

	if (!selectedTask) {
		return null;
	}

	return (
		<>
			<Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 0.75 }}>
				<Box>
					<Typography variant="caption" color="text.secondary" fontWeight={700}>
						Task Inspection
					</Typography>
					<Typography variant="caption" color="text.secondary" sx={{ display: "block", fontSize: 10 }}>
						从最近任务历史里挑一个看前后快照
					</Typography>
				</Box>
				<Chip
					label={selectedTask.status}
					size="small"
					color={getTaskStatusColor(selectedTask.status)}
					sx={{ height: 18, fontSize: 10 }}
				/>
			</Stack>

			<Stack direction="row" spacing={0.5} sx={{ mb: 0.75, flexWrap: "wrap", rowGap: 0.5 }}>
				{taskOptions.map((task) => (
					<Button
						key={task.id}
						size="small"
						variant={selectedTaskId === task.id ? "contained" : "outlined"}
						onClick={() => setSelectedTaskId(task.id)}
					>
						{task.actionKind}
					</Button>
				))}
				<Button size="small" variant="text" onClick={props.onClearTaskHistory}>
					清空任务历史
				</Button>
			</Stack>

			<Stack spacing={0.5} sx={{ mb: 0.75 }}>
				<Typography variant="caption" color="text.secondary" sx={{ display: "block", fontSize: 10 }}>
					name: {selectedTask.name}
				</Typography>
				<Typography variant="caption" color="text.secondary" sx={{ display: "block", fontSize: 10 }}>
					target: {selectedTask.targetTitle}
				</Typography>
				<Typography variant="caption" color="text.secondary" sx={{ display: "block", fontSize: 10 }}>
					time: {formatTime(selectedTask.startedAt)} · duration {formatDuration(selectedTask.startedAt, selectedTask.endedAt)}
				</Typography>
				<Typography variant="caption" color="text.secondary" sx={{ display: "block", fontSize: 10 }}>
					summary: {selectedTask.summary}
				</Typography>
				{selectedTask.beforeSnapshot && (
					<Typography variant="caption" color="text.secondary" sx={{ display: "block", fontSize: 10 }}>
						before: {selectedTask.beforeSnapshot.captureMethod} / {selectedTask.beforeSnapshot.qualityScore.toFixed(3)}
					</Typography>
				)}
				{selectedTask.afterSnapshot && (
					<Typography variant="caption" color="text.secondary" sx={{ display: "block", fontSize: 10 }}>
						after: {selectedTask.afterSnapshot.captureMethod} / {selectedTask.afterSnapshot.qualityScore.toFixed(3)}
					</Typography>
				)}
			</Stack>

			<Stack direction={{ xs: "column", sm: "row" }} spacing={0.75}>
				{selectedTask.beforeSnapshot ? (
					<SnapshotCard
						title={`Before ${selectedTask.actionKind}`}
						dataUrl={selectedTask.beforeSnapshot.dataUrl}
						label={`${selectedTask.name} before`}
					/>
				) : (
					<PlaceholderSnapshot message="没有前置快照" />
				)}
				{selectedTask.afterSnapshot ? (
					<SnapshotCard
						title={`After ${selectedTask.actionKind}`}
						dataUrl={selectedTask.afterSnapshot.dataUrl}
						label={`${selectedTask.name} after`}
					/>
				) : (
					<PlaceholderSnapshot message="没有后置快照" />
				)}
			</Stack>
		</>
	);
}
