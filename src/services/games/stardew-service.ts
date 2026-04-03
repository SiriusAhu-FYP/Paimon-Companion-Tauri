import type { EventBus } from "@/services/event-bus";
import type { OrchestratorService } from "@/services/orchestrator";
import { getConfig, proxyRequest, SECRET_KEYS } from "@/services/config";
import { createLogger } from "@/services/logger";
import { listWindows } from "@/services/system";
import type {
	FunctionalTarget,
	StardewActionKey,
	StardewAnalysis,
	StardewAttemptRecord,
	StardewRunRecord,
	StardewState,
	StardewTaskId,
} from "@/types";
import {
	chooseWindowByKeywords,
	ensureReferenceSnapshot,
	estimateSnapshotChange,
	normalizeCompatibleOpenAIBaseUrl,
} from "./game-utils";
import { getStardewTaskDefinitions, getStardewTaskTemplate } from "./stardew-task-templates";
import { cloneTemplateAnalysis, parseVisionTemplateResponse } from "./task-templates";

const log = createLogger("stardew");
const MAX_HISTORY = 10;
const TARGET_KEYWORDS = ["stardew valley", "stardew"];

interface VisionCompletionResponse {
	choices?: Array<{
		message?: {
			content?: string | Array<{ type?: string; text?: string }>;
		};
	}>;
}

function makeInitialState(): StardewState {
	return {
		activeRunId: null,
		availableTasks: getStardewTaskDefinitions(),
		lastRun: null,
		history: [],
		detectedTarget: null,
		detectionSummary: null,
		selectedTaskId: "reposition",
	};
}

export class StardewService {
	private bus: EventBus;
	private orchestrator: OrchestratorService;
	private state: StardewState = makeInitialState();

	constructor(deps: { bus: EventBus; orchestrator: OrchestratorService }) {
		this.bus = deps.bus;
		this.orchestrator = deps.orchestrator;
	}

	getState(): Readonly<StardewState> {
		return {
			...this.state,
			availableTasks: this.state.availableTasks.map((task) => ({ ...task })),
			lastRun: this.state.lastRun ? cloneRun(this.state.lastRun) : null,
			history: this.state.history.map(cloneRun),
			detectedTarget: this.state.detectedTarget ? { ...this.state.detectedTarget } : null,
		};
	}

	setSelectedTask(taskId: StardewTaskId) {
		this.state.selectedTaskId = taskId;
		this.emitState();
	}

	async detectTargetWindow(): Promise<FunctionalTarget | null> {
		const windows = await listWindows();
		const candidate = chooseWindowByKeywords(windows, {
			keywords: TARGET_KEYWORDS,
			processKeywords: ["steam"],
		});
		const summary = candidate
			? `detected Stardew target: ${candidate.title}`
			: "no Stardew Valley-like window title found";

		this.state.detectedTarget = candidate ? { handle: candidate.handle, title: candidate.title } : null;
		this.state.detectionSummary = summary;
		if (candidate) {
			this.orchestrator.setTarget(this.state.detectedTarget);
		}

		this.bus.emit("stardew:target-detected", {
			handle: candidate?.handle ?? null,
			title: candidate?.title ?? null,
			summary,
		});
		this.emitState();

		return this.state.detectedTarget ? { ...this.state.detectedTarget } : null;
	}

