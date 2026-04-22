import { beforeEach, describe, expect, it, vi } from "vitest";
import { executeSemanticAction } from "./semantic-action-runtime";
import { getConfig } from "@/services/config";
import { estimateSnapshotChange } from "./game-utils";
import { requestActiveVisionDecision } from "./cloud-decision";

vi.mock("@/services/config", () => ({
	getConfig: vi.fn(),
}));

vi.mock("./game-utils", () => ({
	estimateSnapshotChange: vi.fn(),
	extractJsonObject: vi.fn((content: string) => content),
}));

vi.mock("./cloud-decision", () => ({
	requestActiveVisionDecision: vi.fn(),
}));

function makeSnapshot(dataUrl: string) {
	return {
		dataUrl,
		width: 1200,
		height: 700,
		captureMethod: "test",
		qualityScore: 1,
		lowConfidence: false,
		targetHandle: "window-1",
		targetTitle: "Mozilla Firefox",
		capturedAt: Date.now(),
	};
}

function setGuardConfig(partial?: Partial<{
	enabled: boolean;
	intervalMs: number;
	stableCount: number;
	timeoutMs: number;
	changeThreshold: number;
	cropScale: number;
}>) {
	vi.mocked(getConfig).mockReturnValue({
		companionRuntime: {
			browserLoadGuardEnabled: partial?.enabled ?? true,
			browserLoadIntervalMs: partial?.intervalMs ?? 1,
			browserLoadStableCount: partial?.stableCount ?? 3,
			browserLoadTimeoutMs: partial?.timeoutMs ?? 20,
			browserLoadChangeThreshold: partial?.changeThreshold ?? 0.01,
			browserLoadCropScale: partial?.cropScale ?? 0.9,
		},
	} as never);
}

function createOrchestrator() {
	let captureId = 0;
	return {
		runFocusTask: vi.fn().mockResolvedValue({ id: "focus-1" }),
		runSendKeyTask: vi.fn().mockResolvedValue({ id: "key-1", beforeSnapshot: null, afterSnapshot: null }),
		runSendMouseTask: vi.fn().mockResolvedValue({
			id: "mouse-1",
			beforeSnapshot: makeSnapshot("before"),
			afterSnapshot: makeSnapshot("after"),
		}),
		runCaptureTask: vi.fn().mockImplementation(async () => {
			captureId += 1;
			return {
				id: `capture-${captureId}`,
				afterSnapshot: makeSnapshot(`capture-${captureId}`),
			};
		}),
	};
}

describe("executeSemanticAction browser load guard", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		setGuardConfig();
		vi.mocked(estimateSnapshotChange).mockResolvedValue(0);
		vi.mocked(requestActiveVisionDecision).mockResolvedValue(JSON.stringify({
			ready: true,
			reason: "content loaded",
		}));
	});

	it("waits for stable browser frames and cloud readiness after click", async () => {
		const orchestrator = createOrchestrator();

		const result = await executeSemanticAction(
			orchestrator as never,
			{ handle: "window-1", title: "Mozilla Firefox" },
			{
				id: "browser_click",
				label: "Browser Click",
				description: "click and wait",
				steps: [{ kind: "send-mouse", action: "click", button: "left" }],
			},
		);

		expect(result.actionId).toBe("browser_click");
		expect(orchestrator.runCaptureTask).toHaveBeenCalledTimes(4);
		expect(requestActiveVisionDecision).toHaveBeenCalledTimes(1);
	});

	it("throws timeout when readiness check never returns ready", async () => {
		setGuardConfig({
			intervalMs: 1,
			stableCount: 1,
			timeoutMs: 5,
		});
		vi.mocked(requestActiveVisionDecision).mockResolvedValue(JSON.stringify({
			ready: false,
			reason: "still loading",
		}));
		const orchestrator = createOrchestrator();

		await expect(executeSemanticAction(
			orchestrator as never,
			{ handle: "window-1", title: "Mozilla Firefox" },
			{
				id: "browser_click",
				label: "Browser Click",
				description: "click and wait",
				steps: [{ kind: "send-mouse", action: "click", button: "left" }],
			},
		)).rejects.toThrow("browser load guard timed out");
	});

	it("skips load guard for non-browser windows", async () => {
		const orchestrator = createOrchestrator();

		await executeSemanticAction(
			orchestrator as never,
			{ handle: "window-2", title: "Sokoban" },
			{
				id: "board_click",
				label: "Board Click",
				description: "click in game board",
				steps: [{ kind: "send-mouse", action: "click", button: "left" }],
			},
		);

		expect(orchestrator.runCaptureTask).not.toHaveBeenCalled();
		expect(requestActiveVisionDecision).not.toHaveBeenCalled();
	});

	it("can force-disable load guard even on browser windows", async () => {
		const orchestrator = createOrchestrator();

		await executeSemanticAction(
			orchestrator as never,
			{ handle: "window-1", title: "Mozilla Firefox" },
			{
				id: "browser_click",
				label: "Browser Click",
				description: "click and wait",
				steps: [{ kind: "send-mouse", action: "click", button: "left" }],
			},
			{
				loadGuardPolicy: "force-disable",
			},
		);

		expect(orchestrator.runCaptureTask).not.toHaveBeenCalled();
		expect(requestActiveVisionDecision).not.toHaveBeenCalled();
	});
});
