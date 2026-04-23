import type { CompanionRuntimeService } from "@/services/companion-runtime";
import type { EventBus } from "@/services/event-bus";
import type { AffectStateService } from "@/services/affect-state";
import { findSemanticGameByTargetTitle } from "@/services/games/semantic-game-registry";
import type { Game2048Service, SokobanService } from "@/services/games";
import type { LLMService } from "@/services/llm";
import type { OrchestratorService } from "@/services/orchestrator";
import type { PipelineService } from "@/services/pipeline";
import type { RuntimeService } from "@/services/runtime";
import type { CompanionModeService } from "@/services/companion-mode";
import type { DelegationMemoryService } from "@/services/delegation-memory";
import type { DebugCaptureService } from "@/services/debug-capture";
import type { LongTermMemoryService } from "@/services/memory/long-term-memory-service";
import type { MemoryLogService } from "@/services/memory/memory-log-service";
import type { LongTermMemoryEventResult } from "@/types/memory";
import { createLogger } from "@/services/logger";
import type { DelegatedExecutionRecord, FunctionalTarget, SokobanChangeType, UnifiedRunRecord, UnifiedRuntimeState } from "@/types";
import { callLocalMcpTool } from "@/services/mcp/local-mcp-client";
import { runDelegatedTaskLoop, type DelegationScratchpadRuntime } from "./delegated-task-runner";
import { startDelegationScratchpad, writeDelegationScratchpadText } from "./delegation-scratchpad-service";

const log = createLogger("unified-runtime");
const MAX_HISTORY = 10;
const BROWSER_WINDOW_TITLE_HINTS = ["firefox", "chrome", "edge", "browser", "mozilla", "网页"];
const PREFLIGHT_LOCAL_VISION_TIMEOUT_MS = 8_000;
const PREFLIGHT_CUE_THROTTLE_MS = 8_000;
const PREFLIGHT_CUE_TEXT = {
	noTargetFocused: "我还没找到目标窗口，先帮我聚焦一下 Firefox。",
	localVisionUnavailable: "我现在看不到屏幕内容，本地视觉服务还没连上。",
	localVisionRecovering: "本地视觉服务恢复了，我可以继续了。",
	delegationBlockedByPreflight: "我先不乱点，等目标窗口和视觉连接都就绪再开始托管。",
	companionBlockedByPreflight: "我先暂停观察，等窗口和视觉服务准备好再陪你继续。",
} as const;
const DELEGATION_WARMUP_CUE = {
	zh: "有新委托来了？让派蒙瞧瞧。",
	en: "A new commission? Let Paimon take a look.",
} as const;
type PreflightCueKey = keyof typeof PREFLIGHT_CUE_TEXT;

type SupportedUnifiedGameId = "2048" | "sokoban";

function makeInitialState(): UnifiedRuntimeState {
	return {
		speechEnabled: true,
		voiceInputEnabled: true,
		activeRunId: null,
		loopActive: false,
		phase: "idle",
		lastVoiceInput: null,
		lastCommand: null,
		lastCompanionText: null,
		lastRun: null,
		history: [],
	};
}

function cloneRun(run: UnifiedRunRecord): UnifiedRunRecord {
	return {
		...run,
		timings: { ...run.timings },
	};
}

type UnifiedVoiceCommand = "game-analyze" | null;

const VOICE_GAME_ANALYZE_COMMAND_RE = /(帮我看|看一下|看看|分析一下|分析|建议|下一步)/i;

export class UnifiedRuntimeService {
	private bus: EventBus;
	private runtime: RuntimeService;
	private affect: AffectStateService;
	private companionRuntime: CompanionRuntimeService;
	private orchestrator: OrchestratorService;
	private game2048: Game2048Service;
	private sokoban: SokobanService;
	private llm: LLMService;
	private pipeline: PipelineService;
	private companionMode: CompanionModeService;
	private delegationMemory: DelegationMemoryService;
	private debugCapture?: DebugCaptureService;
	private ltmService?: LongTermMemoryService;
	private memoryLog?: MemoryLogService;
	private state: UnifiedRuntimeState = makeInitialState();
	private activeLoopId: string | null = null;
	private preflightCueLastSpokenAt = new Map<PreflightCueKey, number>();
	private localVisionWasUnavailable = false;

	constructor(deps: {
		bus: EventBus;
		runtime: RuntimeService;
		affect: AffectStateService;
		companionRuntime: CompanionRuntimeService;
		orchestrator: OrchestratorService;
		game2048: Game2048Service;
		sokoban: SokobanService;
		llm: LLMService;
		pipeline: PipelineService;
		companionMode: CompanionModeService;
		delegationMemory: DelegationMemoryService;
		debugCapture?: DebugCaptureService;
	}) {
		this.bus = deps.bus;
		this.runtime = deps.runtime;
		this.affect = deps.affect;
		this.companionRuntime = deps.companionRuntime;
		this.orchestrator = deps.orchestrator;
		this.game2048 = deps.game2048;
		this.sokoban = deps.sokoban;
		this.llm = deps.llm;
		this.pipeline = deps.pipeline;
		this.companionMode = deps.companionMode;
		this.delegationMemory = deps.delegationMemory;
		this.debugCapture = deps.debugCapture;
	}

	setLongTermMemory(ltm: LongTermMemoryService): void {
		this.ltmService = ltm;
	}

	setMemoryLog(ml: MemoryLogService): void {
		this.memoryLog = ml;
	}

	getState(): Readonly<UnifiedRuntimeState> {
		return {
			...this.state,
			lastRun: this.state.lastRun ? cloneRun(this.state.lastRun) : null,
			history: this.state.history.map(cloneRun),
		};
	}

	setSpeechEnabled(enabled: boolean) {
		if (enabled === this.state.speechEnabled) return;
		this.state.speechEnabled = enabled;
		this.emitState();
	}

	setVoiceInputEnabled(enabled: boolean) {
		if (enabled === this.state.voiceInputEnabled) return;
		this.state.voiceInputEnabled = enabled;
		this.emitState();
	}

	async runModePreflight(mode: "companion" | "delegated"): Promise<FunctionalTarget> {
		const selectedTarget = this.orchestrator.getState().selectedTarget;
		if (!selectedTarget) {
			this.playPreflightCue("noTargetFocused");
			this.playPreflightCue(mode === "delegated" ? "delegationBlockedByPreflight" : "companionBlockedByPreflight");
			const modeLabel = mode === "delegated" ? "托管模式" : "陪伴模式";
			throw new Error(`${modeLabel}启动失败：请先聚焦并选中目标窗口。`);
		}

		try {
			await this.companionRuntime.testLocalVisionConnection({ timeoutMs: PREFLIGHT_LOCAL_VISION_TIMEOUT_MS });
			if (this.localVisionWasUnavailable) {
				this.playPreflightCue("localVisionRecovering");
			}
			this.localVisionWasUnavailable = false;
			return selectedTarget;
		} catch (err) {
			this.localVisionWasUnavailable = true;
			this.playPreflightCue("localVisionUnavailable");
			this.playPreflightCue(mode === "delegated" ? "delegationBlockedByPreflight" : "companionBlockedByPreflight");
			const modeLabel = mode === "delegated" ? "托管模式" : "陪伴模式";
			const reason = err instanceof Error ? err.message : String(err);
			throw new Error(`${modeLabel}启动前置检查失败：${reason}`);
		}
	}

	stopDelegationLoop(reason = "manual-stop"): boolean {
		if (!this.activeLoopId) {
			return false;
		}
		const loopId = this.activeLoopId;
		this.activeLoopId = null;
		this.state.loopActive = false;
		this.state.lastCommand = `delegated-stop:${reason}`;
		log.info("delegated loop stop requested", {
			reason,
			loopId,
			activeRunId: this.state.activeRunId,
		});
		this.emitState();
		return true;
	}

