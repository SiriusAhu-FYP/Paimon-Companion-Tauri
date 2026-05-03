import rawGame2048ManifestToml from "@/config/games/2048.toml?raw";
import rawSokobanManifestToml from "@/config/games/sokoban.toml?raw";
import { parse } from "smol-toml";
import type {
	Game2048ActionId,
	HostMouseAction,
	HostMouseButton,
	SemanticDelegationProfileConfig,
	SemanticGameActionDefinition,
	SemanticGameManifest,
	SemanticHostStep,
	SokobanActionId,
} from "@/types";

type KnownGameId = "2048" | "sokoban";

type KnownManifestMap = {
	"2048": SemanticGameManifest<Game2048ActionId>;
	sokoban: SemanticGameManifest<SokobanActionId>;
};

const HOST_MOUSE_BUTTONS: HostMouseButton[] = ["left", "middle", "right"];
const HOST_MOUSE_ACTIONS: HostMouseAction[] = ["click", "down", "up"];

const GAME_MANIFESTS: KnownManifestMap = {
	"2048": validateManifest<Game2048ActionId>(parseManifestToml(rawGame2048ManifestToml, "2048.toml")),
	sokoban: validateManifest<SokobanActionId>(parseManifestToml(rawSokobanManifestToml, "sokoban.toml")),
};

export function listSemanticGames(): ReadonlyArray<{ gameId: KnownGameId; displayName: string }> {
	return (Object.entries(GAME_MANIFESTS) as Array<[KnownGameId, KnownManifestMap[KnownGameId]]>).map(
		([gameId, manifest]) => ({
			gameId,
			displayName: manifest.displayName,
		}),
	);
}

export function getSemanticGameManifest<GameId extends KnownGameId>(
	gameId: GameId,
): KnownManifestMap[GameId] {
	return GAME_MANIFESTS[gameId];
}

export function findSemanticGameByTargetTitle(
	targetTitle: string | null | undefined,
): { gameId: KnownGameId; displayName: string; observationFocus: readonly string[] } | null {
	const normalizedTitle = (targetTitle ?? "").trim().toLowerCase();
	if (!normalizedTitle) return null;

	for (const [gameId, manifest] of Object.entries(GAME_MANIFESTS) as Array<[KnownGameId, KnownManifestMap[KnownGameId]]>) {
		const hints = manifest.windowTitleHints ?? [];
		if (hints.some((hint) => normalizedTitle.includes(hint.toLowerCase()))) {
			return {
				gameId,
				displayName: manifest.displayName,
				observationFocus: manifest.observationFocus ?? [],
			};
		}
	}

	return null;
}

function parseManifestToml(rawToml: string, sourceName: string): unknown {
	try {
		return parse(rawToml);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(`failed to parse ${sourceName}: ${message}`);
	}
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function sanitizeStringArray(input: unknown): string[] {
	if (!Array.isArray(input)) {
		return [];
	}
	return input
		.map((item) => (typeof item === "string" ? item.trim() : ""))
		.filter(Boolean);
}

function toOptionalNumber(value: unknown): number | undefined {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		return undefined;
	}
	return value;
}

function toOptionalBoolean(value: unknown): boolean | undefined {
	return typeof value === "boolean" ? value : undefined;
}

