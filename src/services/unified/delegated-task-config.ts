import rawBrowserTaskConfigToml from "@/config/tasks/delegation-browser.toml?raw";
import { parse } from "smol-toml";

export type DelegatedThinkingMode = "off" | "low" | "medium" | "high";
export type DelegatedTaskProfileId = "delegation";

export interface DelegatedTaskProfileConfig {
	taskId: string;
	displayName: string;
	maxRounds: number;
	maxActionsPerRound: number;
	afterActionWaitMs: number;
	plannerSpeechLeadMs: number;
	locatorRulesEnabled: boolean;
	locatorCloudEnabled: boolean;
	locatorLocalFallbackEnabled: boolean;
	locatorMinConfidence: number;
	missionAnalystTemperature: number;
	missionAnalystThinkingMode: DelegatedThinkingMode;
	operationsPlannerTemperature: number;
	operationsPlannerThinkingMode: DelegatedThinkingMode;
	progressEvaluatorTemperature: number;
	progressEvaluatorThinkingMode: DelegatedThinkingMode;
	allowedTools: string[];
	missionAnalystRules: string[];
	operationsPlannerRules: string[];
	progressEvaluatorRules: string[];
}

export interface DelegatedTaskProfilesConfig {
	defaultProfileId: string;
	profiles: Record<string, DelegatedTaskProfileConfig>;
}

type BrowserProfileTomlRaw = {
	defaultProfileId?: unknown;
	profile?: unknown;
};

type DelegatedTaskProfileRaw = {
	taskId?: unknown;
	displayName?: unknown;
	maxRounds?: unknown;
	maxActionsPerRound?: unknown;
	afterActionWaitMs?: unknown;
	plannerSpeechLeadMs?: unknown;
	locatorRulesEnabled?: unknown;
	locatorCloudEnabled?: unknown;
	locatorLocalFallbackEnabled?: unknown;
	locatorMinConfidence?: unknown;
	missionAnalystTemperature?: unknown;
	missionAnalystThinkingMode?: unknown;
	operationsPlannerTemperature?: unknown;
	operationsPlannerThinkingMode?: unknown;
	progressEvaluatorTemperature?: unknown;
	progressEvaluatorThinkingMode?: unknown;
	allowedTools?: unknown;
	missionAnalystRules?: unknown;
	operationsPlannerRules?: unknown;
	progressEvaluatorRules?: unknown;
	locator?: unknown;
	roles?: unknown;
	plannerTemperature?: unknown;
	reflectionTemperature?: unknown;
	plannerRules?: unknown;
	reflectionRules?: unknown;
};

const DEFAULT_PROFILE_ID: DelegatedTaskProfileId = "delegation";

const DEFAULT_PROFILE_CONFIG: DelegatedTaskProfileConfig = {
	taskId: "delegation-generic",
	displayName: "Generic Delegation",
	maxRounds: 12,
	maxActionsPerRound: 2,
	afterActionWaitMs: 1000,
	plannerSpeechLeadMs: 2000,
	locatorRulesEnabled: true,
	locatorCloudEnabled: false,
	locatorLocalFallbackEnabled: true,
	locatorMinConfidence: 0.55,
	missionAnalystTemperature: 0.1,
	missionAnalystThinkingMode: "medium",
	operationsPlannerTemperature: 0.1,
	operationsPlannerThinkingMode: "medium",
	progressEvaluatorTemperature: 0.1,
	progressEvaluatorThinkingMode: "medium",
	allowedTools: [
		"host.list_windows",
		"host.focus_window",
		"host.capture_window",
		"host.resolve_locator_consensus",
		"host.send_key",
		"host.send_mouse",
		"host.paste_text",
	],
	missionAnalystRules: [],
	operationsPlannerRules: [],
	progressEvaluatorRules: [],
};

const DEFAULT_PROFILES: Record<string, DelegatedTaskProfileConfig> = {
	delegation: {
		...DEFAULT_PROFILE_CONFIG,
		taskId: "delegation-generic",
		displayName: "Generic Delegation",
	},
};

function sanitizeStringArray(input: unknown): string[] {
	if (!Array.isArray(input)) {
		return [];
	}
	return input
		.map((item) => (typeof item === "string" ? item.trim() : ""))
		.filter(Boolean);
}