	async submitDelegationTaskInstruction(text: string): Promise<void> {
		const trimmed = text.trim();
		if (!trimmed) {
			return;
		}
		if (!this.runtime.isAllowed()) {
			throw new Error(`browser task blocked: runtime mode is ${this.runtime.getMode()}`);
		}
		if (this.activeLoopId || this.state.activeRunId) {
			throw new Error("delegation-mode task is already running");
		}

		const preflightTarget = await this.runModePreflight("delegated");
		const target = this.resolveBrowserTaskTarget(preflightTarget);
		const loopId = `delegated-browser-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
		this.activeLoopId = loopId;
		this.state.loopActive = true;
		this.state.phase = "thinking";
		this.state.lastCommand = `browser-task:${trimmed}`;
		this.state.lastVoiceInput = null;
		this.companionMode.setMode("delegated", "browser-task-start", "system");
		this.emitState();

		try {
			this.emitDelegationWarmupCue(trimmed);
			await this.orchestrator.runFocusTask(target, { applyDelegatedViewport: true });
			const scratchpad = await this.createDelegationScratchpadRuntime({
				label: "delegation-task",
				taskText: trimmed,
				target,
			});
			const result = await runDelegatedTaskLoop({
				taskText: trimmed,
				target,
				orchestrator: this.orchestrator,
				shouldStop: () => this.activeLoopId !== loopId,
				scratchpad,
				recallMemoryCandidates: this.ltmService
					? async (query: string) => this.ltmService!.recall(query, 3)
					: undefined,
				onAssistantReply: async (reply, source) => {
					const normalizedReply = reply.trim();
					if (!normalizedReply) {
						return;
					}
					this.state.lastCompanionText = normalizedReply;
					this.emitCompanionReplyToChat(normalizedReply);
					if (this.state.speechEnabled && source === "reflection") {
						this.state.phase = "speaking";
						this.emitState();
						this.safeSpeak(normalizedReply, { interruptQueue: true });
					}
				},
			});
			this.state.lastCompanionText = result.summary;
			if (result.status === "failed") {
				this.emitDelegationFailureReason(result.summary);
				this.state.phase = "failed";
				throw new Error(result.summary);
			}
			this.state.phase = "idle";
			if (result.status === "stopped") {
				this.emitCompanionReplyToChat("托管任务已停止。");
			}
		} catch (err) {
			this.state.phase = "failed";
			throw err;
		} finally {
			if (this.activeLoopId === loopId) {
				this.activeLoopId = null;
			}
			this.state.loopActive = this.activeLoopId !== null;
			if (this.state.phase !== "failed") {
				this.state.phase = "idle";
			}
			this.companionMode.setMode(this.companionMode.getPreferredMode(), "browser-task-complete", "system");
			this.emitState();
		}
	}

	async runDelegationTask(
		trigger: "manual" | "voice" = "manual",
		requestText: string | null = null,
		options?: { traceId?: string },
	): Promise<UnifiedRunRecord> {
		if (!this.runtime.isAllowed()) {
			throw new Error(`unified run blocked: runtime mode is ${this.runtime.getMode()}`);
		}
		if (this.activeLoopId || this.state.activeRunId) {
			throw new Error("unified run already in progress");
		}
		const taskGameHint = this.resolveTargetGame(requestText);
		const preflightTarget = await this.runModePreflight("delegated");
		const target = this.resolveDelegationTarget(preflightTarget);
		const delegationTaskText = this.buildDelegationTaskText(taskGameHint, requestText);
		return this.executeDelegationRun({
			taskTag: taskGameHint ?? "generic",
			target,
			trigger,
			taskText: delegationTaskText,
			traceId: options?.traceId,
		});
	}

	async submitVoiceText(text: string): Promise<void> {
		const trimmed = text.trim();
		if (!trimmed) return;
		if (!this.state.voiceInputEnabled) {
			throw new Error("voice input path is disabled");
		}

		const command = inferVoiceCommand(trimmed);
		this.state.phase = "listening";
		this.state.lastVoiceInput = trimmed;
		this.state.lastCommand = command;
		this.bus.emit("audio:asr-result", { text: trimmed, source: "voice" });
		this.bus.emit("unified:voice-input", { text: trimmed, command });
		this.emitState();

		if (command === "game-analyze") {
			await this.runUnifiedGameAnalysis(trimmed);
			return;
		}

		try {
			await this.pipeline.run(trimmed, { inputSource: "voice" });
			this.state.phase = "idle";
		} catch (err) {
			this.state.phase = "failed";
			throw err;
		} finally {
			this.emitState();
		}
	}

	private async applyEmotion(emotion: string, traceId?: string) {
		try {
			if (emotion === "neutral") {
				await callLocalMcpTool("companion.reset_emotion", {}, { timeoutMs: 45_000, traceId });
				return;
			}
			await callLocalMcpTool("companion.set_emotion", { emotion }, { timeoutMs: 45_000, traceId });
		} catch (err) {
			log.warn("unified emotion application via MCP failed", err);
			this.affect.applyEmotion({
				emotion: resolveUnifiedEmotion(emotion),
				source: "unified-runtime",
				reason: "unified-mcp-fallback",
				holdForSpeech: true,
			});
		}
	}

	private resolveTargetGame(requestText: string | null): SupportedUnifiedGameId | null {
		const explicit = inferGameFromText(requestText);
		if (explicit) {
			return explicit;
		}
		const selectedTarget = this.orchestrator.getState().selectedTarget;
		const inferred = findSemanticGameByTargetTitle(selectedTarget?.title);
		if (!inferred) {
			return null;
		}
		return inferred.gameId;
	}

	private resolveDelegationTarget(selectedTarget: FunctionalTarget): FunctionalTarget {
		return selectedTarget;
	}

	private buildDelegationTaskText(gameId: SupportedUnifiedGameId | null, requestText: string | null): string {
		const trimmed = requestText?.trim();
		if (trimmed) {
			return trimmed;
		}
		if (!gameId) {
			throw new Error("delegation task requires explicit task text when target is not a recognized game window");
		}
		if (gameId === "2048") {
			return "请继续托管当前 2048 局面，执行下一步有效动作并汇报进展。";
		}
		return "请继续托管当前推箱子局面，执行下一步有效动作并汇报进展。";
	}

	private resolveBrowserTaskTarget(selectedTarget: FunctionalTarget): FunctionalTarget {
		const normalizedTitle = selectedTarget.title.toLowerCase();
		const looksLikeBrowser = BROWSER_WINDOW_TITLE_HINTS.some((hint) => normalizedTitle.includes(hint));
		if (!looksLikeBrowser) {
			log.warn("browser structured task target may not be browser-like", {
				title: selectedTarget.title,
				handle: selectedTarget.handle,
			});
		}
		return selectedTarget;
	}

	private async createDelegationScratchpadRuntime(input: {
		label: string;
		taskText: string;
		target: FunctionalTarget;
	}): Promise<DelegationScratchpadRuntime | null> {
		try {
			const debugCaptureState = this.debugCapture?.getState();
			const debugSessionId = debugCaptureState?.enabled ? debugCaptureState.sessionId : null;
			const session = await startDelegationScratchpad({
				label: input.label,
				mirrorDebugSessionId: debugSessionId ?? null,
			});
			if (!session) {
				return null;
			}
			const sessionHeader = [
				`scratchpadId: ${session.scratchpadId}`,
				`target: ${input.target.title} (${input.target.handle})`,
				`task: ${input.taskText}`,
				`createdAt: ${new Date().toISOString()}`,
				`mirrorDirectory: ${session.mirrorDirectory ?? "(none)"}`,
				"",
			].join("\n");
			await writeDelegationScratchpadText({
				scratchpadId: session.scratchpadId,
				relativePath: "shared/session.md",
				text: sessionHeader,
				append: false,
			});
			log.info("delegation scratchpad started", {
				scratchpadId: session.scratchpadId,
				directory: session.directory,
				mirrorDirectory: session.mirrorDirectory,
			});
			return {
				append: (relativePath, text, options) => writeDelegationScratchpadText({
					scratchpadId: session.scratchpadId,
					relativePath,
					text,
					append: options?.append,
				}),
			};
		} catch (error) {
			log.warn("failed to start delegation scratchpad", {
				label: input.label,
				error: error instanceof Error ? error.message : String(error),
			});
			return null;
		}
	}

	private emitDelegationWarmupCue(taskText: string) {
		const cue = isLikelyEnglishTask(taskText) ? DELEGATION_WARMUP_CUE.en : DELEGATION_WARMUP_CUE.zh;
		this.state.lastCompanionText = cue;
		this.emitCompanionReplyToChat(cue);
		if (this.state.speechEnabled) {
			this.state.phase = "speaking";
			this.emitState();
			this.safeSpeak(cue, { interruptQueue: true });
		}
	}

	private playPreflightCue(cueKey: PreflightCueKey): boolean {
		const now = Date.now();
		const lastSpokenAt = this.preflightCueLastSpokenAt.get(cueKey) ?? 0;
		if (now - lastSpokenAt < PREFLIGHT_CUE_THROTTLE_MS) {
			return false;
		}
		this.preflightCueLastSpokenAt.set(cueKey, now);
		const cueText = PREFLIGHT_CUE_TEXT[cueKey];
		this.emitCompanionReplyToChat(cueText);
		try {
			return this.safeSpeak(cueText, { interruptQueue: true });
		} catch (err) {
			log.warn("preflight cue speak failed", {
				cueKey,
				error: err instanceof Error ? err.message : String(err),
			});
			return false;
		}
	}

	private safeSpeak(text: string, options?: { interruptQueue?: boolean }): boolean {
		try {
			if (options?.interruptQueue) {
				this.pipeline.stopSpeechQueue();
			}
			return this.pipeline.speakTextNonBlocking(text);
		} catch (err) {
			log.warn("unified speech failed", err);
			return false;
		}
	}

	private emitCompanionReplyToChat(text: string) {
		const normalized = text.trim();
		if (!normalized) {
			return;
		}
		this.bus.emit("llm:response-end", {
			fullText: normalized,
			source: "companion-reply",
		});
	}

	private emitDelegationFailureReason(summary: string) {
		const reasonText = summarizeDelegationFailureReason(summary);
		this.state.lastCompanionText = reasonText;
		this.emitCompanionReplyToChat(reasonText);
		if (!this.state.speechEnabled) {
			return;
		}
		this.state.phase = "speaking";
		this.emitState();
		this.safeSpeak(reasonText, { interruptQueue: false });
	}

	private emitState() {
		this.bus.emit("unified:state-change", { state: this.getState() });
	}

	private async executeDelegationRun(input: {
		taskTag: string;
		target: FunctionalTarget;
		trigger: "manual" | "voice";
		taskText: string;
		traceId?: string;
	}): Promise<UnifiedRunRecord> {
		const run: UnifiedRunRecord = {
			id: input.traceId ?? `unified-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
			gameId: input.taskTag === "generic" ? null : input.taskTag,
			trigger: input.trigger,
			requestText: input.taskText,
			startedAt: Date.now(),
			endedAt: null,
			status: "running",
			phase: "thinking",
			summary: "",
			companionText: "",
			companionTextSource: "none",
			emotion: "neutral",
			selectedAction: null,
			spoke: false,
			error: null,
			timings: {
				actionMs: 0,
				runtimeRefreshMs: 0,
				llmReplyMs: 0,
				speechMs: 0,
				totalMs: 0,
				totalBlockingMs: 0,
				totalNonBlockingMs: 0,
			},
			delegationTimeline: null,
		};

