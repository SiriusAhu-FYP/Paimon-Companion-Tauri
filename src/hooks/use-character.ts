import { useState, useEffect, useCallback } from "react";
import { getServices } from "@/services";
import type { CharacterState } from "@/types";

export function useCharacter() {
	const { character, bus } = getServices();
	const [state, setState] = useState<CharacterState>(character.getState());

	useEffect(() => {
		return bus.on("character:state-change", () => {
			setState(character.getState());
		});
	}, [bus, character]);

	const setEmotion = useCallback(
		(emotion: string) => character.setEmotion(emotion),
		[character]
	);

	return { ...state, setEmotion };
}
