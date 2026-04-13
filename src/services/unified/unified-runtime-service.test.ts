import { describe, expect, it, vi, beforeEach } from "vitest";
import { EventBus } from "@/services/event-bus";
import { RuntimeService } from "@/services/runtime";
import { AffectStateService } from "@/services/affect-state";
import { UnifiedRuntimeService } from "./unified-runtime-service";
import { callLocalMcpTool } from "@/services/mcp/local-mcp-client";

vi.mock("@/services/mcp/local-mcp-client", () => ({
	callLocalMcpTool: vi.fn(),
}));

describe("UnifiedRuntimeService affect application", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("keeps using the MCP companion emotion contract", async () => {
		const bus = new EventBus();
		const affect = new AffectStateService(bus);
		const runtime = new RuntimeService(bus);
		const service = new UnifiedRuntimeService({
			bus,
			runtime,
			affect,
			companionRuntime: {} as never,
			orchestrator: {} as never,
			game2048: {} as never,
			sokoban: {} as never,
			llm: {} as never,
			pipeline: {} as never,
		});

		await (service as unknown as { applyEmotion: (emotion: string, traceId?: string) => Promise<void> }).applyEmotion("happy", "trace-1");

		expect(callLocalMcpTool).toHaveBeenCalledWith("companion.set_emotion", { emotion: "happy" }, { timeoutMs: 45_000, traceId: "trace-1" });
	});

	it("falls back into affect state when the MCP call fails", async () => {
		vi.mocked(callLocalMcpTool).mockRejectedValueOnce(new Error("mcp failed"));
		const bus = new EventBus();
		const affect = new AffectStateService(bus);
		const runtime = new RuntimeService(bus);
		const service = new UnifiedRuntimeService({
			bus,
			runtime,
			affect,
			companionRuntime: {} as never,
			orchestrator: {} as never,
			game2048: {} as never,
			sokoban: {} as never,
			llm: {} as never,
			pipeline: {} as never,
		});

		await (service as unknown as { applyEmotion: (emotion: string, traceId?: string) => Promise<void> }).applyEmotion("delighted", "trace-2");

		expect(affect.getState()).toMatchObject({
			currentEmotion: "delighted",
			presentationEmotion: "delighted",
			lastSource: "unified-runtime",
			lastReason: "unified-mcp-fallback",
		});
	});
});
