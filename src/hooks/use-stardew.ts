import { useCallback } from "react";
import { getServices } from "@/services";
import type { FunctionalTarget, StardewTaskId } from "@/types";
import { useServiceState } from "./use-service-state";

export function useStardew() {
	const { stardew } = getServices();
	const state = useServiceState({
		getInitialState: () => stardew.getState(),
		event: "stardew:state-change",
		getNextState: ({ state: nextState }) => nextState,
	});

	const detectTarget = useCallback(() => stardew.detectTargetWindow(), [stardew]);
	const setSelectedTask = useCallback((taskId: StardewTaskId) => stardew.setSelectedTask(taskId), [stardew]);
	const runTask = useCallback((taskId?: StardewTaskId, target?: FunctionalTarget) => stardew.runTask(taskId, target), [stardew]);

	return {
		state,
		detectTarget,
		setSelectedTask,
		runTask,
	};
}
