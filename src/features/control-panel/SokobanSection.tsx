import { Alert, Button, Stack } from "@mui/material";
import type { FunctionalRuntimeState, SokobanState } from "@/types";
import { useI18n } from "@/contexts/I18nProvider";
import { InfoLine, PanelCard, SectionHeader, SectionStatusChip } from "./panel-shell";

export function SokobanSection(props: {
	functionalState: FunctionalRuntimeState;
	sokobanState: SokobanState;
	busy: boolean;
	onDetectTarget: () => Promise<unknown>;
	onRunValidationRound: () => Promise<unknown>;
}) {
	const { t } = useI18n();
	const sokobanError = props.sokobanState.lastRun?.status === "failed"
		? props.sokobanState.lastRun.error
		: null;

	return (
		<PanelCard compact>
			<SectionHeader
				title="Sokoban"
				subtitle={t("第二个 reasoning 样例", "Second reasoning sample")}
				right={(
					<SectionStatusChip
						label={props.sokobanState.activeRunId ? t("运行中", "Running") : t("待命", "Idle")}
						color={props.sokobanState.activeRunId ? "warning" : "default"}
					/>
				)}
			/>

			<InfoLine mb={0.5}>
				{t("策略", "Strategy")}：{props.sokobanState.lastRun?.analysis.strategy ?? t("依赖 companion runtime 的本地观察，再交给云端做短序列决策与解释。", "Depend on companion runtime local observation, then ask the cloud model for a short grounded sequence and explanation.") }
			</InfoLine>

			<Stack direction="row" spacing={0.5} sx={{ mb: 0.75, flexWrap: "wrap" }}>
				<Button
					size="small"
					variant="outlined"
					onClick={props.onDetectTarget}
					disabled={props.busy}
				>
					{t("检测窗口", "Detect Window")}
				</Button>
				<Button
					size="small"
					variant="contained"
					onClick={props.onRunValidationRound}
					disabled={props.busy}
				>
					{t("执行一轮推箱子验证", "Run Sokoban Validation")}
				</Button>
			</Stack>

			{props.sokobanState.detectionSummary && <InfoLine>{props.sokobanState.detectionSummary}</InfoLine>}
			<InfoLine>{t("候选目标", "Detected Target")}：{props.sokobanState.detectedTarget?.title ?? t("尚未检测", "Not detected yet")}</InfoLine>

			{sokobanError && (
				<Alert severity="error" sx={{ mt: 0.75, mb: 0.75, py: 0 }}>
					{sokobanError}
				</Alert>
			)}

			<InfoLine>{t("最近结果", "Latest Result")}：{props.sokobanState.lastRun?.summary ?? t("尚未执行", "Not run yet")}</InfoLine>
			<InfoLine>
				{t("分析源", "Analysis Source")}：{props.sokobanState.lastRun?.analysis.source ?? "—"} · {t("尝试数", "Attempts")}：{props.sokobanState.lastRun?.attempts.length ?? 0}
			</InfoLine>
		</PanelCard>
	);
}
