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
import { createLogger } from "@/services/logger";
import type { DelegatedExecutionRecord, UnifiedRunRecord, UnifiedRuntimeState } from "@/types";
import { callLocalMcpTool } from "@/services/mcp/local-mcp-client";

const log = createLogger("unified-runtime");
const MAX_HISTORY = 10;

type SupportedUnifiedGameId = "2048" | "sokoban";

function makeInitialState(): UnifiedRuntimeState {
	return {
		speechEnabled: true,
		voiceInputEnabled: true,
		activeRunId: null,
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

type UnifiedVoiceCommand = "game-step" | "game-analyze" | null;

const VOICE_GAME_STEP_COMMAND_RE = /(走一步|来一步|帮我走|替我走|执行下一步|执行一步|step|move)/i;
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
	private state: UnifiedRuntimeState = makeInitialState();

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

	async runUnifiedGameStep(
		trigger: "manual" | "voice" = "manual",
		requestText: string | null = null,
		options?: { traceId?: string },
	): Promise<UnifiedRunRecord> {
		if (!this.runtime.isAllowed()) {
			throw new Error(`unified run blocked: runtime mode is ${this.runtime.getMode()}`);
		}
		const targetGame = this.resolveTargetGame(requestText);
		if (!targetGame) {
			throw new Error("unified run requires a selected 2048 or Sokoban target window");
		}

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
		};

		this.state.activeRunId = run.id;
		this.state.phase = "acting";
		this.state.lastCommand = `${targetGame}-step`;
		this.state.lastRun = cloneRun(run);
		this.companionMode.setMode("delegated", "unified:run-start", "system");
		await this.applyEmotion("neutral", run.id);
		this.bus.emit("unified:run-start", {
			runId: run.id,
			trigger,
			requestText,
			traceId: run.id,
		});
		this.emitState();

		try {
			let companionText = "";
			let delegatedRecord: DelegatedExecutionRecord | null = null;
			if (targetGame === "2048") {
				const actionStartedAt = Date.now();
				const result = await this.game2048.runSingleStep(undefined, { traceId: run.id });
				run.timings.actionMs = Date.now() - actionStartedAt;
				run.timings.runtimeRefreshMs = await this.refreshCompanionContextForTarget(result.target);
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
					decisionSummary: result.analysis.plannerSummary ?? result.analysis.strategy,
					plannedActions: [...result.analysis.preferredMoves],
					attemptedActions: result.attempts.map((attempt) => attempt.move),
					selectedAction: result.selectedMove,
					executionSummary: result.summary,
					verificationResult: {
						success: result.boardChanged,
						boardChanged: result.boardChanged,
						error: null,
					},
					followUpSummary: "",
					emotion: run.emotion,
					nextStepHint: extractNextStepHint(result.analysis.reflection, result.analysis.reasoning, result.selectedMove),
					traceId: run.id,
				});
				const llmReplyStartedAt = Date.now();
				const generatedReply = await this.generateGroundedCompanionReply({
					traceId: run.id,
					delegationRecord: delegatedRecord,
					fallbackText: result.companionText,
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
				run.timings.runtimeRefreshMs = await this.refreshCompanionContextForTarget(result.target);
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
					decisionSummary: result.analysis.solverSummary ?? result.analysis.strategy,
					plannedActions: [...result.analysis.plannedMoves],
					attemptedActions: result.attempts.map((attempt) => attempt.move),
					selectedAction: result.executedMoves[0] ?? result.analysis.plannedMoves[0] ?? null,
					executionSummary: result.summary,
					verificationResult: {
						success: result.boardChanged,
						boardChanged: result.boardChanged,
						error: null,
					},
					followUpSummary: "",
					emotion: run.emotion,
					nextStepHint: extractNextStepHint(
						result.analysis.reflection,
						result.analysis.reasoning,
						result.executedMoves[0] ?? result.analysis.plannedMoves[0] ?? null,
					),
					traceId: run.id,
				});
				const llmReplyStartedAt = Date.now();
				const generatedReply = await this.generateGroundedCompanionReply({
					traceId: run.id,
					delegationRecord: delegatedRecord,
					fallbackText: result.companionText,
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
			await this.applyEmotion(run.emotion, run.id);
			const beforeSpeechAt = Date.now();
			run.timings.totalNonBlockingMs = Math.max(0, beforeSpeechAt - run.startedAt);

			if (this.state.speechEnabled && companionText) {
				this.state.phase = "speaking";
				this.emitState();
				const speechStartedAt = Date.now();
				run.spoke = await this.safeSpeak(companionText);
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
			this.delegationMemory.appendRecord({
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
				run.spoke = await this.safeSpeak(run.companionText);
				run.timings.speechMs = Date.now() - speechStartedAt;
			}
		}

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
		this.companionMode.setMode(this.companionMode.getPreferredMode(), "unified:run-complete", "system");
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

		if (command === "game-step") {
			await this.runUnifiedGameStep("voice", trimmed);
			return;
		}
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

	private async safeSpeak(text: string): Promise<boolean> {
		try {
			await this.pipeline.speakText(text);
			return true;
		} catch (err) {
			log.warn("unified speech failed", err);
			return false;
		}
	}

	private emitState() {
		this.bus.emit("unified:state-change", { state: this.getState() });
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
			await this.applyEmotion("neutral");
			if (this.state.speechEnabled) {
				this.state.phase = "speaking";
				this.emitState();
				await this.safeSpeak(finalReply);
			}
			this.state.phase = "idle";
		} catch (err) {
			this.state.phase = "failed";
			throw err;
		} finally {
			this.emitState();
		}
	}

	private async refreshCompanionContextForTarget(target: { handle: string; title: string }): Promise<number> {
		const runtimeState = this.companionRuntime.getState();
		if (!runtimeState.running) return 0;
		if (runtimeState.target?.handle !== target.handle) return 0;
		const hasSummary = Boolean(runtimeState.lastSummary);
		const summaryStale = hasSummary
			? (Date.now() - (runtimeState.lastSummary?.createdAt ?? 0)) > runtimeState.summaryWindowMs
			: false;
		const startedAt = Date.now();
		try {
			// Keep per-round refresh latency stable: only block for summary generation when there is
			// no summary at all yet; stale-summary refresh is done in background.
			await this.companionRuntime.refreshNow({ summarize: !hasSummary });
			if (summaryStale) {
				void this.companionRuntime.runSummaryNow().catch((err) => {
					log.warn("background companion summary refresh failed", err);
				});
			}
		} catch (err) {
			log.warn("companion context refresh after unified run failed", err);
		}
		return Date.now() - startedAt;
	}

	private async generateGroundedCompanionReply(input: {
		traceId: string;
		delegationRecord: DelegatedExecutionRecord;
		fallbackText: string;
	}): Promise<{ text: string; source: "llm" | "fallback" }> {
		try {
			const reply = await this.llm.generateCompanionReply(
				[
					"你刚刚完成了一轮游戏托管动作。请基于最近托管执行记录，生成一句到两句简短、口语化、适合 TTS 播报的中文陪伴回复。",
					"要求：",
					"1. 严格依据最近托管执行记录，不要脑补未给出的 Boss 战、血量、奖励或别的游戏剧情。",
					"2. 语气保持陪伴感和轻度支持感，但不要夸张。",
					"3. 不要暴露实现细节，如 API、模型、截图链路。",
					"4. 如果本轮没有明显进展，就直接说没有明显进展，并给出很短的下一步建议。",
					"5. 优先使用本轮验证结果、同游戏最近成功记录和最近下一步提示，不要只复述笼统结果。",
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
			return { text: reply, source: "llm" };
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

function inferVoiceCommand(text: string): UnifiedVoiceCommand {
	const normalized = text.trim();
	if (!normalized) return null;
	if (VOICE_GAME_STEP_COMMAND_RE.test(normalized)) {
		return "game-step";
	}
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
