import { useEffect, useRef, useState, useCallback } from "react";
import {
	Accordion,
	AccordionDetails,
	AccordionSummary,
	Box,
	Chip,
	Typography,
	LinearProgress,
	Button,
	ButtonGroup,
	List,
	ListItemButton,
	ListItemText,
	CircularProgress,
} from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import ErrorIcon from "@mui/icons-material/Error";
import HelpOutlineIcon from "@mui/icons-material/HelpOutline";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import HistoryIcon from "@mui/icons-material/History";
import LiveTvIcon from "@mui/icons-material/LiveTv";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import { useUnifiedRuntime } from "@/hooks/use-unified-runtime";
import { useI18n } from "@/contexts/I18nProvider";
import { listDebugCaptureSessions, readDebugCaptureFile, type DebugCaptureSessionSummary } from "@/services/debug-capture/client";
import type { DelegationRoundEntry, DelegationTimeline, UnifiedRunRecord } from "@/types/unified";

type ViewMode = "live" | "history";

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
		achieved: "success", aligned: "success", closer: "success",
		partial: "warning", unchanged: "warning", stuck: "warning",
		deviated: "error",
	};
	return <Chip size="small" label={alignment} color={colorMap[alignment] ?? "default"} variant="outlined" sx={{ mr: 0.5 }} />;
}

function ProgressChip({ progress }: { progress: string }) {
	const colorMap: Record<string, "success" | "warning" | "error" | "default"> = {
		done: "success", forward: "success",
		stuck: "warning", none: "error",
	};
	return <Chip size="small" label={progress} color={colorMap[progress] ?? "default"} variant="outlined" sx={{ mr: 0.5 }} />;
}

function RoundCard({ entry, isLatest }: { entry: DelegationRoundEntry; isLatest: boolean }) {
	const { t } = useI18n();
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
					<StatusChip
						ok={entry.evaluatorSucceeded}
						label={entry.evaluatorSucceeded ? t("执行成功", "Action Succeeded") : t("执行失败", "Action Failed")}
					/>
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
					{(entry.committedRoute || entry.currentRouteStep || entry.routeDiagnosis || entry.boardGrid) && (
						<Section label={t("路线状态", "Route State")}>
							{entry.committedRoute && (
								<Typography variant="body2" sx={{ fontSize: "0.78rem" }}>
									{t("路线", "Route")}: {entry.committedRoute}
								</Typography>
							)}
							{entry.currentRouteStep && (
								<Typography variant="body2" sx={{ fontSize: "0.78rem" }}>
									{t("步骤", "Step")}: {entry.currentRouteStep}
								</Typography>
							)}
							{entry.routeDiagnosis && (
								<Typography variant="body2" color="warning.main" sx={{ fontSize: "0.78rem" }}>
									{entry.routeDiagnosis}
								</Typography>
							)}
							{entry.boardGrid && (
								<Typography variant="body2" sx={{ fontFamily: "monospace", whiteSpace: "pre-wrap", fontSize: "0.72rem", color: "text.secondary" }}>
									{entry.boardGrid}
								</Typography>
							)}
						</Section>
					)}
					<Section label="Action">
						<Typography variant="body2" sx={{ fontFamily: "monospace", fontSize: "0.72rem", wordBreak: "break-all", color: "text.secondary" }}>
							{entry.actionTool}({entry.actionSummary})
						</Typography>
					</Section>
					<Section label="Evaluator">
						<Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5, mb: 0.3 }}>
							<StatusChip
								ok={entry.evaluatorCorrect}
								label={
									entry.evaluatorCorrect
										? t("动作判断：合适", "Action Judgment: Correct")
										: t("动作判断：不合适", "Action Judgment: Incorrect")
								}
							/>
							<StatusChip
								ok={entry.evaluatorExpectedMet}
								label={
									entry.evaluatorExpectedMet
										? t("预期结果：达成", "Expected Outcome: Met")
										: t("预期结果：未达成", "Expected Outcome: Missed")
								}
							/>
						</Box>
						{entry.evaluatorReply && (
							<Typography variant="body2" sx={{ fontStyle: "italic", fontSize: "0.8rem", color: "text.secondary" }}>
								"{entry.evaluatorReply}"
							</Typography>
						)}
						{entry.evaluatorHint && (
							<Typography variant="body2" color="warning.main" sx={{ mt: 0.3, fontSize: "0.8rem" }}>
								{entry.evaluatorHint}
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

function TaskHeader({ timeline, status, timingsActionMs }: { timeline: DelegationTimeline; status: string; timingsActionMs?: number }) {
	const { t } = useI18n();
	const statusColor: Record<string, "success" | "error" | "warning"> = {
		completed: "success", failed: "error", running: "warning", stopped: "warning",
	};
	const isRunning = status === "running";
	return (
		<Box sx={{ px: 1.5, pt: 1.5, pb: 1 }}>
			<Typography variant="subtitle2" fontWeight={700} sx={{ lineHeight: 1.3 }}>
				{timeline.taskText}
			</Typography>
			<Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.3, lineHeight: 1.4 }}>
				{timeline.missionGoal}
			</Typography>
			<Box sx={{ display: "flex", gap: 1, mt: 1, alignItems: "center" }}>
				<Chip size="small" icon={isRunning ? <PlayArrowIcon /> : undefined} label={status} color={statusColor[status] ?? "default"} />
				<Typography variant="caption" color="text.secondary">
					{timeline.rounds.length} {t("轮", "rounds")}
					{timingsActionMs ? ` · ${(timingsActionMs / 1000).toFixed(1)}s` : ""}
				</Typography>
			</Box>
			{isRunning && <LinearProgress sx={{ mt: 1, borderRadius: 1 }} />}
		</Box>
	);
}

