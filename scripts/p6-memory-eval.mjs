#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const GROUND_TRUTH = {
	minecraft: {
		signalGroups: [
			{ name: "low-health danger state", keywords: ["低血量", "残血", "危险", "濒危", "生命值过低"] },
			{ name: "enemy approach", keywords: ["僵尸", "敌人接近", "逼近", "贴近", "接敌"] },
			{ name: "intent shift heal-to-fight", keywords: ["进食", "恢复", "切换武器", "石剑", "被迫战斗"] },
			{ name: "negative outcome", keywords: ["死亡", "被击杀", "失败", "生命值耗尽"] },
		],
		salientExpectation: {
			mustIncludeTypes: ["danger"],
			highPriorityTypes: ["danger", "error", "turning-point"],
		},
	},
	genshin: {
		signalGroups: [
			{ name: "open-world routine combat", keywords: ["开放世界", "日常战斗", "清怪", "探索"] },
			{ name: "multiple enemies", keywords: ["多个敌人", "复数敌人", "多敌人"] },
			{ name: "stable attack behavior", keywords: ["持续攻击", "稳定输出", "连贯", "无撤退", "无恢复"] },
			{ name: "low urgency", keywords: ["无显著突发", "不构成紧急", "低优先级", "无明显危机"] },
		],
		salientExpectation: {
			maxDangerCount: 1,
			maxHighSeverityDangerCount: 0,
		},
	},
};

function getArg(args, name, fallback = "") {
	const idx = args.indexOf(`--${name}`);
	return idx >= 0 && args[idx + 1] ? args[idx + 1] : fallback;
}

function hasFlag(args, name) {
	return args.includes(`--${name}`);
}

function readJsonl(path) {
	if (!existsSync(path)) {
		throw new Error(`missing file: ${path}`);
	}
	const content = readFileSync(path, "utf-8").trim();
	if (!content) return [];
	return content
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean)
		.map((line) => JSON.parse(line));
}

function matchSignals(allText, signalGroups) {
	const groups = signalGroups.map((group) => {
		const matched = group.keywords.filter((kw) => allText.includes(kw.toLowerCase()));
		return {
			name: group.name,
			matched,
			hit: matched.length > 0,
		};
	});
	const hitCount = groups.filter((g) => g.hit).length;
	return {
		groups,
		hitCount,
		total: signalGroups.length,
		ratio: signalGroups.length > 0 ? hitCount / signalGroups.length : 0,
	};
}

function collectCorpus(summaries, digests, salient) {
	const summaryText = summaries.map((s) => String(s.summary ?? "")).join("\n");
	const digestText = digests.map((d) => String(d.digest ?? "")).join("\n");
	const salientText = salient.map((e) => String(e.description ?? "")).join("\n");
	return `${summaryText}\n${digestText}\n${salientText}`.toLowerCase();
}

function countByType(salient) {
	const map = new Map();
	for (const event of salient) {
		const type = String(event.type ?? "unknown");
		map.set(type, (map.get(type) ?? 0) + 1);
	}
	return map;
}

function scoreSalient(label, salient, expectation) {
	const counts = countByType(salient);
	const getCount = (type) => counts.get(type) ?? 0;
	const dangerCount = getCount("danger");
	const highSeverityDangerCount = salient.filter((e) => String(e.type) === "danger" && Number(e.severity ?? 0) >= 4).length;

	let score = 30;
	const notes = [];

	if (label === "minecraft") {
		for (const type of expectation.mustIncludeTypes ?? []) {
			if (getCount(type) === 0) {
				score -= 18;
				notes.push(`missing required salient type: ${type}`);
			}
		}
		const highPriorityHit = (expectation.highPriorityTypes ?? []).some((type) => getCount(type) > 0);
		if (!highPriorityHit) {
			score -= 8;
			notes.push("no high-priority salient type detected");
		}
	}

	if (label === "genshin") {
		if (typeof expectation.maxDangerCount === "number" && dangerCount > expectation.maxDangerCount) {
			score -= 15;
			notes.push(`danger count too high: ${dangerCount}`);
		}
		if (
			typeof expectation.maxHighSeverityDangerCount === "number" &&
			highSeverityDangerCount > expectation.maxHighSeverityDangerCount
		) {
			score -= 12;
			notes.push(`high-severity danger count too high: ${highSeverityDangerCount}`);
		}
	}

	return {
		score: Math.max(0, Math.min(30, score)),
		notes,
		counts: Object.fromEntries(counts.entries()),
	};
}

