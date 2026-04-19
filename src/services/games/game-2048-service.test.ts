import { describe, expect, it, vi } from "vitest";
import { EventBus } from "@/services/event-bus";
import { Game2048Service } from "./game-2048-service";

vi.mock("@/services/system", () => ({
	listWindows: vi.fn(),
}));
vi.mock("./cloud-decision", () => ({
	requestActiveTextDecision: vi.fn(),
}));

function createService(requireObservationContext: () => { promptContext: string; latestTimestamp: number } | never) {
	return new Game2048Service({
		bus: new EventBus(),
		orchestrator: {
			getState: vi.fn(() => ({
				selectedTarget: { handle: "target-2048", title: "2048" },
			})),
			setTarget: vi.fn(),
		} as never,
		companionRuntime: {
			refreshNow: vi.fn().mockResolvedValue(undefined),
			requireObservationContext: vi.fn(requireObservationContext),
		} as never,
	});
}

describe("Game2048Service local observation guard", () => {
	it("fails when companion runtime is not running", async () => {
		const service = createService(() => {
			throw new Error("companion runtime is not running; start local observation before delegated actions");
		});

		await expect(service.runSingleStep()).rejects.toThrow(
			"companion runtime is not running; start local observation before delegated actions",
		);
	});

	it("fails when companion runtime target does not match the selected target", async () => {
		const service = createService(() => {
			throw new Error("companion runtime target does not match the selected functional target");
		});

		await expect(service.runSingleStep()).rejects.toThrow(
			"companion runtime target does not match the selected functional target",
		);
	});
});
