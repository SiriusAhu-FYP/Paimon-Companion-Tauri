import type { EventBus } from "@/services/event-bus";
import type { SessionDigestRecord, SalientEvent, SessionDigestState } from "@/types/memory";
import type { CompanionSummaryRecord } from "@/types/companion-runtime";
import type { ILLMService } from "@/services/llm/types";
import { createLogger } from "@/services/logger";

const log = createLogger("session-digest");

const DEFAULT_DIGEST_WINDOW_SIZE = 6;
const MAX_DIGEST_HISTORY = 20;
const MAX_DIGEST_CONTEXT_CHARS = 1500;

const DIGEST_SYSTEM_PROMPT = `你是一个记忆压缩助手。你会收到一组连续的游戏/屏幕时序观察摘要（summaries）。
你的任务是将它们压缩为一个简短的 digest，保留以下关键信息：
1. 重要事件和转折点
2. 情绪/氛围变化弧线
3. 关键成就或失败
4. 值得记住的细节

同时，请检测是否有"关键事件"（salient events），包括：
- danger: 角色遇到危险（生命值下降、被攻击、跌落等）
- achievement: 完成成就、通关、获得奖励等
- discovery: 发现新区域、新物品、新信息等
- error: 系统错误、任务失败等
- turning-point: 剧情/游戏进展的关键转折

请以 JSON 格式回复：
{
  "digest": "压缩后的摘要（200字以内）",
  "emotionArc": "情绪变化弧线（如 neutral → excited → anxious）",
  "salientEvents": [
    { "type": "danger|achievement|discovery|error|turning-point", "description": "简要描述", "severity": 1-5 }
  ]
}
仅返回 JSON，不要附加说明。`;

interface DigestLLMResponse {
	digest: string;
	emotionArc: string;
	salientEvents: Array<{
		type: string;
		description: string;
		severity: number;
	}>;
}

export interface SessionDigestServiceDeps {
	bus: EventBus;
	llmProvider: ILLMService;
	digestWindowSize?: number;
}

export class SessionDigestService {
	private bus: EventBus;
	private llmProvider: ILLMService;
	private digestWindowSize: number;

	private pendingSummaries: CompanionSummaryRecord[] = [];
	private digestHistory: SessionDigestRecord[] = [];
	private salientEvents: SalientEvent[] = [];
	private digestCounter = 0;
	private processing = false;
	private unsubscribe: (() => void) | null = null;

	constructor(deps: SessionDigestServiceDeps) {
		this.bus = deps.bus;
		this.llmProvider = deps.llmProvider;
		this.digestWindowSize = deps.digestWindowSize ?? DEFAULT_DIGEST_WINDOW_SIZE;

		this.unsubscribe = this.bus.on("companion-runtime:summary-complete", (payload) => {
			this.handleSummary(payload.record);
		});
	}

	private handleSummary(record: CompanionSummaryRecord): void {
		this.pendingSummaries.push(record);
		log.debug("summary received", { pending: this.pendingSummaries.length, window: this.digestWindowSize });

		if (this.pendingSummaries.length >= this.digestWindowSize) {
			this.generateDigest();
		}
	}

	private async generateDigest(): Promise<void> {
		if (this.processing) return;

		const window = this.pendingSummaries.splice(0, this.digestWindowSize);
		if (window.length === 0) return;

		this.processing = true;

		try {
			const userContent = window
				.map((s, i) => `[摘要 ${i + 1}] (${new Date(s.createdAt).toLocaleTimeString()})\n${s.summary}`)
				.join("\n\n");

			const messages = [
				{ role: "system" as const, content: DIGEST_SYSTEM_PROMPT },
				{ role: "user" as const, content: userContent },
			];

			const response = await this.llmProvider.chat(messages);
			const parsed = this.parseDigestResponse(response);

			this.digestCounter++;
			const record: SessionDigestRecord = {
				id: `digest-${this.digestCounter}-${Date.now()}`,
				createdAt: Date.now(),
				windowStart: window[0]!.createdAt,
				windowEnd: window[window.length - 1]!.createdAt,
				summaryCount: window.length,
				digest: parsed.digest,
				salientEvents: parsed.salientEvents.map((e) => e.description),
				emotionArc: parsed.emotionArc,
			};

			this.digestHistory.push(record);
			if (this.digestHistory.length > MAX_DIGEST_HISTORY) {
				this.digestHistory = this.digestHistory.slice(-MAX_DIGEST_HISTORY);
			}

			this.bus.emit("memory:digest-complete", { digest: record });
			log.info("digest generated", { id: record.id, summaryCount: record.summaryCount });

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
			log.error("digest generation failed", err);
			this.pendingSummaries.unshift(...window);
		} finally {
			this.processing = false;
		}
	}

	private parseDigestResponse(text: string): DigestLLMResponse {
		try {
			const jsonMatch = text.match(/\{[\s\S]*\}/);
			if (!jsonMatch) throw new Error("no JSON found");
			return JSON.parse(jsonMatch[0]) as DigestLLMResponse;
		} catch {
			log.warn("failed to parse digest response, using raw text");
			return {
				digest: text.slice(0, 200),
				emotionArc: "unknown",
				salientEvents: [],
			};
		}
	}

	private validateEventType(type: string): SalientEvent["type"] {
		const valid: SalientEvent["type"][] = ["danger", "achievement", "discovery", "error", "turning-point"];
		return valid.includes(type as SalientEvent["type"]) ? (type as SalientEvent["type"]) : "discovery";
	}

	getSessionDigestContext(): string {
		if (this.digestHistory.length === 0) return "";

		const recent = this.digestHistory.slice(-3);
		const parts = recent.map((d) =>
			`[${new Date(d.createdAt).toLocaleTimeString()}] ${d.digest} (情绪: ${d.emotionArc})`
		);
		const result = parts.join("\n");
		return result.length > MAX_DIGEST_CONTEXT_CHARS
			? `${result.slice(0, MAX_DIGEST_CONTEXT_CHARS)}\n[…已截断…]`
			: result;
	}

	getState(): SessionDigestState {
		return {
			digestHistory: [...this.digestHistory],
			pendingSummaryCount: this.pendingSummaries.length,
			salientEvents: [...this.salientEvents],
		};
	}

	getSalientEvents(): SalientEvent[] {
		return [...this.salientEvents];
	}

	getDigestHistory(): SessionDigestRecord[] {
		return [...this.digestHistory];
	}

	reset(): void {
		this.pendingSummaries = [];
		this.digestHistory = [];
		this.salientEvents = [];
		this.digestCounter = 0;
		this.processing = false;
		log.info("session digest state reset");
	}

	setLLMProvider(provider: ILLMService): void {
		this.llmProvider = provider;
	}

	dispose(): void {
		this.unsubscribe?.();
		this.unsubscribe = null;
	}
}
