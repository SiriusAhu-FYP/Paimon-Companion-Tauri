import { useMemo } from "react";
import { createLogger } from "@/services";

export function useLogger(module: string) {
	return useMemo(() => createLogger(module), [module]);
}
