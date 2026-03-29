// 测试 embedding 模型可用性和向量相似度
const key = "sk-nQurR0slirajn7vbjMBizM1fAEcRPRk4QTrPhhYAdle3mjm1";
const baseUrl = "https://www.dmxapi.cn/v1/embeddings";

async function embed(texts) {
	const resp = await fetch(baseUrl, {
		method: "POST",
		headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
		body: JSON.stringify({ input: texts, model: "text-embedding-3-small", dimensions: 1536 }),
	});
	if (!resp.ok) {
		const body = await resp.text();
		throw new Error(`API ${resp.status}: ${body.slice(0, 200)}`);
	}
	const data = await resp.json();
	return data.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
}

function cosineSim(a, b) {
	let dot = 0, na = 0, nb = 0;
	for (let i = 0; i < a.length; i++) {
		dot += a[i] * b[i];
		na += a[i] * a[i];
		nb += b[i] * b[i];
	}
	return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

async function main() {
	console.log("=== Embedding + Similarity Test ===\n");

	const docText =
		"派蒙PVC玩偶 尺寸：1:2 售价：888元一只，活动除外 状态：施工中，暂未发售，属于预购";
	const queries = ["派蒙", "888元", "玩偶价格", "今天天气怎么样"];

	console.log("Embedding doc...");
	const [docEmb] = await embed([docText]);
	console.log(`Doc embedding dim: ${docEmb.length}`);

	console.log("Embedding queries...\n");
	const queryEmbs = await embed(queries);

	console.log("Similarity results:");
	for (let i = 0; i < queries.length; i++) {
		const sim = cosineSim(docEmb, queryEmbs[i]);
		const verdict = sim >= 0.5 ? "PASS (>=0.5)" : sim >= 0.3 ? "MARGINAL" : "FAIL (<0.3)";
		console.log(`  "${queries[i]}" vs doc: ${sim.toFixed(4)}  ${verdict}`);
	}

	console.log("\nOrama threshold comparison:");
	for (let i = 0; i < queries.length; i++) {
		const sim = cosineSim(docEmb, queryEmbs[i]);
		const at08 = sim >= 0.8 ? "RETURN" : "FILTERED";
		const at05 = sim >= 0.5 ? "RETURN" : "FILTERED";
		const at03 = sim >= 0.3 ? "RETURN" : "FILTERED";
		console.log(`  "${queries[i]}": threshold=0.8→${at08}  0.5→${at05}  0.3→${at03}  (sim=${sim.toFixed(4)})`);
	}

	// 测试 chunking 对相似度的影响
	console.log("\n=== Chunk-level similarity ===");
	const chunks = [
		"派蒙PVC玩偶",
		"尺寸：1:2",
		"售价：888元一只，活动除外",
		"状态：施工中，暂未发售，属于预购",
	];
	const chunkEmbs = await embed(chunks);
	for (const query of ["派蒙", "888元"]) {
		const [qEmb] = await embed([query]);
		console.log(`\n  Query: "${query}"`);
		for (let j = 0; j < chunks.length; j++) {
			const sim = cosineSim(qEmb, chunkEmbs[j]);
			console.log(`    vs "${chunks[j]}": ${sim.toFixed(4)} ${sim >= 0.5 ? "✓" : sim >= 0.3 ? "~" : "✗"}`);
		}
	}

	console.log("\n=== DONE ===");
}

main().catch(console.error);
