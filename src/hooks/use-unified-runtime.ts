import { useCallback } from "react";
import { getServices } from "@/services";
import { useServiceState } from "./use-service-state";

export function useUnifiedRuntime() {
	const { unified } = getServices();
	const state = useServiceState({
		getInitialState: () => unified.getState(),
		event: "unified:state-change",
		getNextState: ({ state: nextState }) => nextState,
	});

	const runDelegationTask = useCallback((requestText?: string | null) => {
		return unified.runDelegationTask("manual", requestText ?? null);
	}, [unified]);

	const stopDelegationLoop = useCallback((reason?: string) => {
		return unified.stopDelegationLoop(reason);
	}, [unified]);

	const submitVoiceText = useCallback((text: string) => {
		return unified.submitVoiceText(text);
	}, [unified]);

	const submitDelegationTaskInstruction = useCallback((text: string) => {
		return unified.submitDelegationTaskInstruction(text);
	}, [unified]);

	const runModePreflight = useCallback((mode: "companion" | "delegated") => {
		return unified.runModePreflight(mode);
	}, [unified]);

	const setSpeechEnabled = useCallback((enabled: boolean) => {
		unified.setSpeechEnabled(enabled);
	}, [unified]);

	const setVoiceInputEnabled = useCallback((enabled: boolean) => {
		unified.setVoiceInputEnabled(enabled);
	}, [unified]);

	return {
		state,
		runDelegationTask,
		stopDelegationLoop,
		submitVoiceText,
		submitDelegationTaskInstruction,
		runModePreflight,
		setSpeechEnabled,
		setVoiceInputEnabled,
	};
}
