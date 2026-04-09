import type {
	Game2048ActionId,
	SemanticGameActionDefinition,
	SemanticGameManifest,
} from "@/types";
import { getSemanticGameManifest } from "./semantic-game-registry";

export const GAME_2048_PLUGIN: SemanticGameManifest<Game2048ActionId> = getSemanticGameManifest("2048");
export const GAME_2048_DEFAULT_ACTION_ORDER: Game2048ActionId[] = [...GAME_2048_PLUGIN.defaultActionOrder];

const ACTION_MAP = new Map<Game2048ActionId, SemanticGameActionDefinition<Game2048ActionId>>(
	GAME_2048_PLUGIN.actions.map((action) => [action.id, action]),
);

export function getGame2048Action(actionId: Game2048ActionId): SemanticGameActionDefinition<Game2048ActionId> {
	const action = ACTION_MAP.get(actionId);
	if (!action) {
		throw new Error(`unknown 2048 action: ${actionId}`);
	}
	return action;
}

export function formatGame2048Action(actionId: Game2048ActionId | null): string {
	if (!actionId) return "none";
	return getGame2048Action(actionId).label;
}

export function listGame2048ActionDescriptions(): string[] {
	return GAME_2048_PLUGIN.actions.map((action) => `${action.id}: ${action.description}`);
}
