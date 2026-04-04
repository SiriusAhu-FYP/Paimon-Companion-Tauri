import { useCallback } from "react";
import { getServices } from "@/services";
import type { FunctionalTarget } from "@/types";
import { useServiceState } from "./use-service-state";

export function useGame2048() {
	const { game2048 } = getServices();
	const state = useServiceState({
		getInitialState: () => game2048.getState(),
		event: "game2048:state-change",
		getNextState: ({ state: nextState }) => nextState,
	});

	const runSingleStep = useCallback((target?: FunctionalTarget) => {
		return game2048.runSingleStep(target);
	}, [game2048]);

	const detectTarget = useCallback(() => {
		return game2048.detectTargetWindow();
	}, [game2048]);

	return {
		state,
		detectTarget,
		runSingleStep,
	};
}
