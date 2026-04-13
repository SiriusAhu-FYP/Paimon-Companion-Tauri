import { beforeEach, describe, expect, it, vi } from "vitest";
import { EventBus } from "@/services/event-bus";
import { AffectStateService } from "@/services/affect-state";
import { CharacterService } from "@/services/character";
import type { ServiceContainer } from "@/services";
import { dispatchTool } from "./tool-bridge-service";

vi.mock("@tauri-apps/api/core", () => ({
	invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({
	listen: vi.fn(),
}));

vi.mock("@/utils/window-sync", () => ({
	isTauriEnvironment: () => false,
}));

describe("dispatchTool companion emotion tools", () => {
	let bus: EventBus;
	let affect: AffectStateService;
	let character: CharacterService;
	let services: ServiceContainer;

	beforeEach(() => {
		bus = new EventBus();
		affect = new AffectStateService(bus);
		character = new CharacterService(bus, affect);
		services = {
			bus,
			affect,
			character,
		} as ServiceContainer;
	});

	it("updates affect state and still emits character expression events", async () => {
		const expressionSpy = vi.fn();
		bus.on("character:expression", expressionSpy);

		const result = await dispatchTool(services, "companion.set_emotion", { emotion: "happy" }) as {
			affectState: ReturnType<AffectStateService["getState"]>;
		};

		expect(result.affectState).toMatchObject({
			currentEmotion: "happy",
			presentationEmotion: "happy",
			lastSource: "mcp",
			lastReason: "mcp-set-emotion",
		});
		expect(expressionSpy).toHaveBeenCalledTimes(1);
		expect(expressionSpy).toHaveBeenCalledWith(expect.objectContaining({
			emotion: "happy",
		}));
	});

	it("returns both character state and affect state from companion.get_state", async () => {
		await dispatchTool(services, "companion.set_emotion", { emotion: "delighted" });

		const result = await dispatchTool(services, "companion.get_state", {}) as {
			state: ReturnType<CharacterService["getState"]>;
			affectState: ReturnType<AffectStateService["getState"]>;
		};

		expect(result.state.emotion).toBe("delighted");
		expect(result.affectState.presentationEmotion).toBe("delighted");
	});
});
