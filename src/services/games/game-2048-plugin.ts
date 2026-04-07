import type {
	Game2048ActionId,
	SemanticGameActionDefinition,
	SemanticGamePluginDefinition,
} from "@/types";

export const GAME_2048_DEFAULT_ACTION_ORDER: Game2048ActionId[] = [
	"move_up",
	"move_left",
	"move_right",
	"move_down",
];

export const GAME_2048_PLUGIN: SemanticGamePluginDefinition<Game2048ActionId> = {
	gameId: "2048",
	displayName: "2048",
	actions: [
		{
			id: "move_up",
			label: "Up",
			description: "Shift the board upward once.",
			steps: [{ kind: "send-key", key: "Up" }],
		},
		{
			id: "move_left",
			label: "Left",
			description: "Shift the board left once.",
			steps: [{ kind: "send-key", key: "Left" }],
		},
		{
			id: "move_right",
			label: "Right",
			description: "Shift the board right once.",
			steps: [{ kind: "send-key", key: "Right" }],
		},
		{
			id: "move_down",
			label: "Down",
			description: "Shift the board downward once.",
			steps: [{ kind: "send-key", key: "Down" }],
		},
	],
};

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