function scoreStructure(summaries, digests) {
	let score = 0;
	const notes = [];
	if (summaries.length > 0) score += 5;
	else notes.push("summaries is empty");
	if (digests.length > 0) score += 5;
	else notes.push("digests is empty");
	return { score, notes };
}

function buildReport(input) {
	const {
		label,
		paths,
		summaries,
		digests,
		salient,
		signalStats,
		signalScore,
		salientStats,
		structureStats,
		totalScore,
		threshold,
	} = input;

	const report = [
		"# P6 Memory Evaluation Report",
		"",
		`- case: ${label}`,
		`- generatedAt: ${new Date().toISOString()}`,
		`- summariesPath: ${paths.summaries}`,
		`- digestsPath: ${paths.digests}`,
		`- salientPath: ${paths.salient}`,
		"",
		"## Raw Counts",
		`- summaries: ${summaries.length}`,
		`- digests: ${digests.length}`,
		`- salient events: ${salient.length}`,
		"",
		"## Signal Coverage",
		`- hit: ${signalStats.hitCount}/${signalStats.total} (${(signalStats.ratio * 100).toFixed(1)}%)`,
		`- score: ${signalScore.toFixed(1)} / 60`,
		"",
		"### Signal Detail",
		...signalStats.groups.map((group) => `- ${group.hit ? "[hit]" : "[miss]"} ${group.name}: ${group.matched.join(", ") || "(none)"}`),
		"",
		"## Salient Consistency",
		`- score: ${salientStats.score.toFixed(1)} / 30`,
		`- type counts: ${JSON.stringify(salientStats.counts)}`,
		...(salientStats.notes.length > 0 ? salientStats.notes.map((n) => `- note: ${n}`) : ["- note: none"]),
		"",
		"## Structure Integrity",
		`- score: ${structureStats.score.toFixed(1)} / 10`,
		...(structureStats.notes.length > 0 ? structureStats.notes.map((n) => `- note: ${n}`) : ["- note: none"]),
		"",
		"## Final Score",
		`- total: ${totalScore.toFixed(1)} / 100`,
		`- threshold: ${threshold}`,
		`- pass: ${totalScore >= threshold ? "yes" : "no"}`,
		"",
	];

	return report.join("\n");
}

function main() {
	const args = process.argv.slice(2);
	const label = getArg(args, "label").toLowerCase();
	const summariesPath = resolve(getArg(args, "summaries"));
	const digestsPath = resolve(getArg(args, "digests"));
	const salientPath = resolve(getArg(args, "salient"));
	const outPath = getArg(args, "out", "");
	const threshold = Number.parseFloat(getArg(args, "threshold", "70"));
	const failOnThreshold = hasFlag(args, "fail-on-threshold");

	if (!label || !GROUND_TRUTH[label]) {
		console.error("invalid or missing --label. allowed: minecraft, genshin");
		process.exit(1);
	}
	if (!summariesPath || !digestsPath || !salientPath) {
		console.error("missing required paths: --summaries --digests --salient");
		process.exit(1);
	}

	const summaries = readJsonl(summariesPath);
	const digests = readJsonl(digestsPath);
	const salient = readJsonl(salientPath);

	const truth = GROUND_TRUTH[label];
	const corpus = collectCorpus(summaries, digests, salient);
	const signalStats = matchSignals(corpus, truth.signalGroups);
	const signalScore = signalStats.ratio * 60;
	const salientStats = scoreSalient(label, salient, truth.salientExpectation);
	const structureStats = scoreStructure(summaries, digests);

	const totalScore = signalScore + salientStats.score + structureStats.score;

	const report = buildReport({
		label,
		paths: {
			summaries: summariesPath,
			digests: digestsPath,
			salient: salientPath,
		},
		summaries,
		digests,
		salient,
		signalStats,
		signalScore,
		salientStats,
		structureStats,
		totalScore,
		threshold,
	});

	if (outPath) {
		const finalOut = resolve(outPath);
		mkdirSync(dirname(finalOut), { recursive: true });
		writeFileSync(finalOut, report, "utf-8");
		console.log(`report written: ${finalOut}`);
	}

	console.log(report);

	if (failOnThreshold && totalScore < threshold) {
		process.exit(2);
	}
}

main();
