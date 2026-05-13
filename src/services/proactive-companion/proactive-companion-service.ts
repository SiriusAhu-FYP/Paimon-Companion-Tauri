import type { EventBus } from "@/services/event-bus";
import type { CompanionRuntimeService } from "@/services/companion-runtime";
import type { LLMService } from "@/services/llm";
import type { PipelineService } from "@/services/pipeline";
import type { CompanionModeService } from "@/services/companion-mode";
import type { DelegationMemoryService } from "@/services/delegation-memory";
import { createLogger } from "@/services/logger";
import type { DelegatedExecutionRecord, EventMap, ProactiveState, ProactiveTriggerSource } from "@/types";
import { PROACTIVE_NO_REPLY_SENTINEL } from "./constants";

const log = createLogger("proactive-companion");
const DEFAULT_RUNTIME_SUMMARY_SILENCE_MS = 30_000;
const TASK_RESULT_SILENCE_MS = 20_000;
const SYSTEM_ERROR_DEDUPE_MS = 30_000;
const RUNTIME_SUMMARY_REPEAT_MS = 90_000;
const CROSS_CONTEXT_WINDOW_MS = 60_000;

interface RuntimeSummaryContext {
	summary: string;
	source: string;
	createdAt: number;
}

interface TaskResultContext {
	source: "game2048-result" | "sokoban-result";
	summary: string;
	primaryAction: string | null;
	success: boolean;
	boardChanged: boolean;
	createdAt: number;
}

interface ProactiveCandidate {
	source: ProactiveTriggerSource;
	priority: number;
	preview: string;
	dedupeKey: string;
	facts: string[];
	traceId?: string;
	isEntrance?: boolean;
	forceSpeak?: boolean;
	skipSilenceWindow?: boolean;
}

function makeInitialState(): ProactiveState {
	return {
		mode: "companion",
		isBusy: false,
		pendingSource: null,
		pendingPriority: null,
		pendingPreview: null,
		lastCandidateSource: null,
		lastDecision: "idle",
		lastSkipReason: null,
		lastEmittedAt: null,
		lastEmittedSource: null,
	};
}

function truncate(text: string, limit = 120): string {
	const normalized = text.trim();
	if (normalized.length <= limit) {
		return normalized;
	}
	return `${normalized.slice(0, limit - 1)}…`;
}

export class ProactiveCompanionService {
	private bus: EventBus;
	private llm: LLMService;
	private pipeline: PipelineService;
	private companionRuntime: CompanionRuntimeService;
	private delegationMemory: DelegationMemoryService;
	private state: ProactiveState = makeInitialState();
	private pendingCandidate: ProactiveCandidate | null = null;
	private llmBusy = false;
	private ttsBusy = false;
	private voiceBusy = false;
	private processingCandidate = false;
	private lastSpokenAt = 0;
	private lastSystemErrorSeen = new Map<string, number>();
	private lastRuntimeSummarySeen = new Map<string, number>();
	private latestRuntimeSummary: RuntimeSummaryContext | null = null;
	private latestTaskResult: TaskResultContext | null = null;
	private runtimeSummarySilenceMs = DEFAULT_RUNTIME_SUMMARY_SILENCE_MS;
	private firstRuntimeSummaryPendingEntrance = true;
	private companionRuntimeRunning = false;
	private companionRuntimeTargetTitle: string | null = null;
	private latestDelegatedRecord: DelegatedExecutionRecord | null = null;
	private activeUnifiedRunId: string | null = null;

