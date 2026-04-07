import { useMemo, useState, type CSSProperties } from "react";
import { EVENT_CATEGORIES, useEventLog } from "@/hooks";
import { useI18n } from "@/contexts/I18nProvider";

export function EventLog() {
	const [activeFilter, setActiveFilter] = useState<string | null>(null);
	const { entries, clear, latestEntry } = useEventLog();
	const { t } = useI18n();

	const filteredEntries = useMemo(() =>
		activeFilter ? entries.filter((e) => e.category === activeFilter) : entries,
	[entries, activeFilter]);

	return (
		<section className="event-log">
			<div className="event-log-header">
				<div className="event-log-title-group">
					<h3>{t("事件日志", "Event Log")}</h3>
					<span className="event-log-meta">{filteredEntries.length} {t("条", "items")}</span>
					{latestEntry && (
						<span className="event-log-latest" title={latestEntry.payloadText}>
							{t("最近", "Latest")}: {latestEntry.summary}
						</span>
					)}
				</div>
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
					<button className="event-log-clear-btn" onClick={clear}>{t("清空", "Clear")}</button>
				</div>
			</div>
			<div className="event-log-entries">
				{filteredEntries.length === 0 ? (
					<p className="event-log-empty">{t("暂无事件", "No events yet")}</p>
				) : (
					filteredEntries.map((entry, i) => {
						return (
							<div key={`${entry.timestamp}-${entry.event}-${i}`} className="event-log-entry">
								<span className="event-log-time">{entry.timestampLabel}</span>
								<span className="event-log-category" style={{ "--event-color": entry.color } as CSSProperties}>
									{entry.category}
								</span>
								<div className="event-log-body">
									<div className="event-log-main">
										<span className="event-log-name" style={{ color: entry.color }}>{entry.event}</span>
										<span className="event-log-summary">{entry.summary}</span>
									</div>
									<div className="event-log-payload" title={entry.payloadText}>{entry.payloadText}</div>
								</div>
							</div>
						);
					})
				)}
			</div>
		</section>
	);
}
