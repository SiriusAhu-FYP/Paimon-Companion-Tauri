import type { StardewActionKey, StardewTaskDefinition, StardewTaskId } from "@/types";
import {
	cloneTemplateAnalysis,
	defineFixedActionTaskTemplate,
	defineVisionActionTaskTemplate,
	toTaskDefinitions,
	type ActionTaskTemplate,
} from "./task-templates";

const MOVEMENT_PRIORITY: readonly StardewActionKey[] = ["W", "A", "D", "S"];

const STARDew_TASK_TEMPLATES: ReadonlyArray<ActionTaskTemplate<StardewTaskId, StardewActionKey>> = [
	defineVisionActionTaskTemplate({
		id: "reposition",
		name: "Reposition Character",
		description: "Take one small movement step based on the current scene.",
		analysisMode: "vision",
		actionSpace: MOVEMENT_PRIORITY,
		verificationThreshold: 0.014,
		buildVisionPrompt: (targetTitle) => [
			"You are analyzing a Stardew Valley gameplay screenshot.",
			`Window title: ${targetTitle}.`,
			"Choose a safe one-step reposition for the player using only W, A, S, D.",
			"Return strict JSON with keys: strategy, reasoning, preferredActions.",
			"preferredActions must contain each of W, A, D, S exactly once, ordered by priority.",
			"Prefer a small movement likely to cause a visible scene change without committing to a long path.",
		].join(" "),
		fallbackAnalysis: {
			source: "heuristic",
			strategy: "try a conservative one-step reposition with north-west bias",
			reasoning: "Without vision analysis, movement defaults to W/A/D/S as a scene-change probe.",
			preferredActions: [...MOVEMENT_PRIORITY],
		},
	}),
	defineFixedActionTaskTemplate({
		id: "open-inventory",
		name: "Open Inventory",
		description: "Toggle the inventory open and verify that the UI changed.",
		analysisMode: "fixed",
		verificationThreshold: 0.03,
		analysis: {
			source: "heuristic",
			strategy: "toggle the inventory with E and expect a strong UI change",
			reasoning: "Inventory is a deterministic small task with a stable keyboard shortcut.",
			preferredActions: ["E"],
		},
	}),
	defineFixedActionTaskTemplate({
		id: "close-menu",
		name: "Close Menu",
		description: "Dismiss the current menu layer with Escape and verify the scene changed back.",
		analysisMode: "fixed",
		verificationThreshold: 0.03,
		analysis: {
			source: "heuristic",
			strategy: "dismiss the current menu layer with Escape",
			reasoning: "Escape is the safest generic way to close Stardew overlays and return to gameplay.",
			preferredActions: ["Escape"],
		},
	}),
];

export function getStardewTaskTemplate(taskId: StardewTaskId): ActionTaskTemplate<StardewTaskId, StardewActionKey> {
	const template = STARDew_TASK_TEMPLATES.find((candidate) => candidate.id === taskId);
	if (!template) {
		throw new Error(`unknown Stardew task template: ${taskId}`);
	}

	if (template.analysisMode === "fixed") {
		return {
			...template,
			analysis: cloneTemplateAnalysis(template.analysis),
		};
	}

	return {
		...template,
		actionSpace: [...template.actionSpace],
		fallbackAnalysis: cloneTemplateAnalysis(template.fallbackAnalysis),
	};
}

export function getStardewTaskDefinitions(): StardewTaskDefinition[] {
	return toTaskDefinitions(STARDew_TASK_TEMPLATES).map((task) => ({ ...task }));
}
