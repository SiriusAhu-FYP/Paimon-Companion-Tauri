import type {
	SemanticGameActionDefinition,
	SemanticGameManifest,
	SokobanActionId,
} from "@/types";
import { getSemanticGameManifest } from "./semantic-game-registry";

export const SOKOBAN_PLUGIN: SemanticGameManifest<SokobanActionId> = getSemanticGameManifest("sokoban");
export const SOKOBAN_DEFAULT_ACTION_ORDER: SokobanActionId[] = [...SOKOBAN_PLUGIN.defaultActionOrder];

const ACTION_MAP = new Map<SokobanActionId, SemanticGameActionDefinition<SokobanActionId>>(
	SOKOBAN_PLUGIN.actions.map((action) => [action.id, action]),
);

export function getSokobanAction(actionId: SokobanActionId): SemanticGameActionDefinition<SokobanActionId> {
	const action = ACTION_MAP.get(actionId);
	if (!action) {
		throw new Error(`unknown sokoban action: ${actionId}`);
	}
	return action;
}

export function formatSokobanAction(actionId: SokobanActionId | null): string {
	if (!actionId) return "none";
	return getSokobanAction(actionId).label;
}
