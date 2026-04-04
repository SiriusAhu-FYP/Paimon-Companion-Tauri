import { Alert, Button, Stack } from "@mui/material";
import type { FunctionalRuntimeState, FunctionalTarget, StardewState, StardewTaskId } from "@/types";
import { InfoLine, PanelCard, SectionHeader, SectionStatusChip } from "./panel-shell";

export function StardewSection(props: {
	functionalState: FunctionalRuntimeState;
	stardewState: StardewState;
	onDetectTarget: () => Promise<unknown>;
	onSetSelectedTask: (taskId: StardewTaskId) => void;
	onRunTask: (taskId?: StardewTaskId, target?: FunctionalTarget) => Promise<unknown>;
}) {
	const stardewError = props.stardewState.lastRun?.status === "failed"
		? props.stardewState.lastRun.error
		: null;

	return (
		<PanelCard compact>
			<SectionHeader
				title="Stardew"
				subtitle="实验扩展"
				right={(
					<SectionStatusChip
						label={props.stardewState.activeRunId ? "运行中" : "待命"}
						color={props.stardewState.activeRunId ? "warning" : "default"}
					/>
				)}
			/>

			<InfoLine mb={0.5}>
				任务：微移动、打开背包、关闭菜单。
			</InfoLine>

			<Stack direction="row" spacing={0.5} sx={{ mb: 0.75, flexWrap: "wrap" }}>
				<Button
					size="small"
					variant="outlined"
					onClick={props.onDetectTarget}
					disabled={props.functionalState.activeTaskId !== null || props.stardewState.activeRunId !== null}
				>
					检测窗口
				</Button>
				{props.stardewState.availableTasks.map((task) => (
					<Button
						key={task.id}
						size="small"
						variant={props.stardewState.selectedTaskId === task.id ? "contained" : "outlined"}
						onClick={() => props.onSetSelectedTask(task.id)}
						disabled={props.functionalState.activeTaskId !== null || props.stardewState.activeRunId !== null}
					>
						{task.name}
					</Button>
				))}
			</Stack>

			<Button
				size="small"
				variant="contained"
				onClick={() => props.onRunTask(undefined, props.functionalState.selectedTarget ?? undefined)}
				disabled={props.functionalState.activeTaskId !== null || props.stardewState.activeRunId !== null}
				sx={{ mb: 0.75 }}
			>
				运行任务
			</Button>

			{props.stardewState.detectionSummary && <InfoLine>{props.stardewState.detectionSummary}</InfoLine>}
			<InfoLine>候选目标：{props.stardewState.detectedTarget?.title ?? "尚未检测"}</InfoLine>

			{stardewError && (
				<Alert severity="error" sx={{ mt: 0.75, mb: 0.75, py: 0 }}>
					{stardewError}
				</Alert>
			)}

			<InfoLine>最近结果：{props.stardewState.lastRun?.summary ?? "尚未执行"}</InfoLine>
			<InfoLine>
				任务：{props.stardewState.lastRun?.taskId ?? props.stardewState.selectedTaskId}
				{" · "}
				分析源：{props.stardewState.lastRun?.analysis.source ?? "—"}
				{" · "}
				尝试数：{props.stardewState.lastRun?.attempts.length ?? 0}
			</InfoLine>
		</PanelCard>
	);
}
