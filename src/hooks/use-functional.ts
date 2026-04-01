import { useEffect, useState, useCallback } from "react";
import { getServices } from "@/services";
import type { FunctionalTarget, HostMouseAction, HostMouseButton } from "@/types";

export function useFunctional() {
	const { orchestrator, bus } = getServices();
	const [state, setState] = useState(orchestrator.getState());

	useEffect(() => {
		return bus.on("orchestrator:state-change", ({ state: nextState }) => {
			setState(nextState);
		});
	}, [bus]);

	const setTarget = useCallback((target: FunctionalTarget | null) => {
		orchestrator.setTarget(target);
		setState(orchestrator.getState());
	}, [orchestrator]);

	const clearHistory = useCallback(() => {
		orchestrator.clearHistory();
		setState(orchestrator.getState());
	}, [orchestrator]);

	const runCapture = useCallback((target?: FunctionalTarget) => {
		return orchestrator.runCaptureTask(target);
	}, [orchestrator]);

	const runFocus = useCallback((target?: FunctionalTarget) => {
		return orchestrator.runFocusTask(target);
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

	return {
		state,
		setTarget,
		clearHistory,
		runCapture,
		runFocus,
		runKey,
		runMouse,
	};
}
