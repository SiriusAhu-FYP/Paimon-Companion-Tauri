import type { EventBus } from "@/services/event-bus";
import type { PerceptionService } from "@/services/perception";
import { getConfig, proxyRequest, SECRET_KEYS, updateConfig } from "@/services/config";
import { createLogger } from "@/services/logger";
import { findSemanticGameByTargetTitle } from "@/services/games/semantic-game-registry";
import { estimateSnapshotChange } from "@/services/games/game-utils";
import { requestOpenAICompatibleVision } from "@/services/vlm";
import type {
	CompanionFrameDescriptionRecord,
	CompanionRuntimeMetrics,
	CompanionRuntimeState,
	CompanionRuntimeDiagnosticCode,
	CompanionSummaryRecord,
	FunctionalTarget,
	PerceptionSnapshot,
} from "@/types";
import type { CompanionRuntimeStateChangePayload } from "@/types/events";
import { normalizeCompatibleOpenAIBaseUrl } from "@/services/games/game-utils";

const log = createLogger("companion-runtime");
const MIN_MEANINGFUL_CHANGE_RATIO = 0.0045;
const LOW_DIFF_SKIP_FRAME_QUEUE_LIMIT = 6;
const UNCHANGED_FRAME_DESCRIPTION = "画面变化很小，当前画面与上一帧基本一致，没有明显新变化。";
const LOCAL_VISION_READY_TIMEOUT_MS = 120_000;
const LOCAL_VISION_READY_POLL_MS = 3_000;
const STATE_CHANGE_MIN_INTERVAL_MS = 250;
const OBSERVATION_READY_WAIT_TIMEOUT_MS = 30_000;
const OBSERVATION_READY_POLL_MS = 300;
const POST_ACTION_OBSERVATION_TIMEOUT_MS = 5_000;

interface OpenAIChatCompletionResponse {
	choices?: Array<{
		message?: {
			content?: string | Array<{ type?: string; text?: string }>;
		};
	}>;
}

function makeInitialMetrics(): CompanionRuntimeMetrics {
	return {
		sessionStartedAt: null,
		lastCaptureAt: null,
		captureTicks: 0,
		visionFrames: 0,
		unchangedFrames: 0,
		summariesGenerated: 0,
		averageFrameLatencyMs: 0,
		averageSummaryLatencyMs: 0,
		lastFrameLatencyMs: null,
		lastSummaryLatencyMs: null,
	};
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
		metrics: makeInitialMetrics(),
		observationReady: false,
		lastObservationAt: null,
		diagnosticCode: null,
		diagnosticMessage: null,
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

function updateRollingAverage(previousAverage: number, previousCount: number, nextValue: number): number {
	if (previousCount <= 0) return nextValue;
	return ((previousAverage * previousCount) + nextValue) / (previousCount + 1);
}

function formatRuntimeError(stage: "frame" | "summary", baseUrl: string, error: unknown): string {
	const rawMessage = error instanceof Error ? error.message : String(error);
	const normalizedBaseUrl = normalizeCompatibleOpenAIBaseUrl(baseUrl);
	const isLocalVisionConnectivityIssue =
		/(error sending request|connection refused|timed out|os error 10060|os error 10061|failed to connect)/i.test(rawMessage)
		&& /localhost|127\.0\.0\.1/i.test(normalizedBaseUrl);

	if (!isLocalVisionConnectivityIssue) {
		return rawMessage;
	}

	if (stage === "frame") {
		return `无法连接本地视觉节点：${normalizedBaseUrl}。请确认 Windows 侧可以访问这个 OpenAI-compatible 地址；如果服务跑在 WSL 里，请确认端口已经对 Windows 暴露。原始错误：${rawMessage}`;
	}

	return `无法连接用于时序总结的 LLM/视觉地址：${normalizedBaseUrl}。请确认当前地址和模型服务已经对 Tauri 应用可达。原始错误：${rawMessage}`;
}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}