function TimelineView({ timeline, status, summary, timingsActionMs }: {
	timeline: DelegationTimeline;
	status: string;
	summary?: string;
	timingsActionMs?: number;
}) {
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
			<TaskHeader timeline={timeline} status={status} timingsActionMs={timingsActionMs} />
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
			{summary && status !== "running" && (
				<Box sx={{ mx: 1.5, mb: 1, p: 1, bgcolor: status === "completed" ? "success.main" : status === "stopped" ? "warning.main" : "error.main", borderRadius: 1, color: "white" }}>
					<Typography variant="caption" fontWeight={600}>
						{t("结论", "Conclusion")}
					</Typography>
					<Typography variant="body2">{summary}</Typography>
				</Box>
			)}
		</Box>
	);
}

function LiveView() {
	const { t } = useI18n();
	const { state } = useUnifiedRuntime();

	const activeTimeline = state.lastRun?.delegationTimeline;
	const activeRun = state.lastRun;
	const hasActive = activeTimeline && activeRun;

	const runsWithTimeline = state.history.filter(
		(r): r is UnifiedRunRecord & { delegationTimeline: DelegationTimeline } =>
			r.delegationTimeline != null && r.delegationTimeline.rounds.length > 0,
	);

	if (!hasActive && !runsWithTimeline.length) {
		return (
			<Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", gap: 1.5, px: 3 }}>
				<HelpOutlineIcon sx={{ fontSize: 48, color: "text.disabled" }} />
				<Typography variant="body2" color="text.secondary" textAlign="center">
					{t(
						"暂无托管任务记录。启动一次托管任务后，时间轴将实时显示每一轮的规划、执行与评估。",
						"No delegation tasks yet. Start a task to see real-time planning, execution, and evaluation.",
					)}
				</Typography>
			</Box>
		);
	}

	if (hasActive) {
		return (
			<TimelineView
				timeline={activeTimeline}
				status={activeRun.status}
				summary={activeRun.summary}
				timingsActionMs={activeRun.timings.actionMs}
			/>
		);
	}

	const latest = runsWithTimeline[0]!;
	return (
		<TimelineView
			timeline={latest.delegationTimeline}
			status={latest.status}
			summary={latest.summary}
			timingsActionMs={latest.timings.actionMs}
		/>
	);
}

