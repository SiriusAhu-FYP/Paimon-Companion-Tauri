import game2048ManifestJson from "@/config/games/2048.json";
import sokobanManifestJson from "@/config/games/sokoban.json";
import type {
	Game2048ActionId,
	HostMouseAction,
	HostMouseButton,
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
	"2048": validateManifest<Game2048ActionId>(game2048ManifestJson),
	sokoban: validateManifest<SokobanActionId>(sokobanManifestJson),
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
		actions,
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
