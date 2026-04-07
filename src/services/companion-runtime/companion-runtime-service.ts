import type { EventBus } from "@/services/event-bus";
import type { PerceptionService } from "@/services/perception";
import { getConfig, proxyRequest, SECRET_KEYS, updateConfig } from "@/services/config";
import { createLogger } from "@/services/logger";
import { findSemanticGameByTargetTitle } from "@/services/games/semantic-game-registry";
import type {
	CompanionFrameDescriptionRecord,
	CompanionRuntimeState,
	CompanionSummaryRecord,
	FunctionalTarget,
	PerceptionSnapshot,
} from "@/types";
import { normalizeCompatibleOpenAIBaseUrl } from "@/services/games/game-utils";

const log = createLogger("companion-runtime");

interface OpenAIChatCompletionResponse {
	choices?: Array<{
		message?: {
			content?: string | Array<{ type?: string; text?: string }>;
		};
	}>;
}

function makeInitialState(): CompanionRuntimeState {
	const config = getConfig();
	return {
		running: false,
		phase: "idle",
		target: null,
		localVisionBaseUrl: config.companionRuntime.localVisionBaseUrl,
		localVisionModel: config.companionRuntime.localVisionModel,
		captureIntervalMs: config.companionRuntime.captureIntervalMs,
		summaryWindowMs: config.companionRuntime.summaryWindowMs,
		historyRetentionMs: config.companionRuntime.historyRetentionMs,
		lastFrame: null,
		lastSummary: null,
		frameQueue: [],
		summaryHistory: [],
		lastError: null,
	};
}

function cloneFrameRecord(record: CompanionFrameDescriptionRecord): CompanionFrameDescriptionRecord {
	return { ...record };
}

function cloneSummaryRecord(record: CompanionSummaryRecord): CompanionSummaryRecord {
	return { ...record };
}

function extractMessageText(response: OpenAIChatCompletionResponse): string {
	const content = response.choices?.[0]?.message?.content;
	if (typeof content === "string") {
		return content.trim();
	}
	if (Array.isArray(content)) {
		return content
			.map((part) => (typeof part.text === "string" ? part.text : ""))
			.join("\n")
			.trim();
	}
	return "";
}

function truncateLine(text: string, limit = 160): string {
	if (text.length <= limit) return text;
	return `${text.slice(0, limit - 1)}…`;
}

function buildFallbackSummary(frames: readonly CompanionFrameDescriptionRecord[]): string {
	if (!frames.length) {
		return "暂无足够的画面描述可供总结。";
	}
	return `最近画面概况：${frames
		.slice(-3)
		.map((frame) => truncateLine(frame.description, 80))
		.join("；")}`;
}

function formatTime(timestamp: number): string {
	return new Date(timestamp).toLocaleTimeString();
}

function buildObservationOverlay(targetTitle: string): string {
	const game = findSemanticGameByTargetTitle(targetTitle);
	if (!game || !game.observationFocus.length) {
		return "";
	}
	return [
		`Special focus for ${game.displayName}:`,
		...game.observationFocus.map((line) => `- ${line}`),
	].join("\n");
}

export class CompanionRuntimeService {
	private bus: EventBus;
	private perception: PerceptionService;
	private state: CompanionRuntimeState = makeInitialState();
	private captureTimer: ReturnType<typeof setInterval> | null = null;
	private summaryTimer: ReturnType<typeof setInterval> | null = null;
	private captureInFlight = false;
	private summaryInFlight = false;

	constructor(deps: {
		bus: EventBus;
		perception: PerceptionService;
	}) {
		this.bus = deps.bus;
		this.perception = deps.perception;
	}

	getState(): Readonly<CompanionRuntimeState> {
		return {
			...this.state,
			target: this.state.target ? { ...this.state.target } : null,
			lastFrame: this.state.lastFrame ? cloneFrameRecord(this.state.lastFrame) : null,
			lastSummary: this.state.lastSummary ? cloneSummaryRecord(this.state.lastSummary) : null,
			frameQueue: this.state.frameQueue.map(cloneFrameRecord),
			summaryHistory: this.state.summaryHistory.map(cloneSummaryRecord),
		};
	}

