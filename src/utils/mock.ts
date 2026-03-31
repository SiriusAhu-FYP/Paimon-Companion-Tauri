import type { EventBus } from "@/services/event-bus";
import type { CharacterProfile } from "@/types";
import type { CharacterService } from "@/services/character";
import type { RuntimeService } from "@/services/runtime";
import { createLogger } from "@/services/logger";

const log = createLogger("mock");

/** 无角色卡时的默认手动档案（派蒙占位） */
export const MOCK_CHARACTER_PROFILE: CharacterProfile = {
	id: "paimon-manual",
	name: "派蒙",
	persona: "你是旅行者的好伙伴派蒙，说话活泼可爱，喜欢吃东西。",
	scenario: "",
	firstMessage: "",
	messageExamples: "",
	systemPrompt: "",
	defaultEmotion: "neutral",
	expressionMap: {
		neutral: "exp_neutral",
		happy: "exp_happy",
		sad: "exp_sad",
		angry: "exp_angry",
		surprised: "exp_surprised",
	},
	source: "manual",
};

/**
 * 模拟完整的 ASR → LLM → TTS → 音频播放 → 口型驱动链路。
 * 使用 pipeline.run() 走完整链路（包括 mock LLM → mock TTS → AudioPlayer → 口型数据）。
 */
export async function mockVoicePipeline(bus: EventBus, runtime?: RuntimeService) {
	if (runtime && !runtime.isAllowed()) {
		log.warn("mock voice pipeline BLOCKED — runtime mode is: " + runtime.getMode());
		return;
	}

	log.info("starting mock voice pipeline (full pipeline path)");

	bus.emit("audio:asr-result", {
		text: "你好，派蒙！今天有什么好吃的推荐吗？",
		source: "voice",
	});

	// 使用服务容器中的 pipeline 走完整链路
	try {
		const { getServices } = await import("@/services");
		const { pipeline } = getServices();
		await pipeline.run("你好，派蒙！今天有什么好吃的推荐吗？");
	} catch (err) {
		log.error("mock pipeline failed", err);
	}
}

// 初始化默认角色档案（无卡或未选卡时）
export function mockCharacterInit(character: CharacterService) {
	character.loadFromProfile(MOCK_CHARACTER_PROFILE);
	log.info("mock character profile loaded");
}

// 将 mock 工具挂载到 window 上，方便在开发者工具中使用
export function exposeMockTools(bus: EventBus, character: CharacterService, runtime: RuntimeService) {
	const tools = {
		voicePipeline: () => mockVoicePipeline(bus, runtime),
		emit: bus.emit.bind(bus),
		stop: () => bus.emit("system:emergency-stop"),
		resume: () => bus.emit("system:resume"),
		setEmotion: (e: string) => character.setEmotion(e),
		// TTS 调试：设置合成失败注入索引（null 清除）
		setTTSFailIndex: async (index: number | null) => {
			try {
				const { getServices } = await import("@/services");
				const { pipeline } = getServices();
				pipeline.getSpeechQueue().setDebugFailIndex(index);
			} catch (err) {
				log.error("setTTSFailIndex failed", err);
			}
		},
		// TTS 调试：开关静音裁剪（默认关闭）
		setTrimEnabled: async (enabled: boolean) => {
			try {
				const { getServices } = await import("@/services");
				const { pipeline } = getServices();
				pipeline.getSpeechQueue().setTrimEnabled(enabled);
			} catch (err) {
				log.error("setTrimEnabled failed", err);
			}
		},
		// Phase 3 M6: 网络能力测试
		testProxy: async (url: string) => {
			const { proxyRequest } = await import("@/services/config");
			return proxyRequest({ url, method: "GET", timeoutMs: 10000 });
		},
		testSecretProxy: async (url: string, secretKey: string) => {
			const { proxyRequest } = await import("@/services/config");
			return proxyRequest({ url, method: "GET", secretKey, timeoutMs: 10000 });
		},
	};

	(window as unknown as Record<string, unknown>).__paimon = tools;
	log.info("mock tools exposed at window.__paimon");
}
