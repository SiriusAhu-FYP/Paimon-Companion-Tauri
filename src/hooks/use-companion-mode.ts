import { getServices } from "@/services";
import type { CompanionModeState } from "@/types";
import { useServiceState } from "./use-service-state";

export function useCompanionMode() {
	const { companionMode } = getServices();
	return useServiceState<CompanionModeState, "companion:mode-change">({
		getInitialState: () => companionMode.getState() as CompanionModeState,
		event: "companion:mode-change",
		getNextState: (payload) => payload.state,
	});
}
