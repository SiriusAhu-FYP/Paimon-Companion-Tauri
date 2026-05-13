import type { CompanionEmotion } from "@/types";
import type { ToolDef } from "@/services/llm/types";

export interface McpToolDefinition {
	mcpName: string;
	llmName: string;
	description: string;
	parameters: Record<string, unknown>;
	scope: "companion" | "game" | "host";
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
	{
		mcpName: "host.list_windows",
		llmName: "host_list_windows",
		scope: "host",
		description: "List desktop windows and return focus candidates for delegated host control.",
		parameters: {
			type: "object",
			properties: {
				query: {
					type: "string",
					description: "Optional keyword filter applied to title, process name, class, handle, and PID.",
				},
				limit: {
					type: "number",
					description: "Optional max result count. Defaults to 20.",
				},
			},
			additionalProperties: false,
		},
	},
	{
		mcpName: "host.focus_window",
		llmName: "host_focus_window",
		scope: "host",
		description: "Focus one desktop window by explicit target handle/title or currently selected target.",
		parameters: {
			type: "object",
			properties: {
				targetHandle: { type: "string" },
				targetTitle: { type: "string" },
				applyDelegatedViewport: {
					type: "boolean",
					description: "When true, apply delegated viewport resize policy (16:9 reduced tier, centered). Defaults to true.",
				},
			},
			additionalProperties: false,
		},
	},
	{
		mcpName: "host.capture_window",
		llmName: "host_capture_window",
		scope: "host",
		description: "Capture one screenshot from the target window.",
		parameters: {
			type: "object",
			properties: {
				targetHandle: { type: "string" },
				targetTitle: { type: "string" },
			},
			additionalProperties: false,
		},
	},
	{
		mcpName: "host.resolve_locator_consensus",
		llmName: "host_resolve_locator_consensus",
		scope: "host",
		description: "Run multiple local vision localization samples, reject outlier boxes, and return a robust averaged click center.",
		parameters: {
			type: "object",
			properties: {
				locatorHint: { type: "string", description: "What UI element to locate, e.g. 地址栏 / 搜索框 / New repository." },
				taskGoal: { type: "string", description: "Optional task goal context to improve localization intent understanding." },
				targetHandle: { type: "string" },
				targetTitle: { type: "string" },
				samples: { type: "number", description: "Number of local vision samples, default 4, range 2-8." },
			},
			required: ["locatorHint"],
			additionalProperties: false,
		},
	},
	{
		mcpName: "host.send_key",
		llmName: "host_send_key",
		scope: "host",
		description: "Send one key token or key combo such as Enter, Space, Ctrl+L to target window.",
		parameters: {
			type: "object",
			properties: {
				key: { type: "string" },
				targetHandle: { type: "string" },
				targetTitle: { type: "string" },
			},
			required: ["key"],
			additionalProperties: false,
		},
	},
	{
		mcpName: "host.send_mouse",
		llmName: "host_send_mouse",
		scope: "host",
		description: "Send mouse action to target window with optional pixel or normalized coordinates.",
		parameters: {
			type: "object",
			properties: {
				action: { type: "string", enum: ["move", "down", "up", "click"] },
				button: { type: "string", enum: ["left", "right", "middle"] },
				x: { type: "number" },
				y: { type: "number" },
				xNorm: { type: "number", description: "Normalized X in [0,1], auto-converted using latest target capture." },
				yNorm: { type: "number", description: "Normalized Y in [0,1], auto-converted using latest target capture." },
				locatorHint: { type: "string", description: "Optional click intent hint for upstream locator ladder." },
				allowLocalVisionFallback: { type: "boolean" },
				targetHandle: { type: "string" },
				targetTitle: { type: "string" },
			},
			additionalProperties: false,
		},
	},
	{
		mcpName: "host.paste_text",
		llmName: "host_paste_text",
		scope: "host",
		description: "Paste full sentence into target window. Falls back to per-character key input when paste fails.",
		parameters: {
			type: "object",
			properties: {
				text: { type: "string" },
				targetHandle: { type: "string" },
				targetTitle: { type: "string" },
			},
			required: ["text"],
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

function normalizeToolNames(names: readonly string[]): Set<string> {
	return new Set(
		names
			.map((name) => name.trim())
			.filter(Boolean),
	);
}

export function listLlmToolsFromRuntime(
	scope: McpToolDefinition["scope"],
	runtimeToolNames: readonly string[],
): ToolDef[] {
	const runtimeNames = normalizeToolNames(runtimeToolNames);
	if (!runtimeNames.size) {
		return listLlmTools(scope);
	}
	const matched = listMcpToolDefinitions(scope)
		.filter((tool) => runtimeNames.has(tool.mcpName))
		.map((tool) => ({
			name: tool.llmName,
			description: tool.description,
			parameters: tool.parameters,
		}));
	return matched.length ? matched : listLlmTools(scope);
}

export function resolveMcpToolName(name: string): string {
	const match = TOOL_DEFINITIONS.find((tool) => tool.llmName === name || tool.mcpName === name);
	return match?.mcpName ?? name;
}