		const loopId = `delegation-task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
		this.companionMode.setMode("delegated", "unified:run-start", "system");
		this.activeLoopId = loopId;
		this.state.loopActive = true;
		this.state.activeRunId = run.id;
		this.state.phase = "thinking";
		this.state.lastCommand = `${input.taskTag}-delegation`;
		this.state.lastRun = cloneRun(run);
		this.bus.emit("unified:run-start", {
			runId: run.id,
			trigger: input.trigger,
			requestText: input.taskText,
			traceId: run.id,
		});
		this.emitState();

		try {
			this.emitDelegationWarmupCue(input.taskText);

			await this.orchestrator.runFocusTask(input.target, { applyDelegatedViewport: true });
			const scratchpad = await this.createDelegationScratchpadRuntime({
				label: "delegation-task",
				taskText: input.taskText,
				target: input.target,
			});
			const actionStartedAt = Date.now();
			const result = await runDelegatedTaskLoop({
				taskText: input.taskText,
				target: input.target,
				orchestrator: this.orchestrator,
				traceId: run.id,
				shouldStop: () => this.activeLoopId !== loopId,
				scratchpad,
				recallMemoryCandidates: this.ltmService
					? async (query: string) => this.ltmService!.recall(query, 3)
					: undefined,
				onAssistantReply: async (reply, source) => {
					const normalizedReply = reply.trim();
					if (!normalizedReply) {
						return;
					}
					this.state.lastCompanionText = normalizedReply;
					this.emitCompanionReplyToChat(normalizedReply);
					run.companionText = normalizedReply;
					run.companionTextSource = "llm";
					if (this.state.speechEnabled && source === "reflection") {
						this.state.phase = "speaking";
						this.emitState();
						run.spoke = this.safeSpeak(normalizedReply, { interruptQueue: true }) || run.spoke;
					}
				},
			});
			run.timings.actionMs = Date.now() - actionStartedAt;
			if (result.status === "failed") {
				throw new Error(result.summary);
			}
			run.status = "completed";
			run.phase = this.state.speechEnabled ? "speaking" : "idle";
			run.summary = result.summary;
			run.delegationTimeline = result.timeline ?? null;
			if (result.status === "completed") {
				const completionText = `搞定啦！${result.summary}`;
				run.companionText = completionText;
				run.companionTextSource = "fallback";
				this.state.lastCompanionText = completionText;
				this.emitCompanionReplyToChat(completionText);
			} else if (!run.companionText) {
				const fallbackText = result.status === "stopped" ? "托管任务已停止。" : result.summary;
				run.companionText = fallbackText;
				run.companionTextSource = "fallback";
				this.state.lastCompanionText = fallbackText;
				this.emitCompanionReplyToChat(fallbackText);
			}
			const beforeSpeechAt = Date.now();
			run.timings.totalNonBlockingMs = Math.max(0, beforeSpeechAt - run.startedAt);
			if (this.state.speechEnabled && run.companionText && run.companionTextSource !== "llm") {
				this.state.phase = "speaking";
				this.emitState();
				const speechStartedAt = Date.now();
				run.spoke = this.safeSpeak(run.companionText);
				run.timings.speechMs = Date.now() - speechStartedAt;
			}
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			run.status = "failed";
			run.phase = "failed";
			run.error = message;
			run.summary = `delegation-mode unified run failed: ${message}`;
			run.companionText = summarizeDelegationFailureReason(message);
			run.companionTextSource = "fallback";
			run.emotion = "sad";
			this.state.lastCompanionText = run.companionText;
			this.emitCompanionReplyToChat(run.companionText);
			if (this.state.speechEnabled) {
				this.state.phase = "speaking";
				this.emitState();
				const speechStartedAt = Date.now();
				run.spoke = this.safeSpeak(run.companionText, { interruptQueue: false });
				run.timings.speechMs = Date.now() - speechStartedAt;
			}
		} finally {
			run.endedAt = Date.now();
			run.timings.totalBlockingMs = Math.max(0, run.endedAt - run.startedAt);
			run.timings.totalMs = run.timings.totalBlockingMs;
			if (run.timings.totalNonBlockingMs <= 0) {
				run.timings.totalNonBlockingMs = run.timings.totalBlockingMs;
			}
			this.state.activeRunId = null;
			this.state.phase = run.status === "failed" ? "failed" : "idle";
			this.state.lastRun = cloneRun(run);
			this.state.history = [cloneRun(run), ...this.state.history].slice(0, MAX_HISTORY);
			this.bus.emit("unified:run-complete", {
				runId: run.id,
				gameId: run.gameId,
				success: run.status === "completed",
				summary: run.summary,
				emotion: run.emotion,
				spoke: run.spoke,
				timings: { ...run.timings },
				traceId: run.id,
			});
			if (this.activeLoopId === loopId) {
				this.activeLoopId = null;
			}
			this.state.loopActive = this.activeLoopId !== null;
			this.companionMode.setMode(this.companionMode.getPreferredMode(), "unified:run-complete", "system");
			this.emitState();

			// Delegation event writeback via intermediate log
			if (this.memoryLog) {
				const eventResult: LongTermMemoryEventResult =
					run.status === "completed" ? "success"
					: run.status === "failed" ? "failure"
					: "interrupted";
				const entities = extractEntitiesFromText(
					`${input.taskText} ${run.summary || ""}`,
				);
				this.memoryLog.append({
					id: `delegation-${run.id}`,
					source: "delegation",
					createdAt: Date.now(),
					rawContext: `任务: ${input.taskText}\n结果: ${run.summary || "无"}`,
					preCompressed: {
						memory_id: `delegation-${run.id}`,
						source: "delegation",
						time_start: run.startedAt,
						time_end: run.endedAt ?? Date.now(),
						scene_or_task: input.taskText.slice(0, 80),
						entities,
						event_result: eventResult,
						summary: run.summary || input.taskText,
						tags: ["delegation", input.taskTag],
						committed_at: 0,
					},
					promoted: false,
				}).catch((err) => {
					log.warn("delegation event log failed", err);
				});
			}
		}

		if (run.status === "failed") {
			throw new Error(run.error ?? run.summary);
		}
		return cloneRun(run);
	}

	/** @deprecated legacy path is retained only for diagnostics, not used by delegation mode */
	async executeSingleUnifiedGameRound(
		targetGame: SupportedUnifiedGameId,
		trigger: "manual" | "voice",
		requestText: string | null,
		options?: { traceId?: string },
	): Promise<UnifiedRunRecord> {
		const run: UnifiedRunRecord = {
			id: options?.traceId ?? `unified-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
			gameId: targetGame,
			trigger,
			requestText,
			startedAt: Date.now(),
			endedAt: null,
			status: "running",
			phase: "acting",
			summary: "",
			companionText: "",
			companionTextSource: "none",
			emotion: "neutral",
			selectedAction: null,
			spoke: false,
			error: null,
			timings: {
				actionMs: 0,
				runtimeRefreshMs: 0,
				llmReplyMs: 0,
				speechMs: 0,
				totalMs: 0,
				totalBlockingMs: 0,
				totalNonBlockingMs: 0,
			},
			delegationTimeline: null,
		};

		this.state.activeRunId = run.id;
		this.state.phase = "acting";
		this.state.lastCommand = `${targetGame}-step`;
		this.state.lastRun = cloneRun(run);
		await this.applyEmotion("neutral", run.id);
		this.bus.emit("unified:run-start", {
			runId: run.id,
			trigger,
			requestText,
			traceId: run.id,
		});
		this.emitState();
		let roundRecordForAudit: DelegatedExecutionRecord | null = null;

		try {
			let companionText = "";
			let delegatedRecord: DelegatedExecutionRecord | null = null;
			if (targetGame === "2048") {
				const actionStartedAt = Date.now();
				const result = await this.game2048.runSingleStep(undefined, { traceId: run.id });
				run.timings.actionMs = Date.now() - actionStartedAt;
				const postActionObservation = await this.waitForPostActionObservationForTarget(result.target, Date.now());
				run.timings.runtimeRefreshMs = postActionObservation.waitedMs;
				run.status = "completed";
				run.phase = this.state.speechEnabled ? "speaking" : "idle";
				run.summary = result.summary;
				run.selectedAction = result.selectedMove;
				run.emotion = result.boardChanged ? "happy" : "dazed";
				delegatedRecord = this.delegationMemory.appendRecord({
					createdAt: Date.now(),
					mode: this.companionMode.getState().mode,
					sourceGame: "2048",
					trigger,
					requestText,
					analysisSource: result.analysis.source,
					decisionSummary: result.analysis.decisionSummary ?? result.analysis.strategy,
					plannedActions: [...result.analysis.preferredMoves],
					attemptedActions: result.attempts.map((attempt) => attempt.move),
					selectedAction: result.selectedMove,
					executionSummary: result.summary,
					verificationResult: {
						success: result.boardChanged,
						boardChanged: result.boardChanged,
						error: null,
					},
					sokobanChangeType: undefined,
					postActionObservationStatus: resolvePostObservationStatus(postActionObservation),
					postActionObservationSummary: truncateObservationContext(postActionObservation.promptContext),
					followUpSummary: "",
					emotion: run.emotion,
					nextStepHint: extractNextStepHint(result.analysis.reflection, result.analysis.reasoning, result.selectedMove),
					traceId: run.id,
				});
				roundRecordForAudit = delegatedRecord;
				const llmReplyStartedAt = Date.now();
				const generatedReply = await this.generateGroundedCompanionReply({
					traceId: run.id,
					delegationRecord: delegatedRecord,
					fallbackText: result.companionText,
					postActionObservation,
				});
				run.timings.llmReplyMs = Date.now() - llmReplyStartedAt;
				run.companionText = generatedReply.text;
				run.companionTextSource = generatedReply.source;
				companionText = generatedReply.text;
				this.delegationMemory.updateRecord(delegatedRecord.id, {
					followUpSummary: generatedReply.text,
				});
			} else {
				const actionStartedAt = Date.now();
				const result = await this.sokoban.runValidationRound(undefined, { traceId: run.id });
				run.timings.actionMs = Date.now() - actionStartedAt;
				const postActionObservation = await this.waitForPostActionObservationForTarget(result.target, Date.now());
				run.timings.runtimeRefreshMs = postActionObservation.waitedMs;
				run.status = "completed";
				run.phase = this.state.speechEnabled ? "speaking" : "idle";
				run.summary = result.summary;
				run.selectedAction = result.executedMoves[0] ?? result.analysis.plannedMoves[0] ?? null;
				run.emotion = result.boardChanged ? "delighted" : "alarmed";
				delegatedRecord = this.delegationMemory.appendRecord({
					createdAt: Date.now(),
					mode: this.companionMode.getState().mode,
					sourceGame: "sokoban",
					trigger,
					requestText,
					analysisSource: result.analysis.source,
					decisionSummary: result.analysis.decisionSummary ?? result.analysis.strategy,
					plannedActions: [...result.analysis.plannedMoves],
					attemptedActions: result.attempts.map((attempt) => attempt.move),
					selectedAction: result.executedMoves[0] ?? result.analysis.plannedMoves[0] ?? null,
					executionSummary: result.summary,
					verificationResult: {
						success: result.boardChanged,
						boardChanged: result.boardChanged,
						error: null,
					},
					sokobanChangeType: inferSokobanChangeType({
						boardChanged: result.boardChanged,
						executedMoves: result.executedMoves,
						decisionSummary: result.analysis.decisionSummary ?? "",
						reflection: result.analysis.reflection,
						reasoning: result.analysis.reasoning,
						executionSummary: result.summary,
						postActionObservationSummary: truncateObservationContext(postActionObservation.promptContext, 700),
					}),
					postActionObservationStatus: resolvePostObservationStatus(postActionObservation),
					postActionObservationSummary: truncateObservationContext(postActionObservation.promptContext),
					followUpSummary: "",
					emotion: run.emotion,
					nextStepHint: extractNextStepHint(
						result.analysis.reflection,
						result.analysis.reasoning,
						result.executedMoves[0] ?? result.analysis.plannedMoves[0] ?? null,
					),
					traceId: run.id,
				});
				roundRecordForAudit = delegatedRecord;
				const llmReplyStartedAt = Date.now();
				const generatedReply = await this.generateGroundedCompanionReply({
					traceId: run.id,
					delegationRecord: delegatedRecord,
					fallbackText: result.companionText,
					postActionObservation,
				});
				run.timings.llmReplyMs = Date.now() - llmReplyStartedAt;
				run.companionText = generatedReply.text;
				run.companionTextSource = generatedReply.source;
				companionText = generatedReply.text;
				this.delegationMemory.updateRecord(delegatedRecord.id, {
					followUpSummary: generatedReply.text,
				});
			}
			this.state.lastCompanionText = companionText;
			if (run.companionTextSource === "fallback" && companionText) {
				this.emitCompanionReplyToChat(companionText);
			}
			await this.applyEmotion(run.emotion, run.id);
			const beforeSpeechAt = Date.now();
			run.timings.totalNonBlockingMs = Math.max(0, beforeSpeechAt - run.startedAt);

			if (this.state.speechEnabled && companionText) {
				this.state.phase = "speaking";
				this.emitState();
				const speechStartedAt = Date.now();
				run.spoke = this.safeSpeak(companionText);
				run.timings.speechMs = Date.now() - speechStartedAt;
			}
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			run.status = "failed";
			run.phase = "failed";
			run.error = message;
			run.summary = `unified run failed: ${message}`;
			run.companionText = "这轮统一运行没成功，我先停下来，等你检查目标窗口或当前画面。";
			run.companionTextSource = "fallback";
			run.emotion = "sad";
			this.state.lastCompanionText = run.companionText;
			this.emitCompanionReplyToChat(run.companionText);
			roundRecordForAudit = this.delegationMemory.appendRecord({
				createdAt: Date.now(),
				mode: this.companionMode.getState().mode,
				sourceGame: run.gameId,
				trigger,
				requestText,
				analysisSource: null,
				decisionSummary: null,
				plannedActions: [],
				attemptedActions: [],
				selectedAction: run.selectedAction,
				executionSummary: run.summary,
				verificationResult: {
					success: false,
					boardChanged: false,
					error: message,
				},
				sokobanChangeType: run.gameId === "sokoban" ? "no_progress" : undefined,
				postActionObservationStatus: undefined,
				postActionObservationSummary: null,
				followUpSummary: run.companionText,
				emotion: run.emotion,
				nextStepHint: null,
				traceId: run.id,
			});
			await this.applyEmotion(run.emotion, run.id);
			const beforeSpeechAt = Date.now();
			run.timings.totalNonBlockingMs = Math.max(0, beforeSpeechAt - run.startedAt);

			if (this.state.speechEnabled) {
				this.state.phase = "speaking";
				this.emitState();
				const speechStartedAt = Date.now();
				run.spoke = this.safeSpeak(run.companionText, { interruptQueue: true });
				run.timings.speechMs = Date.now() - speechStartedAt;
			}
		}

		run.endedAt = Date.now();
		run.timings.totalBlockingMs = Math.max(0, run.endedAt - run.startedAt);
		run.timings.totalMs = run.timings.totalBlockingMs;
		if (run.timings.totalNonBlockingMs <= 0) {
			run.timings.totalNonBlockingMs = run.timings.totalBlockingMs;
		}
		log.info("delegated-round-summary", {
			timestampMs: run.endedAt,
			traceId: run.id,
			gameId: run.gameId,
			status: run.status,
			trigger,
			selectedAction: run.selectedAction,
			companionTextSource: run.companionTextSource,
			spoke: run.spoke,
			summary: run.summary,
			planned: roundRecordForAudit?.plannedActions ?? [],
			attempted: roundRecordForAudit?.attemptedActions ?? [],
			verified: roundRecordForAudit?.verificationResult?.boardChanged ?? null,
			verificationSuccess: roundRecordForAudit?.verificationResult?.success ?? null,
			postObservationStatus: roundRecordForAudit?.postActionObservationStatus ?? null,
		});
		log.info("delegated-round-timing-breakdown", {
			timestampMs: run.endedAt,
			traceId: run.id,
			actionMs: run.timings.actionMs,
			runtimeRefreshMs: run.timings.runtimeRefreshMs,
			llmReplyMs: run.timings.llmReplyMs,
			speechMs: run.timings.speechMs,
			totalBlockingMs: run.timings.totalBlockingMs,
			totalNonBlockingMs: run.timings.totalNonBlockingMs,
		});
		this.state.activeRunId = null;
		this.state.phase = run.status === "failed" ? "failed" : "idle";
		this.state.lastRun = cloneRun(run);
		this.state.history = [cloneRun(run), ...this.state.history].slice(0, MAX_HISTORY);
		this.bus.emit("unified:run-complete", {
			runId: run.id,
			gameId: run.gameId,
			success: run.status === "completed",
			summary: run.summary,
			emotion: run.emotion,
			spoke: run.spoke,
			timings: { ...run.timings },
			traceId: run.id,
		});
		this.emitState();

		if (run.status === "failed") {
			throw new Error(run.error ?? run.summary);
		}

		return cloneRun(run);
	}

	private async runUnifiedGameAnalysis(requestText: string): Promise<void> {
		const targetGame = this.resolveTargetGame(requestText);
		if (!targetGame) {
			throw new Error("unified analysis requires a selected 2048 or Sokoban target window");
		}

		this.state.phase = "thinking";
		this.emitState();

		try {
			const reply = await this.llm.generateCompanionReply([
				"用户希望你只分析当前局面，不要替他执行动作。",
				"请根据当前观察到的画面，给出一句到两句简短建议。",
				"要求：",
				"1. 明确说明这是建议，不是已经执行的动作。",
				"2. 不要假装自己已经移动了棋盘或推了箱子。",
				"3. 如果最近托管记录里已经有明确验证结果或下一步提示，优先沿用这些 grounded 线索，不要重新发明一套无根据建议。",
				`【目标游戏】${targetGame}`,
				`【用户请求】${requestText}`,
			].join("\n"), {
				knowledgeContext: "",
				delegationMemoryContext: this.delegationMemory.buildFocusedPromptContext({
					sourceGame: targetGame,
				}),
			});

			const finalReply = reply || "我先帮你看了一下，但这轮还没拿到足够明确的建议。";
			this.state.lastCompanionText = finalReply;
			if (!reply) {
				this.emitCompanionReplyToChat(finalReply);
			}
			await this.applyEmotion("neutral");
			if (this.state.speechEnabled) {
				this.state.phase = "speaking";
				this.emitState();
				this.safeSpeak(finalReply);
			}
			this.state.phase = "idle";
		} catch (err) {
			this.state.phase = "failed";
			throw err;
		} finally {
			this.emitState();
		}
	}

	private async waitForPostActionObservationForTarget(target: { handle: string; title: string }, afterTimestamp: number): Promise<{
		promptContext: string;
		latestTimestamp: number;
		changedObservation: boolean;
		timedOut: boolean;
		waitedMs: number;
	}> {
		const startedAt = Date.now();
		try {
			const result = await this.companionRuntime.waitForPostActionObservation(target, {
				afterTimestamp,
				timeoutMs: 5_000,
				requireChanged: true,
			});
			return {
				...result,
				waitedMs: Date.now() - startedAt,
			};
		} catch (err) {
			log.warn("post-action companion observation wait failed", err);
			return {
				promptContext: "",
				latestTimestamp: 0,
				changedObservation: false,
				timedOut: true,
				waitedMs: Date.now() - startedAt,
			};
		}
	}

	private async generateGroundedCompanionReply(input: {
		traceId: string;
		delegationRecord: DelegatedExecutionRecord;
		fallbackText: string;
		postActionObservation: {
			promptContext: string;
			latestTimestamp: number;
			changedObservation: boolean;
			timedOut: boolean;
		};
	}): Promise<{ text: string; source: "llm" | "fallback" }> {
		const previousSameGameRecord = this.delegationMemory.getState().recentRecords.find((record) => (
			record.sourceGame === input.delegationRecord.sourceGame && record.id !== input.delegationRecord.id
		)) ?? null;
		try {
			const reply = await this.llm.generateCompanionReply(
				[
					"你刚刚完成了一轮游戏托管动作。请基于最近托管执行记录，生成一句到两句简短、口语化、适合 TTS 播报的中文陪伴回复。",
					"要求：",
					"1. 严格依据最近托管执行记录，不要脑补未给出的 Boss 战、血量、奖励或别的游戏剧情。",
					"2. 语气保持陪伴感和轻度支持感，但不要夸张。",
					"3. 不要暴露实现细节，如 API、模型、截图链路。",
					"4. 优先以【本轮验证事实】为准，再参考动作后观察和上一轮记录；不要让旧 summary 覆盖本轮结果。",
					"5. 只有当本轮 verification 未确认变化，并且动作后观察也没有支持变化时，才能说“没有明显进展”“撞墙”或类似结论。",
					"6. 如果本轮 verification 已确认局面变化，就不能再说“这轮没有推进”；要区分这轮是明确推进、走位/开路，还是已确认变化但细节仍在解析。",
					"7. 动态棋盘类游戏必须以动作后的新观察为准；如果你只知道棋盘确实变化了，但还不能确认新的具体格子值或合并结果，就明确说状态还在解析，不要编造一个错误的新盘面。",
					"8. 推箱子类反馈必须具体说明玩家位置、靠近/影响到的箱子、阻塞点，以及为什么下一步方向有用；不要只说“可以继续移动”。",
					"9. 连续托管时必须承接上一轮结果：说明这轮是在延续上一次的推进，还是因为刚才无进展所以换了个思路。",
					"10. 不要把回复写成重新播报当前画面；避免模板化开头，尤其不要反复以“派蒙看到你在……”开头。",
					"11. 如果本轮 verification 没有确认变化，且你拿不准方位关系，不要断言“右侧/左侧被箱子挡住”等具体阻塞位；可以保守说“局面受阻、阻塞点待确认”。",
					"12. 托管叙述必须使用第一人称执行视角（如“我这轮… / 我刚刚…”），不要写成“你这轮… / 我看到你…”。",
					"13. 若有上一轮记录，优先自然体现承接关系，但避免每轮都用同一句固定开头（例如不要反复说“接着上一轮/借着上一轮”）。",
					`【动作后观察状态】${describePostObservation(input.postActionObservation)}`,
					`【本轮验证事实】\n${buildCurrentTurnFacts(input.delegationRecord, input.postActionObservation).join("\n")}`,
					previousSameGameRecord
						? `【上一轮对照】\n${buildContinuityFacts(input.delegationRecord, previousSameGameRecord).join("\n")}`
						: "",
					input.postActionObservation.promptContext
						? `【动作后观察】\n${truncateObservationContext(input.postActionObservation.promptContext, 900)}`
						: "",
					`【记录引用】${input.delegationRecord.id}`,
				].filter(Boolean).join("\n"),
				{
					knowledgeContext: "",
					delegationMemoryContext: this.delegationMemory.buildFocusedPromptContext({
						currentRecordId: input.delegationRecord.id,
						sourceGame: input.delegationRecord.sourceGame,
					}),
					traceId: input.traceId,
				},
			);
			if (!reply) {
				return { text: input.fallbackText, source: "fallback" };
			}
			const sanitizedReply = sanitizeGroundedReply(
				reply,
				input.delegationRecord,
				input.postActionObservation,
				previousSameGameRecord,
			);
			return { text: sanitizedReply || input.fallbackText, source: "llm" };
		} catch (err) {
			log.warn("grounded companion reply generation failed", err);
			return { text: input.fallbackText, source: "fallback" };
		}
	}

}

