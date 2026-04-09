import type { CompanionEmotion } from "@/types";
import type { ToolDef } from "@/services/llm/types";

export interface McpToolDefinition {
	mcpName: string;
	llmName: string;
	description: string;
	parameters: Record<string, unknown>;
	scope: "companion" | "game";
}

const COMPANION_EMOTIONS: CompanionEmotion[] = [
	"neutral",
	"happy",
	"angry",
	"sad",
	"delighted",
	"alarmed",
	"dazed",
];

const TOOL_DEFINITIONS: McpToolDefinition[] = [
	{
		mcpName: "companion.set_emotion",
		llmName: "companion_set_emotion",
		scope: "companion",
		description: "Update the companion's current emotion so the Live2D model can switch expression to match the reply.",
		parameters: {
			type: "object",
			properties: {
				emotion: {
					type: "string",
					enum: COMPANION_EMOTIONS,
					description: "The companion emotion to present.",
				},
			},
			required: ["emotion"],
			additionalProperties: false,
		},
	},
	{
		mcpName: "companion.reset_emotion",
		llmName: "companion_reset_emotion",
		scope: "companion",
		description: "Reset the companion back to neutral emotion.",
		parameters: {
			type: "object",
			properties: {},
			additionalProperties: false,
		},
	},
	{
		mcpName: "companion.get_state",
		llmName: "companion_get_state",
		scope: "companion",
		description: "Return the current companion state, including emotion, speaking state, and active model.",
		parameters: {
			type: "object",
			properties: {},
			additionalProperties: false,
		},
	},
	{
		mcpName: "game.list_actions",
		llmName: "game_list_actions",
		scope: "game",
		description: "List semantic actions for a known game plugin.",
		parameters: {
			type: "object",
			properties: {
				gameId: {
					type: "string",
					description: "Optional game identifier such as 2048 or sokoban. Omit to list every registered game.",
				},
			},
			additionalProperties: false,
		},
	},
	{
		mcpName: "game.perform_action",
		llmName: "game_perform_action",
		scope: "game",
		description: "Perform one semantic game action using the currently selected target window or an explicitly supplied target.",
		parameters: {
			type: "object",
			properties: {
				gameId: { type: "string", description: "Registered game identifier, for example 2048 or sokoban." },
				actionId: { type: "string", description: "Semantic action id from the game manifest." },
				targetHandle: { type: "string", description: "Optional target window handle override." },
				targetTitle: { type: "string", description: "Optional target window title override." },
			},
			required: ["gameId", "actionId"],
			additionalProperties: false,
		},
	},
];

export function listMcpToolDefinitions(scope?: McpToolDefinition["scope"]): readonly McpToolDefinition[] {
	if (!scope) return TOOL_DEFINITIONS;
	return TOOL_DEFINITIONS.filter((tool) => tool.scope === scope);
}

export function listLlmTools(scope?: McpToolDefinition["scope"]): ToolDef[] {
	return listMcpToolDefinitions(scope).map((tool) => ({
		name: tool.llmName,
		description: tool.description,
		parameters: tool.parameters,
	}));
}

export function resolveMcpToolName(name: string): string {
	const match = TOOL_DEFINITIONS.find((tool) => tool.llmName === name || tool.mcpName === name);
	return match?.mcpName ?? name;
}
