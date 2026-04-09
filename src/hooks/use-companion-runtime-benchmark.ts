import { useCallback } from "react";
import { getServices } from "@/services";
import type { FunctionalTarget } from "@/types";
import { useServiceState } from "./use-service-state";

export function useCompanionRuntimeBenchmark() {
	const { companionRuntimeBenchmark } = getServices();
	const state = useServiceState({
		getInitialState: () => companionRuntimeBenchmark.getState(),
		event: "companion-runtime:benchmark-state-change",
		getNextState: ({ state: nextState }) => nextState,
	});

	const runBenchmark = useCallback((benchmarkId: string, target: FunctionalTarget) => {
		return companionRuntimeBenchmark.runBenchmark(benchmarkId, target);
	}, [companionRuntimeBenchmark]);

	return {
		state,
		runBenchmark,
	};
}
