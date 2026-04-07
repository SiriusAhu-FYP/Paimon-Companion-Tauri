import { Alert, Button, Stack } from "@mui/material";
import type { FunctionalRuntimeState, Game2048State } from "@/types";
import { InfoLine, PanelCard, SectionHeader, SectionStatusChip } from "./panel-shell";

export function Game2048Section(props: {
	functionalState: FunctionalRuntimeState;
	game2048State: Game2048State;
	onDetectTarget: () => Promise<unknown>;
	onRunSingleStep: () => Promise<unknown>;
}) {
	const game2048Error = props.game2048State.lastRun?.status === "failed"
		? props.game2048State.lastRun.error
		: null;

	return (
		<PanelCard compact>
			<SectionHeader
				title="2048"
				subtitle="已验证主链路"
				right={(
					<SectionStatusChip
						label={props.game2048State.activeRunId ? "运行中" : "待命"}
						color={props.game2048State.activeRunId ? "warning" : "default"}
					/>
				)}
			/>

			<InfoLine mb={0.5}>
				策略：{props.game2048State.lastRun?.analysis.strategy ?? "默认优先 Up -> Left -> Right -> Down；支持图像模型时优先用截图排序。"}
			</InfoLine>

			<Stack direction="row" spacing={0.5} sx={{ mb: 0.75, flexWrap: "wrap" }}>
				<Button
					size="small"
					variant="outlined"
					onClick={props.onDetectTarget}
					disabled={props.functionalState.activeTaskId !== null || props.game2048State.activeRunId !== null}
				>
					检测窗口
				</Button>
				<Button
					size="small"
					variant="contained"
					onClick={props.onRunSingleStep}
					disabled={props.functionalState.activeTaskId !== null || props.game2048State.activeRunId !== null}
				>
					执行一轮方向验证
				</Button>
			</Stack>

			{props.game2048State.detectionSummary && <InfoLine>{props.game2048State.detectionSummary}</InfoLine>}
			<InfoLine>候选目标：{props.game2048State.detectedTarget?.title ?? "尚未检测"}</InfoLine>

			{game2048Error && (
				<Alert severity="error" sx={{ mt: 0.75, mb: 0.75, py: 0 }}>
					{game2048Error}
				</Alert>
			)}

			<InfoLine>最近结果：{props.game2048State.lastRun?.summary ?? "尚未执行"}</InfoLine>
			<InfoLine>
				分析源：{props.game2048State.lastRun?.analysis.source ?? "—"} · 尝试数：{props.game2048State.lastRun?.attempts.length ?? 0}
			</InfoLine>
		</PanelCard>
	);
}