	constructor(deps: {
		bus: EventBus;
		llm: LLMService;
		pipeline: PipelineService;
		companionRuntime: CompanionRuntimeService;
		companionMode: CompanionModeService;
		delegationMemory: DelegationMemoryService;
		runtimeSummarySilenceSeconds?: number;
	}) {
		this.bus = deps.bus;
		this.llm = deps.llm;
		this.pipeline = deps.pipeline;
		this.companionRuntime = deps.companionRuntime;
		this.delegationMemory = deps.delegationMemory;
		this.state.mode = deps.companionMode.getState().mode;
		this.latestDelegatedRecord = deps.delegationMemory.getLatestRecord();
		this.setRuntimeSummarySilenceSeconds(deps.runtimeSummarySilenceSeconds);

		this.bus.on("companion-runtime:summary-complete", (payload) => {
			this.handleRuntimeSummary(payload);
		});
		this.bus.on("game2048:run-complete", (payload) => {
			this.handle2048Result(payload);
		});
		this.bus.on("sokoban:run-complete", (payload) => {
			this.handleSokobanResult(payload);
		});
		this.bus.on("system:error", (payload) => {
			this.handleSystemError(payload);
		});
		this.bus.on("memory:salient-event", (payload) => {
			this.handleSalientEvent(payload);
		});
		this.bus.on("companion-runtime:state-change", (payload) => {
			this.handleCompanionRuntimeStateChange(payload);
		});
		this.bus.on("companion:mode-change", (payload) => {
			this.state.mode = payload.mode;
			this.emitStateChange(this.state.lastDecision, null, payload.reason);
		});
		this.bus.on("delegation-memory:state-change", (payload) => {
			this.latestDelegatedRecord = payload.state.latestRecord;
			this.emitStateChange(this.state.lastDecision, null, null);
		});
		this.bus.on("unified:state-change", (payload) => {
			this.activeUnifiedRunId = payload.state.activeRunId;
			this.emitStateChange(this.state.lastDecision, null, null);
		});
		this.bus.on("llm:request-start", () => {
			this.llmBusy = true;
			this.syncBusyState();
		});
		this.bus.on("llm:response-end", () => {
			this.llmBusy = false;
			this.syncBusyState();
			void this.maybeDrainPending();
		});
		this.bus.on("llm:error", () => {
			this.llmBusy = false;
			this.syncBusyState();
			void this.maybeDrainPending();
		});
		this.bus.on("audio:tts-start", () => {
			this.ttsBusy = true;
			this.lastSpokenAt = Date.now();
			this.syncBusyState();
		});
		this.bus.on("audio:tts-end", () => {
			this.ttsBusy = false;
			this.syncBusyState();
			void this.maybeDrainPending();
		});
		this.bus.on("voice:state-change", (payload) => {
			this.voiceBusy = payload.state.status === "recording" || payload.state.status === "transcribing";
			this.syncBusyState();
			void this.maybeDrainPending();
		});
	}

	getState(): Readonly<ProactiveState> {
		return { ...this.state };
	}

	setRuntimeSummarySilenceSeconds(seconds: number | null | undefined) {
		const normalizedSeconds = Number.isFinite(seconds)
			? Math.max(5, Math.min(600, Math.round(seconds as number)))
			: DEFAULT_RUNTIME_SUMMARY_SILENCE_MS / 1000;
		this.runtimeSummarySilenceMs = normalizedSeconds * 1000;
	}

	private handleCompanionRuntimeStateChange(payload: EventMap["companion-runtime:state-change"]) {
		const runtimeStopped = !payload.running && this.companionRuntimeRunning;
		const runtimeStarted = payload.running && !this.companionRuntimeRunning;
		const targetChanged = payload.running && this.companionRuntimeRunning && payload.targetTitle !== this.companionRuntimeTargetTitle;

		if (runtimeStopped) {
			this.resetRuntimeSession("runtime-session-stop");
		} else if (runtimeStarted || targetChanged) {
			this.resetRuntimeSession(runtimeStarted ? "runtime-session-start" : "runtime-target-changed");
		}

		this.companionRuntimeRunning = payload.running;
		this.companionRuntimeTargetTitle = payload.running ? payload.targetTitle : null;
	}

	private handleRuntimeSummary(payload: EventMap["companion-runtime:summary-complete"]) {
		const isEntrance = this.firstRuntimeSummaryPendingEntrance;
		this.firstRuntimeSummaryPendingEntrance = false;
		const forceSpeak =
			!isEntrance
			&& this.lastSpokenAt > 0
			&& (Date.now() - this.lastSpokenAt) >= this.runtimeSummarySilenceMs;
		this.latestRuntimeSummary = {
			summary: payload.record.summary,
			source: payload.record.source,
			createdAt: payload.record.createdAt,
		};
		const candidate: ProactiveCandidate = {
			source: "runtime-summary",
			priority: 1,
			preview: truncate(payload.record.summary),
			dedupeKey: `runtime-summary:${payload.record.source}:${payload.record.summary}`,
			isEntrance,
			forceSpeak,
			facts: [
				`【触发源】runtime summary`,
				`【summary 来源】${payload.record.source}`,
				`【summary 内容】${payload.record.summary}`,
			],
		};
		void this.processCandidate(candidate);
	}