	getPromptContext(): string {
		const latestTimestamp = this.state.lastSummary?.createdAt ?? this.state.lastFrame?.capturedAt ?? 0;
		if (!latestTimestamp) {
			return "";
		}
		if (Date.now() - latestTimestamp > this.state.historyRetentionMs) {
			return "";
		}

		const parts: string[] = [];
		const targetTitle = this.state.target?.title?.trim() || this.state.lastFrame?.targetTitle;
		if (targetTitle) {
			parts.push(`当前观察目标：${targetTitle}`);
		}

		if (this.state.lastSummary) {
			const summary = this.state.lastSummary;
			const durationSeconds = Math.max(1, Math.round((summary.windowEndedAt - summary.windowStartedAt) / 1000));
			parts.push(
				[
					`最近时序总结（${summary.source}，约 ${durationSeconds}s 窗口，生成于 ${formatTime(summary.createdAt)}）`,
					summary.summary,
				].join("\n"),
			);
		}

		const recentFrames = this.state.frameQueue.slice(-3);
		if (recentFrames.length) {
			parts.push(
				[
					"最近帧描述：",
					...recentFrames.map((frame) => `- [${formatTime(frame.capturedAt)}] ${truncateLine(frame.description, 120)}`),
				].join("\n"),
			);
		}

		const recentSummaries = this.state.summaryHistory.slice(-3);
		if (recentSummaries.length > 1) {
			parts.push(
				[
					"最近总结历史：",
					...recentSummaries.map((summary) => `- [${formatTime(summary.createdAt)}] ${truncateLine(summary.summary, 120)}`),
				].join("\n"),
			);
		}

		return parts.join("\n\n").trim();
	}

	async start(target: FunctionalTarget): Promise<void> {
		if (!target) {
			throw new Error("no target selected for companion runtime");
		}

		this.stopTimers();
		this.state.running = true;
		this.state.phase = "idle";
		this.state.target = { ...target };
		this.state.lastError = null;
		this.emitState();

		await this.runCaptureTick();

		this.captureTimer = setInterval(() => {
			void this.runCaptureTick();
		}, this.state.captureIntervalMs);

		this.summaryTimer = setInterval(() => {
			void this.runSummaryTick();
		}, this.state.summaryWindowMs);

		log.info("companion runtime started", {
			target: target.title,
			captureIntervalMs: this.state.captureIntervalMs,
			summaryWindowMs: this.state.summaryWindowMs,
			historyRetentionMs: this.state.historyRetentionMs,
		});
	}

	stop(): void {
		this.stopTimers();
		this.captureInFlight = false;
		this.summaryInFlight = false;
		this.state.running = false;
		this.state.phase = "idle";
		this.emitState();
		log.info("companion runtime stopped");
	}

	clearHistory(): void {
		this.state.lastFrame = null;
		this.state.lastSummary = null;
		this.state.frameQueue = [];
		this.state.summaryHistory = [];
		this.state.lastError = null;
		this.emitState();
	}

	async updateRuntimeConfig(partial: Partial<Pick<CompanionRuntimeState, "localVisionBaseUrl" | "localVisionModel" | "captureIntervalMs" | "summaryWindowMs" | "historyRetentionMs">>): Promise<void> {
		this.state.localVisionBaseUrl = partial.localVisionBaseUrl ?? this.state.localVisionBaseUrl;
		this.state.localVisionModel = partial.localVisionModel ?? this.state.localVisionModel;
		this.state.captureIntervalMs = partial.captureIntervalMs ?? this.state.captureIntervalMs;
		this.state.summaryWindowMs = partial.summaryWindowMs ?? this.state.summaryWindowMs;
		this.state.historyRetentionMs = partial.historyRetentionMs ?? this.state.historyRetentionMs;

		await updateConfig({
			companionRuntime: {
				localVisionBaseUrl: this.state.localVisionBaseUrl,
				localVisionModel: this.state.localVisionModel,
				captureIntervalMs: this.state.captureIntervalMs,
				summaryWindowMs: this.state.summaryWindowMs,
				historyRetentionMs: this.state.historyRetentionMs,
			},
		});

		if (this.state.running && this.state.target) {
			await this.start(this.state.target);
			return;
		}

		this.emitState();
	}

