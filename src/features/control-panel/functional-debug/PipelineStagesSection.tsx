import { Alert, Chip, Stack, Typography } from "@mui/material";
import type { FunctionalRuntimeState, Game2048State, SokobanState } from "@/types";
import { buildLatestGameRun, formatDuration, formatPercent, formatTime, SnapshotCard, StageCard } from "./shared";

interface PipelineStagesSectionProps {
	functionalState: FunctionalRuntimeState;
	game2048State: Game2048State;
	sokobanState: SokobanState;
}

export function PipelineStagesSection(props: PipelineStagesSectionProps) {
	const latestTask = props.functionalState.latestTask;
	const latestSnapshot = props.functionalState.latestSnapshot;
	const latestRun = buildLatestGameRun(props.game2048State, props.sokobanState);

	const captureStageStatus = latestSnapshot
		? "success"
		: props.functionalState.activeTaskId && latestTask?.actionKind === "capture"
			? "active"
			: "idle";
	const decisionStageStatus = latestRun
		? (latestRun.analysisSource === "heuristic" ? "warning" : "success")
		: "idle";
	const actionStageStatus = latestTask
		? (latestTask.status === "running" ? "active" : latestTask.status === "completed" ? "success" : "warning")
		: "idle";
	const verificationStageStatus = latestRun
		? (latestRun.attempts.some((attempt) => attempt.changed) ? "success" : "warning")
		: "idle";

	return (
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
							反思: {latestRun.reflection}
						</Typography>
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
	);
}
