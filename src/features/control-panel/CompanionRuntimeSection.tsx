import { useMemo, useState } from "react";
import { Alert, Button, Stack } from "@mui/material";
import type { CompanionRuntimeState, FunctionalRuntimeState } from "@/types";
import { useI18n } from "@/contexts/I18nProvider";
import { InfoLine, PanelCard, SectionHeader, SectionStatusChip } from "./panel-shell";

function formatRuntimeDuration(startedAt: number | null): string {
	if (!startedAt) return "—";
	const elapsedSeconds = Math.max(0, Math.round((Date.now() - startedAt) / 1000));
	return `${elapsedSeconds}s`;
}

export function CompanionRuntimeSection(props: {
	functionalState: FunctionalRuntimeState;
	companionRuntimeState: CompanionRuntimeState;
	onStart: (target: { handle: string; title: string }) => Promise<unknown>;
	onStop: () => void;
	onClearHistory: () => void;
	onRunSummaryNow: () => Promise<unknown>;
}) {
	const { t } = useI18n();
	const [message, setMessage] = useState<{ type: "error" | "success"; text: string } | null>(null);

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
			<InfoLine>{t("连接状态", "Connection State")}：{props.companionRuntimeState.phase === "connecting" ? t("等待本地视觉节点就绪", "Waiting for local vision ready") : t("已连接或空闲", "Ready or idle")}</InfoLine>
			<InfoLine>{t("观察就绪", "Observation Ready")}：{props.companionRuntimeState.observationReady ? t("是", "Yes") : t("否", "No")}</InfoLine>
			<InfoLine>{t("诊断状态", "Runtime Diagnostic")}：{props.companionRuntimeState.diagnosticMessage ?? t("无", "None")}</InfoLine>
			<InfoLine>{t("最近总结", "Latest Summary")}：{summaryLabel}</InfoLine>
			<InfoLine>{t("会话时长", "Session Duration")}：{formatRuntimeDuration(props.companionRuntimeState.metrics.sessionStartedAt)}</InfoLine>

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
