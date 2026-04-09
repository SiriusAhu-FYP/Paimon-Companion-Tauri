import { useCallback } from "react";
import { getServices } from "@/services";
import type { VoiceInputState } from "@/types";
import { useServiceState } from "./use-service-state";

export function useVoiceInput() {
	const { voiceInput } = getServices();
	const state = useServiceState<VoiceInputState, "voice:state-change">({
		getInitialState: () => voiceInput.getState(),
		event: "voice:state-change",
		getNextState: (payload) => payload.state,
	});

	const toggle = useCallback(async () => {
		await voiceInput.toggle();
	}, [voiceInput]);

	const enable = useCallback(async () => {
		await voiceInput.enable();
	}, [voiceInput]);

	const disable = useCallback(async () => {
		await voiceInput.disable();
	}, [voiceInput]);

	return {
		state,
		toggle,
		enable,
		disable,
	};
}
