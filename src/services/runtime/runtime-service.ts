import type { RuntimeMode, RuntimeState } from "@/types";
import type { EventBus } from "@/services/event-bus";

/**
 * Phase 1 最小子集：仅 auto / stopped 两个模式切换。
 * manual / paused 及完整急停协调留到后续 phase。
 */
export class RuntimeService {
	private state: RuntimeState = { mode: "auto" };
	private bus: EventBus;

	constructor(bus: EventBus) {
		this.bus = bus;

		this.bus.on("system:emergency-stop", () => {
			this.setMode("stopped");
		});

		this.bus.on("system:resume", () => {
			this.setMode("auto");
		});
	}

	getMode(): RuntimeMode {
		return this.state.mode;
	}

	getState(): Readonly<RuntimeState> {
		return { ...this.state };
	}

	// Phase 1 门控：stopped 时不允许新操作
	isAllowed(): boolean {
		return this.state.mode === "auto";
	}

	setMode(mode: RuntimeMode) {
		if (mode === this.state.mode) return;

		const previous = this.state.mode;
		this.state.mode = mode;

		this.bus.emit("runtime:mode-change", { mode, previous });
	}

	stop() {
		this.setMode("stopped");
	}

	resume() {
		this.setMode("auto");
	}
}
