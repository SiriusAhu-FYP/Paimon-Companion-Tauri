import { useState } from "react";
import {
	Accordion,
	AccordionDetails,
	AccordionSummary,
	Box,
	Chip,
	Typography,
	Select,
	MenuItem,
	FormControl,
	InputLabel,
	type SelectChangeEvent,
} from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import ErrorIcon from "@mui/icons-material/Error";
import HelpOutlineIcon from "@mui/icons-material/HelpOutline";
import { useUnifiedRuntime } from "@/hooks/use-unified-runtime";
import { useI18n } from "@/contexts/I18nProvider";
import type { DelegationRoundEntry, DelegationTimeline, UnifiedRunRecord } from "@/types/unified";

function StatusChip({ ok, label }: { ok: boolean; label: string }) {
	return (
		<Chip
			size="small"
			icon={ok ? <CheckCircleIcon /> : <ErrorIcon />}
			label={label}
			color={ok ? "success" : "error"}
			variant="outlined"
			sx={{ mr: 0.5, mb: 0.5 }}
		/>
	);
}

function AlignmentChip({ alignment }: { alignment: string }) {
	const colorMap: Record<string, "success" | "warning" | "error" | "default"> = {
		achieved: "success",
		aligned: "success",
		partial: "warning",
		deviated: "error",
	};
	return (
		<Chip
			size="small"
			label={alignment}
			color={colorMap[alignment] ?? "default"}
			variant="outlined"
			sx={{ mr: 0.5, mb: 0.5 }}
		/>
	);
}

function ProgressChip({ progress }: { progress: string }) {
	const colorMap: Record<string, "success" | "warning" | "error" | "default"> = {
		done: "success",
		forward: "success",
		stuck: "warning",
		none: "error",
	};
	return (
		<Chip
			size="small"
			label={`progress: ${progress}`}
			color={colorMap[progress] ?? "default"}
			variant="outlined"
			sx={{ mr: 0.5, mb: 0.5 }}
		/>
	);
}

function RoundCard({ entry }: { entry: DelegationRoundEntry }) {
	const time = new Date(entry.timestamp).toLocaleTimeString();

	return (
		<Accordion
			defaultExpanded={false}
			disableGutters
			sx={{ "&:before": { display: "none" }, boxShadow: "none", borderBottom: 1, borderColor: "divider" }}
		>
			<AccordionSummary expandIcon={<ExpandMoreIcon />} sx={{ minHeight: 40, "& .MuiAccordionSummary-content": { my: 0.5 } }}>
				<Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap", width: "100%" }}>
					<Typography variant="subtitle2" sx={{ fontWeight: 700, minWidth: 60 }}>
						R{entry.round}
					</Typography>
					<Typography variant="caption" color="text.secondary">
						{time}
					</Typography>
					<Chip size="small" label={entry.actionTool} variant="filled" sx={{ fontSize: "0.7rem" }} />
					<StatusChip ok={entry.evaluatorSucceeded} label={entry.evaluatorSucceeded ? "OK" : "FAIL"} />
					<AlignmentChip alignment={entry.evaluatorAlignment} />
					<ProgressChip progress={entry.evaluatorProgress} />
				</Box>
			</AccordionSummary>
			<AccordionDetails sx={{ pt: 0 }}>
				<Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
					<Box>
						<Typography variant="caption" color="text.secondary" fontWeight={600}>Planner</Typography>
						<Typography variant="body2" sx={{ whiteSpace: "pre-wrap" }}>
							{entry.plannerReasoning}
						</Typography>
						{entry.plannerExpectedOutcome && (
							<Typography variant="body2" color="info.main" sx={{ mt: 0.5 }}>
								→ {entry.plannerExpectedOutcome}
							</Typography>
						)}
					</Box>
					<Box>
						<Typography variant="caption" color="text.secondary" fontWeight={600}>Action</Typography>
						<Typography variant="body2" sx={{ fontFamily: "monospace", fontSize: "0.75rem", wordBreak: "break-all" }}>
							{entry.actionTool}: {entry.actionSummary}
						</Typography>
					</Box>
					<Box>
						<Typography variant="caption" color="text.secondary" fontWeight={600}>Evaluator</Typography>
						<Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5, mb: 0.5 }}>
							<StatusChip ok={entry.evaluatorCorrect} label={entry.evaluatorCorrect ? "correct" : "incorrect"} />
							<StatusChip ok={entry.evaluatorExpectedMet} label={entry.evaluatorExpectedMet ? "expected met" : "expected not met"} />
						</Box>
						{entry.evaluatorReply && (
							<Typography variant="body2" sx={{ fontStyle: "italic" }}>
								"{entry.evaluatorReply}"
							</Typography>
						)}
						{entry.evaluatorHint && (
							<Typography variant="body2" color="warning.main" sx={{ mt: 0.5 }}>
								Hint: {entry.evaluatorHint}
							</Typography>
						)}
					</Box>
				</Box>
			</AccordionDetails>
		</Accordion>
	);
}

