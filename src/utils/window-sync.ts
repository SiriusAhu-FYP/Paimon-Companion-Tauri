import type { CharacterState } from "@/types/character";
import type { RuntimeMode } from "@/types/runtime";
import { createLogger } from "@/services/logger";

const log = createLogger("window-sync");

const CHANNEL_NAME = "paimon-state-sync";

export interface SyncPayload {
	character: CharacterState;
	runtimeMode: RuntimeMode;
	timestamp: number;
}

let channel: BroadcastChannel | null = null;

function getChannel(): BroadcastChannel {
	if (!channel) {
		channel = new BroadcastChannel(CHANNEL_NAME);
		log.info("BroadcastChannel created");
	}
	return channel;
}

// 主窗口：广播最新状态
export function broadcastState(state: SyncPayload) {
	try {
		getChannel().postMessage(state);
	} catch (err) {
		log.error("broadcast failed", err);
	}
}

// 舞台窗口：监听状态变化
export function onStateSync(callback: (state: SyncPayload) => void): () => void {
	const ch = getChannel();
	const handler = (event: MessageEvent<SyncPayload>) => {
		callback(event.data);
	};
	ch.addEventListener("message", handler);
	log.info("listening for state sync");
	return () => {
		ch.removeEventListener("message", handler);
	};
}
