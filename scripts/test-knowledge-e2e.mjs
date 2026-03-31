// 知识库端到端测试：embedding → Orama 插入 → 搜索
import {
	create, insert, searchVector, search,
} from "@orama/orama";

const API_KEY = "sk-nQurR0slirajn7vbjMBizM1fAEcRPRk4QTrPhhYAdle3mjm1";
const BASE_URL = "https://www.dmxapi.cn/v1/embeddings";
const MODEL = "text-embedding-3-small";
const DIMENSION = 1536;

async function embed(texts) {
	const resp = await fetch(BASE_URL, {
		method: "POST",
		headers: { "Content-Type": "application/json", Authorization: `Bearer ${API_KEY}` },
		body: JSON.stringify({ input: texts, model: MODEL, dimensions: DIMENSION }),
	});
	if (!resp.ok) throw new Error(`Embedding API ${resp.status}: ${await resp.text()}`);
	const data = await resp.json();
	return data.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
}

async function main() {
	console.log("=== Knowledge E2E Test ===\n");

	// 1. 创建 Orama 数据库
	console.log("1. Creating Orama DB...");
	const db = create({
		schema: {
			docId: "string",
			chunkIndex: "number",
			text: "string",
			title: "string",
			source: "string",
			embedding: `vector[${DIMENSION}]`,
		},
		id: "test-db",
	});
	console.log("   OK\n");

	// 2. 添加文档
	const testDocs = [
		{
			title: "派蒙PVC玩偶",
			content: "派蒙PVC玩偶 尺寸：1:2 售价：888元一只，活动除外 状态：施工中，暂未发售，属于预购",
		},
		{
			title: "甘雨手办",
			content: "甘雨Q版手办 尺寸：10cm 售价：199元 状态：热销中 月销量500+",
		},
		{
			title: "原神周边礼盒",
			content: "原神官方周边礼盒 包含：明信片、徽章、书签 售价：128元 限量3000套",
		},
	];

	console.log("2. Embedding documents...");
	const allTexts = testDocs.map((d) => d.content);
	const allEmbs = await embed(allTexts);

	for (let i = 0; i < testDocs.length; i++) {
		await insert(db, {
			docId: `doc-${i}`,
			chunkIndex: 0,
			text: testDocs[i].content,
			title: testDocs[i].title,
			source: "test",
			embedding: allEmbs[i],
		});
		console.log(`   Inserted: "${testDocs[i].title}" (dim=${allEmbs[i].length})`);
	}
	console.log();

	// 3. 搜索测试
	const queries = [
		"派蒙",
		"888元",
		"玩偶价格",
		"甘雨",
		"限量礼盒",
		"今天天气怎么样",
	];

	console.log("3. Search tests:\n");

	for (const q of queries) {
		const [qEmb] = await embed([q]);

		// Vector search with threshold=0.5 (old)
		const r05 = await searchVector(db, {
			mode: "vector",
			vector: { value: qEmb, property: "embedding" },
			similarity: 0.5,
			limit: 3,
		});

		// Vector search with threshold=0.2 (new)
		const r02 = await searchVector(db, {
			mode: "vector",
			vector: { value: qEmb, property: "embedding" },
			similarity: 0.2,
			limit: 3,
		});

		// Fulltext search
		const rFt = await search(db, {
			mode: "fulltext",
			term: q,
			limit: 3,
		});

		// Hybrid search with threshold=0.2
		const rHy = await search(db, {
			mode: "hybrid",
			term: q,
			vector: { value: qEmb, property: "embedding" },
			similarity: 0.2,
			limit: 3,
		});

		console.log(`  Query: "${q}"`);
		console.log(`    vector(0.5): ${r05.hits.length} hits ${r05.hits.map((h) => `${h.document.title}(${h.score.toFixed(3)})`).join(", ")}`);
		console.log(`    vector(0.2): ${r02.hits.length} hits ${r02.hits.map((h) => `${h.document.title}(${h.score.toFixed(3)})`).join(", ")}`);
		console.log(`    fulltext:    ${rFt.hits.length} hits ${rFt.hits.map((h) => `${h.document.title}(${h.score.toFixed(3)})`).join(", ")}`);
		console.log(`    hybrid(0.2): ${rHy.hits.length} hits ${rHy.hits.map((h) => `${h.document.title}(${h.score.toFixed(3)})`).join(", ")}`);
		console.log();
	}

	console.log("=== DONE ===");
}

main().catch(console.error);
