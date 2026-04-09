import { useCallback } from "react";
import { getServices } from "@/services";
import { useServiceState } from "./use-service-state";

export function useEvaluation() {
	const { evaluation } = getServices();
	const state = useServiceState({
		getInitialState: () => evaluation.getState(),
		event: "evaluation:state-change",
		getNextState: ({ state: nextState }) => nextState,
	});

	const runCase = useCallback((caseId: string) => {
		return evaluation.runCase(caseId);
	}, [evaluation]);

	return {
		state,
		runCase,
	};
}
