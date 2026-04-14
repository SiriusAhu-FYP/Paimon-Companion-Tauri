import type { EventBus } from "@/services/event-bus";
import type { CompanionRuntimeService } from "@/services/companion-runtime";
import type { LLMService } from "@/services/llm";
import type { PipelineService } from "@/services/pipeline";
import { createLogger } from "@/services/logger";
import type { EventMap, ProactiveState, ProactiveTriggerSource } from "@/types";
import { PROACTIVE_NO_REPLY_SENTINEL } from "./constants";

const log = createLogger("proactive-companion");
const RUNTIME_SUMMARY_SILENCE_MS = 45_000;
const TASK_RESULT_SILENCE_MS = 20_000;
const SYSTEM_ERROR_DEDUPE_MS = 30_000;
const DELEGATED_TASK_COOLDOWN_MS = 10_000;

interface ProactiveCandidate {
	source: ProactiveTriggerSource;
	priority: number;
	preview: string;
	dedupeKey: string;
	facts: string[];
	traceId?: string;
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
	private state: ProactiveState = makeInitialState();
	private pendingCandidate: ProactiveCandidate | null = null;
	private llmBusy = false;
	private ttsBusy = false;
	private voiceBusy = false;
	private processingCandidate = false;
	private lastSpokenAt = 0;
	private delegatedTaskCooldownUntil = 0;
	private lastSystemErrorSeen = new Map<string, number>();

	constructor(deps: {
		bus: EventBus;
		llm: LLMService;
		pipeline: PipelineService;
		companionRuntime: CompanionRuntimeService;
	}) {
		this.bus = deps.bus;
		this.llm = deps.llm;
		this.pipeline = deps.pipeline;
		this.companionRuntime = deps.companionRuntime;

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
		this.bus.on("unified:run-start", () => {
			this.setMode("delegated", "unified:run-start");
		});
		this.bus.on("unified:run-complete", () => {
			this.delegatedTaskCooldownUntil = Date.now() + DELEGATED_TASK_COOLDOWN_MS;
			this.setMode("companion", "unified:run-complete");
			void this.maybeDrainPending();
		});
	}

	getState(): Readonly<ProactiveState> {
		return { ...this.state };
	}

	private handleRuntimeSummary(payload: EventMap["companion-runtime:summary-complete"]) {
		const candidate: ProactiveCandidate = {
			source: "runtime-summary",
			priority: 1,
			preview: truncate(payload.record.summary),
			dedupeKey: `runtime-summary:${payload.record.source}:${payload.record.summary}`,
			facts: [
				`【触发源】runtime summary`,
				`【summary 来源】${payload.record.source}`,
				`【summary 内容】${payload.record.summary}`,
			],
		};
		void this.processCandidate(candidate);
	}

	private handle2048Result(payload: EventMap["game2048:run-complete"]) {
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
		if (candidate.source === "runtime-summary" && this.state.mode === "delegated") {
			return "delegated-mode";
		}
		if ((candidate.source === "game2048-result" || candidate.source === "sokoban-result") && this.state.mode === "delegated") {
			return "delegated-follow-up-active";
		}
		if ((candidate.source === "game2048-result" || candidate.source === "sokoban-result") && Date.now() < this.delegatedTaskCooldownUntil) {
			return "delegated-follow-up-cooldown";
		}
		const sinceLastSpeech = Date.now() - this.lastSpokenAt;
		if (candidate.source === "runtime-summary" && this.lastSpokenAt > 0 && sinceLastSpeech < RUNTIME_SUMMARY_SILENCE_MS) {
			return "runtime-summary-silence-window";
		}
		if ((candidate.source === "game2048-result" || candidate.source === "sokoban-result") && this.lastSpokenAt > 0 && sinceLastSpeech < TASK_RESULT_SILENCE_MS) {
			return "task-result-silence-window";
		}
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
			if (!normalized || normalized === PROACTIVE_NO_REPLY_SENTINEL) {
				this.emitStateChange("skipped", candidate.source, "llm-no-proactive-reply");
				return;
			}

			this.state.lastEmittedAt = Date.now();
			this.state.lastEmittedSource = candidate.source;
			await this.pipeline.speakText(normalized);
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
		const parts = [
			"你正在决定是否主动对玩家说一句话。",
			`如果不值得主动说话，请精确输出 ${PROACTIVE_NO_REPLY_SENTINEL} 。`,
			"如果值得主动说话，请只输出一句到两句简短、自然、可直接播报的中文陪伴回复。",
			"不要过度热情，不要频繁刷存在感，不要编造未观察到的事实。",
			"如果你选择不主动说话，不要调用任何工具。",
			"如果你选择主动说话，并且需要同步表情/情绪，请调用现有 companion emotion 工具。",
			`【当前内部模式】${this.state.mode}`,
			...candidate.facts,
		];
		if (runtimeContext) {
			parts.push(`【当前可用观察上下文】\n${runtimeContext}`);
		}
		return parts.join("\n\n");
	}

	private setMode(mode: ProactiveState["mode"], reason: string) {
		if (this.state.mode === mode) {
			return;
		}
		const previous = this.state.mode;
		this.state.mode = mode;
		this.bus.emit("companion:mode-change", {
			mode,
			previous,
			reason,
		});
		this.emitStateChange(this.state.lastDecision, null, reason);
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