	private handle2048Result(payload: EventMap["game2048:run-complete"]) {
		this.latestTaskResult = {
			source: "game2048-result",
			summary: payload.summary,
			primaryAction: payload.selectedMove,
			success: payload.success,
			boardChanged: payload.boardChanged,
			createdAt: Date.now(),
		};
		const candidate: ProactiveCandidate = {
			source: "game2048-result",
			priority: 2,
			preview: truncate(payload.summary),
			dedupeKey: `game2048-result:${payload.runId}`,
			traceId: payload.traceId,
			facts: [
				`【触发源】2048 task result`,
				`【是否成功】${payload.success ? "是" : "否"}`,
				`【是否有有效变化】${payload.boardChanged ? "是" : "否"}`,
				`【结果总结】${payload.summary}`,
				payload.selectedMove ? `【关键动作】${payload.selectedMove}` : "",
			].filter(Boolean),
		};
		void this.processCandidate(candidate);
	}

	private handleSokobanResult(payload: EventMap["sokoban:run-complete"]) {
		this.latestTaskResult = {
			source: "sokoban-result",
			summary: payload.summary,
			primaryAction: payload.executedMoves[0] ?? null,
			success: payload.success,
			boardChanged: payload.boardChanged,
			createdAt: Date.now(),
		};
		const candidate: ProactiveCandidate = {
			source: "sokoban-result",
			priority: 2,
			preview: truncate(payload.summary),
			dedupeKey: `sokoban-result:${payload.runId}`,
			traceId: payload.traceId,
			facts: [
				`【触发源】sokoban task result`,
				`【是否成功】${payload.success ? "是" : "否"}`,
				`【是否有有效变化】${payload.boardChanged ? "是" : "否"}`,
				`【结果总结】${payload.summary}`,
				payload.executedMoves.length ? `【关键动作】${payload.executedMoves.join(" -> ")}` : "",
			].filter(Boolean),
		};
		void this.processCandidate(candidate);
	}

	private handleSystemError(payload: EventMap["system:error"]) {
		const dedupeKey = `system-error:${payload.module}:${payload.error}`;
		const lastSeenAt = this.lastSystemErrorSeen.get(dedupeKey) ?? 0;
		if (Date.now() - lastSeenAt < SYSTEM_ERROR_DEDUPE_MS) {
			this.emitStateChange("skipped", "system-error", "duplicate-system-error");
			return;
		}
		this.lastSystemErrorSeen.set(dedupeKey, Date.now());
		const candidate: ProactiveCandidate = {
			source: "system-error",
			priority: 3,
			preview: truncate(`${payload.module}: ${payload.error}`),
			dedupeKey,
			facts: [
				`【触发源】system error`,
				`【模块】${payload.module}`,
				`【错误】${payload.error}`,
			],
		};
		void this.processCandidate(candidate);
	}

	private handleSalientEvent(payload: EventMap["memory:salient-event"]) {
		const { event } = payload;
		const candidate: ProactiveCandidate = {
			source: "salient-event",
			priority: 3,
			preview: truncate(`${event.type}: ${event.description}`),
			dedupeKey: `salient-event:${event.type}:${event.timestamp}`,
			skipSilenceWindow: true,
			facts: [
				`【触发源】记忆系统关键事件`,
				`【类型】${event.type}`,
				`【严重度】${event.severity}/5`,
				`【描述】${event.description}`,
			],
		};
		void this.processCandidate(candidate);
	}

	private async processCandidate(candidate: ProactiveCandidate): Promise<void> {
		this.state.lastCandidateSource = candidate.source;
		this.emitStateChange("candidate-created", candidate.source, null);

		const skipReason = this.getImmediateSkipReason(candidate);
		if (skipReason) {
			this.emitStateChange("skipped", candidate.source, skipReason);
			return;
		}

		if (this.isBusy()) {
			this.queueCandidate(candidate);
			return;
		}

		await this.emitCandidate(candidate);
	}

