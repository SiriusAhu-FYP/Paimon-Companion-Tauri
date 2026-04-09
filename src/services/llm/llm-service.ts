import type { EventBus } from "@/services/event-bus";
import type { RuntimeService } from "@/services/runtime";
import type { CharacterService } from "@/services/character";
import type { KnowledgeService } from "@/services/knowledge";
import type { CompanionRuntimeService } from "@/services/companion-runtime";
import { getConfig } from "@/services/config";
import type { ILLMService, ChatMessage } from "./types";
import { buildSystemMessage, summarizePromptContext } from "./prompt-builder";
import { formatRetrievalForPrompt, summarizeRetrieval } from "@/services/knowledge/knowledge-formatter";
import { createLogger } from "@/services/logger";
import { listLlmTools, resolveMcpToolName } from "@/services/mcp/tool-defs";
import { callLocalMcpTool } from "@/services/mcp/local-mcp-client";

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
	private companionRuntime: CompanionRuntimeService;
	private history: ChatMessage[] = [];
	private processing = false;

	constructor(
		bus: EventBus,
		runtime: RuntimeService,
		provider: ILLMService,
		character: CharacterService,
		knowledge: KnowledgeService,
		companionRuntime: CompanionRuntimeService,
	) {
		this.bus = bus;
		this.runtime = runtime;
		this.provider = provider;
		this.character = character;
		this.knowledge = knowledge;
		this.companionRuntime = companionRuntime;
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

	private async collectResponse(
		messages: ChatMessage[],
		options?: {
			tools?: ReturnType<typeof listLlmTools>;
			emitStream?: boolean;
			emitToolCalls?: boolean;
		},
	): Promise<{
		fullText: string;
		toolCalls: Array<{
			id: string;
			name: string;
			args: Record<string, unknown>;
			rawArguments: string;
		}>;
	}> {
		const toolCalls: Array<{
			id: string;
			name: string;
			args: Record<string, unknown>;
			rawArguments: string;
		}> = [];
		let fullText = "";

		for await (const chunk of this.provider.chat(messages, options?.tools)) {
			if (!this.runtime.isAllowed()) {
				log.warn("LLM stream aborted — runtime stopped");
				break;
			}
			switch (chunk.type) {
				case "delta":
					fullText += chunk.text;
					if (options?.emitStream) {
						this.bus.emit("llm:stream-chunk", { delta: chunk.text });
					}
					break;
				case "tool-call": {
					const resolvedName = resolveMcpToolName(chunk.name);
					toolCalls.push({
						id: chunk.id,
						name: resolvedName,
						args: chunk.args,
						rawArguments: chunk.rawArguments,
					});
					if (options?.emitToolCalls) {
						this.bus.emit("llm:tool-call", { name: resolvedName, args: chunk.args });
					}
					break;
				}
				case "done":
					fullText = chunk.fullText || fullText;
					break;
			}
		}

		return { fullText: fullText.trim(), toolCalls };
	}

	private async executeToolCalls(
		toolCalls: Array<{
			id: string;
			name: string;
			args: Record<string, unknown>;
			rawArguments: string;
		}>,
	): Promise<Array<Extract<ChatMessage, { role: "tool" }>>> {
		const toolMessages: Array<Extract<ChatMessage, { role: "tool" }>> = [];

		for (const call of toolCalls) {
			try {
				const result = await callLocalMcpTool(call.name, call.args);
				toolMessages.push({
					role: "tool",
					toolCallId: call.id,
					content: result || "{}",
				});
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				toolMessages.push({
					role: "tool",
					toolCallId: call.id,
					content: JSON.stringify({ ok: false, error: message }),
				});
				log.error("MCP tool execution failed", { tool: call.name, error: message });
			}
		}

		return toolMessages;
	}

	private async runToolLoop(
		messages: ChatMessage[],
		tools: ReturnType<typeof listLlmTools>,
		options?: { emitFinalStream?: boolean },
	): Promise<{ fullText: string; historyAppend: ChatMessage[] }> {
		const firstPass = await this.collectResponse(messages, {
			tools,
			emitStream: false,
			emitToolCalls: true,
		});

		if (!firstPass.toolCalls.length) {
			if (options?.emitFinalStream && firstPass.fullText) {
				this.bus.emit("llm:stream-chunk", { delta: firstPass.fullText });
			}
			return {
				fullText: firstPass.fullText,
				historyAppend: [{ role: "assistant", content: firstPass.fullText }],
			};
		}

		const assistantToolMessage: ChatMessage = {
			role: "assistant",
			content: firstPass.fullText,
			toolCalls: firstPass.toolCalls.map((call) => ({
				id: call.id,
				name: call.name,
				arguments: call.rawArguments || JSON.stringify(call.args),
			})),
		};
		const toolMessages = await this.executeToolCalls(firstPass.toolCalls);
		const secondPassMessages: ChatMessage[] = [
			...messages,
			assistantToolMessage,
			...toolMessages,
		];
		const secondPass = await this.collectResponse(secondPassMessages, {
			tools,
			emitStream: options?.emitFinalStream ?? false,
			emitToolCalls: false,
		});

		return {
			fullText: secondPass.fullText.trim(),
			historyAppend: [
				assistantToolMessage,
				...toolMessages,
				{ role: "assistant", content: secondPass.fullText.trim() },
			],
		};
	}

	async generateCompanionReply(
		userText: string,
		options?: {
			companionRuntimeContext?: string;
			knowledgeContext?: string;
		},
	): Promise<string> {
		if (!this.runtime.isAllowed()) {
			log.warn("LLM companion reply blocked — runtime stopped");
			return "";
		}

		const appCharacter = getConfig().character;
		const promptCtx = {
			characterProfile: this.character.getProfile(),
			knowledgeContext: options?.knowledgeContext ?? "",
			companionRuntimeContext: options?.companionRuntimeContext ?? this.companionRuntime.getPromptContext(),
			customPersona: appCharacter.customPersona,
			behaviorConstraints: appCharacter.behaviorConstraints,
		};
		const systemMsg = buildSystemMessage(promptCtx);
		const messages: ChatMessage[] = systemMsg
			? [systemMsg, { role: "user", content: userText }]
			: [{ role: "user", content: userText }];
		const tools = listLlmTools("companion");

		const response = await this.runToolLoop(messages, tools, {
			emitFinalStream: false,
		});
		const normalized = response.fullText;
		if (normalized) {
			log.info("generated transient companion reply", {
				length: normalized.length,
				companionRuntimeContextUsed: promptCtx.companionRuntimeContext.length > 0,
			});
		}
		return normalized;
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
		const companionRuntimeContext = this.companionRuntime.getPromptContext();
		const companionRuntimeTarget = this.companionRuntime.getState().target?.title ?? null;

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

		this.bus.emit("llm:request-start", {
			userText,
			companionRuntimeContextUsed: companionRuntimeContext.length > 0,
			companionRuntimeTarget,
			companionRuntimeContextLength: companionRuntimeContext.length,
			knowledgeContextLength: knowledgeContext.length,
		});

		const promptCtx = {
			characterProfile: this.character.getProfile(),
			knowledgeContext,
			companionRuntimeContext,
			customPersona: appCharacter.customPersona,
			behaviorConstraints: appCharacter.behaviorConstraints,
		};
		const systemMsg = buildSystemMessage(promptCtx);
		const messages: ChatMessage[] = systemMsg
			? [systemMsg, ...this.history]
			: [...this.history];
		const tools = listLlmTools("companion");

		if (systemMsg) {
			log.info("LLM system prompt assembled", summarizePromptContext(promptCtx));
		}

		try {
			const response = await this.runToolLoop(messages, tools, {
				emitFinalStream: true,
			});
			const fullText = response.fullText;

			this.history.push(...response.historyAppend);
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
