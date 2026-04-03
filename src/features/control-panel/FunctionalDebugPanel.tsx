import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Alert, Box, Button, Chip, Divider, Stack, Typography } from "@mui/material";
import type {
	EvaluationState,
	FunctionalRuntimeState,
	FunctionalTaskRecord,
	Game2048State,
	StardewState,
} from "@/types";

interface FunctionalDebugPanelProps {
	functionalState: FunctionalRuntimeState;
	game2048State: Game2048State;
	stardewState: StardewState;
	evaluationState: EvaluationState;
	onClearTaskHistory: () => void;
}

type DebugRun =
	| {
		game: "2048";
		startedAt: number;
		status: string;
		summary: string;
		companionText: string;
		strategy: string;
		reasoning: string;
		analysisSource: string;
		preferred: string[];
		attempts: Array<{ label: string; changed: boolean; changeRatio: number }>;
	}
	| {
		game: "stardew";
		startedAt: number;
		status: string;
		summary: string;
		companionText: string;
		strategy: string;
		reasoning: string;
		analysisSource: string;
		preferred: string[];
		attempts: Array<{ label: string; changed: boolean; changeRatio: number }>;
	};

function formatTime(timestamp: number | null): string {
	if (!timestamp) return "—";
	return new Date(timestamp).toLocaleTimeString();
}

function formatDuration(startedAt: number, endedAt: number | null): string {
	const end = endedAt ?? Date.now();
	return `${Math.max(0, end - startedAt)}ms`;
}

function formatPercent(value: number): string {
	return `${(value * 100).toFixed(1)}%`;
}

function getTaskStatusColor(status: FunctionalTaskRecord["status"]): "success" | "warning" | "error" {
	if (status === "completed") return "success";
	if (status === "failed") return "error";
	return "warning";
}

function buildLatestGameRun(game2048State: Game2048State, stardewState: StardewState): DebugRun | null {
	const gameRun = game2048State.lastRun;
	const stardewRun = stardewState.lastRun;

	if (!gameRun && !stardewRun) return null;

	if (gameRun && (!stardewRun || gameRun.startedAt >= stardewRun.startedAt)) {
		return {
			game: "2048",
			startedAt: gameRun.startedAt,
			status: gameRun.status,
			summary: gameRun.summary,
			companionText: gameRun.companionText,
			strategy: gameRun.analysis.strategy,
			reasoning: gameRun.analysis.reasoning,
			analysisSource: gameRun.analysis.source,
			preferred: gameRun.analysis.preferredMoves,
			attempts: gameRun.attempts.map((attempt) => ({
				label: attempt.move,
				changed: attempt.changed,
				changeRatio: attempt.changeRatio,
			})),
		};
	}

	return {
		game: "stardew",
		startedAt: stardewRun!.startedAt,
		status: stardewRun!.status,
		summary: stardewRun!.summary,
		companionText: stardewRun!.companionText,
		strategy: stardewRun!.analysis.strategy,
		reasoning: stardewRun!.analysis.reasoning,
		analysisSource: stardewRun!.analysis.source,
		preferred: stardewRun!.analysis.preferredActions,
		attempts: stardewRun!.attempts.map((attempt) => ({
			label: attempt.action,
			changed: attempt.changed,
			changeRatio: attempt.changeRatio,
		})),
	};
}

function SnapshotCard(props: {
	title: string;
	dataUrl: string;
	label: string;
	height?: number;
}) {
	return (
		<Box sx={{ flex: 1, minWidth: 0 }}>
			<Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.5 }}>
				{props.title}
			</Typography>
			<Box
				component="img"
				src={props.dataUrl}
				alt={props.label}
				sx={{
					width: "100%",
					height: props.height ?? 160,
					objectFit: "contain",
					bgcolor: "background.default",
					borderRadius: 1,
					border: "1px solid",
					borderColor: "divider",
				}}
			/>
		</Box>
	);
}

function StageCard(props: {
	title: string;
	status: "idle" | "active" | "success" | "warning";
	lines: string[];
	children?: ReactNode;
}) {
	const tone = props.status === "success"
		? "success.main"
		: props.status === "warning"
			? "warning.main"
			: props.status === "active"
				? "info.main"
				: "divider";

	return (
		<Box
			sx={{
				bgcolor: "background.paper",
				borderRadius: 1,
				p: 0.75,
				border: "1px solid",
				borderColor: tone,
			}}
		>
			<Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 0.5 }}>
				<Typography variant="caption" color="text.secondary" fontWeight={700}>
					{props.title}
				</Typography>
				<Chip
					label={props.status}
					size="small"
					variant="outlined"
					sx={{ height: 18, fontSize: 10, textTransform: "uppercase" }}
				/>
			</Stack>
			<Stack spacing={0.35}>
				{props.lines.map((line) => (
					<Typography key={line} variant="caption" color="text.secondary" sx={{ display: "block", fontSize: 10 }}>
						{line}
					</Typography>
				))}
			</Stack>
			{props.children ? <Box sx={{ mt: 0.75 }}>{props.children}</Box> : null}
		</Box>
	);
}

