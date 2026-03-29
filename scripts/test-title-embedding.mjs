// Phase 3.5 实验：验证 title 参与 embedding 对检索质量的影响
// 实验 A/B/C/D 四组对照

const API_KEY = "sk-nQurR0slirajn7vbjMBizM1fAEcRPRk4QTrPhhYAdle3mjm1";
const BASE_URL = "https://www.dmxapi.cn/v1/embeddings";
const MODEL = "text-embedding-3-small";
const DIM = 1536;

async function embed(texts) {
	const resp = await fetch(BASE_URL, {
		method: "POST",
		headers: { "Content-Type": "application/json", Authorization: `Bearer ${API_KEY}` },
		body: JSON.stringify({ input: texts, model: MODEL, dimensions: DIM }),
	});
	if (!resp.ok) throw new Error(`API ${resp.status}: ${await resp.text()}`);
	const data = await resp.json();
	return data.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
}

function cosineSim(a, b) {
	let dot = 0, na = 0, nb = 0;
	for (let i = 0; i < a.length; i++) { dot += a[i]*b[i]; na += a[i]*a[i]; nb += b[i]*b[i]; }
	return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

async function runExperiment(label, docs, queries) {
	console.log(`\n${"=".repeat(60)}`);
	console.log(`实验 ${label}`);
	console.log(`${"=".repeat(60)}\n`);

	// Build two versions for each doc: title-prefixed and content-only
	const titlePrefixed = docs.map(d => `${d.title}\n${d.content}`);
	const contentOnly = docs.map(d => d.content);

	console.log("送入 embedding 的文本样本（title-prefixed）:");
	titlePrefixed.forEach((t, i) => console.log(`  [${i}] "${t.slice(0, 80)}${t.length > 80 ? "..." : ""}"`));
	console.log("送入 embedding 的文本样本（content-only）:");
	contentOnly.forEach((t, i) => console.log(`  [${i}] "${t.slice(0, 80)}${t.length > 80 ? "..." : ""}"`));

	const tpEmbs = await embed(titlePrefixed);
	const coEmbs = await embed(contentOnly);
	const qEmbs = await embed(queries);

	console.log("\n| query | mode | doc | title-prefixed score | content-only score | delta | better |");
	console.log("|-------|------|-----|---------------------|-------------------|-------|--------|");

	for (let qi = 0; qi < queries.length; qi++) {
		for (let di = 0; di < docs.length; di++) {
			const tpSim = cosineSim(qEmbs[qi], tpEmbs[di]);
			const coSim = cosineSim(qEmbs[qi], coEmbs[di]);
			const delta = tpSim - coSim;
			const better = delta > 0.01 ? "title+" : delta < -0.01 ? "content+" : "≈";
			console.log(`| ${queries[qi].padEnd(25)} | vector | ${docs[di].title.padEnd(20)} | ${tpSim.toFixed(4).padStart(19)} | ${coSim.toFixed(4).padStart(17)} | ${delta > 0 ? "+" : ""}${delta.toFixed(4).padStart(5)} | ${better.padStart(6)} |`);
		}
	}
}

async function main() {
	console.log("Phase 3.5 实验：Title Embedding 对照\n");
	console.log(`模型: ${MODEL}, 维度: ${DIM}`);
	console.log(`Base URL: ${BASE_URL}\n`);

	// ── 实验 A：title-only token ──
	await runExperiment("A: title-only token", [
		{ title: "__TITLE_ONLY_TOKEN__派蒙限定", content: "这是一个测试文档，正文里不要重复标题中的专属词。" },
	], [
		"__TITLE_ONLY_TOKEN__",
		"派蒙限定",
	]);

	// ── 实验 B：content-only token ──
	await runExperiment("B: content-only token", [
		{ title: "普通标题", content: "__CONTENT_ONLY_TOKEN__ 这是正文专属词" },
	], [
		"__CONTENT_ONLY_TOKEN__",
	]);

	// ── 实验 C：同文档双版本对照 ──
	const docA = { title: "派蒙PVC玩偶", content: "尺寸：1:2\n售价：888元一只，活动除外\n状态：施工中，暂未发售，属于预购" };
	const docB = { title: "派蒙PVC玩偶", content: "派蒙PVC玩偶\n尺寸：1:2\n售价：888元一只，活动除外\n状态：施工中，暂未发售，属于预购" };

	const cQueries = ["派蒙", "派蒙玩偶", "玩偶的价格", "派蒙玩偶的价格", "888元", "施工中"];

	// C-1: title-prefixed vs content-only（A版文档）
	await runExperiment("C-1: A版文档 title-prefixed vs content-only", [docA], cQueries);

	// C-2: A版title-prefixed vs B版content-only（B版正文已含标题）
	console.log(`\n${"=".repeat(60)}`);
	console.log("实验 C-2: A版(title-prefixed) vs B版(标题并入正文content-only)");
	console.log(`${"=".repeat(60)}\n`);

	const aTP = `${docA.title}\n${docA.content}`;
	const bCO = docB.content; // B版正文已含标题

	console.log(`A版 title-prefixed: "${aTP.slice(0, 60)}..."`);
	console.log(`B版 content-only:   "${bCO.slice(0, 60)}..."`);

	const [aEmb] = await embed([aTP]);
	const [bEmb] = await embed([bCO]);
	const qEmbs = await embed(cQueries);

	console.log("\n| query | A版(tp) score | B版(co) score | delta | notes |");
	console.log("|-------|--------------|--------------|-------|-------|");

	for (let qi = 0; qi < cQueries.length; qi++) {
		const aSim = cosineSim(qEmbs[qi], aEmb);
		const bSim = cosineSim(qEmbs[qi], bEmb);
		const delta = aSim - bSim;
		console.log(`| ${cQueries[qi].padEnd(20)} | ${aSim.toFixed(4).padStart(12)} | ${bSim.toFixed(4).padStart(12)} | ${delta > 0 ? "+" : ""}${delta.toFixed(4).padStart(5)} | ${Math.abs(delta) < 0.02 ? "≈ equivalent" : delta > 0 ? "title-prefix wins" : "inline wins"} |`);
	}

	// ── 实验 D：vector vs hybrid 比较 ──
	// 只做 embedding 层面分析，不启动 Orama
	console.log(`\n${"=".repeat(60)}`);
	console.log("实验 D: 不相关查询的噪声分析");
	console.log(`${"=".repeat(60)}\n`);

	const irrelevantQueries = ["今天天气怎么样", "量子力学基本原理", "如何做红烧肉"];
	const irqEmbs = await embed(irrelevantQueries);

	console.log("| query | vs A版(tp) | threshold 0.2? | threshold 0.3? |");
	console.log("|-------|-----------|----------------|----------------|");
	for (let qi = 0; qi < irrelevantQueries.length; qi++) {
		const sim = cosineSim(irqEmbs[qi], aEmb);
		console.log(`| ${irrelevantQueries[qi].padEnd(20)} | ${sim.toFixed(4).padStart(9)} | ${sim >= 0.2 ? "PASS(noise)" : "FILTER"} | ${sim >= 0.3 ? "PASS(noise)" : "FILTER"} |`);
	}

	console.log("\n=== 实验完成 ===");
}

main().catch(console.error);
