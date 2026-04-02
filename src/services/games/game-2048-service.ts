import type { EventBus } from "@/services/event-bus";
import type { OrchestratorService } from "@/services/orchestrator";
import type {
	FunctionalTarget,
	Game2048Analysis,
	Game2048Move,
	Game2048MoveAttempt,
	Game2048RunRecord,
	Game2048State,
	PerceptionSnapshot,
} from "@/types";
import { createLogger } from "@/services/logger";

const log = createLogger("game-2048");
const MAX_RUN_HISTORY = 10;
const DEFAULT_MOVE_ORDER: Game2048Move[] = ["Up", "Left", "Right", "Down"];

function makeInitialState(): Game2048State {
	return {
		activeRunId: null,
		lastRun: null,
		history: [],
	};
}

export class Game2048Service {
	private bus: EventBus;
	private orchestrator: OrchestratorService;
	private state: Game2048State = makeInitialState();

	constructor(deps: {
		bus: EventBus;
		orchestrator: OrchestratorService;
	}) {
		this.bus = deps.bus;
		this.orchestrator = deps.orchestrator;
	}

	getState(): Readonly<Game2048State> {
		return {
			...this.state,
			lastRun: this.state.lastRun ? cloneRun(this.state.lastRun) : null,
			history: this.state.history.map(cloneRun),
		};
	}

