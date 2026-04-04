import type { TTSProviderConfig } from "@/services/config/types";
import { createLogger } from "@/services/logger";
import type { DirectSpeakHooks, ITTSService, VoiceConfig } from "./types";

const log = createLogger("browser-native-tts");

const LANGUAGE_MAP: Record<string, string> = {
	zh: "zh-CN",
	en: "en-US",
	ja: "ja-JP",
};

function resolveLang(rawLang: string | undefined, fallback: string): string {
	const candidate = (rawLang || fallback || "zh").trim().toLowerCase();
	return LANGUAGE_MAP[candidate] ?? candidate;
}

function pulseMouth(onMouthData?: (value: number) => void): number | null {
	if (!onMouthData) return null;
	let tick = 0;
	onMouthData(0.2);
	return window.setInterval(() => {
		tick += 1;
		const value = 0.25 + Math.abs(Math.sin(tick * 0.75)) * 0.55;
		onMouthData(value);
	}, 90);
}

function stopMouth(timerId: number | null, onMouthData?: (value: number) => void) {
	if (timerId != null) {
		window.clearInterval(timerId);
	}
	onMouthData?.(0);
}

function pickVoice(lang: string, voiceName: string | undefined): SpeechSynthesisVoice | null {
	const voices = window.speechSynthesis.getVoices();
	if (!voices.length) return null;
	if (voiceName?.trim()) {
		const exact = voices.find((voice) => voice.name === voiceName.trim() || voice.voiceURI === voiceName.trim());
		if (exact) return exact;
	}
	return voices.find((voice) => voice.lang.toLowerCase().startsWith(lang.toLowerCase().slice(0, 2))) ?? voices[0];
}

export class BrowserNativeTTSService implements ITTSService {
	readonly deliveryMode = "direct" as const;
	private config: TTSProviderConfig;
	private mouthTimer: number | null = null;

	constructor(config: TTSProviderConfig) {
		this.config = config;
	}

	async speakDirect(text: string, config?: VoiceConfig, hooks?: DirectSpeakHooks): Promise<void> {
		if (typeof window === "undefined" || !("speechSynthesis" in window)) {
			throw new Error("当前环境不支持浏览器原生 TTS");
		}

		window.speechSynthesis.cancel();

		const utterance = new SpeechSynthesisUtterance(text);
		utterance.rate = Math.min(2, Math.max(0.5, config?.speed ?? this.config.speed ?? 1));
		utterance.pitch = Math.min(2, Math.max(0.5, config?.pitch ?? 1));
		utterance.lang = resolveLang(config?.lang, this.config.textLang);

		const voice = pickVoice(utterance.lang, this.config.voiceName || this.config.speakerId);
		if (voice) {
			utterance.voice = voice;
		}

		await new Promise<void>((resolve, reject) => {
			utterance.onstart = () => {
				log.info(`native speech start: ${utterance.lang}`);
				this.mouthTimer = pulseMouth(hooks?.onMouthData);
			};
			utterance.onboundary = () => {
				hooks?.onMouthData?.(0.85);
			};
			utterance.onend = () => {
				stopMouth(this.mouthTimer, hooks?.onMouthData);
				this.mouthTimer = null;
				resolve();
			};
			utterance.onerror = (event) => {
				stopMouth(this.mouthTimer, hooks?.onMouthData);
				this.mouthTimer = null;
				reject(new Error(`浏览器原生 TTS 失败: ${event.error}`));
			};
			window.speechSynthesis.speak(utterance);
		});
	}

	stop(): void {
		if (typeof window !== "undefined" && "speechSynthesis" in window) {
			window.speechSynthesis.cancel();
		}
		stopMouth(this.mouthTimer, undefined);
		this.mouthTimer = null;
	}
}
