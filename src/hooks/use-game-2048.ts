import { useEffect, useState, useCallback } from "react";
import { getServices } from "@/services";
import type { FunctionalTarget } from "@/types";

export function useGame2048() {
	const { game2048, bus } = getServices();
	const [state, setState] = useState(game2048.getState());

	useEffect(() => {
		return bus.on("game2048:state-change", ({ state: nextState }) => {
			setState(nextState);
		});
	}, [bus]);

	const runSingleStep = useCallback((target?: FunctionalTarget) => {
		return game2048.runSingleStep(target);
	}, [game2048]);

	return {
		state,
		runSingleStep,
	};
}