export class CompanionRuntimeService {
	private bus: EventBus;
	private perception: PerceptionService;
	private state: CompanionRuntimeState = makeInitialState();
	private captureTimer: ReturnType<typeof setTimeout> | null = null;
	private summaryTimer: ReturnType<typeof setTimeout> | null = null;
	private captureInFlight = false;
	private summaryInFlight = false;
	private lastSnapshotForDiff: PerceptionSnapshot | null = null;
	private lastStateChangePayloadKey: string | null = null;
	private lastStateEmitAt = 0;
	private pendingStateChangeTimer: ReturnType<typeof setTimeout> | null = null;
	private pendingStatePayload: CompanionRuntimeStateChangePayload | null = null;
	private pendingStatePayloadKey: string | null = null;

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
			metrics: { ...this.state.metrics },
			observationReady: this.state.observationReady,
			lastObservationAt: this.state.lastObservationAt,
			diagnosticCode: this.state.diagnosticCode,
			diagnosticMessage: this.state.diagnosticMessage,
		};
	}

	private setDiagnostic(code: CompanionRuntimeDiagnosticCode | null, message: string | null) {
		this.state.diagnosticCode = code;
		this.state.diagnosticMessage = message;
	}

	private clearDiagnostic() {
		this.setDiagnostic(null, null);
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

	requireObservationContext(
		target: FunctionalTarget,
		options?: { maxAgeMs?: number },
	): { promptContext: string; latestTimestamp: number } {
		if (!this.state.running) {
			this.setDiagnostic("runtime-not-running", "Companion runtime is not running.");
			throw new Error("companion runtime is not running; start local observation before delegated actions");
		}
		if (!this.state.target) {
			this.setDiagnostic("runtime-not-running", "Companion runtime has no active target.");
			throw new Error("companion runtime has no active target");
		}
		if (this.state.target.handle !== target.handle) {
			this.setDiagnostic("target-mismatch", "Companion runtime target does not match the selected functional target.");
			throw new Error("companion runtime target does not match the selected functional target");
		}

		const latestTimestamp = this.state.lastSummary?.createdAt ?? this.state.lastFrame?.capturedAt ?? 0;
		if (!latestTimestamp) {
			this.setDiagnostic("observation-not-ready", "Companion runtime has not produced any local observation yet.");
			throw new Error("companion runtime has no recent local observation yet");
		}

		const maxAgeMs = options?.maxAgeMs ?? Math.max(this.state.summaryWindowMs * 2, this.state.captureIntervalMs * 4, 15_000);
		if (Date.now() - latestTimestamp > maxAgeMs) {
			this.setDiagnostic("observation-not-ready", "Companion runtime observation is stale.");
			throw new Error("companion runtime observation is stale; refresh local observation before delegated actions");
		}

		const promptContext = this.getPromptContext();
		if (!promptContext) {
			this.setDiagnostic("observation-not-ready", "Companion runtime did not produce usable observation context.");
			throw new Error("companion runtime did not produce usable observation context");
		}

		this.state.observationReady = true;
		this.state.lastObservationAt = latestTimestamp;
		this.clearDiagnostic();

		return {
			promptContext,
			latestTimestamp,
		};
	}

	async ensureObservationContext(
		target: FunctionalTarget,
		options?: { autoStart?: boolean; timeoutMs?: number; maxAgeMs?: number },
	): Promise<{ promptContext: string; latestTimestamp: number }> {
		const timeoutMs = options?.timeoutMs ?? OBSERVATION_READY_WAIT_TIMEOUT_MS;
		const deadline = Date.now() + timeoutMs;
		let lastError: Error | null = null;

		if (!this.state.running || this.state.target?.handle !== target.handle) {
			if (!options?.autoStart) {
				return this.requireObservationContext(target, { maxAgeMs: options?.maxAgeMs });
			}
			this.setDiagnostic("runtime-auto-starting", `Starting local observation for ${target.title}.`);
			log.info("companion runtime auto-start requested", {
				target: target.title,
				timeoutMs,
			});
			await this.start(target);
		}

		while (Date.now() <= deadline) {
			try {
				this.setDiagnostic("warmup-waiting", "Waiting for the first fresh local observation.");
				await this.refreshNow({ summarize: true });
				const context = this.requireObservationContext(target, { maxAgeMs: options?.maxAgeMs });
				log.info("companion runtime warmup ready", {
					target: target.title,
					latestTimestamp: context.latestTimestamp,
				});
				return context;
			} catch (err) {
				lastError = err instanceof Error ? err : new Error(String(err));
				this.state.observationReady = false;
				if (lastError.message.includes("target does not match")) {
					this.setDiagnostic("target-mismatch", "Companion runtime target does not match the selected functional target.");
				} else if (lastError.message.includes("local vision")) {
					this.setDiagnostic("local-vision-unavailable", lastError.message);
				} else {
					this.setDiagnostic("warmup-waiting", "Waiting for the first usable local observation.");
				}
				await delay(OBSERVATION_READY_POLL_MS);
			}
		}

		const timeoutMessage = lastError?.message ?? "companion runtime observation is not ready";
		this.setDiagnostic("warmup-timeout", `Timed out while waiting for local observation readiness: ${timeoutMessage}`);
		log.warn("companion runtime warmup timed out", {
			target: target.title,
			timeoutMs,
			lastError: timeoutMessage,
		});
		throw new Error(`companion runtime warmup timed out after ${Math.round(timeoutMs / 1000)}s: ${timeoutMessage}`);
	}

	async waitForPostActionObservation(
		target: FunctionalTarget,
		options: {
			afterTimestamp: number;
			timeoutMs?: number;
			requireChanged?: boolean;
		},
	): Promise<{ promptContext: string; latestTimestamp: number; changedObservation: boolean; timedOut: boolean }> {
		const timeoutMs = options.timeoutMs ?? POST_ACTION_OBSERVATION_TIMEOUT_MS;
		const deadline = Date.now() + timeoutMs;
		let lastKnownContext = this.getPromptContext();
		let lastKnownTimestamp = this.state.lastSummary?.createdAt ?? this.state.lastFrame?.capturedAt ?? 0;
		let sawBelowThresholdChange = false;

		while (Date.now() <= deadline) {
			try {
				await this.refreshNow({ summarize: true });
				const context = this.requireObservationContext(target);
				lastKnownContext = context.promptContext;
				lastKnownTimestamp = context.latestTimestamp;
				const latestFrame = this.state.lastFrame;
				const latestSummary = this.state.lastSummary;
				const hasFreshFrame = Boolean(latestFrame && latestFrame.capturedAt > options.afterTimestamp);
				const hasFreshSummary = Boolean(latestSummary && latestSummary.createdAt > options.afterTimestamp);
				const changedObservation = Boolean(hasFreshFrame && latestFrame?.source === "vision");

				if (latestFrame && hasFreshFrame && latestFrame.changeRatio !== null && latestFrame.changeRatio > 0 && !changedObservation) {
					sawBelowThresholdChange = true;
				}

				if ((hasFreshSummary || hasFreshFrame) && (!options.requireChanged || changedObservation)) {
					this.clearDiagnostic();
					return {
						promptContext: context.promptContext,
						latestTimestamp: context.latestTimestamp,
						changedObservation,
						timedOut: false,
					};
				}

				if (sawBelowThresholdChange) {
					this.setDiagnostic("below-threshold-change", "A new frame arrived, but the visible change is still below the current threshold.");
				} else {
					this.setDiagnostic("post-action-waiting", "Waiting for a fresh post-action local observation.");
				}
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				this.setDiagnostic("post-action-waiting", message);
			}

			await delay(OBSERVATION_READY_POLL_MS);
		}

		this.setDiagnostic("post-action-timeout", "Timed out while waiting for a changed post-action observation.");
		return {
			promptContext: lastKnownContext,
			latestTimestamp: lastKnownTimestamp,
			changedObservation: false,
			timedOut: true,
		};
	}

	async start(target: FunctionalTarget): Promise<void> {
		if (!target) {
			throw new Error("no target selected for companion runtime");
		}

		this.stopTimers();
		this.lastSnapshotForDiff = null;
		this.state.running = true;
		this.state.phase = "idle";
		this.state.target = { ...target };
		this.state.lastFrame = null;
		this.state.lastSummary = null;
		this.state.frameQueue = [];
		this.state.summaryHistory = [];
		this.state.metrics = {
			...makeInitialMetrics(),
			sessionStartedAt: Date.now(),
		};
		this.state.observationReady = false;
		this.state.lastObservationAt = null;
		this.state.lastError = null;
		this.clearDiagnostic();
		this.state.phase = "connecting";
		this.emitState();

		try {
			await this.waitForLocalVisionReady();
			await this.runCaptureTick();
			if (!this.state.lastFrame && this.state.lastError) {
				throw new Error(this.state.lastError ?? "companion runtime failed to capture the first local observation");
			}
			this.scheduleCaptureTick();
			this.scheduleSummaryTick();

			log.info("companion runtime started", {
				target: target.title,
				captureIntervalMs: this.state.captureIntervalMs,
				summaryWindowMs: this.state.summaryWindowMs,
				historyRetentionMs: this.state.historyRetentionMs,
			});
		} catch (err) {
			this.stopTimers();
			this.captureInFlight = false;
			this.summaryInFlight = false;
			this.lastSnapshotForDiff = null;
			this.state.running = false;
			this.state.observationReady = false;
			this.emitState(true);
			throw err;
		}
	}

	stop(): void {
		this.stopTimers();
		this.captureInFlight = false;
		this.summaryInFlight = false;
		this.lastSnapshotForDiff = null;
		this.state.running = false;
		this.state.phase = "idle";
		this.state.observationReady = false;
		this.state.lastObservationAt = null;
		this.clearDiagnostic();
		this.emitState();
		log.info("companion runtime stopped");
	}

	clearHistory(): void {
		this.state.lastFrame = null;
		this.state.lastSummary = null;
		this.state.frameQueue = [];
		this.state.summaryHistory = [];
		this.state.metrics = makeInitialMetrics();
		this.state.observationReady = false;
		this.state.lastObservationAt = null;
		this.clearDiagnostic();
		this.state.lastError = null;
		this.lastSnapshotForDiff = null;
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
				proactiveRuntimeSummarySilenceSeconds: getConfig().companionRuntime.proactiveRuntimeSummarySilenceSeconds,
			},
		});

		if (this.state.running && this.state.target) {
			await this.start(this.state.target);
			return;
		}

		this.emitState();
	}

	async testLocalVisionConnection(): Promise<void> {
		await this.waitForLocalVisionReady();
	}

	private async probeLocalVisionConnection(): Promise<void> {
		const baseUrl = normalizeCompatibleOpenAIBaseUrl(this.state.localVisionBaseUrl);
		const response = await proxyRequest({
			url: `${baseUrl}/models`,
			method: "GET",
			timeoutMs: 8000,
		});
		if (response.status < 200 || response.status >= 300) {
			throw new Error(`HTTP ${response.status}`);
		}
	}

	private async waitForLocalVisionReady(): Promise<void> {
		const deadline = Date.now() + LOCAL_VISION_READY_TIMEOUT_MS;
		let lastError: unknown = null;
		this.state.phase = "connecting";
		this.state.observationReady = false;
		this.state.lastError = null;
		this.clearDiagnostic();
		this.emitState();

		while (Date.now() < deadline) {
			try {
				await this.probeLocalVisionConnection();
				this.state.lastError = null;
				this.clearDiagnostic();
				if (this.state.phase === "connecting") {
					this.state.phase = "idle";
				}
				this.emitState();
				return;
			} catch (err) {
				lastError = err;
				await delay(LOCAL_VISION_READY_POLL_MS);
			}
		}

		const message = [
			`本地视觉节点在 ${Math.round(LOCAL_VISION_READY_TIMEOUT_MS / 1000)} 秒内未就绪：${normalizeCompatibleOpenAIBaseUrl(this.state.localVisionBaseUrl)}`,
			"如果服务跑在 WSL 里，请确认：",
			"1. vLLM 已经完成模型加载和 warmup",
			"2. 端口已对 Windows 暴露",
			"3. 优先使用离线本地快照路径启动，避免启动时再访问远端",
			`原始错误：${formatRuntimeError("frame", this.state.localVisionBaseUrl, lastError)}`,
		].join("\n");

		this.state.phase = "error";
		this.state.lastError = message;
		this.setDiagnostic("local-vision-unavailable", message);
		this.bus.emit("system:error", {
			module: "companion-runtime",
			error: message,
		});
		this.emitState();
		throw new Error(message);
	}

	async runSummaryNow(): Promise<void> {
		await this.runSummaryTick(true);
	}

	async refreshNow(options?: { summarize?: boolean }): Promise<void> {
		if (!this.state.running || !this.state.target) {
			return;
		}
		await this.runCaptureTick();
		if (options?.summarize) {
			await this.runSummaryTick(true);
		}
	}

	private stopTimers() {
		if (this.captureTimer) {
			clearTimeout(this.captureTimer);
			this.captureTimer = null;
		}
		if (this.summaryTimer) {
			clearTimeout(this.summaryTimer);
			this.summaryTimer = null;
		}
		if (this.pendingStateChangeTimer) {
			clearTimeout(this.pendingStateChangeTimer);
			this.pendingStateChangeTimer = null;
		}
		this.pendingStatePayload = null;
		this.pendingStatePayloadKey = null;
	}

	private scheduleCaptureTick() {
		if (!this.state.running) {
			return;
		}
		if (this.captureTimer) {
			clearTimeout(this.captureTimer);
		}
		this.captureTimer = setTimeout(() => {
			this.captureTimer = null;
			void this.runCaptureLoop();
		}, this.state.captureIntervalMs);
	}

	private async runCaptureLoop(): Promise<void> {
		if (!this.state.running) {
			return;
		}
		await this.runCaptureTick();
		if (this.state.running) {
			this.scheduleCaptureTick();
		}
	}

	private scheduleSummaryTick() {
		if (!this.state.running) {
			return;
		}
		if (this.summaryTimer) {
			clearTimeout(this.summaryTimer);
		}
		this.summaryTimer = setTimeout(() => {
			this.summaryTimer = null;
			void this.runSummaryLoop();
		}, this.state.summaryWindowMs);
	}

	private async runSummaryLoop(): Promise<void> {
		if (!this.state.running) {
			return;
		}
		await this.runSummaryTick();
		if (this.state.running) {
			this.scheduleSummaryTick();
		}
	}

	private async runCaptureTick(): Promise<void> {
		if (!this.state.running || !this.state.target || this.captureInFlight) {
			return;
		}

		const tickStartedAt = Date.now();
		this.captureInFlight = true;
		this.state.phase = "capturing";
		this.state.lastError = null;
		this.emitState();

		try {
			const snapshot = await this.perception.captureTarget(this.state.target);
			this.state.phase = "describing";
			const changeRatio = await this.measureChange(snapshot);
			const recentFrames = this.state.frameQueue.filter((frame) => frame.capturedAt >= snapshot.capturedAt - this.state.summaryWindowMs);
			const shouldSkipLowDiff =
				changeRatio !== null
				&& changeRatio < MIN_MEANINGFUL_CHANGE_RATIO
				&& recentFrames.length >= LOW_DIFF_SKIP_FRAME_QUEUE_LIMIT;
			const description =
				shouldSkipLowDiff
					? UNCHANGED_FRAME_DESCRIPTION
					: await this.describeSnapshot(snapshot);
			const record: CompanionFrameDescriptionRecord = {
				id: `frame-${snapshot.capturedAt}`,
				targetTitle: snapshot.targetTitle,
				capturedAt: snapshot.capturedAt,
				description,
				source: shouldSkipLowDiff ? "unchanged" : "vision",
				captureMethod: snapshot.captureMethod,
				qualityScore: snapshot.qualityScore,
				changeRatio,
			};
			this.state.lastFrame = record;
			this.state.frameQueue = this.pushFrameRecord(record);
			this.pruneHistory(record.capturedAt);
			const frameLatencyMs = Date.now() - tickStartedAt;
			const captureTicks = this.state.metrics.captureTicks + 1;
			const visionFrames = this.state.metrics.visionFrames + (record.source === "vision" ? 1 : 0);
			const unchangedFrames = this.state.metrics.unchangedFrames + (record.source === "unchanged" ? 1 : 0);
			this.state.metrics = {
				...this.state.metrics,
				lastCaptureAt: snapshot.capturedAt,
				captureTicks,
				visionFrames,
				unchangedFrames,
				lastFrameLatencyMs: frameLatencyMs,
				averageFrameLatencyMs: updateRollingAverage(
					this.state.metrics.averageFrameLatencyMs,
					this.state.metrics.captureTicks,
					frameLatencyMs,
				),
			};
			this.bus.emit("companion-runtime:frame-described", { record: cloneFrameRecord(record) });
			this.lastSnapshotForDiff = snapshot;
			this.state.lastObservationAt = record.capturedAt;
			this.state.observationReady = true;
			if (record.source === "vision") {
				this.clearDiagnostic();
			} else if (changeRatio !== null && changeRatio > 0) {
				this.setDiagnostic("below-threshold-change", "A new frame arrived, but the visible change is below the current threshold.");
			}
			this.state.phase = "idle";
			this.emitState();
		} catch (err) {
			const message = formatRuntimeError("frame", this.state.localVisionBaseUrl, err);
			this.state.phase = "error";
			this.state.lastError = message;
			this.setDiagnostic("local-vision-unavailable", message);
			this.bus.emit("system:error", {
				module: "companion-runtime",
				error: message,
			});
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

		const summaryStartedAt = Date.now();
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
			const summaryLatencyMs = Date.now() - summaryStartedAt;
			this.state.metrics = {
				...this.state.metrics,
				summariesGenerated: this.state.metrics.summariesGenerated + 1,
				lastSummaryLatencyMs: summaryLatencyMs,
				averageSummaryLatencyMs: updateRollingAverage(
					this.state.metrics.averageSummaryLatencyMs,
					this.state.metrics.summariesGenerated,
					summaryLatencyMs,
				),
			};
			this.bus.emit("companion-runtime:summary-complete", { record: cloneSummaryRecord(record) });
			this.state.lastObservationAt = record.createdAt;
			this.state.observationReady = true;
			this.clearDiagnostic();
			this.state.phase = "idle";
			this.emitState();
		} catch (err) {
			const message = formatRuntimeError("summary", this.state.localVisionBaseUrl, err);
			this.state.phase = "error";
			this.state.lastError = message;
			this.setDiagnostic("local-vision-unavailable", message);
			this.bus.emit("system:error", {
				module: "companion-runtime",
				error: message,
			});
			this.emitState();
			log.error("summary tick failed", err);
		} finally {
			this.summaryInFlight = false;
		}
	}

	private pruneHistory(now: number) {
		const cutoff = now - this.state.historyRetentionMs;
		const maxFrameEntries = Math.max(
			12,
			Math.ceil(this.state.historyRetentionMs / Math.max(250, this.state.captureIntervalMs)) + 4,
		);
		const maxSummaryEntries = Math.max(
			6,
			Math.ceil(this.state.historyRetentionMs / Math.max(1000, this.state.summaryWindowMs)) + 2,
		);
		this.state.frameQueue = this.state.frameQueue
			.filter((frame) => frame.capturedAt >= cutoff)
			.slice(-maxFrameEntries);
		this.state.summaryHistory = this.state.summaryHistory
			.filter((summary) => summary.createdAt >= cutoff)
			.slice(-maxSummaryEntries);
	}

	private pushFrameRecord(record: CompanionFrameDescriptionRecord): CompanionFrameDescriptionRecord[] {
		const next = [...this.state.frameQueue];
		const last = next[next.length - 1];
		if (
			record.source === "unchanged"
			&& last?.source === "unchanged"
			&& last.targetTitle === record.targetTitle
		) {
			next[next.length - 1] = record;
			return next;
		}
		next.push(record);
		return next;
	}

	private async measureChange(snapshot: PerceptionSnapshot): Promise<number | null> {
		if (!this.lastSnapshotForDiff || this.lastSnapshotForDiff.targetHandle !== snapshot.targetHandle) {
			return null;
		}
		try {
			return await estimateSnapshotChange(this.lastSnapshotForDiff, snapshot, {
				sampleSize: 40,
				cropScale: 0.82,
			});
		} catch (err) {
			log.debug("companion runtime change estimate skipped", err);
			return null;
		}
	}

	private async describeSnapshot(snapshot: PerceptionSnapshot): Promise<string> {
		const observationOverlay = buildObservationOverlay(snapshot.targetTitle);
		return requestOpenAICompatibleVision({
			client: {
				baseUrl: normalizeCompatibleOpenAIBaseUrl(this.state.localVisionBaseUrl),
				model: this.state.localVisionModel,
			},
			systemPrompt: [
				"You are a low-latency screen observer.",
				"Describe only what is directly visible on the screen in 1-2 short sentences.",
				"Mention people, objects, setting, text, motion, interface state, and obvious changes.",
				"Do not assume this is a game unless the screen clearly shows game UI or gameplay elements.",
				"Avoid speculation.",
				observationOverlay,
			].filter(Boolean).join("\n"),
			userPrompt: "Describe this screen for a live companion. Mention only what is clearly visible right now.",
			imageDataUrl: snapshot.dataUrl,
			maxTokens: 120,
			temperature: 0.1,
			timeoutMs: Math.max(8000, this.state.captureIntervalMs * 4),
		});
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

	private emitState(force = false) {
		const payload: CompanionRuntimeStateChangePayload = {
			running: this.state.running,
			phase: this.state.phase,
			targetTitle: this.state.target?.title ?? null,
			frameQueueLength: this.state.frameQueue.length,
			summaryHistoryLength: this.state.summaryHistory.length,
			lastFrameId: this.state.lastFrame?.id ?? null,
			lastSummaryId: this.state.lastSummary?.id ?? null,
			captureTicks: this.state.metrics.captureTicks,
			summariesGenerated: this.state.metrics.summariesGenerated,
			observationReady: this.state.observationReady,
			lastObservationAt: this.state.lastObservationAt,
			diagnosticCode: this.state.diagnosticCode,
			diagnosticMessage: this.state.diagnosticMessage,
			lastError: this.state.lastError,
		};
		const payloadKey = [
			payload.running ? "1" : "0",
			payload.phase,
			payload.targetTitle ?? "",
			String(payload.frameQueueLength),
			String(payload.summaryHistoryLength),
			payload.lastFrameId ?? "",
			payload.lastSummaryId ?? "",
			String(payload.captureTicks),
			String(payload.summariesGenerated),
			payload.observationReady ? "1" : "0",
			String(payload.lastObservationAt ?? 0),
			payload.diagnosticCode ?? "",
			payload.diagnosticMessage ?? "",
			payload.lastError ?? "",
		].join("|");
		if (payloadKey === this.lastStateChangePayloadKey) {
			return;
		}
		const emitNow = () => {
			if (!this.pendingStatePayload || !this.pendingStatePayloadKey) {
				return;
			}
			this.lastStateChangePayloadKey = this.pendingStatePayloadKey;
			this.lastStateEmitAt = Date.now();
			this.bus.emit("companion-runtime:state-change", this.pendingStatePayload);
			this.pendingStatePayload = null;
			this.pendingStatePayloadKey = null;
			if (this.pendingStateChangeTimer) {
				clearTimeout(this.pendingStateChangeTimer);
				this.pendingStateChangeTimer = null;
			}
		};

		this.pendingStatePayload = payload;
		this.pendingStatePayloadKey = payloadKey;
		const now = Date.now();
		const elapsed = now - this.lastStateEmitAt;
		if (force || elapsed >= STATE_CHANGE_MIN_INTERVAL_MS) {
			emitNow();
			return;
		}
		if (this.pendingStateChangeTimer) {
			return;
		}
		const waitMs = Math.max(0, STATE_CHANGE_MIN_INTERVAL_MS - elapsed);
		this.pendingStateChangeTimer = setTimeout(() => {
			this.pendingStateChangeTimer = null;
			emitNow();
		}, waitMs);
	}
}
