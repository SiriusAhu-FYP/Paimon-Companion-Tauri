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

export interface SemanticGameManifest<ActionId extends string> extends SemanticGamePluginDefinition<ActionId> {
	defaultActionOrder: readonly ActionId[];
	notes?: readonly string[];
	windowTitleHints?: readonly string[];
	observationFocus?: readonly string[];
}

export interface SemanticActionExecutionResult<ActionId extends string> {
	actionId: ActionId;
	label: string;
	taskIds: string[];
	beforeSnapshotAvailable: boolean;
	afterSnapshotAvailable: boolean;
}