function TimelineView({ timeline, run }: { timeline: DelegationTimeline; run: UnifiedRunRecord }) {
	const { t } = useI18n();
	const statusColor: Record<string, "success" | "error" | "warning"> = {
		completed: "success",
		failed: "error",
		running: "warning",
	};

	return (
		<Box sx={{ p: 1 }}>
			<Box sx={{ mb: 1.5 }}>
				<Typography variant="subtitle2" fontWeight={700}>
					{timeline.taskText}
				</Typography>
				<Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5 }}>
					{timeline.missionGoal}
				</Typography>
				<Box sx={{ display: "flex", gap: 1, mt: 1, flexWrap: "wrap", alignItems: "center" }}>
					<Chip
						size="small"
						label={run.status}
						color={statusColor[run.status] ?? "default"}
					/>
					<Typography variant="caption" color="text.secondary">
						{timeline.rounds.length} {t("轮", "rounds")}
						{" · "}
						{run.timings.actionMs ? `${(run.timings.actionMs / 1000).toFixed(1)}s` : "—"}
					</Typography>
				</Box>
			</Box>
			{timeline.rounds.map((entry) => (
				<RoundCard key={entry.round} entry={entry} />
			))}
			{run.summary && (
				<Box sx={{ mt: 1.5, p: 1, bgcolor: "action.hover", borderRadius: 1 }}>
					<Typography variant="caption" color="text.secondary" fontWeight={600}>
						{t("结论", "Conclusion")}
					</Typography>
					<Typography variant="body2">{run.summary}</Typography>
				</Box>
			)}
		</Box>
	);
}

export function DelegationTimelinePanel() {
	const { t } = useI18n();
	const { state } = useUnifiedRuntime();
	const [selectedIdx, setSelectedIdx] = useState<number>(0);

	const runsWithTimeline = state.history.filter(
		(r): r is UnifiedRunRecord & { delegationTimeline: DelegationTimeline } =>
			r.delegationTimeline != null && r.delegationTimeline.rounds.length > 0,
	);

	const activeTimeline = state.lastRun?.delegationTimeline;
	const activeRun = state.lastRun;
	const hasActive = activeTimeline && activeTimeline.rounds.length > 0 && activeRun;

	const allRuns = [
		...(hasActive ? [{ run: activeRun!, timeline: activeTimeline!, label: `${t("当前", "Current")} (${activeRun!.id.slice(-6)})` }] : []),
		...runsWithTimeline.map((r) => ({
			run: r,
			timeline: r.delegationTimeline,
			label: `${r.status === "completed" ? "✓" : "✗"} ${r.id.slice(-6)} — ${r.requestText?.slice(0, 30) ?? "—"}`,
		})),
	];

	if (!allRuns.length) {
		return (
			<Box sx={{ p: 3, textAlign: "center" }}>
				<HelpOutlineIcon sx={{ fontSize: 40, color: "text.disabled", mb: 1 }} />
				<Typography variant="body2" color="text.secondary">
					{t("暂无托管任务记录。启动一次托管任务后，时间轴将显示在此处。", "No delegation task history yet. Start a delegation task to see the timeline here.")}
				</Typography>
			</Box>
		);
	}

	const selected = allRuns[selectedIdx] ?? allRuns[0];

	return (
		<Box sx={{ display: "flex", flexDirection: "column", height: "100%" }}>
			{allRuns.length > 1 && (
				<Box sx={{ p: 1, borderBottom: 1, borderColor: "divider" }}>
					<FormControl size="small" fullWidth>
						<InputLabel>{t("选择任务", "Select Task")}</InputLabel>
						<Select
							value={selectedIdx}
							label={t("选择任务", "Select Task")}
							onChange={(e: SelectChangeEvent<number>) => setSelectedIdx(Number(e.target.value))}
						>
							{allRuns.map((item, idx) => (
								<MenuItem key={idx} value={idx}>
									{item.label}
								</MenuItem>
							))}
						</Select>
					</FormControl>
				</Box>
			)}
			{selected && <TimelineView timeline={selected.timeline} run={selected.run} />}
		</Box>
	);
}
