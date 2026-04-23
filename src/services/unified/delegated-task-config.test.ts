import { describe, expect, it } from "vitest";
import { getDelegatedBrowserTaskConfig } from "./delegated-task-config";

describe("delegated task config", () => {
	it("enables thinking by default and allows short safe browser action chains", () => {
		const config = getDelegatedBrowserTaskConfig();

		expect(config.maxActionsPerRound).toBe(4);
		expect(config.missionAnalystThinkingMode).toBe("medium");
		expect(config.operationsPlannerThinkingMode).toBe("medium");
		expect(config.progressEvaluatorThinkingMode).toBe("medium");
	});
});
