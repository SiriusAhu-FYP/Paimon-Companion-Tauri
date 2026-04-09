import { useCallback } from "react";
import { getServices } from "@/services";
import type { CharacterState } from "@/types";
import { useServiceState } from "./use-service-state";

export function useCharacter() {
	const { character } = getServices();
	const state = useServiceState<CharacterState, "character:state-change">({
		getInitialState: () => character.getState(),
		event: "character:state-change",
		getNextState: () => character.getState(),
	});

	const setEmotion = useCallback(
		(emotion: string) => character.setEmotion(emotion),
		[character]
	);

	return { ...state, setEmotion };
}
