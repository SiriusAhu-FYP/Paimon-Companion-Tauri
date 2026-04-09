import { useEffect, useRef, useState } from "react";
import { getServices } from "@/services";
import type { EventMap, EventName } from "@/types";

export function useServiceState<State, E extends EventName>(options: {
	getInitialState: () => State;
	event: E;
	getNextState: (payload: EventMap[E]) => State;
}) {
	const { bus } = getServices();
	const getNextStateRef = useRef(options.getNextState);
	getNextStateRef.current = options.getNextState;

	const [state, setState] = useState<State>(() => options.getInitialState());

	useEffect(() => {
		return bus.on(options.event, (payload) => {
			setState(getNextStateRef.current(payload));
		});
	}, [bus, options.event]);

	return state;
}
