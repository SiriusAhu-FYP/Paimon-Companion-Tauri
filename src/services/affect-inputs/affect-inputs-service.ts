import type { EventBus } from "@/services/event-bus";
import type { AffectStateService } from "@/services/affect-state";
import { createLogger } from "@/services/logger";
import type { CompanionEmotion, EventMap } from "@/types";

const log = createLogger("affect-inputs");

const ALARM_PATTERNS = /(危险|糟了|不好|快点|救命|来不及|失败|失误|卡住|麻烦|警告|告急|risk|danger|stuck|failed?)/i;
const ANGRY_PATTERNS = /(生气|烦死|可恶|气死|讨厌|怎么又|annoy|angry|frustrat)/i;
const SAD_PATTERNS = /(难过|伤心|可惜|遗憾|失败了|sad|sorry|upset)/i;
const DELIGHTED_PATTERNS = /(太好了|好耶|厉害|真棒|成功了|赢了|开心|yay|great|awesome|nice)/i;
const DAZED_PATTERNS = /(看不清|不确定|奇怪|怎么回事|迷糊|发懵|懵了|dazed|confused|unclear|not sure)/i;

export class AffectInputsService {
	private bus: EventBus;
	private affect: AffectStateService;

	constructor(deps: {
		bus: EventBus;
		affect: AffectStateService;
	}) {
		this.bus = deps.bus;
		this.affect = deps.affect;

		this.bus.on("llm:request-start", (payload) => {
			this.handleUserTurn(payload);
		});
		this.bus.on("game2048:run-complete", (payload) => {
			this.handle2048Result(payload);
		});
		this.bus.on("sokoban:run-complete", (payload) => {
			this.handleSokobanResult(payload);
		});
		this.bus.on("system:error", (payload) => {
			this.handleSystemError(payload);
		});
	}

	private handleUserTurn(payload: EventMap["llm:request-start"]) {
		if (payload.source === "companion-reply" || payload.source === "proactive-reply") {
			return;
		}
		const inputSource = payload.inputSource ?? "manual";
		const inferred = inferEmotionFromUserText(payload.userText);
		if (!inferred || inferred === "neutral") {
			return;
		}
		this.affect.applyEmotion({
			emotion: inferred,
			source: "system",
			reason: `user-turn:${inputSource}:${inferred}`,
		});
		log.info("affect input from user turn", { inputSource, emotion: inferred });
	}

	private handle2048Result(payload: EventMap["game2048:run-complete"]) {
		const emotion: CompanionEmotion = payload.success && payload.boardChanged ? "happy" : "dazed";
		this.affect.applyEmotion({
			emotion,
			source: "system",
			reason: `task-result:2048:${payload.success ? "success" : "stalled"}`,
			holdForSpeech: true,
		});
	}

	private handleSokobanResult(payload: EventMap["sokoban:run-complete"]) {
		const emotion: CompanionEmotion = payload.success && payload.boardChanged ? "delighted" : "alarmed";
		this.affect.applyEmotion({
			emotion,
			source: "system",
			reason: `task-result:sokoban:${payload.success ? "success" : "stalled"}`,
			holdForSpeech: true,
		});
	}

	private handleSystemError(payload: EventMap["system:error"]) {
		this.affect.applyEmotion({
			emotion: "alarmed",
			source: "system",
			reason: `system-error:${payload.module}`,
		});
	}
}

export function inferEmotionFromUserText(text: string): CompanionEmotion {
	const normalized = text.trim();
	if (!normalized) return "neutral";
	if (ALARM_PATTERNS.test(normalized)) return "alarmed";
	if (ANGRY_PATTERNS.test(normalized)) return "angry";
	if (SAD_PATTERNS.test(normalized)) return "sad";
	if (DELIGHTED_PATTERNS.test(normalized)) return "delighted";
	if (DAZED_PATTERNS.test(normalized)) return "dazed";
	if (/[!?！？]{2,}/.test(normalized)) return "happy";
	return "neutral";
}
