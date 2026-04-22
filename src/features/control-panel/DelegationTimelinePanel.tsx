import { useEffect, useRef, useState } from "react";
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
	LinearProgress,
	type SelectChangeEvent,
} from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import ErrorIcon from "@mui/icons-material/Error";
import HelpOutlineIcon from "@mui/icons-material/HelpOutline";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
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
			sx={{ mr: 0.5 }}
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
		<Chip size="small" label={alignment} color={colorMap[alignment] ?? "default"} variant="outlined" sx={{ mr: 0.5 }} />
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
		<Chip size="small" label={progress} color={colorMap[progress] ?? "default"} variant="outlined" sx={{ mr: 0.5 }} />
	);
}

function RoundCard({ entry, isLatest }: { entry: DelegationRoundEntry; isLatest: boolean }) {
	const time = new Date(entry.timestamp).toLocaleTimeString();

	return (
		<Accordion
			defaultExpanded={isLatest}
			disableGutters
			sx={{
				"&:before": { display: "none" },
				boxShadow: "none",
				borderLeft: 3,
				borderColor: entry.evaluatorSucceeded ? "success.main" : "error.main",
				mb: 0.5,
				bgcolor: isLatest ? "action.selected" : "transparent",
			}}
		>
			<AccordionSummary expandIcon={<ExpandMoreIcon />} sx={{ minHeight: 36, py: 0, "& .MuiAccordionSummary-content": { my: 0.5, alignItems: "center" } }}>
				<Box sx={{ display: "flex", alignItems: "center", gap: 0.5, flexWrap: "wrap", width: "100%" }}>
					<Typography variant="caption" sx={{ fontWeight: 700, fontFamily: "monospace", minWidth: 28 }}>
						R{entry.round}
					</Typography>
					<Typography variant="caption" color="text.disabled" sx={{ fontSize: "0.65rem" }}>
						{time}
					</Typography>
					<Chip size="small" label={entry.actionTool.replace("host.", "")} sx={{ fontSize: "0.65rem", height: 18 }} />
					<Box sx={{ flex: 1 }} />
					<StatusChip ok={entry.evaluatorSucceeded} label={entry.evaluatorSucceeded ? "OK" : "FAIL"} />
					<AlignmentChip alignment={entry.evaluatorAlignment} />
					<ProgressChip progress={entry.evaluatorProgress} />
				</Box>
			</AccordionSummary>
			<AccordionDetails sx={{ pt: 0, px: 1.5, pb: 1 }}>
				<Box sx={{ display: "flex", flexDirection: "column", gap: 0.8 }}>
					<Section label="Planner">
						<Typography variant="body2" sx={{ whiteSpace: "pre-wrap", fontSize: "0.8rem" }}>
							{entry.plannerReasoning}
						</Typography>
						{entry.plannerExpectedOutcome && (
							<Typography variant="body2" color="info.main" sx={{ mt: 0.3, fontSize: "0.8rem" }}>
								→ {entry.plannerExpectedOutcome}
							</Typography>
						)}
					</Section>
					<Section label="Action">
						<Typography variant="body2" sx={{ fontFamily: "monospace", fontSize: "0.72rem", wordBreak: "break-all", color: "text.secondary" }}>
							{entry.actionTool}({entry.actionSummary})
						</Typography>
					</Section>
					<Section label="Evaluator">
						<Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5, mb: 0.3 }}>
							<StatusChip ok={entry.evaluatorCorrect} label={entry.evaluatorCorrect ? "correct" : "incorrect"} />
							<StatusChip ok={entry.evaluatorExpectedMet} label={entry.evaluatorExpectedMet ? "expected met" : "expected miss"} />
						</Box>
						{entry.evaluatorReply && (
							<Typography variant="body2" sx={{ fontStyle: "italic", fontSize: "0.8rem", color: "text.secondary" }}>
								"{entry.evaluatorReply}"
							</Typography>
						)}
						{entry.evaluatorHint && (
							<Typography variant="body2" color="warning.main" sx={{ mt: 0.3, fontSize: "0.8rem" }}>
								💡 {entry.evaluatorHint}
							</Typography>
						)}
					</Section>
				</Box>
			</AccordionDetails>
		</Accordion>
	);
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
	return (
		<Box>
			<Typography variant="caption" color="text.disabled" fontWeight={600} sx={{ fontSize: "0.65rem", textTransform: "uppercase", letterSpacing: 0.5 }}>
				{label}
			</Typography>
			{children}
		</Box>
	);
}