	private getImmediateSkipReason(candidate: ProactiveCandidate): string | null {
		if (candidate.source === "runtime-summary") {
			const repeatReason = this.getRuntimeSummaryPreFilterReason(candidate);
			if (repeatReason) {
				return repeatReason;
			}
		}
		if (
			(candidate.source === "game2048-result" || candidate.source === "sokoban-result")
			&& candidate.traceId
			&& this.activeUnifiedRunId === candidate.traceId
		) {
			return "unified-follow-up-active";
		}
		const sinceLastSpeech = Date.now() - this.lastSpokenAt;
		if (candidate.source === "runtime-summary" && !candidate.isEntrance && this.lastSpokenAt > 0 && sinceLastSpeech < this.runtimeSummarySilenceMs) {
			return "runtime-summary-silence-window";
		}
		if ((candidate.source === "game2048-result" || candidate.source === "sokoban-result") && this.lastSpokenAt > 0 && sinceLastSpeech < TASK_RESULT_SILENCE_MS) {
			return "task-result-silence-window";
		}
		return null;
	}

	private getRuntimeSummaryPreFilterReason(candidate: ProactiveCandidate): string | null {
		if (candidate.forceSpeak) {
			return null;
		}
		const normalizedPreview = normalizeForDedupe(candidate.preview);
		if (!normalizedPreview) {
			return "runtime-summary-empty";
		}
		if (looksLikeLowSignalRuntimeSummary(normalizedPreview)) {
			return "runtime-summary-low-signal";
		}
		const lastSeenAt = this.lastRuntimeSummarySeen.get(normalizedPreview) ?? 0;
		if (Date.now() - lastSeenAt < RUNTIME_SUMMARY_REPEAT_MS) {
			return "runtime-summary-repeat-window";
		}
		this.lastRuntimeSummarySeen.set(normalizedPreview, Date.now());
		return null;
	}

	private queueCandidate(candidate: ProactiveCandidate) {
		if (!this.pendingCandidate) {
			this.pendingCandidate = candidate;
			this.state.pendingSource = candidate.source;
			this.state.pendingPriority = candidate.priority;
			this.state.pendingPreview = candidate.preview;
			this.emitStateChange("queued", candidate.source, "busy");
			return;
		}
		if (this.pendingCandidate.dedupeKey === candidate.dedupeKey) {
			this.emitStateChange("dropped", candidate.source, "duplicate-pending");
			return;
		}
		if (candidate.priority > this.pendingCandidate.priority || candidate.priority === this.pendingCandidate.priority) {
			this.pendingCandidate = candidate;
			this.state.pendingSource = candidate.source;
			this.state.pendingPriority = candidate.priority;
			this.state.pendingPreview = candidate.preview;
			this.emitStateChange("replaced", candidate.source, "pending-replaced");
			return;
		}
		this.emitStateChange("dropped", candidate.source, "lower-priority-pending-exists");
	}

	private async maybeDrainPending(): Promise<void> {
		if (!this.pendingCandidate || this.isBusy()) {
			return;
		}
		const candidate = this.pendingCandidate;
		this.pendingCandidate = null;
		this.state.pendingSource = null;
		this.state.pendingPriority = null;
		this.state.pendingPreview = null;

		const skipReason = this.getImmediateSkipReason(candidate);
		if (skipReason) {
			this.emitStateChange("skipped", candidate.source, skipReason);
			return;
		}

		await this.emitCandidate(candidate);
	}

