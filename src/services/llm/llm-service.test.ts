import { describe, expect, it, vi } from "vitest";
import { EventBus } from "@/services/event-bus";
import { RuntimeService } from "@/services/runtime";
import { CompanionModeService } from "@/services/companion-mode";
import { DelegationMemoryService } from "@/services/delegation-memory";
import { LLMService } from "./llm-service";
import type { ILLMService, ToolDef } from "./types";
import { listLlmTools } from "@/services/mcp/tool-defs";
import { callLocalMcpTool } from "@/services/mcp/local-mcp-client";

vi.mock("./prompt-builder", () => ({
	buildSystemMessage: vi.fn(() => null),
	summarizePromptContext: vi.fn(() => "prompt-context"),
}));

vi.mock("@/services/config", () => ({
	getConfig: vi.fn(() => ({
		character: {
			customPersona: "",
			behaviorConstraints: "",
		},
	})),
}));

vi.mock("@/services/mcp/tool-defs", () => ({
	listLlmTools: vi.fn((): ToolDef[] => []),
	resolveMcpToolName: vi.fn((name: string) => name),
}));

vi.mock("@/services/mcp/local-mcp-client", () => ({
	callLocalMcpTool: vi.fn(),
}));

describe("LLMService proactive source emission", () => {
	it("emits proactive-reply as a distinct llm request/response source", async () => {
		const bus = new EventBus();
		const runtime = new RuntimeService(bus);
		const companionMode = new CompanionModeService(bus);
		const delegationMemory = new DelegationMemoryService(bus);
		const provider: ILLMService = {
			async *chat() {
				yield { type: "done", fullText: "我会继续看着情况。" } as const;
			},
		};
		const service = new LLMService(
			bus,
			runtime,
			provider,
			{
				getState: vi.fn(() => ({
					currentEmotion: "neutral",
					intensity: 0,
					residualEmotion: "neutral",
					residualIntensity: 0,
					presentationEmotion: "neutral",
					isHeldForSpeech: false,
					lastReason: null,
					lastSource: "system",
					updatedAt: 0,
					priority: 0,
				})),
			} as never,
			{
				getProfile: vi.fn(() => ({
					id: "paimon",
					name: "Paimon",
					description: "",
					defaultEmotion: "neutral",
				})),
			} as never,
			{} as never,
			{
				getPromptContext: vi.fn(() => "最近观察：角色正在原地等待。"),
			} as never,
			companionMode,
			delegationMemory,
		);

		await service.generateCompanionReply("请判断是否需要主动回应", {
			source: "proactive-reply",
			traceId: "trace-proactive-1",
		});

		const requestEvent = bus.getHistory().find((entry) => entry.event === "llm:request-start");
		const responseEvent = bus.getHistory().find((entry) => entry.event === "llm:response-end");

		expect(requestEvent?.payload).toMatchObject({
			source: "proactive-reply",
			traceId: "trace-proactive-1",
		});
		expect(responseEvent?.payload).toMatchObject({
			source: "proactive-reply",
			traceId: "trace-proactive-1",
			fullText: "我会继续看着情况。",
		});
	});

	it("keeps first-pass text when a tool-call follow-up returns no second assistant text", async () => {
		vi.mocked(listLlmTools).mockReturnValueOnce([
			{
				name: "companion_set_emotion",
				description: "set emotion",
				parameters: {
					type: "object",
					properties: {},
				},
			},
		]);
		vi.mocked(callLocalMcpTool).mockResolvedValueOnce("{\"ok\":true}");

		const bus = new EventBus();
		const runtime = new RuntimeService(bus);
		const companionMode = new CompanionModeService(bus);
		const delegationMemory = new DelegationMemoryService(bus);
		let callIndex = 0;
		const provider: ILLMService = {
			async *chat() {
				callIndex += 1;
				if (callIndex === 1) {
					yield { type: "tool-call", id: "tool-1", name: "companion_set_emotion", args: { emotion: "happy" }, rawArguments: "{\"emotion\":\"happy\"}" } as const;
					yield { type: "done", fullText: "小心一点，我在看着。" } as const;
					return;
				}
				yield { type: "done", fullText: "" } as const;
			},
		};
		const service = new LLMService(
			bus,
			runtime,
			provider,
			{
				getState: vi.fn(() => ({
					currentEmotion: "neutral",
					intensity: 0,
					residualEmotion: "neutral",
					residualIntensity: 0,
					presentationEmotion: "neutral",
					isHeldForSpeech: false,
					lastReason: null,
					lastSource: "system",
					updatedAt: 0,
					priority: 0,
				})),
			} as never,
			{
				getProfile: vi.fn(() => ({
					id: "paimon",
					name: "Paimon",
					description: "",
					defaultEmotion: "neutral",
				})),
			} as never,
			{} as never,
			{
				getPromptContext: vi.fn(() => "最近观察：危险接近。"),
			} as never,
			companionMode,
			delegationMemory,
		);

		const reply = await service.generateCompanionReply("请判断是否需要主动回应", {
			source: "proactive-reply",
			traceId: "trace-proactive-2",
		});

		expect(reply).toBe("小心一点，我在看着。");
	});
});
