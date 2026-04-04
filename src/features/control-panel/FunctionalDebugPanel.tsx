import { Alert, Box, Chip, Divider, Stack, Typography } from "@mui/material";
import type { EvaluationState, FunctionalRuntimeState, Game2048State } from "@/types";
import { PipelineStagesSection } from "./functional-debug/PipelineStagesSection";
import { TaskInspectionSection } from "./functional-debug/TaskInspectionSection";
import { EvaluationSummaryCard } from "./functional-debug/shared";

interface FunctionalDebugPanelProps {
	functionalState: FunctionalRuntimeState;
	game2048State: Game2048State;
	evaluationState: EvaluationState;
	onClearTaskHistory: () => void;
}

export function FunctionalDebugPanel(props: FunctionalDebugPanelProps) {
	return (
		<Box sx={{ mt: 1, p: 0.75, border: "1px solid", borderColor: "divider", borderRadius: 1 }}>
			<Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 0.75 }}>
				<Box>
					<Typography variant="caption" color="text.secondary" fontWeight={700}>
						Functional Debug Drill-down
					</Typography>
					<Typography variant="caption" color="text.secondary" sx={{ display: "block", fontSize: 10 }}>
						把 capture / decision / action / verification 拆开看
					</Typography>
				</Box>
				{props.functionalState.selectedTarget ? (
					<Chip
						label={props.functionalState.selectedTarget.title}
						size="small"
						variant="outlined"
						sx={{ maxWidth: 160, "& .MuiChip-label": { overflow: "hidden", textOverflow: "ellipsis" } }}
					/>
				) : (
					<Chip label="未选目标" size="small" variant="outlined" />
				)}
			</Stack>

			{props.functionalState.safetyBlockedReason && (
				<Alert severity="warning" sx={{ mb: 0.75, py: 0 }}>
					安全阻断: {props.functionalState.safetyBlockedReason}
				</Alert>
			)}

			<PipelineStagesSection
				functionalState={props.functionalState}
				game2048State={props.game2048State}
			/>

			{(props.functionalState.latestTask || props.functionalState.taskHistory.length > 0) && (
				<>
					<Divider sx={{ my: 1 }} />
					<TaskInspectionSection
						functionalState={props.functionalState}
						onClearTaskHistory={props.onClearTaskHistory}
					/>
				</>
			)}

			{props.evaluationState.latestResult && (
				<>
					<Divider sx={{ my: 1 }} />
					<EvaluationSummaryCard latestResult={props.evaluationState.latestResult} />
				</>
			)}
		</Box>
	);
}