function HistoryBrowser() {
	const { t } = useI18n();
	const [sessions, setSessions] = useState<DebugCaptureSessionSummary[]>([]);
	const [loading, setLoading] = useState(true);
	const [selectedSession, setSelectedSession] = useState<string | null>(null);
	const [sessionTimeline, setSessionTimeline] = useState<DelegationTimeline | null>(null);
	const [sessionStatus, setSessionStatus] = useState("unknown");
	const [sessionSummary, setSessionSummary] = useState("");
	const [loadingSession, setLoadingSession] = useState(false);

	useEffect(() => {
		listDebugCaptureSessions()
			.then(setSessions)
			.catch(() => setSessions([]))
			.finally(() => setLoading(false));
	}, []);

	const handleSelectSession = useCallback(async (sessionId: string) => {
		setSelectedSession(sessionId);
		setLoadingSession(true);
		try {
			const raw = await readDebugCaptureFile(sessionId, "events.jsonl");
			const lines = raw.trim().split("\n").filter(Boolean);
			let timeline: DelegationTimeline | null = null;
			let status = "unknown";
			let summary = "";
			for (const line of lines) {
				try {
					const entry = JSON.parse(line);
					if (entry.type === "delegation-timeline" && entry.timeline) {
						timeline = entry.timeline;
					}
					if (entry.type === "run-complete" || entry.type === "unified:run-complete") {
						status = entry.success ? "completed" : "failed";
						summary = entry.summary ?? "";
					}
					if (entry.delegationTimeline) {
						timeline = entry.delegationTimeline;
					}
					if (entry.event === "unified:state-change" && entry.payload?.state?.lastRun) {
						const lastRun = entry.payload.state.lastRun as UnifiedRunRecord;
						if (lastRun.delegationTimeline) {
							timeline = lastRun.delegationTimeline;
							status = lastRun.status ?? status;
							summary = lastRun.summary || summary;
						}
					}
					if (entry.event === "unified:run-complete" && entry.payload) {
						status = entry.payload.success ? "completed" : "failed";
						summary = entry.payload.summary ?? summary;
					}
					if (entry.status) {
						status = entry.status;
					}
					if (entry.summary && !summary) {
						summary = entry.summary;
					}
				} catch { /* skip malformed lines */ }
			}
			setSessionTimeline(timeline);
			setSessionStatus(status);
			setSessionSummary(summary);
		} catch {
			setSessionTimeline(null);
			setSessionStatus("error");
			setSessionSummary(t("无法加载会话数据", "Failed to load session data"));
		} finally {
			setLoadingSession(false);
		}
	}, [t]);

	if (selectedSession) {
		return (
			<Box sx={{ display: "flex", flexDirection: "column", height: "100%" }}>
				<Box sx={{ px: 1, pt: 1, pb: 0.5, display: "flex", alignItems: "center", gap: 1, borderBottom: 1, borderColor: "divider" }}>
					<Button size="small" startIcon={<ArrowBackIcon />} onClick={() => setSelectedSession(null)} sx={{ textTransform: "none" }}>
						{t("返回", "Back")}
					</Button>
					<Typography variant="caption" color="text.secondary" sx={{ fontFamily: "monospace" }}>
						{selectedSession}
					</Typography>
				</Box>
				{loadingSession ? (
					<Box sx={{ display: "flex", justifyContent: "center", p: 3 }}>
						<CircularProgress size={24} />
					</Box>
				) : sessionTimeline ? (
					<TimelineView
						timeline={sessionTimeline}
						status={sessionStatus}
						summary={sessionSummary}
					/>
				) : (
					<Box sx={{ p: 2, textAlign: "center" }}>
						<Typography variant="body2" color="text.secondary">
							{t("该会话无时间轴数据", "No timeline data in this session")}
						</Typography>
					</Box>
				)}
			</Box>
		);
	}

	if (loading) {
		return (
			<Box sx={{ display: "flex", justifyContent: "center", p: 3 }}>
				<CircularProgress size={24} />
			</Box>
		);
	}

	if (!sessions.length) {
		return (
			<Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", gap: 1.5, px: 3 }}>
				<HistoryIcon sx={{ fontSize: 48, color: "text.disabled" }} />
				<Typography variant="body2" color="text.secondary" textAlign="center">
					{t("暂无历史日志记录。", "No historical log sessions found.")}
				</Typography>
			</Box>
		);
	}

	return (
		<List sx={{ overflowY: "auto", flex: 1, py: 0 }}>
			{sessions.map((s) => (
				<ListItemButton key={s.sessionId} onClick={() => handleSelectSession(s.sessionId)} sx={{ py: 0.8, borderBottom: 1, borderColor: "divider" }}>
					<ListItemText
						primary={
							<Typography variant="body2" sx={{ fontFamily: "monospace", fontSize: "0.8rem" }}>
								{s.label || "manual"}
							</Typography>
						}
						secondary={
							<Typography variant="caption" color="text.secondary">
								{s.createdAt} · {s.sessionId}
							</Typography>
						}
					/>
				</ListItemButton>
			))}
		</List>
	);
}

export function DelegationTimelinePanel() {
	const { t } = useI18n();
	const [viewMode, setViewMode] = useState<ViewMode>("live");

	return (
		<Box sx={{ display: "flex", flexDirection: "column", height: "100%" }}>
			<Box sx={{ px: 1.5, pt: 1, pb: 0.5, display: "flex", justifyContent: "center", borderBottom: 1, borderColor: "divider" }}>
				<ButtonGroup size="small" variant="outlined">
					<Button
						startIcon={<LiveTvIcon sx={{ fontSize: 14 }} />}
						variant={viewMode === "live" ? "contained" : "outlined"}
						onClick={() => setViewMode("live")}
						sx={{ textTransform: "none", fontSize: 12 }}
					>
						{t("当前任务", "Current Task")}
					</Button>
					<Button
						startIcon={<HistoryIcon sx={{ fontSize: 14 }} />}
						variant={viewMode === "history" ? "contained" : "outlined"}
						onClick={() => setViewMode("history")}
						sx={{ textTransform: "none", fontSize: 12 }}
					>
						{t("历史日志", "History")}
					</Button>
				</ButtonGroup>
			</Box>
			<Box sx={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
				{viewMode === "live" ? <LiveView /> : <HistoryBrowser />}
			</Box>
		</Box>
	);
}
