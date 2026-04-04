import { useCallback } from "react";
import { useEvaluation, useFunctional, useGame2048, useStardew } from "@/hooks";
import type { StardewTaskId } from "@/types";
import { createLogger } from "@/services/logger";
import { EvaluationSection } from "./EvaluationSection";
import { FunctionalDebugPanel } from "./FunctionalDebugPanel";
import { Game2048Section } from "./Game2048Section";
import { HostToolsSection } from "./HostToolsSection";
import { PanelRoot } from "./panel-shell";
import { StardewSection } from "./StardewSection";

const log = createLogger("functional-panel");

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
	const { state: game2048State, detectTarget, runSingleStep } = useGame2048();
	const {
		state: stardewState,
		detectTarget: detectStardewTarget,
		setSelectedTask: setSelectedStardewTask,
		runTask: runStardewTask,
	} = useStardew();
	const { state: evaluationState, runCase } = useEvaluation();

	const handleDetect2048Target = useCallback(async () => {
		try {
			await detectTarget();
		} catch (err) {
			log.error("failed to detect 2048 target", err);
		}
	}, [detectTarget]);

	const handleRunEvaluationCase = useCallback(async (caseId: string) => {
		try {
			await runCase(caseId);
		} catch (err) {
			log.error("failed to run evaluation case", err);
		}
	}, [runCase]);

	const handleDetectStardewTarget = useCallback(async () => {
		try {
			await detectStardewTarget();
		} catch (err) {
			log.error("failed to detect Stardew target", err);
		}
	}, [detectStardewTarget]);

	const handleRunStardewTask = useCallback(async (taskId?: StardewTaskId) => {
		try {
			await runStardewTask(taskId, functionalState.selectedTarget ?? undefined);
		} catch (err) {
			log.error("failed to run Stardew task", err);
		}
	}, [functionalState.selectedTarget, runStardewTask]);

	return (
		<PanelRoot title="功能实验">
			<HostToolsSection
				functionalState={functionalState}
				setTarget={setTarget}
				runCapture={runCapture}
				runFocus={runFocus}
				runKey={runKey}
				runMouse={runMouse}
			/>
			<Game2048Section
				functionalState={functionalState}
				game2048State={game2048State}
				onDetectTarget={handleDetect2048Target}
				onRunSingleStep={runSingleStep}
			/>
			<StardewSection
				functionalState={functionalState}
				stardewState={stardewState}
				onDetectTarget={handleDetectStardewTarget}
				onSetSelectedTask={setSelectedStardewTask}
				onRunTask={handleRunStardewTask}
			/>
			<EvaluationSection
				evaluationState={evaluationState}
				functionalState={functionalState}
				game2048State={game2048State}
				onRunCase={handleRunEvaluationCase}
			/>
			<FunctionalDebugPanel
				functionalState={functionalState}
				game2048State={game2048State}
				stardewState={stardewState}
				evaluationState={evaluationState}
				onClearTaskHistory={clearHistory}
			/>
		</PanelRoot>
	);
}
