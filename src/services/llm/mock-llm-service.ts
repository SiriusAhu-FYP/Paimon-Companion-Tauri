import type { ChatMessage, ToolDef, LLMChunk, ILLMService } from "./types";
import { createLogger } from "@/services/logger";

const log = createLogger("mock-llm");

const MOCK_REPLIES: Array<{ text: string; emotion?: string }> = [
	{ text: "嘿嘿，当然有啦！今天推荐蒙德的甜甜花酿鸡，超级好吃的！", emotion: "happy" },
	{ text: "哼，旅行者你是不是又忘了带派蒙出去玩！", emotion: "angry" },
	{ text: "哇！是新的冒险任务吗？快告诉派蒙！", emotion: "delighted" },
	{ text: "呜…派蒙有点想念蒙德的苹果酿了…", emotion: "sad" },
	{ text: "等等，这情况有点不妙，派蒙先紧张起来了！", emotion: "alarmed" },
	{ text: "欸？欸欸？派蒙脑袋一时有点转不过来了……", emotion: "dazed" },
	{ text: "没问题！派蒙作为最好的向导，肯定能帮到你！", emotion: "happy" },
];

function delay(ms: number): Promise<void> {
	return new Promise((r) => setTimeout(r, ms));
}

/**
 * Mock LLM 服务：模拟流式回复 + 工具调用。
 * 从预设回复中随机选择，逐字输出模拟打字效果。
 */
export class MockLLMService implements ILLMService {
	async *chat(_messages: ChatMessage[], _tools?: ToolDef[]): AsyncGenerator<LLMChunk> {
		const pick = MOCK_REPLIES[Math.floor(Math.random() * MOCK_REPLIES.length)];
		log.info(`mock reply selected: ${pick.text.slice(0, 20)}...`);

		await delay(300);

		// 先发工具调用（表情切换）
		if (pick.emotion) {
			yield { type: "tool-call", name: "setExpression", args: { emotion: pick.emotion } };
			await delay(100);
		}

		// 逐字流式输出
		const chars = Array.from(pick.text);
		for (let i = 0; i < chars.length; i++) {
			yield { type: "delta", text: chars[i] };
			await delay(30 + Math.random() * 40);
		}

		yield { type: "done", fullText: pick.text };
	}
}