function extractNextStepHint(reflection: string, reasoning: string, selectedAction: string | null): string | null {
	const candidate = [reflection, reasoning, selectedAction ?? ""]
		.map((value) => value.trim())
		.find(Boolean);
	if (!candidate) {
		return null;
	}
	return candidate.length <= 120 ? candidate : `${candidate.slice(0, 119)}…`;
}

function resolvePostObservationStatus(input: {
	promptContext: string;
	changedObservation: boolean;
	timedOut: boolean;
}): "fresh-changed" | "fresh-ambiguous" | "timeout" {
	if (input.timedOut) {
		return "timeout";
	}
	return input.changedObservation ? "fresh-changed" : "fresh-ambiguous";
}

function truncateObservationContext(value: string, limit = 400): string | null {
	const trimmed = value.trim();
	if (!trimmed) {
		return null;
	}
	if (trimmed.length <= limit) {
		return trimmed;
	}
	return `${trimmed.slice(0, limit - 1)}…`;
}

function describePostObservation(input: {
	changedObservation: boolean;
	timedOut: boolean;
	promptContext: string;
}): string {
	if (input.timedOut) {
		return "timed-out";
	}
	if (input.changedObservation) {
		return "fresh-changed";
	}
	if (input.promptContext.trim()) {
		return "fresh-but-ambiguous";
	}
	return "no-post-action-observation";
}

