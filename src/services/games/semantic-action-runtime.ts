import type { OrchestratorService } from "@/services/orchestrator";
import { getConfig } from "@/services/config";
import { createLogger } from "@/services/logger";
import type {
	FunctionalTarget,
	PerceptionSnapshot,
	SemanticActionExecutionResult,
	SemanticGameActionDefinition,
} from "@/types";
import { estimateSnapshotChange, extractJsonObject } from "./game-utils";
import { requestActiveVisionDecision } from "./cloud-decision";

const log = createLogger("semantic-action");
const BROWSER_TITLE_HINTS = ["firefox", "chrome", "edge", "browser", "网页", "mozilla"];

export type BrowserLoadGuardPolicy = "auto" | "force-enable" | "force-disable";

interface BrowserLoadGuardConfig {
	enabled: boolean;
	intervalMs: number;
	stableCount: number;
	timeoutMs: number;
	changeThreshold: number;
	cropScale: number;
}

export async function executeSemanticAction<ActionId extends string>(
	orchestrator: OrchestratorService,
	target: FunctionalTarget,
	action: SemanticGameActionDefinition<ActionId>,
	options?: {
		loadGuardPolicy?: BrowserLoadGuardPolicy;
	},
): Promise<SemanticActionExecutionResult<ActionId>> {
	const taskIds: string[] = [];
	let beforeSnapshotAvailable = false;
	let afterSnapshotAvailable = false;
	const loadGuardPolicy = options?.loadGuardPolicy ?? "auto";

	for (const step of action.steps) {
		if (step.kind === "focus") {
			const task = await orchestrator.runFocusTask(target);
			taskIds.push(task.id);
			continue;
		}

		if (step.kind === "send-key") {
			const task = await orchestrator.runSendKeyTask(step.key, target);
			taskIds.push(task.id);
			beforeSnapshotAvailable = beforeSnapshotAvailable || Boolean(task.beforeSnapshot);
			afterSnapshotAvailable = afterSnapshotAvailable || Boolean(task.afterSnapshot);
			continue;
		}

		const task = await orchestrator.runSendMouseTask(
			{
				x: step.x,
				y: step.y,
				button: step.button,
				action: step.action,
			},
			target,
		);
		taskIds.push(task.id);
		beforeSnapshotAvailable = beforeSnapshotAvailable || Boolean(task.beforeSnapshot);
		afterSnapshotAvailable = afterSnapshotAvailable || Boolean(task.afterSnapshot);
		const loadGuardDecision = resolveLoadGuardDecision(step.action, target, loadGuardPolicy);
		if (loadGuardDecision.enabled) {
			const guardResult = await waitForBrowserLoadReady(orchestrator, target);
			if (!guardResult.ready) {
				throw new Error(`browser load guard timed out after ${guardResult.elapsedMs}ms`);
			}
		} else if (loadGuardDecision.reason === "policy-disabled") {
			log.info("browser load guard skipped by policy", {
				target: target.title,
				action: step.action ?? "click",
			});
		}
	}

	return {
		actionId: action.id,
		label: action.label,
		taskIds,
		beforeSnapshotAvailable,
		afterSnapshotAvailable,
	};
}

function resolveLoadGuardDecision(
	action: string | undefined,
	target: FunctionalTarget,
	policy: BrowserLoadGuardPolicy,
): { enabled: boolean; reason: "non-click" | "policy-disabled" | "policy-enabled" | "browser-target" | "non-browser-target" } {
	const normalizedAction = action ?? "click";
	if (normalizedAction !== "click") {
		return {
			enabled: false,
			reason: "non-click",
		};
	}
	if (policy === "force-disable") {
		return {
			enabled: false,
			reason: "policy-disabled",
		};
	}
	if (policy === "force-enable") {
		return {
			enabled: true,
			reason: "policy-enabled",
		};
	}
	const title = target.title.toLowerCase();
	const isBrowserTarget = BROWSER_TITLE_HINTS.some((hint) => title.includes(hint));
	return {
		enabled: isBrowserTarget,
		reason: isBrowserTarget ? "browser-target" : "non-browser-target",
	};
}

function resolveBrowserLoadGuardConfig(): BrowserLoadGuardConfig {
	const runtimeConfig = getConfig().companionRuntime;
	return {
		enabled: runtimeConfig.browserLoadGuardEnabled !== false,
		intervalMs: clampInt(runtimeConfig.browserLoadIntervalMs, 1000, 200, 5000),
		stableCount: clampInt(runtimeConfig.browserLoadStableCount, 3, 1, 12),
		timeoutMs: clampInt(runtimeConfig.browserLoadTimeoutMs, 30000, 1000, 120000),
		changeThreshold: clampFloat(runtimeConfig.browserLoadChangeThreshold, 0.0025, 0.0001, 0.2),
		cropScale: clampFloat(runtimeConfig.browserLoadCropScale, 0.9, 0.2, 1),
	};
}

