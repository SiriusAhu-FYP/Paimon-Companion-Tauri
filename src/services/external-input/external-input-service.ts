import type { EventBus } from "@/services/event-bus";
import type { RuntimeService } from "@/services/runtime";
import { createLogger } from "@/services/logger";

const log = createLogger("external-input");

export interface RawExternalEvent {
	source: string;
	type: string;
	data: Record<string, unknown>;
}

/**
 * Phase 1 最小占位：外部事件标准化接入。
 * 提供 injectEvent 用于调试/mock 注入。
 * 真实平台适配器（直播弹幕、礼物等）留到后续 phase。
 */
export class ExternalInputService {
	private bus: EventBus;
	private runtime: RuntimeService | null = null;
	private sources = new Map<string, { connected: boolean }>();

	constructor(bus: EventBus) {
		this.bus = bus;
	}

	setRuntime(runtime: RuntimeService) {
		this.runtime = runtime;
	}

	// 调试/mock 注入入口（受 runtime 门控）
	injectEvent(raw: RawExternalEvent) {
		if (this.runtime && !this.runtime.isAllowed()) {
			log.warn(`event BLOCKED by runtime gate [${raw.source}]: ${raw.type}`);
			return;
		}

		log.debug(`raw event from [${raw.source}]: ${raw.type}`, raw.data);

		switch (raw.type) {
			case "danmaku":
				this.bus.emit("external:danmaku", {
					user: (raw.data["user"] as string) ?? "unknown",
					text: (raw.data["text"] as string) ?? "",
					source: raw.source,
				});
				break;
			case "gift":
				this.bus.emit("external:gift", {
					user: (raw.data["user"] as string) ?? "unknown",
					giftName: (raw.data["giftName"] as string) ?? "",
					count: (raw.data["count"] as number) ?? 1,
					source: raw.source,
				});
				break;
			case "product-message":
				this.bus.emit("external:product-message", {
					type: (raw.data["priority"] ? "priority" : "persistent") as "priority" | "persistent",
					content: (raw.data["content"] as string) ?? "",
					ttl: raw.data["ttl"] as number | undefined,
				});
				break;
			default:
				log.warn(`unknown external event type: ${raw.type}`);
		}
	}

	registerSource(sourceId: string) {
		this.sources.set(sourceId, { connected: true });
		log.info(`source registered: ${sourceId}`);
	}

	unregisterSource(sourceId: string) {
		this.sources.delete(sourceId);
		log.info(`source unregistered: ${sourceId}`);
	}

	getSourceStatus(): Record<string, { connected: boolean }> {
		return Object.fromEntries(this.sources);
	}
}