function describeSokobanChangeType(type: SokobanChangeType): string {
	switch (type) {
		case "push_box":
			return "push_box（已发生推箱）";
		case "open_path":
			return "open_path（开路/改善通路）";
		case "reposition":
			return "reposition（走位/调整站位）";
		case "no_progress":
		default:
			return "no_progress（未确认推进）";
	}
}

function inferSokobanChangeType(input: {
	boardChanged: boolean;
	executedMoves: string[];
	decisionSummary: string;
	reflection: string;
	reasoning: string;
	executionSummary: string;
	postActionObservationSummary: string | null;
}): SokobanChangeType {
	if (!input.boardChanged) {
		return "no_progress";
	}

	const evidence = [
		input.decisionSummary,
		input.reflection,
		input.reasoning,
		input.executionSummary,
		input.postActionObservationSummary ?? "",
	].join("\n").toLowerCase();

	if (/(push|pushed|push box|pushing|推箱|推动|箱子被推|推了一格)/i.test(evidence)) {
		return "push_box";
	}
	if (/(open path|open route|clear path|corridor|route|开路|让路|通道|走廊|绕开|腾挪)/i.test(evidence)) {
		return "open_path";
	}
	if (input.executedMoves.length >= 2) {
		return "open_path";
	}
	return "reposition";
}

