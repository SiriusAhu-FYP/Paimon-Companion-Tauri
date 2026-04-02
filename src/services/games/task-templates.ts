import type { PerceptionSnapshot } from "@/types";
import { extractJsonObject } from "./game-utils";

export interface TemplateAnalysis<ActionKey extends string> {
	source: "vision-llm" | "heuristic";
	strategy: string;
	reasoning: string;
	preferredActions: ActionKey[];
}

interface ActionTaskTemplateBase<TaskId extends string> {
	id: TaskId;
	name: string;
	description: string;
	verificationThreshold: number;
}

export interface FixedActionTaskTemplate<TaskId extends string, ActionKey extends string>
	extends ActionTaskTemplateBase<TaskId> {
	analysisMode: "fixed";
	analysis: TemplateAnalysis<ActionKey>;
}

export interface VisionActionTaskTemplate<TaskId extends string, ActionKey extends string>
	extends ActionTaskTemplateBase<TaskId> {
	analysisMode: "vision";
	actionSpace: readonly ActionKey[];
	buildVisionPrompt: (targetTitle: string, snapshot: PerceptionSnapshot) => string;
	fallbackAnalysis: TemplateAnalysis<ActionKey>;
}

export type ActionTaskTemplate<TaskId extends string, ActionKey extends string> =
	| FixedActionTaskTemplate<TaskId, ActionKey>
	| VisionActionTaskTemplate<TaskId, ActionKey>;

export function defineFixedActionTaskTemplate<TaskId extends string, ActionKey extends string>(
	template: FixedActionTaskTemplate<TaskId, ActionKey>,
): FixedActionTaskTemplate<TaskId, ActionKey> {
	return {
		...template,
		analysis: {
			...template.analysis,
			preferredActions: [...template.analysis.preferredActions],
		},
	};
}

export function defineVisionActionTaskTemplate<TaskId extends string, ActionKey extends string>(
	template: VisionActionTaskTemplate<TaskId, ActionKey>,
): VisionActionTaskTemplate<TaskId, ActionKey> {
	return {
		...template,
		actionSpace: [...template.actionSpace],
		fallbackAnalysis: {
			...template.fallbackAnalysis,
			preferredActions: [...template.fallbackAnalysis.preferredActions],
		},
	};
}

export function toTaskDefinitions<TaskId extends string>(
	templates: ReadonlyArray<ActionTaskTemplate<TaskId, string>>,
): Array<{ id: TaskId; name: string; description: string }> {
	return templates.map((template) => ({
		id: template.id,
		name: template.name,
		description: template.description,
	}));
}

export function cloneTemplateAnalysis<ActionKey extends string>(
	analysis: TemplateAnalysis<ActionKey>,
): TemplateAnalysis<ActionKey> {
	return {
		...analysis,
		preferredActions: [...analysis.preferredActions],
	};
}

export function parseVisionTemplateResponse<ActionKey extends string>(
	content: string,
	actionSpace: readonly ActionKey[],
	defaults: {
		strategy: string;
		reasoning: string;
	},
): TemplateAnalysis<ActionKey> {
	const jsonText = extractJsonObject(content);
	const parsed = JSON.parse(jsonText) as {
		strategy?: unknown;
		reasoning?: unknown;
		preferredActions?: unknown;
	};

	const preferredActions = normalizeTemplateActions(parsed.preferredActions, actionSpace);
	if (preferredActions.length !== actionSpace.length) {
		throw new Error("vision analysis did not return a full action ordering");
	}

	return {
		source: "vision-llm",
		strategy: typeof parsed.strategy === "string" ? parsed.strategy : defaults.strategy,
		reasoning: typeof parsed.reasoning === "string" ? parsed.reasoning : defaults.reasoning,
		preferredActions,
	};
}

function normalizeTemplateActions<ActionKey extends string>(
	value: unknown,
	actionSpace: readonly ActionKey[],
): ActionKey[] {
	if (!Array.isArray(value)) {
		throw new Error("preferredActions is not an array");
	}

	const allowed = new Set<ActionKey>(actionSpace);
	const seen = new Set<ActionKey>();
	const normalized: ActionKey[] = [];

	for (const entry of value) {
		const action = String(entry) as ActionKey;
		if (!allowed.has(action) || seen.has(action)) {
			continue;
		}
		seen.add(action);
		normalized.push(action);
	}

	return normalized;
}
