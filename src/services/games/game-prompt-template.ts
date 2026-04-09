import sharedGamePromptTemplate from "../../../prompts/example.md?raw";

export interface SharedGamePromptInput {
	gameName: string;
	taskName: string;
	targetWindow: string;
	actionList: string[];
	gameRules: string[];
	stateCues: string[];
	recentDecisions: string[];
	goal: string;
}

function formatList(items: string[]): string {
	const normalized = items.map((item) => item.trim()).filter(Boolean);
	if (!normalized.length) {
		return "- none";
	}
	return normalized.map((item) => `- ${item}`).join("\n");
}

function replaceToken(template: string, token: string, value: string): string {
	return template.split(token).join(value);
}

export function buildSharedGamePrompt(input: SharedGamePromptInput): string {
	return replaceToken(
		replaceToken(
			replaceToken(
				replaceToken(
					replaceToken(
						replaceToken(
							replaceToken(sharedGamePromptTemplate, "{game_name}", input.gameName),
							"{task_name}",
							input.taskName,
						),
						"{target_window}",
						input.targetWindow,
					),
					"{action_list}",
					formatList(input.actionList),
				),
				"{game_rules}",
				formatList(input.gameRules),
			),
			"{state_cues}",
			formatList(input.stateCues),
		),
		"{recent_decisions}",
		formatList(input.recentDecisions),
	)
		.split("{goal}")
		.join(input.goal)
		.trim();
}
