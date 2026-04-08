import type { CharacterService } from "@/services/character";
import type { EventBus } from "@/services/event-bus";
import { findSemanticGameByTargetTitle } from "@/services/games/semantic-game-registry";
import type { Game2048Service, SokobanService } from "@/services/games";
import type { LLMService } from "@/services/llm";
import type { OrchestratorService } from "@/services/orchestrator";
import type { PipelineService } from "@/services/pipeline";
import type { RuntimeService } from "@/services/runtime";
import { createLogger } from "@/services/logger";
import type { UnifiedRunRecord, UnifiedRuntimeState } from "@/types";

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
	return { ...run };
}

const VOICE_GAME_STEP_COMMAND_RE = /(下一步|走一步|来一步|帮我看|帮我走|step|move)/i;

export class UnifiedRuntimeService {
	private bus: EventBus;
	private runtime: RuntimeService;
	private character: CharacterService;
	private orchestrator: OrchestratorService;
	private game2048: Game2048Service;
	private sokoban: SokobanService;
	private llm: LLMService;
	private pipeline: PipelineService;
	private state: UnifiedRuntimeState = makeInitialState();

	constructor(deps: {
		bus: EventBus;
		runtime: RuntimeService;
		character: CharacterService;
		orchestrator: OrchestratorService;
		game2048: Game2048Service;
		sokoban: SokobanService;
		llm: LLMService;
		pipeline: PipelineService;
	}) {
		this.bus = deps.bus;
		this.runtime = deps.runtime;
		this.character = deps.character;
		this.orchestrator = deps.orchestrator;
		this.game2048 = deps.game2048;
		this.sokoban = deps.sokoban;
		this.llm = deps.llm;
		this.pipeline = deps.pipeline;
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

	async runUnifiedGameStep(trigger: "manual" | "voice" = "manual", requestText: string | null = null): Promise<UnifiedRunRecord> {
		if (!this.runtime.isAllowed()) {
			throw new Error(`unified run blocked: runtime mode is ${this.runtime.getMode()}`);
		}
		const targetGame = this.resolveTargetGame(requestText);
		if (!targetGame) {
			throw new Error("unified run requires a selected 2048 or Sokoban target window");
		}

		const run: UnifiedRunRecord = {
			id: `unified-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
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
		};

		this.state.activeRunId = run.id;
		this.state.phase = "acting";
		this.state.lastCommand = `${targetGame}-step`;
		this.state.lastRun = cloneRun(run);
		this.applyEmotion("neutral");
		this.bus.emit("unified:run-start", {
			runId: run.id,
			trigger,
			requestText,
		});
		this.emitState();

		try {
			let companionText = "";
			if (targetGame === "2048") {
				const result = await this.game2048.runSingleStep();
				run.status = "completed";
				run.phase = this.state.speechEnabled ? "speaking" : "idle";
				run.summary = result.summary;
				run.selectedAction = result.selectedMove;
				run.emotion = result.boardChanged ? "happy" : "dazed";
				const generatedReply = await this.generateGroundedCompanionReply({
					gameId: "2048",
					requestText,
					summary: result.summary,
					analysisReflection: result.analysis.reflection,
					analysisReasoning: result.analysis.reasoning,
					primaryAction: result.selectedMove,
					boardChanged: result.boardChanged,
					fallbackText: result.companionText,
				});
				run.companionText = generatedReply.text;
				run.companionTextSource = generatedReply.source;
				companionText = generatedReply.text;
			} else {
				const result = await this.sokoban.runValidationRound();
				run.status = "completed";
				run.phase = this.state.speechEnabled ? "speaking" : "idle";
				run.summary = result.summary;
				run.selectedAction = result.executedMoves[0] ?? result.analysis.plannedMoves[0] ?? null;
				run.emotion = result.boardChanged ? "delighted" : "alarmed";
				const generatedReply = await this.generateGroundedCompanionReply({
					gameId: "sokoban",
					requestText,
					summary: result.summary,
					analysisReflection: result.analysis.reflection,
					analysisReasoning: result.analysis.reasoning,
					primaryAction: result.executedMoves[0] ?? result.analysis.plannedMoves[0] ?? null,
					boardChanged: result.boardChanged,
					fallbackText: result.companionText,
				});
				run.companionText = generatedReply.text;
				run.companionTextSource = generatedReply.source;
				companionText = generatedReply.text;
			}
			this.state.lastCompanionText = companionText;
			this.applyEmotion(run.emotion);

			if (this.state.speechEnabled && companionText) {
				this.state.phase = "speaking";
				this.emitState();
				run.spoke = await this.safeSpeak(companionText);
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
			this.applyEmotion(run.emotion);

			if (this.state.speechEnabled) {
				this.state.phase = "speaking";
				this.emitState();
				run.spoke = await this.safeSpeak(run.companionText);
			}
		}

		run.endedAt = Date.now();
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

		const command = VOICE_GAME_STEP_COMMAND_RE.test(trimmed) ? "game-step" : null;
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

		try {
			await this.pipeline.run(trimmed);
			this.state.phase = "idle";
		} catch (err) {
			this.state.phase = "failed";
			throw err;
		} finally {
			this.emitState();
		}
	}

	private applyEmotion(emotion: string) {
		this.character.setEmotion(emotion);
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

	private async generateGroundedCompanionReply(input: {
		gameId: SupportedUnifiedGameId;
		requestText: string | null;
		summary: string;
		analysisReflection: string;
		analysisReasoning: string;
		primaryAction: string | null;
		boardChanged: boolean;
		fallbackText: string;
	}): Promise<{ text: string; source: "llm" | "fallback" }> {
		try {
			const reply = await this.llm.generateCompanionReply(
				[
					"你刚刚完成了一轮游戏托管动作。请基于提供事实，生成一句到两句简短、口语化、适合 TTS 播报的中文陪伴回复。",
					"要求：",
					"1. 严格依据提供事实，不要脑补未给出的 Boss 战、血量、奖励或别的游戏剧情。",
					"2. 语气保持陪伴感和轻度支持感，但不要夸张。",
					"3. 不要暴露实现细节，如 API、模型、截图链路。",
					"4. 如果本轮没有明显进展，就直接说没有明显进展，并给出很短的下一步建议。",
					`【游戏】${input.gameId}`,
					input.requestText ? `【触发请求】${input.requestText}` : "",
					`【本轮结果】${input.summary}`,
					input.primaryAction ? `【关键动作】${input.primaryAction}` : "",
					`【是否观察到有效变化】${input.boardChanged ? "是" : "否"}`,
					`【决策反思】${input.analysisReflection}`,
					`【决策理由】${input.analysisReasoning}`,
				].filter(Boolean).join("\n"),
				{ knowledgeContext: "" },
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
