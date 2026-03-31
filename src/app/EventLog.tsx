import { useState, useCallback, useMemo } from "react";
import { useEventBus } from "@/hooks";
import type { EventName } from "@/types";

interface LogEntry {
	event: string;
	payload: string;
	timestamp: string;
	category: string;
}

const MAX_ENTRIES = 100;

const EVENT_CATEGORIES: Record<string, { events: EventName[]; color: string }> = {
	"系统": {
		events: ["runtime:mode-change", "system:error", "system:emergency-stop", "system:resume"],
		color: "#e57373",
	},
	"角色": {
		events: ["character:expression", "character:state-change"],
		color: "#81c784",
	},
	"语音": {
		events: ["audio:asr-result", "audio:tts-start", "audio:tts-end"],
		color: "#64b5f6",
	},
	"LLM": {
		events: ["llm:response-end"],
		color: "#ba68c8",
	},
	"外部": {
		events: ["external:danmaku", "external:gift", "external:product-message"],
		color: "#ffb74d",
	},
};

function getCategoryForEvent(event: string): { name: string; color: string } {
	for (const [name, { events, color }] of Object.entries(EVENT_CATEGORIES)) {
		if (events.includes(event as EventName)) return { name, color };
	}
	return { name: "其他", color: "#90a4ae" };
}

export function EventLog() {
	const [entries, setEntries] = useState<LogEntry[]>([]);
	const [activeFilter, setActiveFilter] = useState<string | null>(null);

	const addEntry = useCallback((event: string, payload: unknown) => {
		const cat = getCategoryForEvent(event);
		setEntries((prev) => {
			const entry: LogEntry = {
				event,
				payload: JSON.stringify(payload ?? "—"),
				timestamp: new Date().toLocaleTimeString(),
				category: cat.name,
			};
			const next = [entry, ...prev];
			return next.length > MAX_ENTRIES ? next.slice(0, MAX_ENTRIES) : next;
		});
	}, []);

	const allEvents = useMemo(() =>
		Object.values(EVENT_CATEGORIES).flatMap((c) => c.events),
	[]);

	for (const event of allEvents) {
		// eslint-disable-next-line react-hooks/rules-of-hooks
		useEventBus(event, (payload) => addEntry(event, payload));
	}

	const filteredEntries = useMemo(() =>
		activeFilter ? entries.filter((e) => e.category === activeFilter) : entries,
	[entries, activeFilter]);

	const handleClear = useCallback(() => setEntries([]), []);

	return (
		<section className="event-log">
			<div className="event-log-header">
				<h3>事件日志</h3>
				<div className="event-log-filters">
					{Object.entries(EVENT_CATEGORIES).map(([name, { color }]) => (
						<button
							key={name}
							className={`event-log-filter-chip${activeFilter === name ? " active" : ""}`}
							style={{ "--chip-color": color } as React.CSSProperties}
							onClick={() => setActiveFilter(activeFilter === name ? null : name)}
						>
							{name}
						</button>
					))}
					<button className="event-log-clear-btn" onClick={handleClear}>清空</button>
				</div>
			</div>
			<div className="event-log-entries">
				{filteredEntries.length === 0 ? (
					<p className="event-log-empty">暂无事件</p>
				) : (
					filteredEntries.map((entry, i) => {
						const cat = getCategoryForEvent(entry.event);
						return (
							<div key={i} className="event-log-entry">
								<span className="event-log-time">{entry.timestamp}</span>
								<span className="event-log-name" style={{ color: cat.color }}>{entry.event}</span>
								<span className="event-log-payload">{entry.payload}</span>
							</div>
						);
					})
				)}
			</div>
		</section>
	);
}
