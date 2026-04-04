import { Alert, Button, Stack, Typography } from "@mui/material";
import type { EvaluationState, FunctionalRuntimeState, Game2048State } from "@/types";
import { InfoLine, PanelCard, SectionHeader, SectionStatusChip } from "./panel-shell";

export function EvaluationSection(props: {
	evaluationState: EvaluationState;
	functionalState: FunctionalRuntimeState;
	game2048State: Game2048State;
	onRunCase: (caseId: string) => Promise<unknown>;
}) {
	const evaluationError = props.evaluationState.latestResult?.status === "failed"
		? props.evaluationState.latestResult.summary
		: null;

	return (
		<PanelCard compact>
			<SectionHeader
				title="评测"
				subtitle="固定 case"
				right={(
					<SectionStatusChip
						label={props.evaluationState.activeCaseId ? "评测中" : "就绪"}
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
							[{definition.game}] {definition.description} · {definition.iterations} 次
						</InfoLine>
						<Button
							size="small"
							variant="outlined"
							onClick={() => props.onRunCase(definition.id)}
							disabled={props.evaluationState.activeCaseId !== null || props.game2048State.activeRunId !== null || props.functionalState.activeTaskId !== null}
						>
							运行
						</Button>
					</PanelCard>
				))}
			</Stack>

			{evaluationError && (
				<Alert severity="error" sx={{ mb: 0.75, py: 0 }}>
					{evaluationError}
				</Alert>
			)}

			<InfoLine>最近评测：{props.evaluationState.latestResult?.caseName ?? "尚未执行"}</InfoLine>
			<InfoLine>
				成功率：{props.evaluationState.latestResult ? `${(props.evaluationState.latestResult.metrics.successRate * 100).toFixed(0)}%` : "—"}
				{" · "}
				平均延迟：{props.evaluationState.latestResult ? `${props.evaluationState.latestResult.metrics.averageLatencyMs.toFixed(0)}ms` : "—"}
			</InfoLine>
		</PanelCard>
	);
}
