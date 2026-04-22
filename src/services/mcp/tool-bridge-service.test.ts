import { beforeEach, describe, expect, it, vi } from "vitest";
import { EventBus } from "@/services/event-bus";
import { AffectStateService } from "@/services/affect-state";
import { CharacterService } from "@/services/character";
import type { ServiceContainer } from "@/services";
import { dispatchTool } from "./tool-bridge-service";
import { listWindows } from "@/services/system";
import { requestOpenAICompatibleVision } from "@/services/vlm";

vi.mock("@tauri-apps/api/core", () => ({
	invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({
	listen: vi.fn(),
}));

vi.mock("@/utils/window-sync", () => ({
	isTauriEnvironment: () => false,
}));

vi.mock("@/services/system", () => ({
	listWindows: vi.fn(),
}));

vi.mock("@/services/config", () => ({
	getConfig: () => ({
		companionRuntime: {
			localVisionBaseUrl: "http://127.0.0.1:32183/v1",
			localVisionModel: "Qwen/Qwen3-VL-2B-Instruct",
		},
	}),
}));

vi.mock("@/services/vlm", () => ({
	requestOpenAICompatibleVision: vi.fn(),
}));

beforeEach(() => {
	vi.mocked(requestOpenAICompatibleVision).mockReset();
});

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

describe("dispatchTool host tools", () => {
	it("filters and limits host.list_windows results", async () => {
		vi.mocked(listWindows).mockResolvedValueOnce([
			{
				handle: "0x1",
				title: "Mozilla Firefox - Docs",
				className: "MozillaWindowClass",
				processId: 100,
				processName: "firefox.exe",
				visible: true,
				minimized: false,
			},
			{
				handle: "0x2",
				title: "Visual Studio Code",
				className: "Chrome_WidgetWin_1",
				processId: 200,
				processName: "Code.exe",
				visible: true,
				minimized: false,
			},
		]);

		const services = {
			orchestrator: {
				getState: () => ({ selectedTarget: null }),
			},
		} as unknown as ServiceContainer;

		const result = await dispatchTool(services, "host.list_windows", {
			query: "firefox",
			limit: 1,
		}) as {
			total: number;
			returned: number;
			windows: Array<{ title: string }>;
		};

		expect(result.total).toBe(2);
		expect(result.returned).toBe(1);
		expect(result.windows).toHaveLength(1);
		expect(result.windows[0].title).toContain("Firefox");
	});

	it("converts normalized mouse coordinates into pixels before dispatch", async () => {
		const runCaptureTask = vi.fn().mockResolvedValue({
			afterSnapshot: {
				width: 1600,
				height: 900,
			},
			beforeSnapshot: null,
		});
		const runSendMouseTask = vi.fn().mockResolvedValue({
			id: "task-mouse",
			status: "completed",
		});
		const services = {
			orchestrator: {
				getState: () => ({
					selectedTarget: { handle: "0xabc", title: "Mozilla Firefox" },
				}),
				setTarget: vi.fn(),
				runCaptureTask,
				runSendMouseTask,
			},
		} as unknown as ServiceContainer;

		const result = await dispatchTool(services, "host.send_mouse", {
			xNorm: 0.5,
			yNorm: 0.25,
			action: "click",
		}) as { resolvedFrom: string; x: number; y: number };

		expect(runCaptureTask).toHaveBeenCalledTimes(1);
		expect(runSendMouseTask).toHaveBeenCalledWith(
			{
				action: "click",
				button: "left",
				x: 800,
				y: 225,
			},
			{ handle: "0xabc", title: "Mozilla Firefox" },
		);
		expect(result.resolvedFrom).toBe("normalized");
		expect(result.x).toBe(800);
		expect(result.y).toBe(225);
	});

	it("defaults host.focus_window to delegated viewport policy", async () => {
		const runFocusTask = vi.fn().mockResolvedValue({
			id: "task-focus",
			status: "completed",
		});
		const services = {
			orchestrator: {
				getState: () => ({
					selectedTarget: { handle: "0x123", title: "Firefox" },
				}),
				setTarget: vi.fn(),
				runFocusTask,
			},
		} as unknown as ServiceContainer;

		await dispatchTool(services, "host.focus_window", {});
		await dispatchTool(services, "host.focus_window", { applyDelegatedViewport: false });

		expect(runFocusTask).toHaveBeenNthCalledWith(
			1,
			{ handle: "0x123", title: "Firefox" },
			{ applyDelegatedViewport: true },
		);
		expect(runFocusTask).toHaveBeenNthCalledWith(
			2,
			{ handle: "0x123", title: "Firefox" },
			{ applyDelegatedViewport: false },
		);
	});

	it("computes locator consensus and rejects outlier sample", async () => {
		const runCaptureTask = vi.fn().mockResolvedValue({
			afterSnapshot: {
				width: 1200,
				height: 800,
				dataUrl: "data:image/png;base64,mock",
			},
			beforeSnapshot: null,
		});
		vi.mocked(requestOpenAICompatibleVision)
			.mockResolvedValueOnce("{\"found\":true,\"leftNorm\":0.15,\"topNorm\":0.14,\"rightNorm\":0.28,\"bottomNorm\":0.24,\"confidence\":0.86}")
			.mockResolvedValueOnce("{\"found\":true,\"leftNorm\":0.16,\"topNorm\":0.15,\"rightNorm\":0.30,\"bottomNorm\":0.25,\"confidence\":0.84}")
			.mockResolvedValueOnce("{\"found\":true,\"leftNorm\":0.80,\"topNorm\":0.80,\"rightNorm\":0.92,\"bottomNorm\":0.93,\"confidence\":0.62}")
			.mockResolvedValueOnce("{\"found\":true,\"leftNorm\":0.15,\"topNorm\":0.13,\"rightNorm\":0.27,\"bottomNorm\":0.23,\"confidence\":0.88}");
		const services = {
			orchestrator: {
				getState: () => ({
					selectedTarget: { handle: "0xabc", title: "Mozilla Firefox" },
				}),
				setTarget: vi.fn(),
				runCaptureTask,
			},
		} as unknown as ServiceContainer;

		const result = await dispatchTool(services, "host.resolve_locator_consensus", {
			locatorHint: "地址栏",
			samples: 4,
		}) as {
			found: boolean;
			usedSamples: number;
			rejectedSamples: number;
			center: { xNorm: number; yNorm: number };
		};

		expect(runCaptureTask).toHaveBeenCalledTimes(4);
		expect(result.found).toBe(true);
		expect(result.usedSamples).toBe(3);
		expect(result.rejectedSamples).toBe(1);
		expect(result.center.xNorm).toBeGreaterThan(0.18);
		expect(result.center.xNorm).toBeLessThan(0.26);
		expect(result.center.yNorm).toBeGreaterThan(0.16);
		expect(result.center.yNorm).toBeLessThan(0.24);
	});

	it("falls back to per-character send_key when host.paste_text fails", async () => {
		const runSendTextTask = vi.fn().mockRejectedValue(new Error("paste command failed"));
		const runSendKeyTask = vi.fn().mockResolvedValue({
			id: "task-key",
			status: "completed",
		});
		const services = {
			orchestrator: {
				getState: () => ({
					selectedTarget: { handle: "0x123", title: "Mozilla Firefox" },
				}),
				setTarget: vi.fn(),
				runSendTextTask,
				runSendKeyTask,
			},
		} as unknown as ServiceContainer;

		const result = await dispatchTool(services, "host.paste_text", {
			text: "ab",
		}) as { mode: string; keyCount: number; sent: boolean };

		expect(result.mode).toBe("fallback-send-key");
		expect(result.sent).toBe(true);
		expect(result.keyCount).toBe(2);
		expect(runSendTextTask).toHaveBeenCalledTimes(1);
		expect(runSendKeyTask).toHaveBeenNthCalledWith(
			1,
			"a",
			{ handle: "0x123", title: "Mozilla Firefox" },
		);
		expect(runSendKeyTask).toHaveBeenNthCalledWith(
			2,
			"b",
			{ handle: "0x123", title: "Mozilla Firefox" },
		);
	});
});
