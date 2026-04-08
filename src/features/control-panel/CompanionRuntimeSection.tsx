import { useEffect, useMemo, useState } from "react";
import { Alert, Button, Stack, TextField } from "@mui/material";
import type { CompanionRuntimeState, FunctionalRuntimeState } from "@/types";
import { useI18n } from "@/contexts/I18nProvider";
import { InfoLine, PanelCard, SectionHeader, SectionStatusChip } from "./panel-shell";

function formatSeconds(valueMs: number): string {
	return String(Math.round(valueMs / 1000));
}

function normalizePositiveSeconds(value: string, fallbackMs: number, min = 1, max = 600): number {
	const parsed = Number.parseInt(value, 10);
	if (!Number.isFinite(parsed)) {
		return fallbackMs;
	}
	return Math.min(max, Math.max(min, parsed)) * 1000;
}

function formatRuntimeDuration(startedAt: number | null): string {
	if (!startedAt) return "—";
	const elapsedSeconds = Math.max(0, Math.round((Date.now() - startedAt) / 1000));
	return `${elapsedSeconds}s`;
}

function formatRatio(numerator: number, denominator: number): string {
	if (denominator <= 0) return "0%";
	return `${Math.round((numerator / denominator) * 100)}%`;
}

export function CompanionRuntimeSection(props: {
	functionalState: FunctionalRuntimeState;
	companionRuntimeState: CompanionRuntimeState;
	onStart: (target: { handle: string; title: string }) => Promise<unknown>;
	onStop: () => void;
	onClearHistory: () => void;
	onRunSummaryNow: () => Promise<unknown>;
	onUpdateConfig: (partial: {
		localVisionBaseUrl?: string;
		localVisionModel?: string;
		captureIntervalMs?: number;
		summaryWindowMs?: number;
		historyRetentionMs?: number;
	}) => Promise<unknown>;
}) {
	const { t } = useI18n();
	const [localVisionBaseUrl, setLocalVisionBaseUrl] = useState(props.companionRuntimeState.localVisionBaseUrl);
	const [localVisionModel, setLocalVisionModel] = useState(props.companionRuntimeState.localVisionModel);
	const [captureIntervalSeconds, setCaptureIntervalSeconds] = useState(formatSeconds(props.companionRuntimeState.captureIntervalMs));
	const [summaryWindowSeconds, setSummaryWindowSeconds] = useState(formatSeconds(props.companionRuntimeState.summaryWindowMs));
	const [historyRetentionSeconds, setHistoryRetentionSeconds] = useState(formatSeconds(props.companionRuntimeState.historyRetentionMs));
	const [message, setMessage] = useState<{ type: "error" | "success"; text: string } | null>(null);
	const [saving, setSaving] = useState(false);

	useEffect(() => {
		setLocalVisionBaseUrl(props.companionRuntimeState.localVisionBaseUrl);
		setLocalVisionModel(props.companionRuntimeState.localVisionModel);
		setCaptureIntervalSeconds(formatSeconds(props.companionRuntimeState.captureIntervalMs));
		setSummaryWindowSeconds(formatSeconds(props.companionRuntimeState.summaryWindowMs));
		setHistoryRetentionSeconds(formatSeconds(props.companionRuntimeState.historyRetentionMs));
	}, [
		props.companionRuntimeState.captureIntervalMs,
		props.companionRuntimeState.historyRetentionMs,
		props.companionRuntimeState.localVisionBaseUrl,
		props.companionRuntimeState.localVisionModel,
		props.companionRuntimeState.summaryWindowMs,
	]);

	const currentTarget = props.functionalState.selectedTarget;
	const statusColor = props.companionRuntimeState.running
		? (props.companionRuntimeState.phase === "error" ? "error" : "warning")
		: "default";

	const summaryLabel = useMemo(() => {
		if (!props.companionRuntimeState.lastSummary) {
			return t("尚未总结", "No summary yet");
		}
		return `${props.companionRuntimeState.lastSummary.source} · ${props.companionRuntimeState.lastSummary.frameCount} ${t("帧", "frames")}`;
	}, [props.companionRuntimeState.lastSummary, t]);

	return (
		<PanelCard compact>
			<SectionHeader
				title={t("陪伴运行时", "Companion Runtime")}
				subtitle={t("本地帧描述队列 + 云端时序总结", "Local frame-description queue + cloud temporal summaries")}
				right={(
					<SectionStatusChip
						label={props.companionRuntimeState.running ? props.companionRuntimeState.phase : t("就绪", "Ready")}
						color={statusColor}
					/>
				)}
			/>

			<InfoLine>{t("当前目标", "Current Target")}：{currentTarget?.title ?? t("未选择", "Not selected")}</InfoLine>
			<InfoLine>{t("本地视觉", "Local Vision")}：{props.companionRuntimeState.localVisionModel}</InfoLine>
			<InfoLine>{t("帧队列", "Frame Queue")}：{props.companionRuntimeState.frameQueue.length}</InfoLine>
			<InfoLine>{t("总结历史", "Summary History")}：{props.companionRuntimeState.summaryHistory.length}</InfoLine>
			<InfoLine>{t("最近总结", "Latest Summary")}：{summaryLabel}</InfoLine>
			<InfoLine>{t("会话时长", "Session Duration")}：{formatRuntimeDuration(props.companionRuntimeState.metrics.sessionStartedAt)}</InfoLine>
			<InfoLine>{t("采样次数", "Capture Ticks")}：{props.companionRuntimeState.metrics.captureTicks}</InfoLine>
			<InfoLine>
				{t("视觉/静止", "Vision / Unchanged")}：
				{props.companionRuntimeState.metrics.visionFrames} / {props.companionRuntimeState.metrics.unchangedFrames}
				{" · "}
				{t("静止占比", "Unchanged Ratio")} {formatRatio(
					props.companionRuntimeState.metrics.unchangedFrames,
					props.companionRuntimeState.metrics.captureTicks,
				)}
			</InfoLine>
			<InfoLine>
				{t("平均帧耗时", "Avg Frame Latency")}：
				{props.companionRuntimeState.metrics.averageFrameLatencyMs.toFixed(0)}ms
				{" · "}
				{t("平均总结耗时", "Avg Summary Latency")}：
				{props.companionRuntimeState.metrics.averageSummaryLatencyMs.toFixed(0)}ms
			</InfoLine>

			<Stack direction="row" spacing={0.5} sx={{ mt: 0.75, mb: 0.75, flexWrap: "wrap" }}>
				<Button
					size="small"
					variant="contained"
					disabled={!currentTarget || props.companionRuntimeState.running}
					onClick={async () => {
						if (!currentTarget) return;
						setMessage(null);
						try {
							await props.onStart(currentTarget);
						} catch (err) {
							setMessage({ type: "error", text: err instanceof Error ? err.message : String(err) });
						}
					}}
				>
					{t("开始观察", "Start Watching")}
				</Button>
				<Button
					size="small"
					variant="outlined"
					disabled={!props.companionRuntimeState.running}
					onClick={props.onStop}
				>
					{t("停止", "Stop")}
				</Button>
				<Button
					size="small"
					variant="outlined"
					disabled={!props.companionRuntimeState.running}
					onClick={async () => {
						setMessage(null);
						try {
							await props.onRunSummaryNow();
						} catch (err) {
							setMessage({ type: "error", text: err instanceof Error ? err.message : String(err) });
						}
					}}
				>
					{t("立即总结", "Summarize Now")}
				</Button>
				<Button
					size="small"
					variant="text"
					onClick={props.onClearHistory}
				>
					{t("清空历史", "Clear History")}
				</Button>
			</Stack>

			<Stack direction="row" spacing={0.5} sx={{ mb: 0.5 }}>
				<TextField
					size="small"
					fullWidth
					label={t("本地视觉 Base URL", "Local Vision Base URL")}
					value={localVisionBaseUrl}
					onChange={(event) => setLocalVisionBaseUrl(event.target.value)}
				/>
				<TextField
					size="small"
					fullWidth
					label={t("本地视觉模型", "Local Vision Model")}
					value={localVisionModel}
					onChange={(event) => setLocalVisionModel(event.target.value)}
				/>
			</Stack>

			<Stack direction="row" spacing={0.5} sx={{ mb: 0.75 }}>
				<TextField
					size="small"
					fullWidth
					label={t("采样间隔(秒)", "Capture Interval (s)")}
					value={captureIntervalSeconds}
					onChange={(event) => setCaptureIntervalSeconds(event.target.value)}
				/>
				<TextField
					size="small"
					fullWidth
					label={t("总结窗口(秒)", "Summary Window (s)")}
					value={summaryWindowSeconds}
					onChange={(event) => setSummaryWindowSeconds(event.target.value)}
				/>
				<TextField
					size="small"
					fullWidth
					label={t("历史保留(秒)", "History Retention (s)")}
					value={historyRetentionSeconds}
					onChange={(event) => setHistoryRetentionSeconds(event.target.value)}
				/>
			</Stack>

			<Button
				size="small"
				variant="outlined"
				disabled={saving}
				onClick={async () => {
					setSaving(true);
					setMessage(null);
					try {
						await props.onUpdateConfig({
							localVisionBaseUrl: localVisionBaseUrl.trim(),
							localVisionModel: localVisionModel.trim(),
							captureIntervalMs: normalizePositiveSeconds(captureIntervalSeconds, props.companionRuntimeState.captureIntervalMs, 1, 10),
							summaryWindowMs: normalizePositiveSeconds(summaryWindowSeconds, props.companionRuntimeState.summaryWindowMs, 5, 30),
							historyRetentionMs: normalizePositiveSeconds(historyRetentionSeconds, props.companionRuntimeState.historyRetentionMs, 30, 300),
						});
						setMessage({ type: "success", text: t("运行时配置已保存。", "Companion runtime settings saved.") });
					} catch (err) {
						setMessage({ type: "error", text: err instanceof Error ? err.message : String(err) });
					} finally {
						setSaving(false);
					}
				}}
			>
				{saving ? t("保存中...", "Saving...") : t("保存运行时配置", "Save Runtime Settings")}
			</Button>

			{props.companionRuntimeState.lastFrame && (
				<InfoLine mb={0.5}>
					{t("最近帧描述", "Latest Frame Description")}：
					{props.companionRuntimeState.lastFrame.source === "unchanged"
						? `${t("静止帧", "Unchanged")} · `
						: `${t("视觉帧", "Vision")} · `}
					{props.companionRuntimeState.lastFrame.description}
				</InfoLine>
			)}
			{props.companionRuntimeState.lastSummary && (
				<InfoLine mb={0.5}>
					{t("最新时序总结", "Latest Temporal Summary")}：{props.companionRuntimeState.lastSummary.summary}
				</InfoLine>
			)}

			{(props.companionRuntimeState.lastError || message) && (
				<Alert severity={message?.type ?? "error"} sx={{ mt: 0.75, py: 0 }}>
					{message?.text ?? props.companionRuntimeState.lastError}
				</Alert>
			)}
		</PanelCard>
	);
}
