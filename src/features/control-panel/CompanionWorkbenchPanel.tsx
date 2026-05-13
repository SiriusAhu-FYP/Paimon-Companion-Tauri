import {
	Box,
	Divider,
} from "@mui/material";
import {
	useCharacter,
	useCompanionMode,
	useCompanionRuntime,
	useFunctional,
	useProactiveState,
} from "@/hooks";
import { RuntimeSummaryCard } from "./RuntimeSummaryCard";
import {
	LiveStateCard,
	ProactiveDebugCard,
} from "./companion-workbench-cards";

export function CompanionWorkbenchPanel() {
	const { emotion, emotionReason, emotionSource, isSpeaking } = useCharacter();
	const companionMode = useCompanionMode();
	const proactive = useProactiveState();
	const { state: companionRuntimeState, start, stop, clearHistory, runSummaryNow } = useCompanionRuntime();
	const { state: functionalState } = useFunctional();

	return (
		<Box sx={{ p: 1.5, display: "flex", flexDirection: "column", gap: 1 }}>
			<RuntimeSummaryCard
				functionalState={functionalState}
				companionRuntimeState={companionRuntimeState}
				onStart={start}
				onStop={stop}
				onClearHistory={clearHistory}
				onRunSummaryNow={runSummaryNow}
			/>

			<LiveStateCard
				emotion={emotion}
				emotionReason={emotionReason}
				emotionSource={emotionSource}
				isSpeaking={isSpeaking}
			/>

			<Divider />

			<ProactiveDebugCard
				currentMode={companionMode.mode}
				preferredMode={companionMode.preferredMode}
				proactive={proactive}
			/>
		</Box>
	);
}
