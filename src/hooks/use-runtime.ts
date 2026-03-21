import { useState, useEffect, useCallback } from "react";
import { getServices } from "@/services";
import type { RuntimeMode } from "@/types";

export function useRuntime() {
	const { runtime, bus } = getServices();
	const [mode, setMode] = useState<RuntimeMode>(runtime.getMode());

	useEffect(() => {
		return bus.on("runtime:mode-change", (payload) => {
			setMode(payload.mode);
		});
	}, [bus]);

	const stop = useCallback(() => runtime.stop(), [runtime]);
	const resume = useCallback(() => runtime.resume(), [runtime]);
	const isAllowed = useCallback(() => runtime.isAllowed(), [runtime]);

	return { mode, stop, resume, isAllowed };
}
