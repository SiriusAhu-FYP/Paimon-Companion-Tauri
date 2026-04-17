import { getServices } from "@/services";
import type { DelegationMemoryState } from "@/types";
import { useServiceState } from "./use-service-state";

export function useDelegationMemory() {
	const { delegationMemory } = getServices();
	return useServiceState<DelegationMemoryState, "delegation-memory:state-change">({
		getInitialState: () => delegationMemory.getState() as DelegationMemoryState,
		event: "delegation-memory:state-change",
		getNextState: (payload) => payload.state,
	});
}
