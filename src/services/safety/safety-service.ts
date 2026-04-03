import type { EventBus } from "@/services/event-bus";
import type { RuntimeService } from "@/services/runtime";
import type { FunctionalTarget } from "@/types";

export class SafetyService {
	private bus: EventBus;
	private runtime: RuntimeService;

	constructor(bus: EventBus, runtime: RuntimeService) {
		this.bus = bus;
		this.runtime = runtime;
	}

	ensureHostActionAllowed(target: FunctionalTarget | null, operation: string): void {
		let reason: string | null = null;

		if (!this.runtime.isAllowed()) {
			reason = "runtime is stopped";
		} else if (!target) {
			reason = "no target window selected";
		}

		this.bus.emit("safety:decision", {
			operation,
			allowed: reason === null,
			reason,
		});

		if (reason) {
			throw new Error(reason);
		}
	}
}