function TaskHeader({ timeline, run }: { timeline: DelegationTimeline; run: UnifiedRunRecord }) {
	const { t } = useI18n();
	const statusColor: Record<string, "success" | "error" | "warning"> = {
		completed: "success",
		failed: "error",
		running: "warning",
	};
	const isRunning = run.status === "running";

	return (
		<Box sx={{ px: 1.5, pt: 1.5, pb: 1 }}>
			<Typography variant="subtitle2" fontWeight={700} sx={{ lineHeight: 1.3 }}>
				{timeline.taskText}
			</Typography>
			<Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.3, lineHeight: 1.4 }}>
				{timeline.missionGoal}
			</Typography>
			<Box sx={{ display: "flex", gap: 1, mt: 1, alignItems: "center" }}>
				<Chip
					size="small"
					icon={isRunning ? <PlayArrowIcon /> : undefined}
					label={run.status}
					color={statusColor[run.status] ?? "default"}
				/>
				<Typography variant="caption" color="text.secondary">
					{timeline.rounds.length} {t("轮", "rounds")}
					{run.timings.actionMs ? ` · ${(run.timings.actionMs / 1000).toFixed(1)}s` : ""}
				</Typography>
			</Box>
			{isRunning && <LinearProgress sx={{ mt: 1, borderRadius: 1 }} />}
		</Box>
	);
}

function TimelineView({ timeline, run }: { timeline: DelegationTimeline; run: UnifiedRunRecord }) {
	const { t } = useI18n();
	const scrollRef = useRef<HTMLDivElement>(null);
	const prevRoundCount = useRef(timeline.rounds.length);

	useEffect(() => {
		if (timeline.rounds.length > prevRoundCount.current && scrollRef.current) {
			scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
		}
		prevRoundCount.current = timeline.rounds.length;
	}, [timeline.rounds.length]);

	return (
		<Box sx={{ display: "flex", flexDirection: "column", height: "100%" }}>
			<TaskHeader timeline={timeline} run={run} />
			<Box ref={scrollRef} sx={{ flex: 1, overflowY: "auto", px: 1, pb: 1 }}>
				{timeline.rounds.map((entry, i) => (
					<RoundCard key={entry.round} entry={entry} isLatest={i === timeline.rounds.length - 1} />
				))}
				{!timeline.rounds.length && (
					<Box sx={{ p: 2, textAlign: "center" }}>
						<Typography variant="body2" color="text.disabled">
							{t("等待第一轮执行…", "Waiting for first round…")}
						</Typography>
					</Box>
				)}
			</Box>
			{run.summary && run.status !== "running" && (
				<Box sx={{ mx: 1.5, mb: 1, p: 1, bgcolor: run.status === "completed" ? "success.main" : "error.main", borderRadius: 1, color: "white" }}>
					<Typography variant="caption" fontWeight={600}>
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
	const hasActive = activeTimeline && activeRun;

	const allRuns = [
		...(hasActive ? [{ run: activeRun, timeline: activeTimeline, label: `${activeRun.status === "running" ? "▶" : activeRun.status === "completed" ? "✓" : "✗"} ${activeRun.id.slice(-6)} — ${activeRun.requestText?.slice(0, 24) ?? "—"}` }] : []),
		...runsWithTimeline
			.filter((r) => r.id !== activeRun?.id)
			.map((r) => ({
				run: r,
				timeline: r.delegationTimeline,
				label: `${r.status === "completed" ? "✓" : "✗"} ${r.id.slice(-6)} — ${r.requestText?.slice(0, 24) ?? "—"}`,
			})),
	];

	if (!allRuns.length) {
		return (
			<Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", gap: 1.5, px: 3 }}>
				<HelpOutlineIcon sx={{ fontSize: 48, color: "text.disabled" }} />
				<Typography variant="body2" color="text.secondary" textAlign="center">
					{t(
						"暂无托管任务记录。启动一次托管任务后，时间轴将实时显示每一轮的规划、执行与评估。",
						"No delegation tasks yet. Start a task and the timeline will show each round's planning, execution, and evaluation in real time.",
					)}
				</Typography>
			</Box>
		);
	}

	const selected = allRuns[selectedIdx] ?? allRuns[0];

	return (
		<Box sx={{ display: "flex", flexDirection: "column", height: "100%" }}>
			{allRuns.length > 1 && (
				<Box sx={{ px: 1.5, pt: 1, borderBottom: 1, borderColor: "divider" }}>
					<FormControl size="small" fullWidth>
						<InputLabel>{t("任务", "Task")}</InputLabel>
						<Select
							value={selectedIdx}
							label={t("任务", "Task")}
							onChange={(e: SelectChangeEvent<number>) => setSelectedIdx(Number(e.target.value))}
						>
							{allRuns.map((item, idx) => (
								<MenuItem key={idx} value={idx} sx={{ fontSize: "0.85rem" }}>
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