function sanitizeNumber(value: unknown, fallback: number, min: number, max: number): number {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		return fallback;
	}
	return Math.min(max, Math.max(min, value));
}

function sanitizeBoolean(value: unknown, fallback: boolean): boolean {
	if (typeof value === "boolean") {
		return value;
	}
	return fallback;
}

function sanitizeThinkingMode(value: unknown, fallback: DelegatedThinkingMode): DelegatedThinkingMode {
	if (value === "off" || value === "low" || value === "medium" || value === "high") {
		return value;
	}
	return fallback;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseTomlObject(rawToml: string): Record<string, unknown> {
	try {
		const parsed = parse(rawToml);
		return isObjectRecord(parsed) ? parsed : {};
	} catch {
		return {};
	}
}

function flattenProfileRaw(input: unknown): DelegatedTaskProfileRaw {
	if (!isObjectRecord(input)) {
		return {};
	}
	const parsed: DelegatedTaskProfileRaw = { ...input };
	const locator = isObjectRecord(parsed.locator) ? parsed.locator : {};
	const roles = isObjectRecord(parsed.roles) ? parsed.roles : {};
	const missionAnalyst = isObjectRecord(roles.missionAnalyst) ? roles.missionAnalyst : {};
	const operationsPlanner = isObjectRecord(roles.operationsPlanner) ? roles.operationsPlanner : {};
	const progressEvaluator = isObjectRecord(roles.progressEvaluator) ? roles.progressEvaluator : {};
	return {
		...parsed,
		locatorRulesEnabled: parsed.locatorRulesEnabled ?? locator.locatorRulesEnabled,
		locatorCloudEnabled: parsed.locatorCloudEnabled ?? locator.locatorCloudEnabled,
		locatorLocalFallbackEnabled: parsed.locatorLocalFallbackEnabled ?? locator.locatorLocalFallbackEnabled,
		locatorMinConfidence: parsed.locatorMinConfidence ?? locator.locatorMinConfidence,
		missionAnalystTemperature: parsed.missionAnalystTemperature ?? missionAnalyst.missionAnalystTemperature,
		missionAnalystThinkingMode: parsed.missionAnalystThinkingMode ?? missionAnalyst.missionAnalystThinkingMode,
		missionAnalystRules: parsed.missionAnalystRules ?? missionAnalyst.missionAnalystRules,
		operationsPlannerTemperature: parsed.operationsPlannerTemperature ?? operationsPlanner.operationsPlannerTemperature,
		operationsPlannerThinkingMode: parsed.operationsPlannerThinkingMode ?? operationsPlanner.operationsPlannerThinkingMode,
		operationsPlannerRules: parsed.operationsPlannerRules ?? operationsPlanner.operationsPlannerRules,
		progressEvaluatorTemperature: parsed.progressEvaluatorTemperature ?? progressEvaluator.progressEvaluatorTemperature,
		progressEvaluatorThinkingMode: parsed.progressEvaluatorThinkingMode ?? progressEvaluator.progressEvaluatorThinkingMode,
		progressEvaluatorRules: parsed.progressEvaluatorRules ?? progressEvaluator.progressEvaluatorRules,
	};
}

function sanitizeProfile(rawValue: unknown, fallback: DelegatedTaskProfileConfig): DelegatedTaskProfileConfig {
	const parsed = flattenProfileRaw(rawValue);
	const missionAnalystTemperature = sanitizeNumber(
		parsed.missionAnalystTemperature,
		sanitizeNumber(parsed.plannerTemperature, fallback.missionAnalystTemperature, 0, 1),
		0,
		1,
	);
	const operationsPlannerTemperature = sanitizeNumber(
		parsed.operationsPlannerTemperature,
		sanitizeNumber(parsed.plannerTemperature, fallback.operationsPlannerTemperature, 0, 1),
		0,
		1,
	);
	const progressEvaluatorTemperature = sanitizeNumber(
		parsed.progressEvaluatorTemperature,
		sanitizeNumber(parsed.reflectionTemperature, fallback.progressEvaluatorTemperature, 0, 1),
		0,
		1,
	);
	const missionAnalystRules = sanitizeStringArray(parsed.missionAnalystRules);
	const rawOperationsPlannerRules = sanitizeStringArray(parsed.operationsPlannerRules);
	const rawProgressEvaluatorRules = sanitizeStringArray(parsed.progressEvaluatorRules);
	const operationsPlannerRules = rawOperationsPlannerRules.length
		? rawOperationsPlannerRules
		: sanitizeStringArray(parsed.plannerRules);
	const progressEvaluatorRules = rawProgressEvaluatorRules.length
		? rawProgressEvaluatorRules
		: sanitizeStringArray(parsed.reflectionRules);
	const allowedTools = sanitizeStringArray(parsed.allowedTools);
	return {
		taskId: typeof parsed.taskId === "string" && parsed.taskId.trim() ? parsed.taskId.trim() : fallback.taskId,
		displayName: typeof parsed.displayName === "string" && parsed.displayName.trim()
			? parsed.displayName.trim()
			: fallback.displayName,
		maxRounds: sanitizeNumber(parsed.maxRounds, fallback.maxRounds, 1, 40),
		maxActionsPerRound: sanitizeNumber(parsed.maxActionsPerRound, fallback.maxActionsPerRound, 1, 6),
		afterActionWaitMs: sanitizeNumber(parsed.afterActionWaitMs, fallback.afterActionWaitMs, 200, 5000),
		plannerSpeechLeadMs: sanitizeNumber(parsed.plannerSpeechLeadMs, fallback.plannerSpeechLeadMs, 0, 5000),
		locatorRulesEnabled: sanitizeBoolean(parsed.locatorRulesEnabled, fallback.locatorRulesEnabled),
		locatorCloudEnabled: sanitizeBoolean(parsed.locatorCloudEnabled, fallback.locatorCloudEnabled),
		locatorLocalFallbackEnabled: sanitizeBoolean(parsed.locatorLocalFallbackEnabled, fallback.locatorLocalFallbackEnabled),
		locatorMinConfidence: sanitizeNumber(parsed.locatorMinConfidence, fallback.locatorMinConfidence, 0, 1),
		missionAnalystTemperature,
		missionAnalystThinkingMode: sanitizeThinkingMode(parsed.missionAnalystThinkingMode, fallback.missionAnalystThinkingMode),
		operationsPlannerTemperature,
		operationsPlannerThinkingMode: sanitizeThinkingMode(parsed.operationsPlannerThinkingMode, fallback.operationsPlannerThinkingMode),
		progressEvaluatorTemperature,
		progressEvaluatorThinkingMode: sanitizeThinkingMode(parsed.progressEvaluatorThinkingMode, fallback.progressEvaluatorThinkingMode),
		allowedTools: allowedTools.length ? allowedTools : [...fallback.allowedTools],
		missionAnalystRules: missionAnalystRules.length ? missionAnalystRules : [...fallback.missionAnalystRules],
		operationsPlannerRules: operationsPlannerRules.length ? operationsPlannerRules : [...fallback.operationsPlannerRules],
		progressEvaluatorRules: progressEvaluatorRules.length ? progressEvaluatorRules : [...fallback.progressEvaluatorRules],
	};
}

export function getDelegatedTaskProfilesConfig(): DelegatedTaskProfilesConfig {
	const raw = parseTomlObject(rawBrowserTaskConfigToml) as BrowserProfileTomlRaw;
	const profiles: Record<string, DelegatedTaskProfileConfig> = {
		delegation: sanitizeProfile(raw.profile, DEFAULT_PROFILES.delegation),
	};
	const requestedDefault = typeof raw.defaultProfileId === "string" ? raw.defaultProfileId : DEFAULT_PROFILE_ID;
	const defaultProfileId = profiles[requestedDefault] ? requestedDefault : DEFAULT_PROFILE_ID;
	return {
		defaultProfileId,
		profiles,
	};
}

export function getDelegatedTaskConfig(profileId?: string): DelegatedTaskProfileConfig {
	const bundle = getDelegatedTaskProfilesConfig();
	const targetProfileId = profileId && bundle.profiles[profileId] ? profileId : bundle.defaultProfileId;
	return bundle.profiles[targetProfileId] ?? bundle.profiles[bundle.defaultProfileId];
}

export function getDelegatedBrowserTaskConfig(): DelegatedTaskProfileConfig {
	return getDelegatedTaskConfig("delegation");
}
