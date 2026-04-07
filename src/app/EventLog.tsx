import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { EVENT_CATEGORIES, useEventLog, type EventLogEntry } from "@/hooks";
import { useI18n } from "@/contexts/I18nProvider";

async function copyText(text: string) {
	if (navigator.clipboard?.writeText) {
		await navigator.clipboard.writeText(text);
		return;
	}

	const textarea = document.createElement("textarea");
	textarea.value = text;
	textarea.style.position = "fixed";
	textarea.style.opacity = "0";
	document.body.appendChild(textarea);
	textarea.focus();
	textarea.select();
	document.execCommand("copy");
	document.body.removeChild(textarea);
}

function buildExportText(entries: readonly EventLogEntry[]) {
	return entries.map((entry) => (
		[
			`${entry.timestampLabel} ${entry.event}`,
			entry.summary,
			entry.payloadText,
		].join("\n")
	)).join("\n\n");
}

export function EventLog() {
	const { t } = useI18n();
	const { entries, clear, latestEntry } = useEventLog(200);
	const [activeFilters, setActiveFilters] = useState<string[]>([]);
	const [searchQuery, setSearchQuery] = useState("");
	const [selectedKey, setSelectedKey] = useState<string | null>(null);
	const [copyMessage, setCopyMessage] = useState<string | null>(null);
	const listRef = useRef<HTMLDivElement | null>(null);
	const stickToBottomRef = useRef(true);

	const filteredEntries = useMemo(() => {
		const normalizedQuery = searchQuery.trim().toLowerCase();
		return entries.filter((entry) => {
			if (activeFilters.length > 0 && !activeFilters.includes(entry.category)) {
				return false;
			}
			if (!normalizedQuery) {
				return true;
			}
			return [
				entry.event,
				entry.category,
				entry.summary,
				entry.payloadText,
			].join(" ").toLowerCase().includes(normalizedQuery);
		});
	}, [activeFilters, entries, searchQuery]);

	useEffect(() => {
		if (!filteredEntries.length) {
			setSelectedKey(null);
			return;
		}
		if (!selectedKey || !filteredEntries.some((entry) => entry.key === selectedKey)) {
			setSelectedKey(filteredEntries[filteredEntries.length - 1]?.key ?? null);
		}
	}, [filteredEntries, selectedKey]);

	useEffect(() => {
		if (!copyMessage) return;
		const timer = window.setTimeout(() => setCopyMessage(null), 1800);
		return () => window.clearTimeout(timer);
	}, [copyMessage]);

	useEffect(() => {
		if (!stickToBottomRef.current) return;
		const list = listRef.current;
		if (!list) return;
		list.scrollTop = list.scrollHeight;
	}, [filteredEntries]);

	const selectedEntry = filteredEntries.find((entry) => entry.key === selectedKey) ?? filteredEntries[filteredEntries.length - 1] ?? null;

	return (
		<section className="event-log">
			<div className="event-log-header">
				<div className="event-log-title-group">
					<h3>{t("事件控制台", "Event Console")}</h3>
					<span className="event-log-meta">{filteredEntries.length} / {entries.length} {t("条", "items")}</span>
					{latestEntry && (
						<span className="event-log-latest" title={latestEntry.payloadText}>
							{t("最近", "Latest")}: {latestEntry.summary}
						</span>
					)}
				</div>
				<div className="event-log-actions">
					<button
						className="event-log-clear-btn"
						onClick={async () => {
							await copyText(buildExportText(filteredEntries));
							setCopyMessage(t("已复制筛选结果", "Filtered events copied"));
						}}
					>
						{t("复制筛选结果", "Copy Filtered")}
					</button>
					<button className="event-log-clear-btn" onClick={clear}>{t("清空", "Clear")}</button>
				</div>
			</div>

			<div className="event-log-toolbar">
				<input
					className="event-log-search"
					value={searchQuery}
					onChange={(event) => setSearchQuery(event.target.value)}
					placeholder={t("搜索事件名 / 摘要 / payload", "Search event / summary / payload")}
				/>
				<div className="event-log-filters">
					{Object.entries(EVENT_CATEGORIES).map(([name, { color }]) => (
						<button
							key={name}
							className={`event-log-filter-chip${activeFilters.includes(name) ? " active" : ""}`}
							style={{ "--chip-color": color } as CSSProperties}
							onClick={() => {
								setActiveFilters((current) =>
									current.includes(name)
										? current.filter((item) => item !== name)
										: [...current, name],
								);
							}}
						>
							{name}
						</button>
					))}
					<button
						className="event-log-clear-btn"
						onClick={() => setActiveFilters([])}
						disabled={activeFilters.length === 0}
					>
						{t("清空筛选", "Clear Filters")}
					</button>
				</div>
			</div>

			{copyMessage && <div className="event-log-copy-message">{copyMessage}</div>}

			<div className="event-log-body-layout">
				<div
					ref={listRef}
					className="event-log-entries"
					onScroll={(event) => {
						const element = event.currentTarget;
						const distanceFromBottom = element.scrollHeight - element.scrollTop - element.clientHeight;
						stickToBottomRef.current = distanceFromBottom < 16;
					}}
				>
					{filteredEntries.length === 0 ? (
						<p className="event-log-empty">{t("暂无匹配事件", "No matching events")}</p>
					) : (
						filteredEntries.map((entry) => (
							<button
								key={entry.key}
								className={`event-log-entry${selectedEntry?.key === entry.key ? " active" : ""}`}
								onClick={() => setSelectedKey(entry.key)}
							>
								<span className="event-log-time">{entry.timestampLabel}</span>
								<span className="event-log-category" style={{ "--event-color": entry.color } as CSSProperties}>
									{entry.category}
								</span>
								<div className="event-log-body">
									<div className="event-log-main">
										<span className="event-log-name" style={{ color: entry.color }}>{entry.event}</span>
										<span className="event-log-summary">{entry.summary}</span>
									</div>
									<div className="event-log-payload">{entry.payloadPreviewText}</div>
								</div>
							</button>
						))
					)}
				</div>

				<div className="event-log-detail">
					{selectedEntry ? (
						<>
							<div className="event-log-detail-header">
								<div className="event-log-detail-title-group">
									<div className="event-log-detail-title" style={{ color: selectedEntry.color }}>
										{selectedEntry.event}
									</div>
									<div className="event-log-detail-meta">
										{selectedEntry.timestampLabel} · {selectedEntry.category}
									</div>
								</div>
								<div className="event-log-actions">
									<button
										className="event-log-clear-btn"
										onClick={async () => {
											await copyText(selectedEntry.payloadText);
											setCopyMessage(t("已复制完整 payload", "Full payload copied"));
										}}
									>
										{t("复制 payload", "Copy Payload")}
									</button>
									<button
										className="event-log-clear-btn"
										onClick={async () => {
											await copyText(`${selectedEntry.event}\n${selectedEntry.summary}\n\n${selectedEntry.payloadText}`);
											setCopyMessage(t("已复制事件详情", "Event details copied"));
										}}
									>
										{t("复制详情", "Copy Details")}
									</button>
								</div>
							</div>
							<div className="event-log-detail-summary">{selectedEntry.summary}</div>
							<pre className="event-log-detail-payload">{selectedEntry.payloadText}</pre>
						</>
					) : (
						<div className="event-log-empty">{t("选择一条事件以查看完整详情", "Select an event to inspect full details")}</div>
					)}
				</div>
			</div>
		</section>
	);
}