	async runSingleStep(targetOverride?: FunctionalTarget): Promise<Game2048RunRecord> {
		const target = targetOverride ?? this.orchestrator.getState().selectedTarget;
		if (!target) {
			throw new Error("no target window selected");
		}

		const analysis = this.buildAnalysis();
		const run: Game2048RunRecord = {
			id: `2048-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
			status: "running",
			target: { ...target },
			startedAt: Date.now(),
			endedAt: null,
			analysis,
			attempts: [],
			selectedMove: null,
			boardChanged: false,
			summary: "",
			companionText: "",
			error: null,
		};

		this.state.activeRunId = run.id;
		this.state.lastRun = cloneRun(run);
		this.bus.emit("game2048:run-start", {
			runId: run.id,
			targetHandle: target.handle,
			targetTitle: target.title,
			preferredMoves: [...analysis.preferredMoves],
		});
		this.emitState();

		try {
			await this.orchestrator.runFocusTask(target);

			let referenceSnapshot = await this.ensureReferenceSnapshot(target);

			for (const move of analysis.preferredMoves) {
				const task = await this.orchestrator.runSendKeyTask(move, target);
				const beforeSnapshot = task.beforeSnapshot ?? referenceSnapshot;
				const afterSnapshot = task.afterSnapshot;

				if (!afterSnapshot) {
					throw new Error(`missing post-action snapshot for move ${move}`);
				}

				const attempt = await this.evaluateAttempt(move, beforeSnapshot, afterSnapshot);
				run.attempts.push(attempt);
				this.bus.emit("game2048:attempt", {
					runId: run.id,
					move: attempt.move,
					changed: attempt.changed,
					changeRatio: attempt.changeRatio,
				});

				if (attempt.changed) {
					run.selectedMove = move;
					run.boardChanged = true;
					referenceSnapshot = afterSnapshot;
					break;
				}

				referenceSnapshot = afterSnapshot;
			}

			run.status = "completed";
			run.endedAt = Date.now();
			run.summary = buildRunSummary(run);
			run.companionText = buildCompanionText(run);
			log.info(run.summary, {
				target: run.target.title,
				selectedMove: run.selectedMove,
				attempts: run.attempts,
			});
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			run.status = "failed";
			run.endedAt = Date.now();
			run.error = message;
			run.summary = `2048 step failed: ${message}`;
			run.companionText = "这一步没跑通，先别继续自动化。请检查目标窗口、截图稳定性，或者确认当前画面确实是 2048 对局。";
			log.error("2048 step failed", err);
		}

		this.state.activeRunId = null;
		this.state.lastRun = cloneRun(run);
		this.state.history = [cloneRun(run), ...this.state.history].slice(0, MAX_RUN_HISTORY);
		this.bus.emit("game2048:run-complete", {
			runId: run.id,
			success: run.status === "completed" && run.boardChanged,
			selectedMove: run.selectedMove,
			boardChanged: run.boardChanged,
			summary: run.summary,
		});
		this.emitState();

		if (run.status === "failed") {
			throw new Error(run.error ?? run.summary);
		}

		return cloneRun(run);
	}

	private buildAnalysis(): Game2048Analysis {
		const previousMove = this.state.lastRun?.boardChanged ? this.state.lastRun.selectedMove : null;
		const preferredMoves = previousMove
			? uniqueMoves([previousMove, ...DEFAULT_MOVE_ORDER])
			: [...DEFAULT_MOVE_ORDER];

		return {
			strategy: previousMove
				? `reuse last verified move ${previousMove} first, then bias toward upper-left stability`
				: "prefer keeping the board stable toward the upper-left corner: Up -> Left -> Right -> Down",
			preferredMoves,
		};
	}

	private async ensureReferenceSnapshot(target: FunctionalTarget): Promise<PerceptionSnapshot> {
		const state = this.orchestrator.getState();
		if (state.latestSnapshot && state.latestSnapshot.targetHandle === target.handle) {
			return state.latestSnapshot;
		}

		const captureTask = await this.orchestrator.runCaptureTask(target);
		if (!captureTask.afterSnapshot) {
			throw new Error("unable to capture baseline snapshot");
		}

		return captureTask.afterSnapshot;
	}

	private async evaluateAttempt(
		move: Game2048Move,
		beforeSnapshot: PerceptionSnapshot,
		afterSnapshot: PerceptionSnapshot,
	): Promise<Game2048MoveAttempt> {
		const changeRatio = await estimateSnapshotChange(beforeSnapshot, afterSnapshot);
		return {
			move,
			changed: changeRatio >= 0.012,
			changeRatio,
		};
	}

	private emitState() {
		this.bus.emit("game2048:state-change", { state: this.getState() });
	}
}

function uniqueMoves(moves: Game2048Move[]): Game2048Move[] {
	const seen = new Set<Game2048Move>();
	return moves.filter((move) => {
		if (seen.has(move)) return false;
		seen.add(move);
		return true;
	});
}

function cloneRun(run: Game2048RunRecord): Game2048RunRecord {
	return {
		...run,
		target: { ...run.target },
		analysis: {
			...run.analysis,
			preferredMoves: [...run.analysis.preferredMoves],
		},
		attempts: run.attempts.map((attempt) => ({ ...attempt })),
	};
}

function buildRunSummary(run: Game2048RunRecord): string {
	if (run.boardChanged && run.selectedMove) {
		const successAttempt = run.attempts.find((attempt) => attempt.move === run.selectedMove);
		return `2048 step verified with ${run.selectedMove} (${formatPercent(successAttempt?.changeRatio ?? 0)})`;
	}

	return `2048 step found no board-changing move after ${run.attempts.length} attempt(s)`;
}

function buildCompanionText(run: Game2048RunRecord): string {
	if (run.boardChanged && run.selectedMove) {
		return `我先按 ${run.selectedMove} 试了一步，截图前后已经确认棋盘变化。这说明目标窗口能被感知、执行和验证，最小功能闭环是通的。`;
	}

	return "我按顺序试了几个方向，但截图前后没看到足够明显的棋盘变化。可能当前画面不是 2048 对局，或者需要重新聚焦目标窗口。";
}

async function estimateSnapshotChange(
	beforeSnapshot: PerceptionSnapshot,
	afterSnapshot: PerceptionSnapshot,
): Promise<number> {
	if (beforeSnapshot.width !== afterSnapshot.width || beforeSnapshot.height !== afterSnapshot.height) {
		return 1;
	}

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

	if (!context) {
		throw new Error("2d canvas context unavailable");
	}

	canvas.width = 48;
	canvas.height = 48;

	const cropWidth = image.width * 0.7;
	const cropHeight = image.height * 0.7;
	const cropX = (image.width - cropWidth) / 2;
	const cropY = (image.height - cropHeight) / 2;

	context.drawImage(
		image,
		cropX,
		cropY,
		cropWidth,
		cropHeight,
		0,
		0,
		canvas.width,
		canvas.height,
	);

	return context.getImageData(0, 0, canvas.width, canvas.height);
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
	return new Promise((resolve, reject) => {
		const image = new Image();
		image.onload = () => resolve(image);
		image.onerror = () => reject(new Error("failed to decode snapshot image"));
		image.src = dataUrl;
	});
}

function luma(r: number, g: number, b: number): number {
	return (r * 0.2126) + (g * 0.7152) + (b * 0.0722);
}

function formatPercent(value: number): string {
	return `${(value * 100).toFixed(1)}%`;
}
