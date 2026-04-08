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

	const runUnifiedGameStep = useCallback(() => {
		return unified.runUnifiedGameStep();
	}, [unified]);

	const submitVoiceText = useCallback((text: string) => {
		return unified.submitVoiceText(text);
	}, [unified]);

	const setSpeechEnabled = useCallback((enabled: boolean) => {
		unified.setSpeechEnabled(enabled);
	}, [unified]);

	const setVoiceInputEnabled = useCallback((enabled: boolean) => {
		unified.setVoiceInputEnabled(enabled);
	}, [unified]);

	return {
		state,
		runUnifiedGameStep,
		submitVoiceText,
		setSpeechEnabled,
		setVoiceInputEnabled,
	};
}
