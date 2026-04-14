import { getServices } from "@/services";
import type { ProactiveState } from "@/types";
import { useServiceState } from "./use-service-state";

export function useProactiveState() {
	const { proactiveCompanion } = getServices();
	return useServiceState<ProactiveState, "companion:proactive-state-change">({
		getInitialState: () => proactiveCompanion.getState() as ProactiveState,
		event: "companion:proactive-state-change",
		getNextState: (payload) => payload.state,
	});
}

