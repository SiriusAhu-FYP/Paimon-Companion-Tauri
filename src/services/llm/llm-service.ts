import type { EventBus } from "@/services/event-bus";
import type { RuntimeService } from "@/services/runtime";
import type { CharacterService } from "@/services/character";
import type { KnowledgeService } from "@/services/knowledge";
import { getConfig } from "@/services/config";
import type { ILLMService, ChatMessage } from "./types";
import { buildSystemMessage, summarizePromptContext } from "./prompt-builder";
import { formatRetrievalForPrompt, summarizeRetrieval } from "@/services/knowledge/knowledge-formatter";
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
	private character: CharacterService;
	private knowledge: KnowledgeService;
	private history: ChatMessage[] = [];
	private processing = false;

	constructor(
		bus: EventBus,
		runtime: RuntimeService,
		provider: ILLMService,
		character: CharacterService,
		knowledge: KnowledgeService,
	) {
		this.bus = bus;
		this.runtime = runtime;
		this.provider = provider;
		this.character = character;
		this.knowledge = knowledge;
	}

	isProcessing(): boolean {
		return this.processing;
	}

	/** 热替换 LLM Provider（profile 切换后调用） */
	setProvider(provider: ILLMService) {
		this.provider = provider;
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

		const appCharacter = getConfig().character;

		// Phase 3.5：语义检索 + liveContext 格式化（带超时保护，不阻塞主 LLM 流程）
		let knowledgeContext = "";
		try {
			const queryPromise = this.knowledge.query(userText);
			const timeoutPromise = new Promise<never>((_, reject) =>
				setTimeout(() => reject(new Error("knowledge query timeout (10s)")), 10000),
			);
			const retrievalResults = await Promise.race([queryPromise, timeoutPromise]);
			const liveContext = this.knowledge.getAssembledLiveContext();
			knowledgeContext = formatRetrievalForPrompt(retrievalResults, liveContext);

			if (retrievalResults.length > 0) {
				log.info("knowledge retrieval results", summarizeRetrieval(retrievalResults));
			}
		} catch (err) {
			log.warn("knowledge retrieval failed, using liveContext only", err);
			knowledgeContext = this.knowledge.getAssembledLiveContext();
		}

		const systemMsg = buildSystemMessage({
			characterProfile: this.character.getProfile(),
			knowledgeContext,
			customPersona: appCharacter.customPersona,
		});
		const messages: ChatMessage[] = systemMsg
			? [systemMsg, ...this.history]
			: [...this.history];

		if (systemMsg) {
			log.info("LLM system prompt assembled", summarizePromptContext({
				characterProfile: this.character.getProfile(),
				knowledgeContext,
				customPersona: appCharacter.customPersona,
			}));
		}

		try {
			let fullText = "";
			for await (const chunk of this.provider.chat(messages)) {
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
