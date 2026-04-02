import { useEffect, useState, useCallback } from "react";
import { getServices } from "@/services";
import type { FunctionalTarget, StardewTaskId } from "@/types";

export function useStardew() {
	const { stardew, bus } = getServices();
	const [state, setState] = useState(stardew.getState());

	useEffect(() => {
		return bus.on("stardew:state-change", ({ state: nextState }) => {
			setState(nextState);
		});
	}, [bus]);

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
