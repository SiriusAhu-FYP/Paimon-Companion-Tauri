import { useState, useCallback } from "react";
import { useEventBus } from "@/hooks";
import type { EventName } from "@/types";

interface LogEntry {
	event: string;
	payload: string;
	timestamp: string;
}

const MAX_ENTRIES = 50;

// 展示最近发生的事件总线事件，用于调试和监控
export function EventLog() {
	const [entries, setEntries] = useState<LogEntry[]>([]);

	const addEntry = useCallback((event: string, payload: unknown) => {
		setEntries((prev) => {
			const entry: LogEntry = {
				event,
				payload: JSON.stringify(payload ?? "—"),
				timestamp: new Date().toLocaleTimeString(),
			};
			const next = [entry, ...prev];
			return next.length > MAX_ENTRIES ? next.slice(0, MAX_ENTRIES) : next;
		});
	}, []);

	// 订阅关键事件用于日志展示
	const events: EventName[] = [
		"runtime:mode-change",
		"character:expression",
		"character:state-change",
		"audio:asr-result",
		"llm:response-end",
		"external:danmaku",
		"external:gift",
		"external:product-message",
		"system:error",
		"system:emergency-stop",
		"system:resume",
	];

	for (const event of events) {
		// eslint-disable-next-line react-hooks/rules-of-hooks
		useEventBus(event, (payload) => addEntry(event, payload));
	}

	return (
		<section className="event-log">
			<h3>事件日志</h3>
			<div className="event-log-entries">
				{entries.length === 0 ? (
					<p className="event-log-empty">暂无事件</p>
				) : (
					entries.map((entry, i) => (
						<div key={i} className="event-log-entry">
							<span className="event-log-time">{entry.timestamp}</span>
							<span className="event-log-name">{entry.event}</span>
							<span className="event-log-payload">{entry.payload}</span>
						</div>
					))
				)}
			</div>
		</section>
	);
}
