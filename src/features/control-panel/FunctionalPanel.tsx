import { useCallback } from "react";
import { useCompanionRuntime, useCompanionRuntimeBenchmark, useEvaluation, useFunctional, useGame2048, useSokoban, useUnifiedRuntime } from "@/hooks";
import { CompanionRuntimeSection } from "./CompanionRuntimeSection";
import { createLogger } from "@/services/logger";
import { useI18n } from "@/contexts/I18nProvider";
import { EvaluationSection } from "./EvaluationSection";
import { FunctionalDebugPanel } from "./FunctionalDebugPanel";
import { Game2048Section } from "./Game2048Section";
import { HostToolsSection } from "./HostToolsSection";
import { PanelRoot } from "./panel-shell";
import { SokobanSection } from "./SokobanSection";
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
	const { state: sokobanState, detectTarget: detectSokobanTarget, runValidationRound } = useSokoban();
	const { state: evaluationState, runCase } = useEvaluation();
	const {
		state: unifiedState,
		runUnifiedGameStep,
		submitVoiceText,
		setSpeechEnabled,
		setVoiceInputEnabled,
	} = useUnifiedRuntime();
	const {
		state: companionRuntimeState,
		start: startCompanionRuntime,
		stop: stopCompanionRuntime,
		clearHistory: clearCompanionRuntimeHistory,
		runSummaryNow,
		updateRuntimeConfig,
	} = useCompanionRuntime();
	const {
		state: companionRuntimeBenchmarkState,
		runBenchmark: runCompanionRuntimeBenchmark,
	} = useCompanionRuntimeBenchmark();

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

	const handleDetectSokobanTarget = useCallback(async () => {
		try {
			await detectSokobanTarget();
		} catch (err) {
			log.error("failed to detect sokoban target", err);
		}
	}, [detectSokobanTarget]);

	const handleRunSokobanValidationRound = useCallback(async () => {
		try {
			await runValidationRound(functionalState.selectedTarget ?? undefined);
		} catch (err) {
			log.error("failed to run sokoban validation round", err);
		}
	}, [functionalState.selectedTarget, runValidationRound]);

	const labBusy = functionalState.activeTaskId !== null
		|| game2048State.activeRunId !== null
		|| sokobanState.activeRunId !== null
		|| evaluationState.activeCaseId !== null
		|| companionRuntimeBenchmarkState.activeBenchmarkId !== null
		|| unifiedState.activeRunId !== null;

	return (
		<PanelRoot title={t("功能实验", "Functional Lab")}>
			<CompanionRuntimeSection
				functionalState={functionalState}
				companionRuntimeState={companionRuntimeState}
				companionRuntimeBenchmarkState={companionRuntimeBenchmarkState}
				onStart={startCompanionRuntime}
				onStop={stopCompanionRuntime}
				onClearHistory={clearCompanionRuntimeHistory}
				onRunSummaryNow={runSummaryNow}
				onRunBenchmark={runCompanionRuntimeBenchmark}
				onUpdateConfig={updateRuntimeConfig}
			/>
			<UnifiedRunSection
				unifiedState={unifiedState}
				onRunUnifiedGame={runUnifiedGameStep}
				onSubmitVoiceText={submitVoiceText}
				onSetSpeechEnabled={setSpeechEnabled}
				onSetVoiceInputEnabled={setVoiceInputEnabled}
				busy={labBusy}
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
				busy={labBusy}
				onDetectTarget={handleDetect2048Target}
				onRunSingleStep={handleRunSingle2048Step}
			/>
			<SokobanSection
				functionalState={functionalState}
				sokobanState={sokobanState}
				busy={labBusy}
				onDetectTarget={handleDetectSokobanTarget}
				onRunValidationRound={handleRunSokobanValidationRound}
			/>
			<EvaluationSection
				evaluationState={evaluationState}
				functionalState={functionalState}
				game2048State={game2048State}
				busy={labBusy}
				onRunCase={handleRunEvaluationCase}
			/>
			<FunctionalDebugPanel
				functionalState={functionalState}
				game2048State={game2048State}
				sokobanState={sokobanState}
				evaluationState={evaluationState}
				onClearTaskHistory={clearHistory}
			/>
		</PanelRoot>
	);
}
