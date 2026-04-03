import { useEffect, useState, useCallback } from "react";
import { getServices } from "@/services";

export function useEvaluation() {
	const { evaluation, bus } = getServices();
	const [state, setState] = useState(evaluation.getState());

	useEffect(() => {
		return bus.on("evaluation:state-change", ({ state: nextState }) => {
			setState(nextState);
		});
	}, [bus]);

	const runCase = useCallback((caseId: string) => {
		return evaluation.runCase(caseId);
	}, [evaluation]);

	return {
		state,
		runCase,
	};
}
