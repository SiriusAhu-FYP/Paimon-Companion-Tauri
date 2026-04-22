import type { EventBus } from "@/services/event-bus";
import type { SalientEvent, L2RollingContext } from "@/types/memory";
import type { CompanionSummaryRecord } from "@/types/companion-runtime";
import type { ILLMService, ChatMessage } from "@/services/llm/types";
import { createLogger } from "@/services/logger";
import { consumeLLMStream } from "./llm-stream-helper";

const log = createLogger("l2-rolling-context");

const ROLLING_COMPRESS_PROMPT = `你是一个记忆压缩助手。你会收到：
1. 当前的"滚动上下文"（可能为空，表示会话刚开始）
2. 一组新的时序观察摘要

请将它们合并压缩为一个更新后的滚动上下文，遵循以下规则：
- 保留重要事件、转折点、关键成就/失败
- 保留情绪/氛围变化
- 丢弃重复、低价值的细节
- 结果控制在300字以内

同时，检测新摘要中是否有"关键事件"（salient events）：
- danger: 角色遇到危险
- achievement: 完成成就、通关、获得奖励
- discovery: 发现新区域、新物品、新信息
- error: 系统错误、任务失败
- turning-point: 剧情/游戏进展的关键转折

以 JSON 格式回复：
{
  "compressedSummary": "更新后的滚动上下文",
  "salientEvents": [
    { "type": "danger|achievement|discovery|error|turning-point", "description": "简要描述", "severity": 1-5 }
  ]
}
仅返回 JSON，不要附加说明。`;

interface CompressLLMResponse {
	compressedSummary: string;
	salientEvents: Array<{
		type: string;
		description: string;
		severity: number;
	}>;
}

export interface L2RollingContextServiceDeps {
	bus: EventBus;
	llmProvider: ILLMService;
	windowSize?: number;
}

export class L2RollingContextService {
	private bus: EventBus;
	private llmProvider: ILLMService;
	private windowSize: number;

	private pendingSummaries: CompanionSummaryRecord[] = [];
	private rollingContext: L2RollingContext = {
		lastUpdatedAt: 0,
		compressedSummary: "",
		windowSummaryIds: [],
	};
	private salientEvents: SalientEvent[] = [];
	private processing = false;
	private unsubscribe: (() => void) | null = null;

	constructor(deps: L2RollingContextServiceDeps) {
		this.bus = deps.bus;
		this.llmProvider = deps.llmProvider;
		this.windowSize = deps.windowSize ?? 6;

		this.unsubscribe = this.bus.on("companion-runtime:summary-complete", (payload) => {
			this.handleSummary(payload.record);
		});
	}

	private handleSummary(record: CompanionSummaryRecord): void {
		this.pendingSummaries.push(record);
		log.debug("summary received", { pending: this.pendingSummaries.length, window: this.windowSize });

		if (this.pendingSummaries.length >= this.windowSize) {
			this.compress();
		}
	}

	private async compress(forceAll = false): Promise<void> {
		if (this.processing) return;

		const take = forceAll ? this.pendingSummaries.length : this.windowSize;
		const batch = this.pendingSummaries.splice(0, take);
		if (batch.length === 0) return;

		this.processing = true;

		try {
			const newSummaries = batch
				.map((s, i) => `[摘要 ${i + 1}] (${new Date(s.createdAt).toLocaleTimeString()})\n${s.summary}`)
				.join("\n\n");

			const existingContext = this.rollingContext.compressedSummary
				? `当前滚动上下文：\n${this.rollingContext.compressedSummary}`
				: "当前滚动上下文：（空，会话刚开始）";

			const userContent = `${existingContext}\n\n---\n新的时序观察摘要：\n${newSummaries}`;

			const messages: ChatMessage[] = [
				{ role: "system", content: ROLLING_COMPRESS_PROMPT },
				{ role: "user", content: userContent },
			];

			const responseText = await consumeLLMStream(this.llmProvider, messages);
			const parsed = this.parseResponse(responseText);

			this.rollingContext = {
				lastUpdatedAt: Date.now(),
				compressedSummary: parsed.compressedSummary,
				windowSummaryIds: [
					...this.rollingContext.windowSummaryIds,
					...batch.map((s) => s.id),
				],
			};

			this.bus.emit("memory:l2-updated", { context: { ...this.rollingContext } });
			log.info("L2 context compressed", {
				summaryCount: batch.length,
				contextLen: parsed.compressedSummary.length,
			});

			for (const se of parsed.salientEvents) {
				const salient: SalientEvent = {
					timestamp: Date.now(),
					type: this.validateEventType(se.type),
					description: se.description,
					severity: Math.max(1, Math.min(5, se.severity)),
					source: "vision",
				};
				this.salientEvents.push(salient);
				this.bus.emit("memory:salient-event", { event: salient });
				log.info("salient event detected", { type: salient.type, severity: salient.severity });
			}
		} catch (err) {
			log.error("L2 compression failed", err);
			this.pendingSummaries.unshift(...batch);
		} finally {
			this.processing = false;
		}
	}

	private parseResponse(text: string): CompressLLMResponse {
		try {
			const jsonMatch = text.match(/\{[\s\S]*\}/);
			if (!jsonMatch) throw new Error("no JSON found");
			return JSON.parse(jsonMatch[0]) as CompressLLMResponse;
		} catch {
			log.warn("failed to parse compress response, using raw text");
			return {
				compressedSummary: text.slice(0, 300),
				salientEvents: [],
			};
		}
	}

	private validateEventType(type: string): SalientEvent["type"] {
		const valid: SalientEvent["type"][] = ["danger", "achievement", "discovery", "error", "turning-point"];
		return valid.includes(type as SalientEvent["type"]) ? (type as SalientEvent["type"]) : "discovery";
	}

	getRollingContext(): string {
		return this.rollingContext.compressedSummary;
	}

	getL2State(): L2RollingContext {
		return { ...this.rollingContext };
	}

	getSalientEvents(): SalientEvent[] {
		return [...this.salientEvents];
	}

	/** Force-flush all pending summaries (used before session-end writeback). */
	async flush(): Promise<void> {
		while (this.pendingSummaries.length > 0 && !this.processing) {
			await this.compress(true);
		}
	}

	reset(): void {
		this.pendingSummaries = [];
		this.rollingContext = { lastUpdatedAt: 0, compressedSummary: "", windowSummaryIds: [] };
		this.salientEvents = [];
		this.processing = false;
		log.info("L2 rolling context reset");
	}

	setLLMProvider(provider: ILLMService): void {
		this.llmProvider = provider;
	}

	dispose(): void {
		this.unsubscribe?.();
		this.unsubscribe = null;
	}
}