function sanitizeGroundedReply(
	text: string,
	record: DelegatedExecutionRecord,
	postActionObservation: {
		promptContext: string;
		changedObservation: boolean;
		timedOut: boolean;
	},
	previousRecord: DelegatedExecutionRecord | null,
): string {
	let normalized = text.trim();
	if (!normalized) {
		return "";
	}

	if (record.verificationResult.boardChanged) {
		normalized = normalized.replace(
			/没有明显进展|没有推进|没推进|局面依然停滞|局面停滞|撞墙/g,
			"这轮已经确认有变化",
		);
	}

	if (record.sourceGame === "sokoban") {
		if (record.verificationResult.boardChanged) {
			normalized = normalized.replace(
				/还没办法推动箱子|无法推动箱子|没办法推动箱子|还不能推动箱子|不能推动箱子|没推动箱子/g,
				"这轮已经确认有变化，推箱细节还在继续确认",
			);
		} else if (!postActionObservation.timedOut && postActionObservation.changedObservation) {
			normalized = normalized.replace(
				/(左侧|右侧|左边|右边|上方|下方|前方|后方)[^，。；！？]{0,20}(箱子|墙)[^，。；！？]{0,20}(挡住|被挡|受阻|阻挡)/g,
				"局面受阻，具体阻塞位置还在确认",
			);
		}
	}

	if (record.mode === "delegated") {
		normalized = normalizeDelegatedPerspective(normalized);
		normalized = diversifyFixedContinuityLead(normalized, record, previousRecord);
		if (previousRecord && !hasContinuityCue(normalized)) {
			const lead = buildContinuityLeadForReply(record, previousRecord);
			normalized = `${lead}${normalized}`;
		}
		normalized = avoidRepeatedDelegatedNarration(normalized, record, previousRecord);
	}

	return normalized.replace(/([。！？])\1+/g, "$1").trim();
}

