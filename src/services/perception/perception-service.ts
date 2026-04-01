import type { EventBus } from "@/services/event-bus";
import type { FunctionalTarget, PerceptionSnapshot } from "@/types";
import { captureWindow } from "@/services/system";
import { createLogger } from "@/services/logger";

const log = createLogger("perception");

export class PerceptionService {
	private bus: EventBus;

	constructor(bus: EventBus) {
		this.bus = bus;
	}

	async captureTarget(target: FunctionalTarget): Promise<PerceptionSnapshot> {
		const capture = await captureWindow(target.handle);
		const snapshot: PerceptionSnapshot = {
			targetHandle: target.handle,
			targetTitle: target.title,
			width: capture.width,
			height: capture.height,
			dataUrl: `data:image/png;base64,${capture.pngBase64}`,
			capturedAt: Date.now(),
		};

		this.bus.emit("perception:snapshot", {
			targetHandle: snapshot.targetHandle,
			targetTitle: snapshot.targetTitle,
			width: snapshot.width,
			height: snapshot.height,
			capturedAt: snapshot.capturedAt,
		});

		log.info(`captured target ${target.title} (${snapshot.width}x${snapshot.height})`);
		return snapshot;
	}
}
