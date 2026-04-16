import { getServices } from "@/services";
import type { DebugCaptureState } from "@/types";
import { useServiceState } from "./use-service-state";

export function useDebugCaptureState() {
	const { debugCapture } = getServices();
	return useServiceState<DebugCaptureState, "debug-capture:state-change">({
		getInitialState: () => debugCapture.getState() as DebugCaptureState,
		event: "debug-capture:state-change",
		getNextState: (payload) => payload.state,
	});
}
