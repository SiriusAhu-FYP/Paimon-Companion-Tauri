import type { EventBus } from "@/services/event-bus";
import type { OrchestratorService } from "@/services/orchestrator";
import { getConfig, proxyRequest, SECRET_KEYS } from "@/services/config";
import { createLogger } from "@/services/logger";
import { listWindows } from "@/services/system";
import type {
	FunctionalTarget,
	HostWindowInfo,
	PerceptionSnapshot,
	StardewActionKey,
	StardewAnalysis,
	StardewAttemptRecord,
	StardewRunRecord,
	StardewState,
	StardewTaskDefinition,
	StardewTaskId,
} from "@/types";

const log = createLogger("stardew");
const MAX_HISTORY = 10;
const TARGET_KEYWORDS = ["stardew valley", "stardew"];
const MOVEMENT_PRIORITY: StardewActionKey[] = ["W", "A", "D", "S"];
const TASK_DEFINITIONS: StardewTaskDefinition[] = [
	{ id: "reposition", name: "Reposition Character", description: "Take one small movement step based on the current scene." },
	{ id: "open-inventory", name: "Open Inventory", description: "Toggle the inventory open and verify that the UI changed." },
	{ id: "close-menu", name: "Close Menu", description: "Dismiss the current menu layer with Escape and verify the scene changed back." },
];

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
		availableTasks: TASK_DEFINITIONS.map((task) => ({ ...task })),
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
		const candidate = chooseStardewWindow(windows);
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
		let target = targetOverride ?? this.orchestrator.getState().selectedTarget;
		if (!target) {
			target = await this.detectTargetWindow();
		}
		if (!target) {
			throw new Error("no target window selected and no Stardew target could be detected");
		}

		const baselineSnapshot = await this.ensureReferenceSnapshot(target);
		const analysis = await this.buildAnalysis(resolvedTaskId, target, baselineSnapshot);
		const run: StardewRunRecord = {
			id: `stardew-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
			taskId: resolvedTaskId,
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

				const attempt = await this.evaluateAttempt(run.taskId, action, beforeSnapshot, afterSnapshot);
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

	private async buildAnalysis(taskId: StardewTaskId, target: FunctionalTarget, snapshot: PerceptionSnapshot): Promise<StardewAnalysis> {
		try {
			if (taskId === "reposition") {
				return await this.requestVisionAnalysis(target, snapshot);
			}
			return buildFixedTaskAnalysis(taskId);
		} catch (err) {
			log.warn("stardew analysis unavailable, falling back", err);
			return taskId === "reposition" ? buildMovementFallback() : buildFixedTaskAnalysis(taskId);
		}
	}

	private async requestVisionAnalysis(target: FunctionalTarget, snapshot: PerceptionSnapshot): Promise<StardewAnalysis> {
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
			url: `${normalizeBaseUrl(rawBaseUrl)}/chat/completions`,
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
						{ type: "text", text: buildVisionPrompt(target.title) },
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
		return parseVisionResponse(textContent);
	}

	private async ensureReferenceSnapshot(target: FunctionalTarget): Promise<PerceptionSnapshot> {
		const state = this.orchestrator.getState();
		if (state.latestSnapshot && state.latestSnapshot.targetHandle === target.handle) {
			return state.latestSnapshot;
		}

		const captureTask = await this.orchestrator.runCaptureTask(target);
		if (!captureTask.afterSnapshot) {
			throw new Error("unable to capture Stardew baseline snapshot");
		}

		return captureTask.afterSnapshot;
	}

	private async evaluateAttempt(taskId: StardewTaskId, action: StardewActionKey, beforeSnapshot: PerceptionSnapshot, afterSnapshot: PerceptionSnapshot): Promise<StardewAttemptRecord> {
		const changeRatio = await estimateSnapshotChange(beforeSnapshot, afterSnapshot);
		const threshold = taskId === "reposition" ? 0.014 : 0.03;
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

function chooseStardewWindow(windows: HostWindowInfo[]): HostWindowInfo | null {
	const candidates = windows
		.filter((windowInfo) => windowInfo.visible && !windowInfo.minimized)
		.map((windowInfo) => ({ windowInfo, score: scoreWindow(windowInfo) }))
		.filter((candidate) => candidate.score > 0)
		.sort((left, right) => right.score - left.score);

	return candidates[0]?.windowInfo ?? null;
}

function scoreWindow(windowInfo: HostWindowInfo): number {
	const title = windowInfo.title.toLowerCase();
	let score = 0;
	for (const keyword of TARGET_KEYWORDS) {
		if (title.includes(keyword)) score += 12;
	}
	if (title.includes("steam")) score += 2;
	if (windowInfo.visible) score += 1;
	if (!windowInfo.minimized) score += 1;
	return score;
}

function buildFixedTaskAnalysis(taskId: StardewTaskId): StardewAnalysis {
	if (taskId === "open-inventory") {
		return {
			source: "heuristic",
			strategy: "toggle the inventory with E and expect a strong UI change",
			reasoning: "Inventory is a deterministic small task with a stable keyboard shortcut.",
			preferredActions: ["E"],
		};
	}

	return {
		source: "heuristic",
		strategy: "dismiss the current menu layer with Escape",
		reasoning: "Escape is the safest generic way to close Stardew overlays and return to gameplay.",
		preferredActions: ["Escape"],
	};
}

function buildMovementFallback(): StardewAnalysis {
	return {
		source: "heuristic",
		strategy: "try a conservative one-step reposition with north-west bias",
		reasoning: "Without vision analysis, movement defaults to W/A/D/S as a scene-change probe.",
		preferredActions: [...MOVEMENT_PRIORITY],
	};
}

function buildVisionPrompt(targetTitle: string): string {
	return [
		"You are analyzing a Stardew Valley gameplay screenshot.",
		`Window title: ${targetTitle}.`,
		"Choose a safe one-step reposition for the player using only W, A, S, D.",
		"Return strict JSON with keys: strategy, reasoning, preferredActions.",
		"preferredActions must contain each of W, A, D, S exactly once, ordered by priority.",
		"Prefer a small movement likely to cause a visible scene change without committing to a long path.",
	].join(" ");
}

function parseVisionResponse(content: string): StardewAnalysis {
	const jsonText = extractJsonObject(content);
	const parsed = JSON.parse(jsonText) as { strategy?: unknown; reasoning?: unknown; preferredActions?: unknown };
	const preferredActions = normalizeActions(parsed.preferredActions);
	if (preferredActions.length !== 4) {
		throw new Error("stardew analysis did not return a full action ordering");
	}

	return {
		source: "vision-llm",
		strategy: typeof parsed.strategy === "string" ? parsed.strategy : "vision-guided Stardew movement selection",
		reasoning: typeof parsed.reasoning === "string" ? parsed.reasoning : "The model selected a movement probe from the screenshot.",
		preferredActions,
	};
}

function normalizeActions(value: unknown): StardewActionKey[] {
	if (!Array.isArray(value)) throw new Error("preferredActions is not an array");
	const normalized = value
		.map((entry) => String(entry))
		.filter((entry): entry is StardewActionKey => MOVEMENT_PRIORITY.includes(entry as StardewActionKey));
	return uniqueActions(normalized);
}

function extractJsonObject(content: string): string {
	const start = content.indexOf("{");
	const end = content.lastIndexOf("}");
	if (start === -1 || end === -1 || end <= start) throw new Error("no JSON object found in Stardew response");
	return content.slice(start, end + 1);
}

function normalizeBaseUrl(raw: string): string {
	let url = raw.replace(/\/+$/, "");
	if (!url.endsWith("/v1")) url += "/v1";
	return url;
}

function uniqueActions(actions: StardewActionKey[]): StardewActionKey[] {
	const seen = new Set<StardewActionKey>();
	return actions.filter((action) => {
		if (seen.has(action)) return false;
		seen.add(action);
		return true;
	});
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

async function estimateSnapshotChange(beforeSnapshot: PerceptionSnapshot, afterSnapshot: PerceptionSnapshot): Promise<number> {
	if (beforeSnapshot.width !== afterSnapshot.width || beforeSnapshot.height !== afterSnapshot.height) return 1;

	const beforeData = await sampleSnapshot(beforeSnapshot.dataUrl);
	const afterData = await sampleSnapshot(afterSnapshot.dataUrl);
	const pixelCount = beforeData.width * beforeData.height;
	let totalDiff = 0;

	for (let index = 0; index < beforeData.data.length; index += 4) {
		const beforeLuma = luma(beforeData.data[index], beforeData.data[index + 1], beforeData.data[index + 2]);
		const afterLuma = luma(afterData.data[index], afterData.data[index + 1], afterData.data[index + 2]);
		totalDiff += Math.abs(beforeLuma - afterLuma);
	}

	return totalDiff / (pixelCount * 255);
}

async function sampleSnapshot(dataUrl: string): Promise<ImageData> {
	const image = await loadImage(dataUrl);
	const canvas = document.createElement("canvas");
	const context = canvas.getContext("2d");
	if (!context) throw new Error("2d canvas context unavailable");

	canvas.width = 48;
	canvas.height = 48;
	const cropWidth = image.width * 0.75;
	const cropHeight = image.height * 0.75;
	const cropX = (image.width - cropWidth) / 2;
	const cropY = (image.height - cropHeight) / 2;
	context.drawImage(image, cropX, cropY, cropWidth, cropHeight, 0, 0, canvas.width, canvas.height);
	return context.getImageData(0, 0, canvas.width, canvas.height);
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
	return new Promise((resolve, reject) => {
		const image = new Image();
		image.onload = () => resolve(image);
		image.onerror = () => reject(new Error("failed to decode Stardew snapshot image"));
		image.src = dataUrl;
	});
}

function luma(r: number, g: number, b: number): number {
	return (r * 0.2126) + (g * 0.7152) + (b * 0.0722);
}

function formatPercent(value: number): string {
	return `${(value * 100).toFixed(1)}%`;
}
