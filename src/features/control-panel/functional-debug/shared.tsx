import { Box, Chip, Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";
import type {
	EvaluationCaseResult,
	FunctionalTaskRecord,
	Game2048State,
} from "@/types";

export interface DebugRun {
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

export function formatTime(timestamp: number | null): string {
	if (!timestamp) return "—";
	return new Date(timestamp).toLocaleTimeString();
}

export function formatDuration(startedAt: number, endedAt: number | null): string {
	const end = endedAt ?? Date.now();
	return `${Math.max(0, end - startedAt)}ms`;
}

export function formatPercent(value: number): string {
	return `${(value * 100).toFixed(1)}%`;
}

export function getTaskStatusColor(status: FunctionalTaskRecord["status"]): "success" | "warning" | "error" {
	if (status === "completed") return "success";
	if (status === "failed") return "error";
	return "warning";
}

export function buildLatestGameRun(game2048State: Game2048State): DebugRun | null {
	const gameRun = game2048State.lastRun;
	if (!gameRun) return null;

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

export function SnapshotCard(props: {
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

export function PlaceholderSnapshot(props: { message: string }) {
	return (
		<Box sx={{ flex: 1, minWidth: 0, p: 1, border: "1px dashed", borderColor: "divider", borderRadius: 1 }}>
			<Typography variant="caption" color="text.secondary">{props.message}</Typography>
		</Box>
	);
}

export function StageCard(props: {
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

export function EvaluationSummaryCard(props: { latestResult: EvaluationCaseResult }) {
	return (
		<>
			<Typography variant="caption" color="text.secondary" fontWeight={700}>
				Evaluation Summary
			</Typography>
			<Stack spacing={0.35} sx={{ mt: 0.5 }}>
				<Typography variant="caption" color="text.secondary" sx={{ display: "block", fontSize: 10 }}>
					case: {props.latestResult.caseName}
				</Typography>
				<Typography variant="caption" color="text.secondary" sx={{ display: "block", fontSize: 10 }}>
					success: {formatPercent(props.latestResult.metrics.successRate)} · valid: {formatPercent(props.latestResult.metrics.actionValidityRate)}
				</Typography>
				<Typography variant="caption" color="text.secondary" sx={{ display: "block", fontSize: 10 }}>
					latency: avg {props.latestResult.metrics.averageLatencyMs.toFixed(0)}ms · p50 {props.latestResult.metrics.medianLatencyMs.toFixed(0)}ms
				</Typography>
			</Stack>
		</>
	);
}
