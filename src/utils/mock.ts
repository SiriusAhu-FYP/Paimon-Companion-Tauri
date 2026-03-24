import type { EventBus } from "@/services/event-bus";
import type { CharacterConfig } from "@/types";
import type { CharacterService } from "@/services/character";
import type { ExternalInputService } from "@/services/external-input";
import type { RuntimeService } from "@/services/runtime";
import { createLogger } from "@/services/logger";

const log = createLogger("mock");

// Mock 角色配置
export const MOCK_CHARACTER_CONFIG: CharacterConfig = {
	id: "paimon",
	name: "派蒙",
	persona: "你是旅行者的好伙伴派蒙，说话活泼可爱，喜欢吃东西。",
	defaultEmotion: "neutral",
	expressionMap: {
		neutral: "exp_neutral",
		happy: "exp_happy",
		sad: "exp_sad",
		angry: "exp_angry",
		surprised: "exp_surprised",
	},
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

// 模拟外部事件注入
export function mockExternalEvents(externalInput: ExternalInputService) {
	log.info("injecting mock external events");

	externalInput.injectEvent({
		source: "debug",
		type: "danmaku",
		data: { user: "测试用户A", text: "派蒙好可爱！" },
	});

	setTimeout(() => {
		externalInput.injectEvent({
			source: "debug",
			type: "gift",
			data: { user: "测试用户B", giftName: "火箭", count: 1 },
		});
	}, 500);

	setTimeout(() => {
		externalInput.injectEvent({
			source: "debug",
			type: "product-message",
			data: {
				priority: true,
				content: "当前主推商品：原神周边摆件，限时8折优惠！",
				ttl: 300,
			},
		});
	}, 1000);
}

// 初始化 mock 角色
export function mockCharacterInit(character: CharacterService) {
	character.loadConfig(MOCK_CHARACTER_CONFIG);
	log.info("mock character loaded");
}

// 将 mock 工具挂载到 window 上，方便在开发者工具中使用
export function exposeMockTools(bus: EventBus, character: CharacterService, externalInput: ExternalInputService, runtime: RuntimeService) {
	const tools = {
		voicePipeline: () => mockVoicePipeline(bus, runtime),
		externalEvents: () => mockExternalEvents(externalInput),
		emit: bus.emit.bind(bus),
		stop: () => bus.emit("system:emergency-stop"),
		resume: () => bus.emit("system:resume"),
		setEmotion: (e: string) => character.setEmotion(e),
		injectDanmaku: (user: string, text: string) =>
			externalInput.injectEvent({
				source: "devtools",
				type: "danmaku",
				data: { user, text },
			}),
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