async function waitForBrowserLoadReady(
	orchestrator: OrchestratorService,
	target: FunctionalTarget,
): Promise<{ ready: boolean; elapsedMs: number }> {
	const guardConfig = resolveBrowserLoadGuardConfig();
	if (!guardConfig.enabled) {
		return {
			ready: true,
			elapsedMs: 0,
		};
	}

	const startedAt = Date.now();
	log.info("browser load guard started", {
		target: target.title,
		intervalMs: guardConfig.intervalMs,
		stableCount: guardConfig.stableCount,
		timeoutMs: guardConfig.timeoutMs,
	});
	const initialSnapshot = await captureLatestSnapshot(orchestrator, target);
	let previousSnapshot = initialSnapshot;
	let stableHits = 0;

	while (Date.now() - startedAt < guardConfig.timeoutMs) {
		await sleep(guardConfig.intervalMs);
		const currentSnapshot = await captureLatestSnapshot(orchestrator, target);
		let changeRatio = 1;
		try {
			changeRatio = await estimateSnapshotChange(previousSnapshot, currentSnapshot, {
				cropScale: guardConfig.cropScale,
			});
		} catch (err) {
			log.warn("browser load guard diff estimate failed", {
				error: err instanceof Error ? err.message : String(err),
			});
			changeRatio = 1;
		}

		const isStableFrame = changeRatio <= guardConfig.changeThreshold;
		stableHits = isStableFrame ? stableHits + 1 : 0;
		previousSnapshot = currentSnapshot;

		if (stableHits < guardConfig.stableCount) {
			continue;
		}

		const ready = await judgeBrowserPageReady(target, currentSnapshot);
		log.info("browser load guard stable-window verdict", {
			target: target.title,
			ready,
			stableHits: guardConfig.stableCount,
			elapsedMs: Date.now() - startedAt,
		});
		if (ready) {
			return {
				ready: true,
				elapsedMs: Date.now() - startedAt,
			};
		}
		stableHits = 0;
	}
	log.warn("browser load guard timed out", {
		target: target.title,
		elapsedMs: Date.now() - startedAt,
	});

	return {
		ready: false,
		elapsedMs: Date.now() - startedAt,
	};
}

async function captureLatestSnapshot(
	orchestrator: OrchestratorService,
	target: FunctionalTarget,
): Promise<PerceptionSnapshot> {
	const task = await orchestrator.runCaptureTask(target);
	if (!task.afterSnapshot) {
		throw new Error("browser load guard failed to capture snapshot");
	}
	return task.afterSnapshot;
}

async function judgeBrowserPageReady(
	target: FunctionalTarget,
	snapshot: PerceptionSnapshot,
): Promise<boolean> {
	try {
		const content = await requestActiveVisionDecision({
			systemPrompt: [
				"You judge whether a browser page is ready for the next user action.",
				"NOT ready examples: blank white screen, loading spinner, skeleton placeholders, heavy transition, blocker overlay.",
				"Ready examples: main content and controls are visible, page looks interactive and stable.",
				"Return strict JSON: {\"ready\": boolean, \"reason\": string}.",
			].join("\n"),
			userPrompt: `Target window: ${target.title}. Determine if this screenshot is ready for the next operation.`,
			imageDataUrls: [snapshot.dataUrl],
			maxTokens: 140,
			temperature: 0,
			timeoutMs: 20_000,
			jsonResponse: true,
		});
		return parseReadyFlag(content);
	} catch (err) {
		log.warn("browser load guard vision readiness check failed", {
			error: err instanceof Error ? err.message : String(err),
		});
		return false;
	}
}

function parseReadyFlag(content: string): boolean {
	const jsonText = extractJsonObject(content);
	const parsed = JSON.parse(jsonText) as {
		ready?: unknown;
		loaded?: unknown;
		isReady?: unknown;
	};
	const candidate = parsed.ready ?? parsed.loaded ?? parsed.isReady;
	const normalized = normalizeBooleanLike(candidate);
	if (normalized === null) {
		throw new Error("vision readiness response missing ready boolean");
	}
	return normalized;
}

function normalizeBooleanLike(value: unknown): boolean | null {
	if (typeof value === "boolean") {
		return value;
	}
	if (typeof value === "number") {
		return value !== 0;
	}
	if (typeof value !== "string") {
		return null;
	}
	const normalized = value.trim().toLowerCase();
	if (!normalized) {
		return null;
	}
	if (
		normalized === "true"
		|| normalized === "yes"
		|| normalized === "1"
		|| normalized.includes("ready")
		|| normalized.includes("已完成")
		|| normalized.includes("已加载")
	) {
		return true;
	}
	if (
		normalized === "false"
		|| normalized === "no"
		|| normalized === "0"
		|| normalized.includes("not ready")
		|| normalized.includes("未完成")
		|| normalized.includes("未加载")
		|| normalized.includes("加载中")
	) {
		return false;
	}
	return null;
}

function clampInt(value: number, fallback: number, min: number, max: number): number {
	if (!Number.isFinite(value)) {
		return fallback;
	}
	return Math.min(max, Math.max(min, Math.round(value)));
}

function clampFloat(value: number, fallback: number, min: number, max: number): number {
	if (!Number.isFinite(value)) {
		return fallback;
	}
	return Math.min(max, Math.max(min, value));
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}
