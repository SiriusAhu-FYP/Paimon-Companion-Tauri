#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const ALL_FILES = ["app.log", "llm.jsonl", "events.jsonl", "images.jsonl", "session.jsonl"];

function parseArgs(argv) {
	const parsed = {
		session: "",
		files: "app.log,llm.jsonl",
		modules: "",
		sources: "",
		levels: "",
		traceId: "",
		pattern: "",
		since: "",
		until: "",
		limit: 200,
		json: false,
	};

	for (let i = 0; i < argv.length; i += 1) {
		const arg = argv[i];
		const next = argv[i + 1];
		if (arg === "--session" && next) {
			parsed.session = next;
			i += 1;
			continue;
		}
		if (arg === "--files" && next) {
			parsed.files = next;
			i += 1;
			continue;
		}
		if (arg === "--modules" && next) {
			parsed.modules = next;
			i += 1;
			continue;
		}
		if (arg === "--sources" && next) {
			parsed.sources = next;
			i += 1;
			continue;
		}
		if (arg === "--levels" && next) {
			parsed.levels = next;
			i += 1;
			continue;
		}
		if (arg === "--trace" && next) {
			parsed.traceId = next;
			i += 1;
			continue;
		}
		if (arg === "--pattern" && next) {
			parsed.pattern = next;
			i += 1;
			continue;
		}
		if (arg === "--since" && next) {
			parsed.since = next;
			i += 1;
			continue;
		}
		if (arg === "--until" && next) {
			parsed.until = next;
			i += 1;
			continue;
		}
		if (arg === "--limit" && next) {
			const numericLimit = Number.parseInt(next, 10);
			if (Number.isFinite(numericLimit) && numericLimit > 0) {
				parsed.limit = numericLimit;
			}
			i += 1;
			continue;
		}
		if (arg === "--json") {
			parsed.json = true;
		}
	}

	return parsed;
}

function usage() {
	return [
		"Usage:",
		"  node scripts/filter-debug-capture.mjs --session <session-id> [options]",
		"",
		"Options:",
		"  --files <csv>      app.log,llm.jsonl,events.jsonl,images.jsonl,session.jsonl,all",
		"  --modules <csv>    Filter by app.log module field",
		"  --sources <csv>    Filter by source / type fields",
		"  --levels <csv>     debug,info,warn,error",
		"  --trace <id>       Keep lines containing trace id",
		"  --pattern <regex>  Regex match against raw line + message",
		"  --since <iso>      Keep lines with timestamp >= since",
		"  --until <iso>      Keep lines with timestamp <= until",
		"  --limit <n>        Max rows to print (default: 200)",
		"  --json             Print normalized JSON lines",
		"",
		"Examples:",
		"  pnpm logs:filter -- --session 1776712593-769-manual --modules sokoban,unified-runtime --levels warn,error",
		"  pnpm logs:filter -- --session 1776712593-769-manual --files app.log,llm.jsonl --trace unified-17767 --pattern \"repeated|no verified\"",
	].join("\n");
}

function splitCsv(value) {
	return value
		.split(/[,\s]+/g)
		.map((item) => item.trim())
		.filter(Boolean);
}

function resolveFiles(rawFiles) {
	const requested = splitCsv(rawFiles.toLowerCase());
	if (!requested.length || requested.includes("all")) {
		return [...ALL_FILES];
	}
	const normalizedSet = new Set(requested);
	return ALL_FILES.filter((file) => normalizedSet.has(file.toLowerCase()));
}

function toTimestampValue(value) {
	if (!value) return null;
	const ts = new Date(value).getTime();
	if (!Number.isFinite(ts)) return null;
	return ts;
}

function parseStructuredLogLine(trimmed) {
	const match = trimmed.match(/^\[(?<timestamp>[^\]]+)\]\s+\[(?<level>[A-Z]+)\]\s+\[(?<module>[^\]]+)\]\s+(?<message>.*)$/);
	if (!match || !match.groups) {
		return null;
	}
	const timestamp = match.groups.timestamp?.trim() ?? "";
	const level = (match.groups.level?.trim() ?? "").toLowerCase();
	const module = match.groups.module?.trim() ?? "";
	const message = match.groups.message?.trim() ?? "";
	return {
		timestamp: timestamp || null,
		timestampValue: toTimestampValue(timestamp),
		level: level || null,
		module: module || null,
		message,
	};
}

function parseLine(rawLine, file, lineNo) {
	const trimmed = rawLine.trim();
	if (!trimmed) return null;

	try {
		const payload = JSON.parse(trimmed);
		const timestamp =
			(typeof payload.timestamp === "string" && payload.timestamp)
			|| (typeof payload.time === "string" && payload.time)
			|| null;
		const source =
			(typeof payload.source === "string" && payload.source)
			|| (typeof payload.type === "string" && payload.type)
			|| null;
		const module = typeof payload.module === "string" ? payload.module : null;
		const level = typeof payload.level === "string" ? payload.level : null;
		const message =
			(typeof payload.message === "string" && payload.message)
			|| (typeof payload.error === "string" && payload.error)
			|| (typeof payload.preview === "string" && payload.preview)
			|| "";

		return {
			file,
			lineNo,
			rawLine: trimmed,
			payload,
			timestamp,
			timestampValue: toTimestampValue(timestamp),
			source,
			module,
			level,
			message,
		};
	} catch {
		const structured = parseStructuredLogLine(trimmed);
		if (structured) {
			return {
				file,
				lineNo,
				rawLine: trimmed,
				payload: null,
				timestamp: structured.timestamp,
				timestampValue: structured.timestampValue,
				source: null,
				module: structured.module,
				level: structured.level,
				message: structured.message,
			};
		}
		return {
			file,
			lineNo,
			rawLine: trimmed,
			payload: null,
			timestamp: null,
			timestampValue: null,
			source: null,
			module: null,
			level: null,
			message: trimmed,
		};
	}
}

