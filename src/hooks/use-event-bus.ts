import { useEffect, useRef } from "react";
import { getServices } from "@/services";
import type { EventMap, EventName } from "@/types";

// 在 React 组件中订阅事件总线事件，自动随组件生命周期清理
export function useEventBus<E extends EventName>(
	event: E,
	handler: (payload: EventMap[E]) => void
) {
	const { bus } = getServices();
	const handlerRef = useRef(handler);
	handlerRef.current = handler;

	useEffect(() => {
		return bus.on(event, (payload) => {
			handlerRef.current(payload);
		});
	}, [bus, event]);
}
