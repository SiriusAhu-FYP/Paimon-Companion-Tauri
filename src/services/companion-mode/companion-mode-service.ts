import type { EventBus } from "@/services/event-bus";
import type { CompanionInteractionMode, CompanionModeSource, CompanionModeState } from "@/types";

function makeInitialState(): CompanionModeState {
	return {
		mode: "companion",
		preferredMode: "companion",
		lastReason: "initial",
		lastSource: "system",
		updatedAt: Date.now(),
	};
}

export class CompanionModeService {
	private bus: EventBus;
	private state: CompanionModeState = makeInitialState();

	constructor(bus: EventBus) {
		this.bus = bus;
	}

	getState(): Readonly<CompanionModeState> {
		return { ...this.state };
	}

	getPreferredMode(): CompanionInteractionMode {
		return this.state.preferredMode;
	}

	setMode(mode: CompanionInteractionMode, reason: string, source: CompanionModeSource) {
		const previous = this.state.mode;
		const preferredMode = source === "manual" ? mode : this.state.preferredMode;
		const nextState: CompanionModeState = {
			mode,
			preferredMode,
			lastReason: reason,
			lastSource: source,
			updatedAt: Date.now(),
		};
		const changed =
			nextState.mode !== this.state.mode
			|| nextState.preferredMode !== this.state.preferredMode
			|| nextState.lastReason !== this.state.lastReason
			|| nextState.lastSource !== this.state.lastSource;
		this.state = nextState;
		if (!changed) {
			return;
		}
		this.bus.emit("companion:mode-change", {
			state: this.getState(),
			mode,
			previous,
			reason,
			source,
			preferredMode,
		});
	}
}
