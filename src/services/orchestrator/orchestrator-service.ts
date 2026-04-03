import type { EventBus } from "@/services/event-bus";
import type { SafetyService } from "@/services/safety";
import type { PerceptionService } from "@/services/perception";
import type {
	FunctionalActionKind,
	FunctionalLogLevel,
	FunctionalRuntimeState,
	FunctionalTarget,
	FunctionalTaskRecord,
	HostMouseAction,
	HostMouseButton,
} from "@/types";
import { focusWindow, sendHostKey, sendHostMouse } from "@/services/system";

const MAX_TASK_HISTORY = 20;

function makeInitialState(): FunctionalRuntimeState {
	return {
		selectedTarget: null,
		latestSnapshot: null,
		latestTask: null,
		taskHistory: [],
		activeTaskId: null,
		safetyBlockedReason: null,
	};
}

export class OrchestratorService {
	private bus: EventBus;
	private safety: SafetyService;
	private perception: PerceptionService;
	private state: FunctionalRuntimeState = makeInitialState();

	constructor(deps: {
		bus: EventBus;
		safety: SafetyService;
		perception: PerceptionService;
	}) {
		this.bus = deps.bus;
		this.safety = deps.safety;
		this.perception = deps.perception;
	}

	getState(): Readonly<FunctionalRuntimeState> {
		return {
			...this.state,
			selectedTarget: this.state.selectedTarget ? { ...this.state.selectedTarget } : null,
			latestSnapshot: this.state.latestSnapshot ? { ...this.state.latestSnapshot } : null,
			latestTask: this.state.latestTask ? cloneTask(this.state.latestTask) : null,
			taskHistory: this.state.taskHistory.map(cloneTask),
		};
	}

	setTarget(target: FunctionalTarget | null) {
		this.state.selectedTarget = target ? { ...target } : null;
		this.state.safetyBlockedReason = null;
		this.bus.emit("functional:target-change", {
			handle: target?.handle ?? null,
			title: target?.title ?? null,
		});
		this.emitState();
	}

	clearHistory() {
		this.state.latestTask = null;
		this.state.taskHistory = [];
		this.emitState();
	}

	async runCaptureTask(targetOverride?: FunctionalTarget): Promise<FunctionalTaskRecord> {
		return this.runTask({
			name: "Capture Snapshot",
			actionKind: "capture",
			targetOverride,
			execute: async (task, target) => {
				this.pushTaskLog(task, "info", "capturing target snapshot");
				const snapshot = await this.perception.captureTarget(target);
				task.afterSnapshot = snapshot;
				this.state.latestSnapshot = snapshot;
				task.summary = `captured ${snapshot.width}x${snapshot.height}`;
			},
		});
	}

	async runFocusTask(targetOverride?: FunctionalTarget): Promise<FunctionalTaskRecord> {
		return this.runTask({
			name: "Focus Window",
			actionKind: "focus",
			targetOverride,
			execute: async (task, target) => {
				this.pushTaskLog(task, "info", "focusing target window");
				await focusWindow(target.handle);
				task.summary = "window focused";
			},
		});
	}

	async runSendKeyTask(key: string, targetOverride?: FunctionalTarget): Promise<FunctionalTaskRecord> {
		return this.runTask({
			name: `Send Key: ${key}`,
			actionKind: "send-key",
			targetOverride,
			execute: async (task, target) => {
				this.pushTaskLog(task, "info", "capturing pre-action snapshot");
				task.beforeSnapshot = await this.perception.captureTarget(target);

				this.pushTaskLog(task, "info", `sending key "${key}"`);
				await sendHostKey(target.handle, key);

				this.pushTaskLog(task, "info", "capturing post-action snapshot");
				task.afterSnapshot = await this.perception.captureTarget(target);
				this.state.latestSnapshot = task.afterSnapshot;
				task.summary = `sent key "${key}"`;
			},
		});
	}

