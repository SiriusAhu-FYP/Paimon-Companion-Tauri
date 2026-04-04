import type { CharacterService } from "@/services/character";
import type { EventBus } from "@/services/event-bus";
import type { Game2048Service } from "@/services/games";
import type { PipelineService } from "@/services/pipeline";
import type { RuntimeService } from "@/services/runtime";
import { createLogger } from "@/services/logger";
import type { UnifiedRunRecord, UnifiedRuntimeState } from "@/types";

const log = createLogger("unified-runtime");
const MAX_HISTORY = 10;

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

const VOICE_2048_COMMAND_RE = /(2048|下一步|走一步|来一步|帮我看|帮我走|step)/i;

export class UnifiedRuntimeService {
	private bus: EventBus;
	private runtime: RuntimeService;
	private character: CharacterService;
	private game2048: Game2048Service;
	private pipeline: PipelineService;
	private state: UnifiedRuntimeState = makeInitialState();

	constructor(deps: {
		bus: EventBus;
		runtime: RuntimeService;
		character: CharacterService;
		game2048: Game2048Service;
		pipeline: PipelineService;
	}) {
		this.bus = deps.bus;
		this.runtime = deps.runtime;
		this.character = deps.character;
		this.game2048 = deps.game2048;
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

	async run2048UnifiedStep(trigger: "manual" | "voice" = "manual", requestText: string | null = null): Promise<UnifiedRunRecord> {
		if (!this.runtime.isAllowed()) {
			throw new Error(`unified run blocked: runtime mode is ${this.runtime.getMode()}`);
		}

		const run: UnifiedRunRecord = {
			id: `unified-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
			trigger,
			requestText,
			startedAt: Date.now(),
			endedAt: null,
			status: "running",
			phase: "acting",
			summary: "",
			companionText: "",
			emotion: "neutral",
			selectedMove: null,
			spoke: false,
			error: null,
		};

		this.state.activeRunId = run.id;
		this.state.phase = "acting";
		this.state.lastCommand = "2048-step";
		this.state.lastRun = cloneRun(run);
		this.applyEmotion("surprised");
		this.bus.emit("unified:run-start", {
			runId: run.id,
			trigger,
			requestText,
		});
		this.emitState();

		try {
			const result = await this.game2048.runSingleStep();
			run.status = "completed";
			run.phase = this.state.speechEnabled ? "speaking" : "idle";
			run.summary = result.summary;
			run.companionText = result.companionText;
			run.selectedMove = result.selectedMove;
			run.emotion = result.boardChanged ? "happy" : "surprised";
			this.state.lastCompanionText = result.companionText;
			this.applyEmotion(run.emotion);

			if (this.state.speechEnabled && result.companionText) {
				this.state.phase = "speaking";
				this.emitState();
				run.spoke = await this.safeSpeak(result.companionText);
			}
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			run.status = "failed";
			run.phase = "failed";
			run.error = message;
			run.summary = `unified run failed: ${message}`;
			run.companionText = "这轮统一运行没成功，我先停下来，等你检查目标窗口或当前画面。";
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

		const command = VOICE_2048_COMMAND_RE.test(trimmed) ? "2048-step" : null;
		this.state.phase = "listening";
		this.state.lastVoiceInput = trimmed;
		this.state.lastCommand = command;
		this.bus.emit("audio:asr-result", { text: trimmed, source: "voice" });
		this.bus.emit("unified:voice-input", { text: trimmed, command });
		this.emitState();

		if (command === "2048-step") {
			await this.run2048UnifiedStep("voice", trimmed);
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
}
