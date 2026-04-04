import { useCallback } from "react";
import { getServices } from "@/services";
import type { RuntimeMode } from "@/types";
import { useServiceState } from "./use-service-state";

export function useRuntime() {
	const { runtime } = getServices();
	const mode = useServiceState<RuntimeMode, "runtime:mode-change">({
		getInitialState: () => runtime.getMode(),
		event: "runtime:mode-change",
		getNextState: (payload) => payload.mode,
	});

	const stop = useCallback(() => runtime.stop(), [runtime]);
	const resume = useCallback(() => runtime.resume(), [runtime]);
	const isAllowed = useCallback(() => runtime.isAllowed(), [runtime]);

	return { mode, stop, resume, isAllowed };
}