function normalizeDelegatedPerspective(text: string): string {
	return [
		[/派蒙看到你/g, "我"],
		[/我看到你这一轮/g, "我这轮"],
		[/我看到你这轮/g, "我这轮"],
		[/我看到你刚刚/g, "我刚刚"],
		[/我看到你上一步/g, "我上一步"],
		[/我看到你这一步/g, "我这一步"],
		[/这一轮你/g, "我这轮"],
		[/这轮你/g, "我这轮"],
		[/你这一轮/g, "我这轮"],
		[/你这轮/g, "我这轮"],
		[/你刚刚/g, "我刚刚"],
		[/你上一步/g, "我上一步"],
		[/你这一步/g, "我这一步"],
		[/你成功/g, "我成功"],
		[/你已经/g, "我已经"],
		[/你先/g, "我先"],
		[/你又/g, "我又"],
		[/你继续/g, "我继续"],
		[/你改成/g, "我改成"],
		[/你换成/g, "我换成"],
		[/你尝试/g, "我尝试"],
		[/你试着/g, "我试着"],
		[/你推动/g, "我推动"],
		[/你推了/g, "我推了"],
		[/你移动/g, "我移动"],
	].reduce((output, [pattern, replacement]) => output.replace(pattern as RegExp, replacement as string), text);
}

function hasContinuityCue(text: string): boolean {
	return /(上一轮|这轮|这一步|刚才|接着|继续|随后|换了|改成|承接|延续|相比上一轮)/.test(text);
}

function diversifyFixedContinuityLead(
	text: string,
	currentRecord: DelegatedExecutionRecord,
	previousRecord: DelegatedExecutionRecord | null,
): string {
	if (!previousRecord) {
		return text;
	}
	if (!/^(接着|借着)上一轮[，,、：:\s]*/.test(text)) {
		return text;
	}
	const dynamicLead = buildContinuityLeadForReply(currentRecord, previousRecord);
	return text.replace(/^(接着|借着)上一轮[，,、：:\s]*/, dynamicLead);
}

function buildContinuityLeadForReply(
	currentRecord: DelegatedExecutionRecord,
	previousRecord: DelegatedExecutionRecord,
): string {
	if (previousRecord.verificationResult.boardChanged && currentRecord.verificationResult.boardChanged) {
		return pickContinuityLead(
			[
				"我沿着刚才的推进继续试了下，",
				"上一轮已经推进，这轮我继续往前试一步，",
				"我延续上一轮的路数，再推进一格，",
			],
			currentRecord.id,
		);
	}
	if (!previousRecord.verificationResult.boardChanged && currentRecord.verificationResult.boardChanged) {
		return pickContinuityLead(
			[
				"上一轮没推进，这轮我换了个方向后，",
				"刚才那步没打开局面，我这轮改路后，",
				"上一轮受阻，所以我这轮换线尝试后，",
			],
			currentRecord.id,
		);
	}
	if (previousRecord.verificationResult.boardChanged && !currentRecord.verificationResult.boardChanged) {
		return pickContinuityLead(
			[
				"我本来想延续刚才的推进，但这轮",
				"上一轮有进展，这轮我继续同一路线时",
				"我照着上一轮的节奏继续试，结果这轮",
			],
			currentRecord.id,
		);
	}
	return pickContinuityLead(
		[
			"前两轮都没打开局面，我这轮继续换思路试探，",
			"我这轮延续试探，但换了个角度，",
			"这轮我继续调整策略试探，",
		],
		currentRecord.id,
	);
}

function pickContinuityLead(options: string[], seed: string): string {
	if (!options.length) {
		return "";
	}
	let hash = 0;
	for (let i = 0; i < seed.length; i += 1) {
		hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
	}
	return options[hash % options.length] ?? options[0];
}

function avoidRepeatedDelegatedNarration(
	text: string,
	record: DelegatedExecutionRecord,
	previousRecord: DelegatedExecutionRecord | null,
): string {
	const previousReply = previousRecord?.followUpSummary?.trim() ?? "";
	if (!previousRecord || !previousReply) {
		return text;
	}
	const normalizedCurrent = normalizeReplyForRepeatCheck(text);
	const normalizedPrevious = normalizeReplyForRepeatCheck(previousReply);
	if (!normalizedCurrent || !normalizedPrevious) {
		return text;
	}
	const isNearDuplicate = normalizedCurrent === normalizedPrevious
		|| normalizedCurrent.includes(normalizedPrevious)
		|| normalizedPrevious.includes(normalizedCurrent);
	if (!isNearDuplicate) {
		return text;
	}
	return buildNonRepeatingDelegatedReply(record, previousRecord);
}

