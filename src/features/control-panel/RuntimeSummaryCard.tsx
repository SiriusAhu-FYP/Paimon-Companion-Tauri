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

export function RuntimeSummaryCard(props: {
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
			<InfoLine>{t("观察就绪", "Observation Ready")}：{props.companionRuntimeState.observationReady ? t("是", "Yes") : t("否", "No")}</InfoLine>
			<InfoLine>{t("诊断状态", "Runtime Diagnostic")}：{props.companionRuntimeState.diagnosticMessage ?? t("无", "None")}</InfoLine>
			<InfoLine>{t("最近总结", "Latest Summary")}：{summaryLabel}</InfoLine>
			<InfoLine mb={0.75}>{t("会话时长", "Session Duration")}：{formatRuntimeDuration(props.companionRuntimeState.metrics.sessionStartedAt)}</InfoLine>

			<Stack direction="row" spacing={0.5} sx={{ flexWrap: "wrap" }}>
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

			{(props.companionRuntimeState.lastError || message) && (
				<Alert severity={message?.type ?? "error"} sx={{ mt: 0.75, py: 0 }}>
					{message?.text ?? props.companionRuntimeState.lastError}
				</Alert>
			)}
		</PanelCard>
	);
}