function formatTimestamp(entry) {
	if (entry.timestamp && entry.timestampValue !== null) {
		return `${entry.timestamp} @${entry.timestampValue}`;
	}
	if (entry.timestamp) {
		return entry.timestamp;
	}
	if (entry.timestampValue !== null) {
		return String(entry.timestampValue);
	}
	return "no-ts";
}

function matchTrace(entry, traceId) {
	if (!traceId) return true;
	if (entry.rawLine.includes(traceId)) return true;
	if (entry.payload && typeof entry.payload === "object") {
		const serialized = JSON.stringify(entry.payload);
		return serialized.includes(traceId);
	}
	return false;
}

function matchTime(entry, sinceMs, untilMs) {
	if (sinceMs === null && untilMs === null) {
		return true;
	}
	if (entry.timestampValue === null) {
		return false;
	}
	if (sinceMs !== null && entry.timestampValue < sinceMs) {
		return false;
	}
	if (untilMs !== null && entry.timestampValue > untilMs) {
		return false;
	}
	return true;
}

function matchRegex(entry, regex) {
	if (!regex) return true;
	return regex.test(`${entry.rawLine}\n${entry.message}`);
}

function formatEntry(entry) {
	const timestamp = formatTimestamp(entry);
	const tags = [
		entry.file,
		entry.level ?? null,
		entry.module ?? null,
		entry.source ?? null,
	].filter(Boolean).join("|");
	const text = entry.message || entry.rawLine;
	return `[${timestamp}] [${tags}] ${text}`;
}

function main() {
	const args = parseArgs(process.argv.slice(2));
	if (!args.session) {
		console.error(usage());
		process.exit(1);
	}

	const files = resolveFiles(args.files);
	if (!files.length) {
		console.error("No valid files selected. Use --files with app.log/llm.jsonl/events.jsonl/images.jsonl/session.jsonl/all");
		process.exit(1);
	}

	let patternRegex = null;
	if (args.pattern) {
		try {
			patternRegex = new RegExp(args.pattern, "i");
		} catch (error) {
			console.error(`Invalid --pattern regex: ${String(error)}`);
			process.exit(1);
		}
	}

	const sessionDir = path.resolve(process.cwd(), "src-tauri", "logs", "debug-captures", args.session);
	if (!fs.existsSync(sessionDir)) {
		console.error(`Session directory not found: ${sessionDir}`);
		process.exit(1);
	}

	const moduleFilters = new Set(splitCsv(args.modules));
	const sourceFilters = new Set(splitCsv(args.sources));
	const levelFilters = new Set(splitCsv(args.levels).map((level) => level.toLowerCase()));
	const sinceMs = args.since ? toTimestampValue(args.since) : null;
	const untilMs = args.until ? toTimestampValue(args.until) : null;

	if (args.since && sinceMs === null) {
		console.error(`Invalid --since value: ${args.since}`);
		process.exit(1);
	}
	if (args.until && untilMs === null) {
		console.error(`Invalid --until value: ${args.until}`);
		process.exit(1);
	}

	const rows = [];
	for (const file of files) {
		const fullPath = path.join(sessionDir, file);
		if (!fs.existsSync(fullPath)) {
			continue;
		}
		const content = fs.readFileSync(fullPath, "utf8");
		const lines = content.split(/\r?\n/);
		for (let index = 0; index < lines.length; index += 1) {
			const parsed = parseLine(lines[index], file, index + 1);
			if (!parsed) {
				continue;
			}
			if (moduleFilters.size && (!parsed.module || !moduleFilters.has(parsed.module))) {
				continue;
			}
			if (sourceFilters.size) {
				const sourceCandidate = parsed.source ?? "";
				if (!sourceFilters.has(sourceCandidate)) {
					continue;
				}
			}
			if (levelFilters.size) {
				const levelCandidate = (parsed.level ?? "").toLowerCase();
				if (!levelFilters.has(levelCandidate)) {
					continue;
				}
			}
			if (!matchTrace(parsed, args.traceId)) {
				continue;
			}
			if (!matchRegex(parsed, patternRegex)) {
				continue;
			}
			if (!matchTime(parsed, sinceMs, untilMs)) {
				continue;
			}
			rows.push(parsed);
		}
	}

	rows.sort((a, b) => {
		if (a.timestampValue !== null && b.timestampValue !== null && a.timestampValue !== b.timestampValue) {
			return a.timestampValue - b.timestampValue;
		}
		if (a.file !== b.file) {
			return a.file.localeCompare(b.file);
		}
		return a.lineNo - b.lineNo;
	});

	const outputRows = rows.slice(-args.limit);
	for (const row of outputRows) {
		if (args.json) {
			console.log(JSON.stringify({
				timestamp: row.timestamp,
				timestampMs: row.timestampValue,
				file: row.file,
				lineNo: row.lineNo,
				level: row.level,
				module: row.module,
				source: row.source,
				message: row.message,
				rawLine: row.rawLine,
			}));
		} else {
			console.log(formatEntry(row));
		}
	}

	console.error(
		`Matched ${rows.length} rows, displayed ${outputRows.length} rows from session ${args.session}.`,
	);
}

main();
