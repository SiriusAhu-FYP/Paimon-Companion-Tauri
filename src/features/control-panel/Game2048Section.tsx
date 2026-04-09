import { Alert, Button, Stack } from "@mui/material";
import type { FunctionalRuntimeState, Game2048State } from "@/types";
import { useI18n } from "@/contexts/I18nProvider";
import { InfoLine, PanelCard, SectionHeader, SectionStatusChip } from "./panel-shell";

export function Game2048Section(props: {
	functionalState: FunctionalRuntimeState;
	game2048State: Game2048State;
	busy: boolean;
	onDetectTarget: () => Promise<unknown>;
	onRunSingleStep: () => Promise<unknown>;
}) {
	const { t } = useI18n();
	const game2048Error = props.game2048State.lastRun?.status === "failed"
		? props.game2048State.lastRun.error
		: null;

	return (
		<PanelCard compact>
			<SectionHeader
				title="2048"
				subtitle={t("已验证主链路", "Validated baseline path")}
				right={(
					<SectionStatusChip
						label={props.game2048State.activeRunId ? t("运行中", "Running") : t("待命", "Idle")}
						color={props.game2048State.activeRunId ? "warning" : "default"}
					/>
				)}
			/>

			<InfoLine mb={0.5}>
				{t("策略", "Strategy")}：{props.game2048State.lastRun?.analysis.strategy ?? t("默认优先 Up -> Left -> Right -> Down；支持图像模型时优先用截图排序。", "Default priority is Up -> Left -> Right -> Down. If vision is available, use screenshot-based ordering.")}
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
					onClick={props.onRunSingleStep}
					disabled={props.busy}
				>
					{t("执行一轮方向验证", "Run Direction Validation")}
				</Button>
			</Stack>

			{props.game2048State.detectionSummary && <InfoLine>{props.game2048State.detectionSummary}</InfoLine>}
			<InfoLine>{t("候选目标", "Detected Target")}：{props.game2048State.detectedTarget?.title ?? t("尚未检测", "Not detected yet")}</InfoLine>

			{game2048Error && (
				<Alert severity="error" sx={{ mt: 0.75, mb: 0.75, py: 0 }}>
					{game2048Error}
				</Alert>
			)}

			<InfoLine>{t("最近结果", "Latest Result")}：{props.game2048State.lastRun?.summary ?? t("尚未执行", "Not run yet")}</InfoLine>
			<InfoLine>
				{t("分析源", "Analysis Source")}：{props.game2048State.lastRun?.analysis.source ?? "—"} · {t("尝试数", "Attempts")}：{props.game2048State.lastRun?.attempts.length ?? 0}
			</InfoLine>
		</PanelCard>
	);
}