function normalizeReplyForRepeatCheck(text: string): string {
	return text
		.toLowerCase()
		.replace(/[\s，。！？!?,、；;:“”"'`（）()【】\[\]-]/g, "")
		.replace(/喵/g, "")
		.trim();
}

function buildNonRepeatingDelegatedReply(
	record: DelegatedExecutionRecord,
	previousRecord: DelegatedExecutionRecord,
): string {
	const lead = buildContinuityLeadForReply(record, previousRecord);
	if (record.sourceGame === "sokoban") {
		if (record.verificationResult.boardChanged) {
			const body = pickContinuityLead(
				[
					"这轮我确认把局面推进了一点，下一步我会继续沿着这条线找稳定推箱位喵。",
					"我这轮已经把局面往前拱开了，下一步会顺着这个开口继续推进喵。",
					"这一步已经确认有效，我会接着用同一节奏继续推进下一步喵。",
				],
				`sokoban-success-${record.id}`,
			);
			return `${lead}${body}`;
		}
		const body = pickContinuityLead(
			[
				"我还没确认到有效推进，下一步会换个角度再试一次喵。",
				"我这步没拿到明确进展，下一步改走另一条线继续试探喵。",
				"这一步还不够理想，我会调整站位后再推进喵。",
			],
			`sokoban-failed-${record.id}`,
		);
		return `${lead}${body}`;
	}
	if (record.verificationResult.boardChanged) {
		const body = pickContinuityLead(
			[
				"这轮棋盘已经确认有变化，我会顺着这个变化继续找更稳的合并喵。",
				"我这一步已经让棋盘动起来了，下一步继续围绕主方向做合并喵。",
				"这一轮确认推进成功，接下来我会延续当前节奏继续操作喵。",
			],
			`2048-success-${record.id}`,
		);
		return `${lead}${body}`;
	}
	const body = pickContinuityLead(
		[
			"我这轮没确认到有效推进，下一步会换方向再试喵。",
			"我这步没有拿到理想变化，接下来改路线继续找机会喵。",
			"这一步推进不明显，我会调整策略后再走一步喵。",
		],
		`2048-failed-${record.id}`,
	);
	return `${lead}${body}`;
}

function buildCurrentTurnFacts(
	record: DelegatedExecutionRecord,
	postActionObservation: {
		promptContext: string;
		changedObservation: boolean;
		timedOut: boolean;
	},
): string[] {
	const lines: string[] = [
		`- 游戏：${record.sourceGame ?? "none"}`,
		`- 计划动作：${record.plannedActions.length ? record.plannedActions.join(" -> ") : "none"}`,
		`- 实际尝试：${record.attemptedActions.length ? record.attemptedActions.join(" -> ") : "none"}`,
		`- verification：${record.verificationResult.success ? "已确认局面变化" : "未确认局面变化"}`,
	];
	if (record.sourceGame === "sokoban") {
		lines.push(`- 变化类型：${describeSokobanChangeType(record.sokobanChangeType ?? "no_progress")}`);
	}

	if (record.verificationResult.error) {
		lines.push(`- 错误：${record.verificationResult.error}`);
	}

	if (record.verificationResult.boardChanged) {
		lines.push("- 这轮至少发生了真实变化，不能把它说成“完全没有推进”。");
		if (record.sourceGame === "2048") {
			lines.push("- 2048 若新盘面细节仍不清楚，只能承认棋盘变化与解析歧义，不能编造新的格值或合并结果。");
		}
		if (record.sourceGame === "sokoban") {
			lines.push("- Sokoban 本轮已确认有变化：禁止输出“没有推进”“局面停滞”“撞墙”。");
			lines.push("- Sokoban verification 一旦确认变化，不要再说“还没办法推动箱子/无法推动箱子”。若推箱细节不确定，只能说“这轮已有变化，推箱细节待继续确认”。");
			lines.push("- 若这轮更像 reposition 或开路，要明确说是走位/开路，不要硬编具体方位阻塞。");
		}
	} else {
		lines.push("- 只有当动作后观察也没有支持变化时，才可以说“没有推进”或“撞墙”。");
		if (record.sourceGame === "sokoban") {
			lines.push("- Sokoban 若 verification 未确认变化，且你拿不准方向，不要断言“右侧/左侧被箱子挡住”等具体阻塞位；应改成“局面受阻，阻塞点待确认”。");
		}
	}

	if (postActionObservation.timedOut) {
		lines.push("- 动作后观察等待超时：不能把动作前旧画面当作本轮结果。");
	} else if (postActionObservation.changedObservation) {
		lines.push("- 动作后观察已检测到新变化：优先据此说明这轮结果。");
	} else if (postActionObservation.promptContext.trim()) {
		lines.push("- 动作后观察有新内容但细节仍有歧义：可以承认变化有限或细节仍在解析，但不要编造。");
	} else {
		lines.push("- 动作后没有拿到新的可用观察：描述要保守。");
	}

	return lines;
}

function buildContinuityFacts(
	currentRecord: DelegatedExecutionRecord,
	previousRecord: DelegatedExecutionRecord,
): string[] {
	const lines: string[] = [
		`- 上一轮 verification：${previousRecord.verificationResult.success ? "已确认变化" : "未确认变化"}`,
		previousRecord.nextStepHint ? `- 上一轮下一步线索：${previousRecord.nextStepHint}` : "- 上一轮下一步线索：无",
	];

	if (previousRecord.verificationResult.boardChanged && currentRecord.verificationResult.boardChanged) {
		lines.push("- 这轮属于延续上一轮的推进，要说清推进是继续扩大、重排，还是只是局部调整。");
	} else if (!previousRecord.verificationResult.boardChanged && currentRecord.verificationResult.boardChanged) {
		lines.push("- 这轮相对上一轮有改进：要点出这轮为什么比上一轮更有效。");
	} else if (previousRecord.verificationResult.boardChanged && !currentRecord.verificationResult.boardChanged) {
		lines.push("- 上一轮有推进，这一轮没延续成功：要说明是在试探另一侧、被阻塞，还是路线没接上。");
	} else {
		lines.push("- 连续两轮都没有确认推进：要明确说在换思路，而不是重复旁白。");
	}

	return lines;
}

function resolveUnifiedEmotion(value: string): "neutral" | "happy" | "angry" | "sad" | "delighted" | "alarmed" | "dazed" {
	switch (value) {
		case "happy":
		case "angry":
		case "sad":
		case "delighted":
		case "alarmed":
		case "dazed":
		case "neutral":
			return value;
		default:
			return "neutral";
	}
}

function summarizeDelegationFailureReason(rawSummary: string): string {
	const summary = rawSummary.trim().replace(/\s+/g, " ");
	if (!summary) {
		return "托管已停止：这轮没有形成有效推进，派蒙建议先确认窗口与定位状态。";
	}
	if (/达到最大轮次/i.test(summary)) {
		return `托管已停止：${summary} 派蒙建议先检查定位结果，再继续执行。`;
	}
	return `托管已停止：${summary}`;
}

function inferVoiceCommand(text: string): UnifiedVoiceCommand {
	const normalized = text.trim();
	if (!normalized) return null;
	if (VOICE_GAME_ANALYZE_COMMAND_RE.test(normalized)) {
		return "game-analyze";
	}
	return null;
}

function inferGameFromText(text: string | null): SupportedUnifiedGameId | null {
	const normalized = (text ?? "").trim().toLowerCase();
	if (!normalized) return null;
	if (/(2048|tile|合并|棋盘)/i.test(normalized)) {
		return "2048";
	}
	if (/(sokoban|push box|boxoban|推箱子|仓库番)/i.test(normalized)) {
		return "sokoban";
	}
	return null;
}

function isLikelyEnglishTask(text: string): boolean {
	const trimmed = text.trim();
	if (!trimmed) {
		return false;
	}
	const latinMatches = trimmed.match(/[A-Za-z]/g)?.length ?? 0;
	const cjkMatches = trimmed.match(/[\u4E00-\u9FFF]/g)?.length ?? 0;
	return latinMatches > 0 && latinMatches >= cjkMatches * 2;
}

/**
 * Extract entity-like nouns from task text + summary for delegation writeback.
 * Simple heuristic: URLs → domain, quoted strings, capitalized words, CJK proper nouns.
 */
function extractEntitiesFromText(text: string): string[] {
	const entities = new Set<string>();

	const urls = text.match(/https?:\/\/[^\s,，]+/g);
	if (urls) {
		for (const u of urls) {
			try {
				entities.add(new URL(u).hostname.replace(/^www\./, ""));
			} catch {
				entities.add(u.slice(0, 30));
			}
		}
	}

	const quoted = text.match(/[""「」『』]([^""「」『』]{1,20})[""「」『』]/g);
	if (quoted) {
		for (const q of quoted) {
			entities.add(q.replace(/[""「」『』]/g, ""));
		}
	}

	const capitalized = text.match(/\b[A-Z][a-z]{2,}\b/g);
	if (capitalized) {
		for (const c of capitalized) {
			if (!["The", "This", "That", "For", "And", "But"].includes(c)) {
				entities.add(c);
			}
		}
	}

	return [...entities].slice(0, 8);
}
