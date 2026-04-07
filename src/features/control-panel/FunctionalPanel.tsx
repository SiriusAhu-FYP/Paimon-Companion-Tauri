import { useCallback } from "react";
import { useEvaluation, useFunctional, useGame2048, useUnifiedRuntime } from "@/hooks";
import { createLogger } from "@/services/logger";
import { useI18n } from "@/contexts/I18nProvider";
import { EvaluationSection } from "./EvaluationSection";
import { FunctionalDebugPanel } from "./FunctionalDebugPanel";
import { Game2048Section } from "./Game2048Section";
import { HostToolsSection } from "./HostToolsSection";
import { PanelRoot } from "./panel-shell";
import { UnifiedRunSection } from "./UnifiedRunSection";

const log = createLogger("functional-panel");

export function FunctionalPanel() {
	const { t } = useI18n();
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
	const { state: evaluationState, runCase } = useEvaluation();
	const {
		state: unifiedState,
		runUnified2048Step,
		submitVoiceText,
		setSpeechEnabled,
		setVoiceInputEnabled,
	} = useUnifiedRuntime();

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

	const handleRunSingle2048Step = useCallback(async () => {
		try {
			await runSingleStep(functionalState.selectedTarget ?? undefined);
		} catch (err) {
			log.error("failed to run 2048 single step", err);
		}
	}, [functionalState.selectedTarget, runSingleStep]);

	return (
		<PanelRoot title={t("功能实验", "Functional Lab")}>
			<UnifiedRunSection
				unifiedState={unifiedState}
				onRunUnified2048={runUnified2048Step}
				onSubmitVoiceText={submitVoiceText}
				onSetSpeechEnabled={setSpeechEnabled}
				onSetVoiceInputEnabled={setVoiceInputEnabled}
				busy={functionalState.activeTaskId !== null || game2048State.activeRunId !== null || evaluationState.activeCaseId !== null || unifiedState.activeRunId !== null}
			/>
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
				onRunSingleStep={handleRunSingle2048Step}
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
				evaluationState={evaluationState}
				onClearTaskHistory={clearHistory}
			/>
		</PanelRoot>
	);
}
