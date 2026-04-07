import { useCallback } from "react";
import { getServices } from "@/services";
import type { FunctionalTarget } from "@/types";
import { useServiceState } from "./use-service-state";

export function useSokoban() {
	const { sokoban } = getServices();
	const state = useServiceState({
		getInitialState: () => sokoban.getState(),
		event: "sokoban:state-change",
		getNextState: ({ state: nextState }) => nextState,
	});

	const runValidationRound = useCallback((target?: FunctionalTarget) => {
		return sokoban.runValidationRound(target);
	}, [sokoban]);

	const detectTarget = useCallback(() => {
		return sokoban.detectTargetWindow();
	}, [sokoban]);

	return {
		state,
		detectTarget,
		runValidationRound,
	};
}
