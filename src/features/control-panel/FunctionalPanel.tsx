import { Box } from "@mui/material";
import { useEvaluation, useFunctional, useGame2048, useSokoban } from "@/hooks";
import { FunctionalDebugPanel } from "./FunctionalDebugPanel";
import { HostToolsSection } from "./HostToolsSection";

export function FunctionalPanel() {
	const {
		state: functionalState,
		setTarget,
		clearHistory,
		runCapture,
		runFocus,
		runKey,
		runMouse,
	} = useFunctional();
	const { state: game2048State } = useGame2048();
	const { state: sokobanState } = useSokoban();
	const { state: evaluationState } = useEvaluation();

	return (
		<Box sx={{ p: 1.5, display: "flex", flexDirection: "column", gap: 1 }}>
			<HostToolsSection
				functionalState={functionalState}
				setTarget={setTarget}
				runCapture={runCapture}
				runFocus={runFocus}
				runKey={runKey}
				runMouse={runMouse}
			/>
			<FunctionalDebugPanel
				functionalState={functionalState}
				game2048State={game2048State}
				sokobanState={sokobanState}
				evaluationState={evaluationState}
				onClearTaskHistory={clearHistory}
			/>
		</Box>
	);
}
