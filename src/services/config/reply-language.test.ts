import { beforeEach, describe, expect, it, vi } from "vitest";

const { getConfig } = vi.hoisted(() => ({
	getConfig: vi.fn(),
}));

vi.mock("@/services/config/config-service", () => ({
	getConfig,
}));

import {
	buildConversationReplyLanguageInstruction,
	buildStructuredReplyLanguageInstruction,
	getReplyLanguageMode,
	pickReplyLanguageText,
} from "./reply-language";

describe("reply language helpers", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("uses zh as default mode", () => {
		getConfig.mockReturnValue({ locale: "zh" });
		expect(getReplyLanguageMode()).toBe("zh");
		expect(pickReplyLanguageText("你好", "hello")).toBe("你好");
	});

	it("switches to en mode", () => {
		getConfig.mockReturnValue({ locale: "en" });
		expect(getReplyLanguageMode()).toBe("en");
		expect(pickReplyLanguageText("你好", "hello")).toBe("hello");
	});

	it("builds conversation instruction from locale", () => {
		getConfig.mockReturnValue({ locale: "en" });
		expect(buildConversationReplyLanguageInstruction()).toContain("Current reply language mode: English (en).");
		getConfig.mockReturnValue({ locale: "zh" });
		expect(buildConversationReplyLanguageInstruction()).toContain("当前回复语言模式：简体中文（zh）。");
	});

	it("builds structured instruction with JSON guard", () => {
		getConfig.mockReturnValue({ locale: "en" });
		const instruction = buildStructuredReplyLanguageInstruction({ jsonResponse: true });
		expect(instruction).toContain("Reply language mode: English (en).");
		expect(instruction).toContain("If you output JSON, keep keys");
	});
});