	async runSummaryNow(): Promise<void> {
		await this.runSummaryTick(true);
	}

	private stopTimers() {
		if (this.captureTimer) {
			clearInterval(this.captureTimer);
			this.captureTimer = null;
		}
		if (this.summaryTimer) {
			clearInterval(this.summaryTimer);
			this.summaryTimer = null;
		}
	}

	private async runCaptureTick(): Promise<void> {
		if (!this.state.running || !this.state.target || this.captureInFlight) {
			return;
		}

		this.captureInFlight = true;
		this.state.phase = "capturing";
		this.state.lastError = null;
		this.emitState();

		try {
			const snapshot = await this.perception.captureTarget(this.state.target);
			this.state.phase = "describing";
			this.emitState();
			const description = await this.describeSnapshot(snapshot);
			const record: CompanionFrameDescriptionRecord = {
				id: `frame-${snapshot.capturedAt}`,
				targetTitle: snapshot.targetTitle,
				capturedAt: snapshot.capturedAt,
				description,
				captureMethod: snapshot.captureMethod,
				qualityScore: snapshot.qualityScore,
			};
			this.state.lastFrame = record;
			this.state.frameQueue = [...this.state.frameQueue, record];
			this.pruneHistory(record.capturedAt);
			this.bus.emit("companion-runtime:frame-described", { record: cloneFrameRecord(record) });
			this.state.phase = "idle";
			this.emitState();
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			this.state.phase = "error";
			this.state.lastError = message;
			this.emitState();
			log.error("frame description tick failed", err);
		} finally {
			this.captureInFlight = false;
		}
	}

	private async runSummaryTick(force = false): Promise<void> {
		if (!this.state.running || this.summaryInFlight) {
			return;
		}

		const now = Date.now();
		this.pruneHistory(now);
		const windowStartedAt = now - this.state.summaryWindowMs;
		const windowFrames = this.state.frameQueue.filter((frame) => frame.capturedAt >= windowStartedAt);
		if (!windowFrames.length) {
			return;
		}

		if (!force && this.state.lastSummary && this.state.lastFrame && this.state.lastFrame.capturedAt <= this.state.lastSummary.windowEndedAt) {
			return;
		}

		this.summaryInFlight = true;
		this.state.phase = "summarizing";
		this.state.lastError = null;
		this.emitState();

		try {
			const previousSummaries = this.state.summaryHistory.slice(-6);
			const { summary, source } = await this.summarizeWindow(windowFrames, previousSummaries);
			const record: CompanionSummaryRecord = {
				id: `summary-${now}`,
				createdAt: now,
				windowStartedAt,
				windowEndedAt: now,
				frameCount: windowFrames.length,
				summary,
				source,
			};
			this.state.lastSummary = record;
			this.state.summaryHistory = [...this.state.summaryHistory, record];
			this.pruneHistory(now);
			this.bus.emit("companion-runtime:summary-complete", { record: cloneSummaryRecord(record) });
			this.state.phase = "idle";
			this.emitState();
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			this.state.phase = "error";
			this.state.lastError = message;
			this.emitState();
			log.error("summary tick failed", err);
		} finally {
			this.summaryInFlight = false;
		}
	}

	private pruneHistory(now: number) {
		const cutoff = now - this.state.historyRetentionMs;
		this.state.frameQueue = this.state.frameQueue.filter((frame) => frame.capturedAt >= cutoff);
		this.state.summaryHistory = this.state.summaryHistory.filter((summary) => summary.createdAt >= cutoff);
	}