	async runTask(taskId?: StardewTaskId, targetOverride?: FunctionalTarget): Promise<StardewRunRecord> {
		const resolvedTaskId = taskId ?? this.state.selectedTaskId;
		const taskTemplate = getStardewTaskTemplate(resolvedTaskId);
		let target = targetOverride ?? this.orchestrator.getState().selectedTarget;
		if (!target) {
			target = await this.detectTargetWindow();
		}
		if (!target) {
			throw new Error("no target window selected and no Stardew target could be detected");
		}

		const baselineSnapshot = await ensureReferenceSnapshot(
			this.orchestrator,
			target,
			"unable to capture Stardew baseline snapshot",
		);
		const analysis = await this.buildAnalysis(taskTemplate, target, baselineSnapshot);
		const run: StardewRunRecord = {
			id: `stardew-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
			taskId: taskTemplate.id,
			status: "running",
			target: { ...target },
			startedAt: Date.now(),
			endedAt: null,
			analysis,
			attempts: [],
			selectedAction: null,
			boardChanged: false,
			summary: "",
			companionText: "",
			error: null,
		};

		this.state.activeRunId = run.id;
		this.state.lastRun = cloneRun(run);
		this.bus.emit("stardew:run-start", {
			runId: run.id,
			taskId: run.taskId,
			targetHandle: target.handle,
			targetTitle: target.title,
			preferredActions: [...analysis.preferredActions],
		});
		this.emitState();

		try {
			await this.orchestrator.runFocusTask(target);

			for (const action of analysis.preferredActions) {
				const task = await this.orchestrator.runSendKeyTask(action, target);
				const beforeSnapshot = task.beforeSnapshot ?? baselineSnapshot;
				const afterSnapshot = task.afterSnapshot;
				if (!afterSnapshot) {
					throw new Error(`missing post-action snapshot for ${action}`);
				}

				const attempt = await this.evaluateAttempt(taskTemplate.verificationThreshold, action, beforeSnapshot, afterSnapshot);
				run.attempts.push(attempt);
				this.bus.emit("stardew:attempt", {
					runId: run.id,
					action,
					changed: attempt.changed,
					changeRatio: attempt.changeRatio,
				});

				if (attempt.changed) {
					run.selectedAction = action;
					run.boardChanged = true;
					break;
				}
			}

			run.status = "completed";
			run.endedAt = Date.now();
			run.summary = buildRunSummary(run);
			run.companionText = buildCompanionText(run);
			log.info(run.summary, {
				taskId: run.taskId,
				selectedAction: run.selectedAction,
				analysisSource: run.analysis.source,
			});
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			run.status = "failed";
			run.endedAt = Date.now();
			run.error = message;
			run.summary = `Stardew task failed: ${message}`;
			run.companionText = "这次 Stardew 小任务没跑通，先检查目标窗口和当前游戏场景。";
			log.error("stardew task failed", err);
		}

		this.state.activeRunId = null;
		this.state.lastRun = cloneRun(run);
		this.state.history = [cloneRun(run), ...this.state.history].slice(0, MAX_HISTORY);
		this.bus.emit("stardew:run-complete", {
			runId: run.id,
			taskId: run.taskId,
			success: run.status === "completed" && run.boardChanged,
			selectedAction: run.selectedAction,
			boardChanged: run.boardChanged,
			summary: run.summary,
		});
		this.emitState();

		if (run.status === "failed") {
			throw new Error(run.error ?? run.summary);
		}

		return cloneRun(run);
	}

	private async buildAnalysis(
		taskTemplate: ReturnType<typeof getStardewTaskTemplate>,
		target: FunctionalTarget,
		snapshot: Awaited<ReturnType<typeof ensureReferenceSnapshot>>,
	): Promise<StardewAnalysis> {
		try {
			if (taskTemplate.analysisMode === "vision") {
				return await this.requestVisionAnalysis(taskTemplate, target, snapshot);
			}
			return cloneTemplateAnalysis(taskTemplate.analysis);
		} catch (err) {
			log.warn("stardew analysis unavailable, falling back", err);
			if (taskTemplate.analysisMode === "vision") {
				return cloneTemplateAnalysis(taskTemplate.fallbackAnalysis);
			}
			return cloneTemplateAnalysis(taskTemplate.analysis);
		}
	}

	private async requestVisionAnalysis(
		taskTemplate: Extract<ReturnType<typeof getStardewTaskTemplate>, { analysisMode: "vision" }>,
		target: FunctionalTarget,
		snapshot: Awaited<ReturnType<typeof ensureReferenceSnapshot>>,
	): Promise<StardewAnalysis> {
		// The functional loop is latency-bound, so game actions bypass the
		// general chat/retrieval stack and call the configured model directly.
		const config = getConfig();
		const activeProfile = config.activeLlmProfileId
			? config.llmProfiles.find((profile) => profile.id === config.activeLlmProfileId)
			: null;

		const provider = activeProfile?.provider ?? config.llm.provider;
		const rawBaseUrl = activeProfile?.baseUrl ?? config.llm.baseUrl;
		const model = activeProfile?.model ?? config.llm.model;
		const secretKey = activeProfile?.id ? SECRET_KEYS.LLM_API_KEY(activeProfile.id) : undefined;
		if (provider !== "openai-compatible" || !rawBaseUrl || !model) {
			throw new Error("stardew analysis requires an openai-compatible LLM profile");
		}

		const response = await proxyRequest({
			url: `${normalizeCompatibleOpenAIBaseUrl(rawBaseUrl)}/chat/completions`,
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				model,
				temperature: 0.1,
				max_tokens: 220,
				response_format: { type: "json_object" },
				messages: [{
					role: "user",
					content: [
						{ type: "text", text: taskTemplate.buildVisionPrompt(target.title, snapshot) },
						{ type: "image_url", image_url: { url: snapshot.dataUrl } },
					],
				}],
			}),
			secretKey,
			timeoutMs: 30000,
		});

		if (response.status < 200 || response.status >= 300) {
			throw new Error(`stardew analysis failed with HTTP ${response.status}`);
		}

		const payload = JSON.parse(response.body) as VisionCompletionResponse;
		const rawContent = payload.choices?.[0]?.message?.content;
		const textContent = Array.isArray(rawContent)
			? rawContent.map((part) => part.text ?? "").join("")
			: rawContent ?? "";
		return parseVisionTemplateResponse(textContent, taskTemplate.actionSpace, {
			strategy: "vision-guided Stardew movement selection",
			reasoning: "The model selected a movement probe from the screenshot.",
		});
	}

	private async evaluateAttempt(
		threshold: number,
		action: StardewActionKey,
		beforeSnapshot: Awaited<ReturnType<typeof ensureReferenceSnapshot>>,
		afterSnapshot: Awaited<ReturnType<typeof ensureReferenceSnapshot>>,
	): Promise<StardewAttemptRecord> {
		const changeRatio = await estimateSnapshotChange(beforeSnapshot, afterSnapshot);
		return {
			action,
			changed: changeRatio >= threshold,
			changeRatio,
		};
	}

	private emitState() {
		this.bus.emit("stardew:state-change", { state: this.getState() });
	}
}

function cloneRun(run: StardewRunRecord): StardewRunRecord {
	return {
		...run,
		target: { ...run.target },
		analysis: { ...run.analysis, preferredActions: [...run.analysis.preferredActions] },
		attempts: run.attempts.map((attempt) => ({ ...attempt })),
	};
}

function buildRunSummary(run: StardewRunRecord): string {
	if (run.boardChanged && run.selectedAction) {
		const successAttempt = run.attempts.find((attempt) => attempt.action === run.selectedAction);
		return `Stardew ${run.taskId} verified with ${run.selectedAction} (${formatPercent(successAttempt?.changeRatio ?? 0)}) via ${run.analysis.source}`;
	}
	return `Stardew ${run.taskId} found no verified screen change after ${run.attempts.length} attempt(s)`;
}

function buildCompanionText(run: StardewRunRecord): string {
	if (run.boardChanged && run.selectedAction) {
		return `我先判断了这次 Stardew 小任务应该怎么做，再用 ${run.selectedAction} 执行，并确认画面真的变化了。`;
	}
	return "这轮 Stardew 小任务没有得到足够明显的画面变化，可能需要换一个更明确的场景或重新聚焦游戏窗口。";
}

function formatPercent(value: number): string {
	return `${(value * 100).toFixed(1)}%`;
}
