import { useCallback } from "react";
import { getServices } from "@/services";
import type { FunctionalTarget } from "@/types";
import { useServiceState } from "./use-service-state";

export function useCompanionRuntime() {
	const { companionRuntime } = getServices();
	const state = useServiceState({
		getInitialState: () => companionRuntime.getState(),
		event: "companion-runtime:state-change",
		getNextState: () => companionRuntime.getState(),
	});

	const start = useCallback((target: FunctionalTarget) => {
		return companionRuntime.start(target);
	}, [companionRuntime]);

	const stop = useCallback(() => {
		companionRuntime.stop();
	}, [companionRuntime]);

	const clearHistory = useCallback(() => {
		companionRuntime.clearHistory();
	}, [companionRuntime]);

	const runSummaryNow = useCallback(() => {
		return companionRuntime.runSummaryNow();
	}, [companionRuntime]);

	const updateRuntimeConfig = useCallback((partial: Parameters<typeof companionRuntime.updateRuntimeConfig>[0]) => {
		return companionRuntime.updateRuntimeConfig(partial);
	}, [companionRuntime]);

	const testLocalVisionConnection = useCallback(() => {
		return companionRuntime.testLocalVisionConnection();
	}, [companionRuntime]);

	return {
		state,
		start,
		stop,
		clearHistory,
		runSummaryNow,
		updateRuntimeConfig,
		testLocalVisionConnection,
	};
}
