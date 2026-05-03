import type { HostMouseAction, HostMouseButton } from "./system";

export type SemanticHostStep =
	| { kind: "focus" }
	| { kind: "send-key"; key: string }
	| {
		kind: "send-mouse";
		x?: number;
		y?: number;
		button?: HostMouseButton;
		action?: HostMouseAction;
	};

export interface SemanticGameActionDefinition<ActionId extends string> {
	id: ActionId;
	label: string;
	description: string;
	steps: SemanticHostStep[];
}

export interface SemanticGamePluginDefinition<ActionId extends string> {
	gameId: string;
	displayName: string;
	actions: readonly SemanticGameActionDefinition<ActionId>[];
}

export interface SemanticDelegationProfileConfig {
	profileId?: string;
	taskId?: string;
	displayName?: string;
	maxRounds?: number;
	maxActionsPerRound?: number;
	afterActionWaitMs?: number;
	locatorRulesEnabled?: boolean;
	locatorCloudEnabled?: boolean;
	locatorLocalFallbackEnabled?: boolean;
	locatorMinConfidence?: number;
	missionAnalystTemperature?: number;
	missionAnalystThinkingMode?: "off" | "low" | "medium" | "high";
	operationsPlannerTemperature?: number;
	operationsPlannerThinkingMode?: "off" | "low" | "medium" | "high";
	progressEvaluatorTemperature?: number;
	progressEvaluatorThinkingMode?: "off" | "low" | "medium" | "high";
	allowedTools?: readonly string[];
	missionAnalystRules?: readonly string[];
	operationsPlannerRules?: readonly string[];
	progressEvaluatorRules?: readonly string[];
	boardPerceptionPrompt?: string;
	visionPreprocess?: {
		enabled?: boolean;
		mode?: "none" | "crop-only" | "crop-resize";
		crop?: {
			xNorm?: number;
			yNorm?: number;
			widthNorm?: number;
			heightNorm?: number;
		};
		maxWidth?: number;
		maxHeight?: number;
		format?: "png" | "jpeg";
		quality?: number;
	};
	longSequence?: {
		enabled?: boolean;
		maxActions?: number;
		stepWaitMs?: number;
		stopOnUnchangedSnapshot?: boolean;
	};
}

export interface SemanticGameManifest<ActionId extends string> extends SemanticGamePluginDefinition<ActionId> {
	defaultActionOrder: readonly ActionId[];
	notes?: readonly string[];
	windowTitleHints?: readonly string[];
	observationFocus?: readonly string[];
	loadGuardPolicy?: "auto" | "force-enable" | "force-disable";
	delegationProfile?: SemanticDelegationProfileConfig;
}

export interface SemanticActionExecutionResult<ActionId extends string> {
	actionId: ActionId;
	label: string;
	taskIds: string[];
	beforeSnapshotAvailable: boolean;
	afterSnapshotAvailable: boolean;
}
