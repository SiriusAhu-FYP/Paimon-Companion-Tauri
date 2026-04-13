import { getServices } from "@/services";
import type { AffectState } from "@/types";
import { useServiceState } from "./use-service-state";

export function useAffectState() {
	const { affect } = getServices();
	return useServiceState<AffectState, "affect:state-change">({
		getInitialState: () => affect.getState() as AffectState,
		event: "affect:state-change",
		getNextState: (payload) => payload.state,
	});
}