function validateManifest<ActionId extends string>(value: unknown): SemanticGameManifest<ActionId> {
	if (!value || typeof value !== "object") {
		throw new Error("semantic game manifest must be an object");
	}

	const manifest = value as {
		gameId?: unknown;
		displayName?: unknown;
		defaultActionOrder?: unknown;
		notes?: unknown;
		windowTitleHints?: unknown;
		observationFocus?: unknown;
		loadGuardPolicy?: unknown;
		delegationProfile?: unknown;
		actions?: unknown;
	};

	if (typeof manifest.gameId !== "string" || typeof manifest.displayName !== "string") {
		throw new Error("semantic game manifest must include string gameId/displayName");
	}
	const gameId = manifest.gameId;
	const displayName = manifest.displayName;

	if (!Array.isArray(manifest.defaultActionOrder) || !manifest.defaultActionOrder.every((entry) => typeof entry === "string")) {
		throw new Error(`semantic game manifest ${gameId} must include defaultActionOrder`);
	}
	const defaultActionOrder = manifest.defaultActionOrder as ActionId[];

	if (!Array.isArray(manifest.actions)) {
		throw new Error(`semantic game manifest ${gameId} must include actions`);
	}

	const actions = manifest.actions.map((entry) => validateAction<ActionId>(entry, gameId));
	const actionIds = new Set(actions.map((action) => action.id));

	for (const actionId of defaultActionOrder) {
		if (!actionIds.has(actionId)) {
			throw new Error(`semantic game manifest ${gameId} default action ${actionId} is not defined`);
		}
	}

	const loadGuardPolicy = (
		manifest.loadGuardPolicy === "auto"
		|| manifest.loadGuardPolicy === "force-enable"
		|| manifest.loadGuardPolicy === "force-disable"
	)
		? manifest.loadGuardPolicy
		: undefined;

	return {
		gameId,
		displayName,
		defaultActionOrder: [...defaultActionOrder],
		notes: Array.isArray(manifest.notes)
			? manifest.notes.filter((entry): entry is string => typeof entry === "string")
			: [],
		windowTitleHints: Array.isArray(manifest.windowTitleHints)
			? manifest.windowTitleHints.filter((entry): entry is string => typeof entry === "string")
			: [],
		observationFocus: Array.isArray(manifest.observationFocus)
			? manifest.observationFocus.filter((entry): entry is string => typeof entry === "string")
			: [],
		loadGuardPolicy,
		delegationProfile: validateDelegationProfile(manifest.delegationProfile),
		actions,
	};
}

function validateDelegationProfile(value: unknown): SemanticDelegationProfileConfig | undefined {
	if (!isObjectRecord(value)) {
		return undefined;
	}
	const locator = isObjectRecord(value.locator) ? value.locator : {};
	const roles = isObjectRecord(value.roles) ? value.roles : {};
	const missionAnalyst = isObjectRecord(roles.missionAnalyst) ? roles.missionAnalyst : {};
	const operationsPlanner = isObjectRecord(roles.operationsPlanner) ? roles.operationsPlanner : {};
	const progressEvaluator = isObjectRecord(roles.progressEvaluator) ? roles.progressEvaluator : {};
	const boardPerception = isObjectRecord(value.boardPerception) ? value.boardPerception : {};
	const visionPreprocess = isObjectRecord(value.visionPreprocess) ? value.visionPreprocess : {};
	const visionPreprocessCrop = isObjectRecord(visionPreprocess.crop) ? visionPreprocess.crop : {};
	const visionPreprocessMode = visionPreprocess.mode;
	const longSequence = isObjectRecord(value.longSequence) ? value.longSequence : null;
	const thinkingMode = missionAnalyst.missionAnalystThinkingMode;
	const plannerThinkingMode = operationsPlanner.operationsPlannerThinkingMode;
	const evaluatorThinkingMode = progressEvaluator.progressEvaluatorThinkingMode;
	return {
		profileId: typeof value.profileId === "string" ? value.profileId : undefined,
		taskId: typeof value.taskId === "string" ? value.taskId : undefined,
		displayName: typeof value.displayName === "string" ? value.displayName : undefined,
		maxRounds: toOptionalNumber(value.maxRounds),
		maxActionsPerRound: toOptionalNumber(value.maxActionsPerRound),
		afterActionWaitMs: toOptionalNumber(value.afterActionWaitMs),
		locatorRulesEnabled: toOptionalBoolean(locator.locatorRulesEnabled),
		locatorCloudEnabled: toOptionalBoolean(locator.locatorCloudEnabled),
		locatorLocalFallbackEnabled: toOptionalBoolean(locator.locatorLocalFallbackEnabled),
		locatorMinConfidence: toOptionalNumber(locator.locatorMinConfidence),
		missionAnalystTemperature: toOptionalNumber(missionAnalyst.missionAnalystTemperature),
		missionAnalystThinkingMode: (
			thinkingMode === "off"
			|| thinkingMode === "low"
			|| thinkingMode === "medium"
			|| thinkingMode === "high"
		)
			? thinkingMode
			: undefined,
		operationsPlannerTemperature: toOptionalNumber(operationsPlanner.operationsPlannerTemperature),
		operationsPlannerThinkingMode: (
			plannerThinkingMode === "off"
			|| plannerThinkingMode === "low"
			|| plannerThinkingMode === "medium"
			|| plannerThinkingMode === "high"
		)
			? plannerThinkingMode
			: undefined,
		progressEvaluatorTemperature: toOptionalNumber(progressEvaluator.progressEvaluatorTemperature),
		progressEvaluatorThinkingMode: (
			evaluatorThinkingMode === "off"
			|| evaluatorThinkingMode === "low"
			|| evaluatorThinkingMode === "medium"
			|| evaluatorThinkingMode === "high"
		)
			? evaluatorThinkingMode
			: undefined,
		allowedTools: sanitizeStringArray(value.allowedTools),
		missionAnalystRules: sanitizeStringArray(missionAnalyst.missionAnalystRules),
		operationsPlannerRules: sanitizeStringArray(operationsPlanner.operationsPlannerRules),
		progressEvaluatorRules: sanitizeStringArray(progressEvaluator.progressEvaluatorRules),
		boardPerceptionPrompt: typeof boardPerception.boardPerceptionPrompt === "string" ? (boardPerception.boardPerceptionPrompt as string) : undefined,
		visionPreprocess: {
			enabled: toOptionalBoolean(visionPreprocess.enabled),
			mode: (
				visionPreprocessMode === "none"
				|| visionPreprocessMode === "crop-only"
				|| visionPreprocessMode === "crop-resize"
			)
				? visionPreprocessMode
				: undefined,
			crop: {
				xNorm: toOptionalNumber(visionPreprocessCrop.xNorm),
				yNorm: toOptionalNumber(visionPreprocessCrop.yNorm),
				widthNorm: toOptionalNumber(visionPreprocessCrop.widthNorm),
				heightNorm: toOptionalNumber(visionPreprocessCrop.heightNorm),
			},
			maxWidth: toOptionalNumber(visionPreprocess.maxWidth),
			maxHeight: toOptionalNumber(visionPreprocess.maxHeight),
			format: visionPreprocess.format === "png" || visionPreprocess.format === "jpeg" ? visionPreprocess.format : undefined,
			quality: toOptionalNumber(visionPreprocess.quality),
		},
		longSequence: longSequence
			? {
				enabled: toOptionalBoolean(longSequence.enabled),
				maxActions: toOptionalNumber(longSequence.maxActions),
				stepWaitMs: toOptionalNumber(longSequence.stepWaitMs),
				stopOnUnchangedSnapshot: toOptionalBoolean(longSequence.stopOnUnchangedSnapshot),
			}
			: undefined,
	};
}