	private async describeSnapshot(snapshot: PerceptionSnapshot): Promise<string> {
		const baseUrl = normalizeCompatibleOpenAIBaseUrl(this.state.localVisionBaseUrl);
		const observationOverlay = buildObservationOverlay(snapshot.targetTitle);
		const response = await proxyRequest({
			url: `${baseUrl}/chat/completions`,
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				model: this.state.localVisionModel,
				max_tokens: 120,
				temperature: 0.1,
				messages: [
					{
						role: "system",
						content: [
							"You are a low-latency screen observer.",
							"Describe only what is directly visible on the screen in 1-2 short sentences.",
							"Mention people, objects, setting, text, motion, interface state, and obvious changes.",
							"Do not assume this is a game unless the screen clearly shows game UI or gameplay elements.",
							"Avoid speculation.",
							observationOverlay,
						].filter(Boolean).join("\n"),
					},
					{
						role: "user",
						content: [
							{
								type: "text",
								text: "Describe this screen for a live companion. Mention only what is clearly visible right now.",
							},
							{
								type: "image_url",
								image_url: { url: snapshot.dataUrl },
							},
						],
					},
				],
			}),
			timeoutMs: Math.max(8000, this.state.captureIntervalMs * 4),
		});

		if (response.status < 200 || response.status >= 300) {
			throw new Error(`local vision request failed: HTTP ${response.status}`);
		}

		const parsed = JSON.parse(response.body) as OpenAIChatCompletionResponse;
		const text = extractMessageText(parsed);
		if (!text) {
			throw new Error("local vision returned empty description");
		}
		return text;
	}

	private async summarizeWindow(
		windowFrames: readonly CompanionFrameDescriptionRecord[],
		previousSummaries: readonly CompanionSummaryRecord[],
	): Promise<{ summary: string; source: "cloud" | "fallback" }> {
		const config = getConfig();
		const activeProfile = config.activeLlmProfileId
			? config.llmProfiles.find((profile) => profile.id === config.activeLlmProfileId)
			: null;
		const provider = activeProfile?.provider ?? config.llm.provider;
		const baseUrl = activeProfile?.baseUrl ?? config.llm.baseUrl;
		const model = activeProfile?.model ?? config.llm.model;
		const secretKey = activeProfile ? SECRET_KEYS.LLM_API_KEY(activeProfile.id) : undefined;

		if (provider !== "openai-compatible" || !baseUrl || !model) {
			return {
				summary: buildFallbackSummary(windowFrames),
				source: "fallback",
			};
		}

		const historyText = previousSummaries.length
			? previousSummaries
				.slice(-6)
				.map((summary, index) => `${index + 1}. ${summary.summary}`)
				.join("\n")
			: "none";
		const frameText = windowFrames
			.map((frame) => `- [${new Date(frame.capturedAt).toLocaleTimeString()}] ${frame.description}`)
			.join("\n");
		const observationOverlay = buildObservationOverlay(this.state.target?.title ?? windowFrames[windowFrames.length - 1]?.targetTitle ?? "");

		const response = await proxyRequest({
			url: `${normalizeCompatibleOpenAIBaseUrl(baseUrl)}/chat/completions`,
			method: "POST",
			headers: { "Content-Type": "application/json" },
			secretKey,
			body: JSON.stringify({
				model,
				temperature: 0.2,
				max_tokens: 220,
				messages: [
					{
						role: "system",
						content: [
							"You summarize recent screen observations for a companion agent.",
							"Write a concise Chinese summary that captures what visibly happened over time, including people, actions, setting changes, interface changes, and unresolved uncertainty when relevant.",
							"Do not assume this is gameplay unless the observations clearly show game elements.",
							"Do not invent unseen details.",
							observationOverlay,
						].filter(Boolean).join("\n"),
					},
					{
						role: "user",
						content: [
							`Target window: ${this.state.target?.title ?? "unknown"}`,
							"Recent frame descriptions:",
							frameText,
							"Recent summary history:",
							historyText,
							"Write one compact temporal summary for the latest window.",
						].join("\n\n"),
					},
				],
			}),
			timeoutMs: 15000,
		});

		if (response.status < 200 || response.status >= 300) {
			return {
				summary: buildFallbackSummary(windowFrames),
				source: "fallback",
			};
		}

		const parsed = JSON.parse(response.body) as OpenAIChatCompletionResponse;
		const summary = extractMessageText(parsed);
		if (!summary) {
			return {
				summary: buildFallbackSummary(windowFrames),
				source: "fallback",
			};
		}

		return {
			summary,
			source: "cloud",
		};
	}

	private emitState() {
		this.bus.emit("companion-runtime:state-change", { state: this.getState() });
	}
}
