import { describe, expect, it } from "vitest";
import { getDelegatedBrowserTaskConfig } from "./delegated-task-config";

describe("delegated task config", () => {
	it("disables thinking by default and allows short safe browser action chains", () => {
		const config = getDelegatedBrowserTaskConfig();

		expect(config.maxActionsPerRound).toBe(4);
		expect(config.missionAnalystThinkingMode).toBe("off");
		expect(config.operationsPlannerThinkingMode).toBe("off");
		expect(config.progressEvaluatorThinkingMode).toBe("off");
	});

	it("has plannerSpeechLeadMs with a valid default", () => {
		const config = getDelegatedBrowserTaskConfig();

		expect(config.plannerSpeechLeadMs).toBeTypeOf("number");
		expect(config.plannerSpeechLeadMs).toBeGreaterThanOrEqual(0);
		expect(config.plannerSpeechLeadMs).toBeLessThanOrEqual(5000);
	});

	it("keeps browser vision preprocessing disabled by default", () => {
		const config = getDelegatedBrowserTaskConfig();

		expect(config.visionPreprocess.enabled).toBe(false);
		expect(config.visionPreprocess.mode).toBe("none");
		expect(config.visionPreprocess.crop).toEqual({
			xNorm: 0,
			yNorm: 0,
			widthNorm: 1,
			heightNorm: 1,
		});
		expect(config.visionPreprocess.format).toBe("png");
	});
});
