import { Alert, Button, Stack, Typography } from "@mui/material";
import type { EvaluationState, FunctionalRuntimeState, Game2048State } from "@/types";
import { useI18n } from "@/contexts/I18nProvider";
import { InfoLine, PanelCard, SectionHeader, SectionStatusChip } from "./panel-shell";

export function EvaluationSection(props: {
	evaluationState: EvaluationState;
	functionalState: FunctionalRuntimeState;
	game2048State: Game2048State;
	busy: boolean;
	onRunCase: (caseId: string) => Promise<unknown>;
}) {
	const { t } = useI18n();
	const evaluationError = props.evaluationState.latestResult?.status === "failed"
		? props.evaluationState.latestResult.summary
		: null;

	return (
		<PanelCard compact>
			<SectionHeader
				title={t("评测", "Evaluation")}
				subtitle={t("固定 case", "Fixed cases")}
				right={(
					<SectionStatusChip
						label={props.evaluationState.activeCaseId ? t("评测中", "Running") : t("就绪", "Ready")}
						color={props.evaluationState.activeCaseId ? "warning" : "default"}
					/>
				)}
			/>

			<Stack spacing={0.5} sx={{ mb: 0.75 }}>
				{props.evaluationState.availableCases.map((definition) => (
					<PanelCard key={definition.id} compact>
						<Typography variant="caption" sx={{ display: "block", color: "text.primary" }}>
							{definition.name}
						</Typography>
						<InfoLine mb={0.5}>
							[{definition.game}] {definition.description} · {definition.iterations} {t("次", "runs")}
						</InfoLine>
						<Button
							size="small"
							variant="outlined"
							onClick={() => props.onRunCase(definition.id)}
							disabled={props.busy}
						>
							{t("运行", "Run")}
						</Button>
					</PanelCard>
				))}
			</Stack>

			{evaluationError && (
				<Alert severity="error" sx={{ mb: 0.75, py: 0 }}>
					{evaluationError}
				</Alert>
			)}

			<InfoLine>{t("最近评测", "Latest Evaluation")}：{props.evaluationState.latestResult?.caseName ?? t("尚未执行", "Not run yet")}</InfoLine>
			<InfoLine>
				{t("成功率", "Success")}：{props.evaluationState.latestResult ? `${(props.evaluationState.latestResult.metrics.successRate * 100).toFixed(0)}%` : "—"}
				{" · "}
				{t("平均延迟", "Avg latency")}：{props.evaluationState.latestResult ? `${props.evaluationState.latestResult.metrics.averageLatencyMs.toFixed(0)}ms` : "—"}
			</InfoLine>
			<InfoLine>{t("最近摘要", "Latest Summary")}：{props.evaluationState.latestResult?.summary ?? "—"}</InfoLine>
		</PanelCard>
	);
}