function validateAction<ActionId extends string>(
	value: unknown,
	gameId: string,
): SemanticGameActionDefinition<ActionId> {
	if (!value || typeof value !== "object") {
		throw new Error(`semantic game manifest ${gameId} has an invalid action entry`);
	}

	const action = value as {
		id?: unknown;
		label?: unknown;
		description?: unknown;
		steps?: unknown;
	};

	if (
		typeof action.id !== "string"
		|| typeof action.label !== "string"
		|| typeof action.description !== "string"
		|| !Array.isArray(action.steps)
	) {
		throw new Error(`semantic game manifest ${gameId} has an invalid action shape`);
	}
	const actionId = action.id;
	const label = action.label;
	const description = action.description;
	const steps = action.steps;

	return {
		id: actionId as ActionId,
		label,
		description,
		steps: steps.map((step) => validateStep(step, gameId, actionId)),
	};
}

function validateStep(
	value: unknown,
	gameId: string,
	actionId: string,
): SemanticHostStep {
	if (!value || typeof value !== "object") {
		throw new Error(`semantic game manifest ${gameId}.${actionId} has an invalid step`);
	}

	const step = value as Record<string, unknown>;
	if (step.kind === "focus") {
		return { kind: "focus" };
	}

	if (step.kind === "send-key" && typeof step.key === "string") {
		return { kind: "send-key", key: step.key };
	}

	if (step.kind === "send-mouse") {
		const button = typeof step.button === "string" && HOST_MOUSE_BUTTONS.includes(step.button as HostMouseButton)
			? step.button as HostMouseButton
			: undefined;
		const action = typeof step.action === "string" && HOST_MOUSE_ACTIONS.includes(step.action as HostMouseAction)
			? step.action as HostMouseAction
			: undefined;
		return {
			kind: "send-mouse",
			x: typeof step.x === "number" ? step.x : undefined,
			y: typeof step.y === "number" ? step.y : undefined,
			button,
			action,
		};
	}

	throw new Error(`semantic game manifest ${gameId}.${actionId} has an unsupported step kind`);
}