	async runSendMouseTask(
		options: { action?: HostMouseAction; button?: HostMouseButton; x?: number; y?: number },
		targetOverride?: FunctionalTarget,
	): Promise<FunctionalTaskRecord> {
		const action = options.action ?? "click";
		const button = options.button ?? "left";

		return this.runTask({
			name: `Send Mouse: ${action}/${button}`,
			actionKind: "send-mouse",
			targetOverride,
			execute: async (task, target) => {
				this.pushTaskLog(task, "info", "capturing pre-action snapshot");
				task.beforeSnapshot = await this.perception.captureTarget(target);

				this.pushTaskLog(task, "info", `sending mouse ${action}/${button}`);
				await sendHostMouse(target.handle, options);

				this.pushTaskLog(task, "info", "capturing post-action snapshot");
				task.afterSnapshot = await this.perception.captureTarget(target);
				this.state.latestSnapshot = task.afterSnapshot;
				task.summary = `sent mouse ${action}/${button}`;
			},
		});
	}

	private async runTask(args: {
		name: string;
		actionKind: FunctionalActionKind;
		targetOverride?: FunctionalTarget;
		execute: (task: FunctionalTaskRecord, target: FunctionalTarget) => Promise<void>;
	}): Promise<FunctionalTaskRecord> {
		const target = args.targetOverride ?? this.state.selectedTarget;
		try {
			this.safety.ensureHostActionAllowed(target, args.actionKind);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			this.state.safetyBlockedReason = message;
			this.emitState();
			throw err;
		}

		if (args.targetOverride) {
			this.setTarget(args.targetOverride);
		}

		const resolvedTarget = this.state.selectedTarget!;
		const task: FunctionalTaskRecord = {
			id: `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
			name: args.name,
			actionKind: args.actionKind,
			targetHandle: resolvedTarget.handle,
			targetTitle: resolvedTarget.title,
			status: "running",
			startedAt: Date.now(),
			endedAt: null,
			summary: "",
			error: null,
			logs: [],
			beforeSnapshot: null,
			afterSnapshot: null,
		};

		this.state.activeTaskId = task.id;
		this.state.latestTask = cloneTask(task);
		this.state.safetyBlockedReason = null;
		this.bus.emit("orchestrator:task-start", {
			taskId: task.id,
			name: task.name,
			actionKind: task.actionKind,
			targetHandle: task.targetHandle,
			targetTitle: task.targetTitle,
		});
		this.emitState();

		try {
			await args.execute(task, resolvedTarget);
			task.status = "completed";
			task.endedAt = Date.now();
			if (!task.summary) {
				task.summary = "task completed";
			}
			this.pushTaskLog(task, "info", task.summary);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			task.status = "failed";
			task.error = message;
			task.summary = `failed: ${message}`;
			task.endedAt = Date.now();
			this.pushTaskLog(task, "error", message);
		}

		this.state.activeTaskId = null;
		this.state.latestTask = cloneTask(task);
		this.state.taskHistory = [cloneTask(task), ...this.state.taskHistory].slice(0, MAX_TASK_HISTORY);
		if (task.afterSnapshot) {
			this.state.latestSnapshot = task.afterSnapshot;
		} else if (task.beforeSnapshot) {
			this.state.latestSnapshot = task.beforeSnapshot;
		}

		this.bus.emit("orchestrator:task-complete", {
			taskId: task.id,
			name: task.name,
			actionKind: task.actionKind,
			success: task.status === "completed",
			summary: task.summary,
			error: task.error,
		});
		this.emitState();

		if (task.status === "failed") {
			throw new Error(task.error ?? task.summary);
		}

		return cloneTask(task);
	}

	private pushTaskLog(task: FunctionalTaskRecord, level: FunctionalLogLevel, message: string) {
		const entry = { timestamp: Date.now(), level, message };
		task.logs.push(entry);
		this.bus.emit("orchestrator:task-log", {
			taskId: task.id,
			level,
			message,
		});
	}

	private emitState() {
		this.bus.emit("orchestrator:state-change", { state: this.getState() });
	}
}

function cloneTask(task: FunctionalTaskRecord): FunctionalTaskRecord {
	return {
		...task,
		logs: task.logs.map((entry) => ({ ...entry })),
		beforeSnapshot: task.beforeSnapshot ? { ...task.beforeSnapshot } : null,
		afterSnapshot: task.afterSnapshot ? { ...task.afterSnapshot } : null,
	};
}
