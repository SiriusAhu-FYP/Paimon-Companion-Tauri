import type { EventBus } from "@/services/event-bus";
import type { RuntimeService } from "@/services/runtime";
import type { ILLMService, ChatMessage } from "./types";
import { createLogger } from "@/services/logger";

const log = createLogger("llm");

/**
 * LLM 服务门面——协调 ILLMService 实现与事件总线的集成。
 * 接收用户输入，调用底层 LLM，将流式结果分发到事件总线。
 */
export class LLMService {
	private bus: EventBus;
	private runtime: RuntimeService;
	private provider: ILLMService;
	private history: ChatMessage[] = [];
	private processing = false;

	constructor(bus: EventBus, runtime: RuntimeService, provider: ILLMService) {
		this.bus = bus;
		this.runtime = runtime;
		this.provider = provider;
	}

	isProcessing(): boolean {
		return this.processing;
	}

	getHistory(): readonly ChatMessage[] {
		return this.history;
	}

	async sendMessage(userText: string): Promise<void> {
		if (!this.runtime.isAllowed()) {
			log.warn("LLM request blocked — runtime stopped");
			return;
		}
		if (this.processing) {
			log.warn("LLM already processing, ignoring");
			return;
		}

		this.processing = true;
		this.history.push({ role: "user", content: userText });
		this.bus.emit("llm:request-start", { userText });

		try {
			let fullText = "";
			for await (const chunk of this.provider.chat(this.history)) {
				// 在流式处理中也检查 runtime 状态
				if (!this.runtime.isAllowed()) {
					log.warn("LLM stream aborted — runtime stopped");
					break;
				}

				switch (chunk.type) {
					case "delta":
						fullText += chunk.text;
						this.bus.emit("llm:stream-chunk", { delta: chunk.text });
						break;
					case "tool-call":
						this.bus.emit("llm:tool-call", { name: chunk.name, args: chunk.args });
						break;
					case "done":
						fullText = chunk.fullText;
						break;
				}
			}

			this.history.push({ role: "assistant", content: fullText });
			this.bus.emit("llm:response-end", { fullText });
			log.info(`response complete (${fullText.length} chars)`);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			this.bus.emit("llm:error", { error: msg });
			log.error("LLM error", msg);
		} finally {
			this.processing = false;
		}
	}

	clearHistory() {
		this.history = [];
	}
}