	private async emitCandidate(candidate: ProactiveCandidate): Promise<void> {
		this.processingCandidate = true;
		this.syncBusyState();
		this.emitStateChange("emitting", candidate.source, null);

		try {
			const reply = await this.llm.generateCompanionReply(this.buildPrompt(candidate), {
				knowledgeContext: "",
				traceId: candidate.traceId,
				source: "proactive-reply",
			});
			const normalized = reply.trim();
			if ((!normalized || normalized === PROACTIVE_NO_REPLY_SENTINEL) && candidate.forceSpeak) {
				const fallback = this.buildForcedRuntimeSummaryFallback();
				this.state.lastEmittedAt = Date.now();
				this.state.lastEmittedSource = candidate.source;
				this.pipeline.speakTextNonBlocking(fallback);
				this.emitStateChange("emitted", candidate.source, "forced-runtime-summary-fallback");
				log.info("proactive reply emitted via forced fallback", {
					source: candidate.source,
					preview: candidate.preview,
				});
				return;
			}
			if (!normalized || normalized === PROACTIVE_NO_REPLY_SENTINEL) {
				this.emitStateChange("skipped", candidate.source, "llm-no-proactive-reply");
				return;
			}

			this.state.lastEmittedAt = Date.now();
			this.state.lastEmittedSource = candidate.source;
			this.pipeline.speakTextNonBlocking(normalized);
			this.emitStateChange("emitted", candidate.source, null);
			log.info("proactive reply emitted", {
				source: candidate.source,
				preview: candidate.preview,
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.emitStateChange("skipped", candidate.source, `emit-failed:${message}`);
			log.warn("proactive reply emission failed", { source: candidate.source, error: message });
		} finally {
			this.processingCandidate = false;
			this.syncBusyState();
			void this.maybeDrainPending();
		}
	}

	private buildPrompt(candidate: ProactiveCandidate): string {
		const runtimeContext = this.companionRuntime.getPromptContext();
		const parts: string[] = [];

		// --- 1. Identity & Role (first) ---
		parts.push([
			`【你的身份】`,
			`你是「派蒙」，一个正在陪用户一起看屏幕内容的小伙伴。`,
			"你的核心职责不是监控或播报，而是像一个朋友坐在旁边，一起感受正在发生的事情。",
			"你可以感叹、担心、吐槽、期待、轻声确认——这些都是自然的陪看反应。",
		].join("\n"));

		// --- 2. Ideal output style ---
		parts.push([
			"【输出风格】",
			"说话像朋友随口一说，而不是解说员在做实况转播。",
			"一句话足够时就说一句；两句话已经是上限。",
			"只在确实有值得指出的事情时才开口，沉默也是一种好回应。",
			"如果要指出观察，只挑最关键的一个点，不要罗列。",
			`如果不值得说话，请精确输出 ${PROACTIVE_NO_REPLY_SENTINEL}`,
		].join("\n"));

		// --- 3. Context facts ---
		parts.push(`【当前内部模式】${this.state.mode}`);
		parts.push(...candidate.facts);
		if (candidate.isEntrance) {
			parts.push(
				"【入场提示】这是你进入当前场景后的第一次观察。用一句自然的开场白即可，不要像正式解说。",
			);
		}
		if (candidate.forceSpeak) {
			parts.push([
				`【存在感要求】已静默超过 ${Math.round(this.runtimeSummarySilenceMs / 1000)} 秒，本轮需要开口。`,
				"即使只是轻声一句确认也好，本轮不输出不说话哨兵。",
			].join("\n"));
		}

		const relatedContext = this.getRelatedContextFacts(candidate.source);
		if (relatedContext.length) {
			parts.push(...relatedContext);
		}
		if (runtimeContext) {
			parts.push(`【当前可用观察上下文】\n${runtimeContext}`);
		}

		// --- 4. Prohibitions (last) ---
		parts.push([
			"【禁止项】",
			"不要编造未观察到的事实。",
			"不要流水账式复述画面内容。",
			"不要过度热情或频繁刷存在感。",
			"不要在文本里暗示情绪；如需表达情绪请调用 companion emotion 工具。",
			"如果选择不说话，不要调用任何工具。",
		].join("\n"));

		return parts.join("\n\n");
	}


	private getRelatedContextFacts(source: ProactiveTriggerSource): string[] {
		const parts: string[] = [];
		if (this.latestDelegatedRecord && Date.now() - this.latestDelegatedRecord.createdAt <= CROSS_CONTEXT_WINDOW_MS) {
			parts.push([
				"【最近托管执行记录】",
				`游戏：${this.latestDelegatedRecord.sourceGame ?? "none"}`,
				`模式：${this.latestDelegatedRecord.mode}`,
				`结果：${this.latestDelegatedRecord.executionSummary}`,
				`验证：${this.latestDelegatedRecord.verificationResult.success ? "成功" : "失败"}`,
				this.latestDelegatedRecord.decisionSummary ? `本轮思路：${this.latestDelegatedRecord.decisionSummary}` : "",
				this.latestDelegatedRecord.postActionObservationSummary ? `动作后观察：${this.latestDelegatedRecord.postActionObservationSummary}` : "",
				this.latestDelegatedRecord.nextStepHint ? `下一步线索：${this.latestDelegatedRecord.nextStepHint}` : "",
			].filter(Boolean).join("\n"));
		}
		if ((source === "runtime-summary" || source === "system-error") && this.latestTaskResult && Date.now() - this.latestTaskResult.createdAt <= CROSS_CONTEXT_WINDOW_MS) {
			parts.push([
				"【最近任务结果】",
				`来源：${this.latestTaskResult.source}`,
				`结果：${this.latestTaskResult.summary}`,
				`是否成功：${this.latestTaskResult.success ? "是" : "否"}`,
				`是否有明显变化：${this.latestTaskResult.boardChanged ? "是" : "否"}`,
				this.latestTaskResult.primaryAction ? `关键动作：${this.latestTaskResult.primaryAction}` : "",
			].filter(Boolean).join("\n"));
		}
		if ((source === "game2048-result" || source === "sokoban-result" || source === "system-error") && this.latestRuntimeSummary && Date.now() - this.latestRuntimeSummary.createdAt <= CROSS_CONTEXT_WINDOW_MS) {
			parts.push([
				"【最近观察总结】",
				`来源：${this.latestRuntimeSummary.source}`,
				`内容：${this.latestRuntimeSummary.summary}`,
			].join("\n"));
		}
		if (this.state.lastEmittedAt) {
			parts.push(`【距离上次已播报回复】约 ${Math.round((Date.now() - this.state.lastEmittedAt) / 1000)} 秒`);
		}
		return parts;
	}

	private resetRuntimeSession(reason: string) {
		this.pendingCandidate = null;
		this.lastSpokenAt = 0;
		this.lastSystemErrorSeen.clear();
		this.lastRuntimeSummarySeen.clear();
		this.latestRuntimeSummary = null;
		this.latestTaskResult = null;
		this.latestDelegatedRecord = this.delegationMemory.getLatestRecord();
		this.firstRuntimeSummaryPendingEntrance = true;
		this.state.pendingSource = null;
		this.state.pendingPriority = null;
		this.state.pendingPreview = null;
		this.state.lastCandidateSource = null;
		this.state.lastSkipReason = null;
		this.state.lastEmittedAt = null;
		this.state.lastEmittedSource = null;
		this.emitStateChange("idle", null, reason);
	}

	private buildForcedRuntimeSummaryFallback(): string {
		const summary = this.latestRuntimeSummary?.summary ?? "";
		if (summary.includes("紧张") || summary.includes("不安")) {
			return "派蒙还在陪你看着呢，这段气氛有点紧，我继续帮你盯着后面，汪。";
		}
		if (summary.includes("暂停") || summary.includes("等待")) {
			return "派蒙还在呢，这里像是先停住了一下，我继续陪你看后面会怎么发展，汪。";
		}
		return "派蒙还在陪你看着呢，我继续帮你盯着接下来会发生什么，汪。";
	}

	private isBusy(): boolean {
		return this.llmBusy || this.ttsBusy || this.voiceBusy || this.processingCandidate;
	}

	private syncBusyState() {
		const nextBusy = this.isBusy();
		if (this.state.isBusy === nextBusy) {
			return;
		}
		this.state.isBusy = nextBusy;
		this.emitStateChange(this.state.lastDecision, null, null);
	}

	private emitStateChange(
		action: ProactiveState["lastDecision"],
		source: ProactiveTriggerSource | null,
		reason: string | null,
	) {
		this.state.lastDecision = action;
		if (action === "skipped" && reason) {
			this.state.lastSkipReason = reason;
		}
		this.bus.emit("companion:proactive-state-change", {
			state: this.getState() as ProactiveState,
			action,
			source,
			reason,
		});
	}
}

function normalizeForDedupe(text: string): string {
	return text.trim().replace(/\s+/g, " ").toLowerCase();
}

function looksLikeLowSignalRuntimeSummary(summary: string): boolean {
	return [
		"画面变化很小",
		"当前画面与上一帧基本一致",
		"没有明显新变化",
		"暂无足够的画面描述可供总结",
		"最近画面概况",
		"基本一致",
	].some((pattern) => summary.includes(pattern.toLowerCase()));
}
