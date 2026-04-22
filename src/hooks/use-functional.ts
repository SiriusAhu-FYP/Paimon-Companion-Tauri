import { useCallback } from "react";
import { getServices } from "@/services";
import type { FunctionalTarget, HostFocusOptions, HostMouseAction, HostMouseButton } from "@/types";
import { useServiceState } from "./use-service-state";

export function useFunctional() {
	const { orchestrator } = getServices();
	const state = useServiceState({
		getInitialState: () => orchestrator.getState(),
		event: "orchestrator:state-change",
		getNextState: ({ state: nextState }) => nextState,
	});

	const setTarget = useCallback((target: FunctionalTarget | null) => {
		orchestrator.setTarget(target);
	}, [orchestrator]);

	const clearHistory = useCallback(() => {
		orchestrator.clearHistory();
	}, [orchestrator]);

	const runCapture = useCallback((target?: FunctionalTarget) => {
		return orchestrator.runCaptureTask(target);
	}, [orchestrator]);

	const runFocus = useCallback((target?: FunctionalTarget, options?: HostFocusOptions) => {
		return orchestrator.runFocusTask(target, options);
	}, [orchestrator]);

	const runKey = useCallback((key: string, target?: FunctionalTarget) => {
		return orchestrator.runSendKeyTask(key, target);
	}, [orchestrator]);

	const runMouse = useCallback((
		options: { action?: HostMouseAction; button?: HostMouseButton; x?: number; y?: number },
		target?: FunctionalTarget,
	) => {
		return orchestrator.runSendMouseTask(options, target);
	}, [orchestrator]);

	const runText = useCallback((text: string, target?: FunctionalTarget) => {
		return orchestrator.runSendTextTask(text, target);
	}, [orchestrator]);

	return {
		state,
		setTarget,
		clearHistory,
		runCapture,
		runFocus,
		runKey,
		runMouse,
		runText,
	};
}