export function FunctionalDebugPanel(props: FunctionalDebugPanelProps) {
	const latestTask = props.functionalState.latestTask;
	const latestSnapshot = props.functionalState.latestSnapshot;
	const latestRun = useMemo(
		() => buildLatestGameRun(props.game2048State, props.stardewState),
		[props.game2048State, props.stardewState],
	);
	const [selectedTaskId, setSelectedTaskId] = useState<string | null>(props.functionalState.latestTask?.id ?? null);

	useEffect(() => {
		if (props.functionalState.latestTask?.id) {
			setSelectedTaskId((current) => current ?? props.functionalState.latestTask!.id);
		}
	}, [props.functionalState.latestTask?.id]);

	useEffect(() => {
		if (selectedTaskId && props.functionalState.taskHistory.some((task) => task.id === selectedTaskId)) {
			return;
		}
		setSelectedTaskId(props.functionalState.taskHistory[0]?.id ?? props.functionalState.latestTask?.id ?? null);
	}, [props.functionalState.taskHistory, props.functionalState.latestTask, selectedTaskId]);

	const selectedTask = useMemo(() => {
		if (selectedTaskId && props.functionalState.latestTask?.id === selectedTaskId) {
			return props.functionalState.latestTask;
		}
		return props.functionalState.taskHistory.find((task) => task.id === selectedTaskId)
			?? props.functionalState.latestTask
			?? null;
	}, [props.functionalState.latestTask, props.functionalState.taskHistory, selectedTaskId]);

	const captureStageStatus = latestSnapshot
		? "success"
		: props.functionalState.activeTaskId && latestTask?.actionKind === "capture"
			? "active"
			: "idle";
	const decisionStageStatus = latestRun
		? (latestRun.analysisSource === "vision-llm" ? "success" : "warning")
		: "idle";
	const actionStageStatus = latestTask
		? (latestTask.status === "running" ? "active" : latestTask.status === "completed" ? "success" : "warning")
		: "idle";
	const verificationStageStatus = latestRun
		? (latestRun.attempts.some((attempt) => attempt.changed) ? "success" : "warning")
		: "idle";

	return (
		<Box sx={{ mt: 1, p: 0.75, border: "1px solid", borderColor: "divider", borderRadius: 1 }}>
			<Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 0.75 }}>
				<Box>
					<Typography variant="caption" color="text.secondary" fontWeight={700}>
						Functional Debug Drill-down
					</Typography>
					<Typography variant="caption" color="text.secondary" sx={{ display: "block", fontSize: 10 }}>
						把 capture / decision / action / verification 拆开看
					</Typography>
				</Box>
				{props.functionalState.selectedTarget ? (
					<Chip
						label={props.functionalState.selectedTarget.title}
						size="small"
						variant="outlined"
						sx={{ maxWidth: 160, "& .MuiChip-label": { overflow: "hidden", textOverflow: "ellipsis" } }}
					/>
				) : (
					<Chip label="未选目标" size="small" variant="outlined" />
				)}
			</Stack>

			{props.functionalState.safetyBlockedReason && (
				<Alert severity="warning" sx={{ mb: 0.75, py: 0 }}>
					安全阻断: {props.functionalState.safetyBlockedReason}
				</Alert>
			)}

			<Stack spacing={0.75}>
				<StageCard
					title="Capture"
					status={captureStageStatus}
					lines={latestSnapshot ? [
						`target: ${latestSnapshot.targetTitle}`,
						`size: ${latestSnapshot.width}x${latestSnapshot.height}`,
						`method: ${latestSnapshot.captureMethod}`,
						`quality: ${latestSnapshot.qualityScore.toFixed(3)}${latestSnapshot.lowConfidence ? " (low-confidence)" : ""}`,
						`captured: ${formatTime(latestSnapshot.capturedAt)}`,
					] : ["还没有可视快照"]}
				>
					{latestSnapshot ? (
						<>
							{latestSnapshot.lowConfidence && (
								<Alert severity="warning" sx={{ mb: 0.75, py: 0 }}>
									当前截图可信度偏低，后续验证结果可能不可靠。
								</Alert>
							)}
							<SnapshotCard
								title="Latest Snapshot"
								dataUrl={latestSnapshot.dataUrl}
								label={latestSnapshot.targetTitle}
								height={180}
							/>
						</>
					) : null}
				</StageCard>

				<StageCard
					title="Decision"
					status={decisionStageStatus}
					lines={latestRun ? [
						`game: ${latestRun.game}`,
						`source: ${latestRun.analysisSource}`,
						`at: ${formatTime(latestRun.startedAt)}`,
						`strategy: ${latestRun.strategy}`,
					] : ["还没有游戏分析结果"]}
				>
					{latestRun ? (
						<>
							<Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.5, fontSize: 10 }}>
								推理: {latestRun.reasoning}
							</Typography>
							<Stack direction="row" spacing={0.5} sx={{ flexWrap: "wrap", rowGap: 0.5 }}>
								{latestRun.preferred.map((entry) => (
									<Chip key={`${latestRun.game}-${entry}`} label={entry} size="small" variant="outlined" sx={{ height: 18, fontSize: 10 }} />
								))}
							</Stack>
						</>
					) : null}
				</StageCard>

				<StageCard
					title="Action"
					status={actionStageStatus}
					lines={latestTask ? [
						`task: ${latestTask.name}`,
						`status: ${latestTask.status}`,
						`duration: ${formatDuration(latestTask.startedAt, latestTask.endedAt)}`,
						`target: ${latestTask.targetTitle}`,
					] : ["还没有功能动作任务"]}
				>
					{latestTask ? (
						<>
							<Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.5, fontSize: 10 }}>
								摘要: {latestTask.summary || "—"}
							</Typography>
							<Stack spacing={0.35}>
								{latestTask.logs.slice(-5).map((entry) => (
									<Typography key={`${latestTask.id}-${entry.timestamp}-${entry.message}`} variant="caption" color="text.secondary" sx={{ display: "block", fontSize: 10 }}>
										[{formatTime(entry.timestamp)}] {entry.level}: {entry.message}
									</Typography>
								))}
							</Stack>
						</>
					) : null}
				</StageCard>

				<StageCard
					title="Verification"
					status={verificationStageStatus}
					lines={latestRun ? [
						`status: ${latestRun.status}`,
						`summary: ${latestRun.summary}`,
						`attempts: ${latestRun.attempts.length}`,
					] : ["还没有验证结果"]}
				>
					{latestRun ? (
						<>
							<Stack spacing={0.35} sx={{ mb: 0.5 }}>
								{latestRun.attempts.length > 0 ? latestRun.attempts.map((attempt) => (
									<Typography key={`${latestRun.game}-${attempt.label}`} variant="caption" color="text.secondary" sx={{ display: "block", fontSize: 10 }}>
										{attempt.label}: {attempt.changed ? "changed" : "no change"} ({formatPercent(attempt.changeRatio)})
									</Typography>
								)) : (
									<Typography variant="caption" color="text.secondary" sx={{ display: "block", fontSize: 10 }}>
										还没有动作尝试记录
									</Typography>
								)}
							</Stack>
							<Typography variant="caption" color="text.secondary" sx={{ display: "block", fontSize: 10 }}>
								反馈: {latestRun.companionText}
							</Typography>
						</>
					) : null}
				</StageCard>
			</Stack>

			{selectedTask && (
				<>
					<Divider sx={{ my: 1 }} />
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
						{[props.functionalState.latestTask, ...props.functionalState.taskHistory]
							.filter((task, index, array): task is FunctionalTaskRecord => Boolean(task) && array.findIndex((item) => item?.id === task?.id) === index)
							.slice(0, 6)
							.map((task) => (
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
							<Box sx={{ flex: 1, minWidth: 0, p: 1, border: "1px dashed", borderColor: "divider", borderRadius: 1 }}>
								<Typography variant="caption" color="text.secondary">没有前置快照</Typography>
							</Box>
						)}
						{selectedTask.afterSnapshot ? (
							<SnapshotCard
								title={`After ${selectedTask.actionKind}`}
								dataUrl={selectedTask.afterSnapshot.dataUrl}
								label={`${selectedTask.name} after`}
							/>
						) : (
							<Box sx={{ flex: 1, minWidth: 0, p: 1, border: "1px dashed", borderColor: "divider", borderRadius: 1 }}>
								<Typography variant="caption" color="text.secondary">没有后置快照</Typography>
							</Box>
						)}
					</Stack>
				</>
			)}

			{props.evaluationState.latestResult && (
				<>
					<Divider sx={{ my: 1 }} />
					<Typography variant="caption" color="text.secondary" fontWeight={700}>
						Evaluation Summary
					</Typography>
					<Stack spacing={0.35} sx={{ mt: 0.5 }}>
						<Typography variant="caption" color="text.secondary" sx={{ display: "block", fontSize: 10 }}>
							case: {props.evaluationState.latestResult.caseName}
						</Typography>
						<Typography variant="caption" color="text.secondary" sx={{ display: "block", fontSize: 10 }}>
							success: {formatPercent(props.evaluationState.latestResult.metrics.successRate)} · valid: {formatPercent(props.evaluationState.latestResult.metrics.actionValidityRate)}
						</Typography>
						<Typography variant="caption" color="text.secondary" sx={{ display: "block", fontSize: 10 }}>
							latency: avg {props.evaluationState.latestResult.metrics.averageLatencyMs.toFixed(0)}ms · p50 {props.evaluationState.latestResult.metrics.medianLatencyMs.toFixed(0)}ms
						</Typography>
					</Stack>
				</>
			)}
		</Box>
	);
}
