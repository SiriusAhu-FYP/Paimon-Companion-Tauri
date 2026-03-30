import { useState, useEffect, useCallback, useRef } from "react";
import {
	Box, Button, Typography, Stack, TextField, Select, MenuItem,
	Alert, IconButton, Tooltip, Popover, Chip, LinearProgress,
	type SelectChangeEvent,
} from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import UploadFileIcon from "@mui/icons-material/UploadFile";
import DeleteIcon from "@mui/icons-material/Delete";
import AddIcon from "@mui/icons-material/Add";
import RefreshIcon from "@mui/icons-material/Refresh";
import EditIcon from "@mui/icons-material/Edit";
import NetworkCheckIcon from "@mui/icons-material/NetworkCheck";
import {
	SECRET_KEYS,
	loadConfig, updateConfig,
	setSecret, getSecret, deleteSecret,
	proxyRequest,
} from "@/services/config";
import { HelpTooltip } from "@/components";
import { getServices, refreshEmbeddingService } from "@/services";
import type { KnowledgeDocument, RetrievalResult, EmbeddingProfile, RerankProfile } from "@/types/knowledge";
import type { IndexStatus } from "@/services/knowledge";
import { RebuildGate } from "./RebuildGate";

interface KnowledgePanelProps {
	onClose: () => void;
}

const SectionTitle = ({ children }: { children: React.ReactNode }) => (
	<Typography variant="subtitle2" sx={{ fontWeight: 600, py: 0.5, display: "flex", alignItems: "center", gap: 0.5 }}>
		{children}
	</Typography>
);

export function KnowledgePanel({ onClose }: KnowledgePanelProps) {
	const [message, setMessage] = useState<{ type: "success" | "error" | "info" | "warning"; text: string } | null>(null);

	// Embedding profiles
	const [embProfiles, setEmbProfiles] = useState<EmbeddingProfile[]>([]);
	const [activeEmbProfileId, setActiveEmbProfileId] = useState("");
	const [editAnchor, setEditAnchor] = useState<HTMLElement | null>(null);
	const [editProfile, setEditProfile] = useState<EmbeddingProfile | null>(null);
	const [editApiKey, setEditApiKey] = useState("");

	// Rerank profiles
	const [rerankProfiles, setRerankProfiles] = useState<RerankProfile[]>([]);
	const [activeRerankProfileId, setActiveRerankProfileId] = useState("");
	const [rerankEnabled, setRerankEnabled] = useState(false);
	const [rerankEditAnchor, setRerankEditAnchor] = useState<HTMLElement | null>(null);
	const [rerankEditProfile, setRerankEditProfile] = useState<RerankProfile | null>(null);
	const [rerankEditApiKey, setRerankEditApiKey] = useState("");
	const [embTesting, setEmbTesting] = useState(false);
	const [embTestResult, setEmbTestResult] = useState<{ ok: boolean; text: string } | null>(null);
	const [rerankTesting, setRerankTesting] = useState(false);
	const [rerankTestResult, setRerankTestResult] = useState<{ ok: boolean; text: string } | null>(null);

	// Knowledge state
	const [documents, setDocuments] = useState<KnowledgeDocument[]>([]);
	const [chunkCount, setChunkCount] = useState(0);
	const [hasIndex, setHasIndex] = useState(false);
	const [knowledgeReady, setKnowledgeReady] = useState(false);
	const [indexStatus, setIndexStatus] = useState<IndexStatus>("ready");
	const [importing, setImporting] = useState(false);
	const [rebuilding, setRebuilding] = useState(false);

	// 门控状态：当搜索被拦截时保存待执行动作
	const [showRebuildGate, setShowRebuildGate] = useState(false);
	const pendingSearchRef = useRef<string | null>(null);

	// Add form
	const [addTitle, setAddTitle] = useState("");
	const [addContent, setAddContent] = useState("");
	const [adding, setAdding] = useState(false);

	// Edit document
	const [editingDocId, setEditingDocId] = useState<string | null>(null);
	const [editTitle, setEditTitle] = useState("");
	const [editContent, setEditContent] = useState("");
	const [saving, setSaving] = useState(false);

	// Search
	const [searchQuery, setSearchQuery] = useState("");
	const [searchResults, setSearchResults] = useState<RetrievalResult[] | null>(null);
	const [searching, setSearching] = useState(false);

	// Dual-mode input
	const [inputMode, setInputMode] = useState<"simple" | "json">("simple");
	const [jsonInput, setJsonInput] = useState("");
	const [jsonError, setJsonError] = useState<string | null>(null);
	const [jsonDocCount, setJsonDocCount] = useState<number | null>(null);
	const [showTemplate, setShowTemplate] = useState(false);
	const [dragging, setDragging] = useState(false);

	const fileInputRef = useRef<HTMLInputElement>(null);

	const refreshState = useCallback(() => {
		try {
			const { knowledge } = getServices();
			setDocuments([...knowledge.getDocuments()]);
			setChunkCount(knowledge.getChunkCount());
			setHasIndex(knowledge.hasIndex());
			setKnowledgeReady(knowledge.isInitialized());
			setIndexStatus(knowledge.getIndexStatus());
		} catch { /* services not yet initialized */ }
	}, []);

	useEffect(() => {
		(async () => {
			const loaded = await loadConfig();
			setEmbProfiles(loaded.knowledge.embeddingProfiles ?? []);
			setActiveEmbProfileId(loaded.knowledge.activeEmbeddingProfileId ?? "");
			setRerankProfiles(loaded.knowledge.rerankProfiles ?? []);
			setActiveRerankProfileId(loaded.knowledge.activeRerankProfileId ?? "");
			setRerankEnabled(loaded.knowledge.rerankEnabled ?? false);
		})();
		const timer = setInterval(refreshState, 500);
		refreshState();
		return () => clearInterval(timer);
	}, [refreshState]);

	useEffect(() => {
		if (knowledgeReady) refreshState();
	}, [knowledgeReady, refreshState]);

	// ── Embedding profile management ──

	const handleSelectEmbProfile = useCallback(async (id: string) => {
		setActiveEmbProfileId(id);
		const loaded = await loadConfig();
		const profile = (loaded.knowledge.embeddingProfiles ?? []).find((p) => p.id === id);
		if (profile) {
			await updateConfig({
				knowledge: {
					...loaded.knowledge,
					activeEmbeddingProfileId: id,
					embedding: { baseUrl: profile.baseUrl, model: profile.model, dimension: profile.dimension },
				},
			});
			await refreshEmbeddingService();
			refreshState();
			setMessage({ type: "success", text: `已切换 Embedding 档案: ${profile.name}` });
		}
	}, [refreshState]);

	const handleOpenEdit = useCallback((anchor: HTMLElement, profile?: EmbeddingProfile) => {
		const p = profile ?? { id: `emb-${Date.now()}`, name: "", baseUrl: "", model: "", dimension: 1536 };
		setEditProfile({ ...p });
		setEditApiKey("");
		setEditAnchor(anchor);
		if (profile) {
			getSecret(SECRET_KEYS.EMBEDDING_API_KEY(profile.id)).then((key) => {
				if (key) setEditApiKey(key);
			});
		}
	}, []);

	const handleSaveProfile = useCallback(async () => {
		if (!editProfile || !editProfile.name.trim() || !editProfile.baseUrl.trim() || !editProfile.model.trim()) return;
		const loaded = await loadConfig();
		const profiles = [...(loaded.knowledge.embeddingProfiles ?? [])];
		const idx = profiles.findIndex((p) => p.id === editProfile.id);
		if (idx >= 0) {
			profiles[idx] = editProfile;
		} else {
			profiles.push(editProfile);
		}
		if (editApiKey) {
			await setSecret(SECRET_KEYS.EMBEDDING_API_KEY(editProfile.id), editApiKey);
		}
		let newActiveId = loaded.knowledge.activeEmbeddingProfileId;
		if (!newActiveId || !profiles.some((p) => p.id === newActiveId)) {
			newActiveId = editProfile.id;
		}
		await updateConfig({
			knowledge: {
				...loaded.knowledge,
				embeddingProfiles: profiles,
				activeEmbeddingProfileId: newActiveId,
				embedding: newActiveId === editProfile.id
					? { baseUrl: editProfile.baseUrl, model: editProfile.model, dimension: editProfile.dimension }
					: loaded.knowledge.embedding,
			},
		});
		setEmbProfiles(profiles);
		setActiveEmbProfileId(newActiveId);
		setEditAnchor(null);
		setEditProfile(null);
		await refreshEmbeddingService();
		refreshState();
		setMessage({ type: "success", text: `Embedding 档案已保存: ${editProfile.name}` });
	}, [editProfile, editApiKey, refreshState]);

	const handleDeleteProfile = useCallback(async () => {
		if (!editProfile) return;
		const loaded = await loadConfig();
		const profiles = (loaded.knowledge.embeddingProfiles ?? []).filter((p) => p.id !== editProfile.id);
		await deleteSecret(SECRET_KEYS.EMBEDDING_API_KEY(editProfile.id));
		const newActiveId = profiles.length > 0 ? profiles[0].id : "";
		const newEmb = newActiveId
			? { baseUrl: profiles[0].baseUrl, model: profiles[0].model, dimension: profiles[0].dimension }
			: { baseUrl: "", model: "", dimension: 1536 };
		await updateConfig({
			knowledge: { ...loaded.knowledge, embeddingProfiles: profiles, activeEmbeddingProfileId: newActiveId, embedding: newEmb },
		});
		setEmbProfiles(profiles);
		setActiveEmbProfileId(newActiveId);
		setEditAnchor(null);
		setEditProfile(null);
		await refreshEmbeddingService();
		refreshState();
		setMessage({ type: "info", text: "Embedding 档案已删除" });
	}, [editProfile, refreshState]);

	// ── Embedding 连接测试 ──

	const testEmbConnection = useCallback(async (profile: EmbeddingProfile, apiKey: string) => {
		setEmbTesting(true);
		setEmbTestResult(null);
		try {
			let baseUrl = profile.baseUrl.replace(/\/+$/, "").replace(/\/v1$/, "");
			const url = `${baseUrl}/v1/embeddings`;
			const body = JSON.stringify({ input: ["test"], model: profile.model, dimensions: profile.dimension });
			const resp = await proxyRequest({
				url,
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body,
				secretKey: apiKey ? SECRET_KEYS.EMBEDDING_API_KEY(profile.id) : undefined,
				timeoutMs: 15000,
			});
			if (resp.status >= 200 && resp.status < 300) {
				setEmbTestResult({ ok: true, text: `连接成功 (HTTP ${resp.status})` });
			} else {
				setEmbTestResult({ ok: false, text: `连接失败: HTTP ${resp.status} — ${resp.body.slice(0, 100)}` });
			}
		} catch (err) {
			setEmbTestResult({ ok: false, text: `连接失败: ${err instanceof Error ? err.message : String(err)}` });
		} finally {
			setEmbTesting(false);
		}
	}, []);

	const handleTestEmbFromMain = useCallback(async () => {
		const profile = embProfiles.find((p) => p.id === activeEmbProfileId);
		if (!profile) {
			setMessage({ type: "error", text: "请先选择一个 Embedding 档案" });
			return;
		}
		const key = (await getSecret(SECRET_KEYS.EMBEDDING_API_KEY(profile.id))) ?? "";
		testEmbConnection(profile, key);
	}, [embProfiles, activeEmbProfileId, testEmbConnection]);

	const handleTestEmbConnection = useCallback(async () => {
		if (!editProfile?.baseUrl.trim() || !editProfile?.model.trim()) {
			setMessage({ type: "error", text: "请先填写 Base URL 和模型名称" });
			return;
		}
		const key = editApiKey || (editProfile.id
			? await getSecret(SECRET_KEYS.EMBEDDING_API_KEY(editProfile.id)) ?? ""
			: "");
		testEmbConnection(editProfile, key);
	}, [editProfile, editApiKey, testEmbConnection]);

	// ── Rerank profile management ──

	const handleToggleRerank = useCallback(async (enabled: boolean) => {
		setRerankEnabled(enabled);
		const loaded = await loadConfig();
		await updateConfig({ knowledge: { ...loaded.knowledge, rerankEnabled: enabled } });
		await refreshEmbeddingService();
		refreshState();
		setMessage({ type: "info", text: enabled ? "Rerank 已启用" : "Rerank 已关闭" });
	}, [refreshState]);

	const handleSelectRerankProfile = useCallback(async (id: string) => {
		setActiveRerankProfileId(id);
		const loaded = await loadConfig();
		const profile = (loaded.knowledge.rerankProfiles ?? []).find((p) => p.id === id);
		if (profile) {
			await updateConfig({
				knowledge: {
					...loaded.knowledge,
					activeRerankProfileId: id,
					rerank: { baseUrl: profile.baseUrl, model: profile.model },
				},
			});
			await refreshEmbeddingService();
			refreshState();
			setMessage({ type: "success", text: `已切换 Rerank 档案: ${profile.name}` });
		}
	}, [refreshState]);

	const handleOpenRerankEdit = useCallback((anchor: HTMLElement, profile?: RerankProfile) => {
		const p = profile ?? { id: `rerank-${Date.now()}`, name: "", baseUrl: "", model: "" };
		setRerankEditProfile({ ...p });
		setRerankEditApiKey("");
		setRerankEditAnchor(anchor);
		if (profile) {
			getSecret(SECRET_KEYS.RERANK_API_KEY(profile.id)).then((key) => {
				if (key) setRerankEditApiKey(key);
			});
		}
	}, []);

	const handleSaveRerankProfile = useCallback(async () => {
		if (!rerankEditProfile || !rerankEditProfile.name.trim() || !rerankEditProfile.baseUrl.trim() || !rerankEditProfile.model.trim()) return;
		const loaded = await loadConfig();
		const profiles = [...(loaded.knowledge.rerankProfiles ?? [])];
		const idx = profiles.findIndex((p) => p.id === rerankEditProfile.id);
		if (idx >= 0) {
			profiles[idx] = rerankEditProfile;
		} else {
			profiles.push(rerankEditProfile);
		}
		if (rerankEditApiKey) {
			await setSecret(SECRET_KEYS.RERANK_API_KEY(rerankEditProfile.id), rerankEditApiKey);
		}
		let newActiveId = loaded.knowledge.activeRerankProfileId;
		if (!newActiveId || !profiles.some((p) => p.id === newActiveId)) {
			newActiveId = rerankEditProfile.id;
		}
		await updateConfig({
			knowledge: {
				...loaded.knowledge,
				rerankProfiles: profiles,
				activeRerankProfileId: newActiveId,
				rerank: newActiveId === rerankEditProfile.id
					? { baseUrl: rerankEditProfile.baseUrl, model: rerankEditProfile.model }
					: loaded.knowledge.rerank,
			},
		});
		setRerankProfiles(profiles);
		setActiveRerankProfileId(newActiveId);
		setRerankEditAnchor(null);
		setRerankEditProfile(null);
		await refreshEmbeddingService();
		refreshState();
		setMessage({ type: "success", text: `Rerank 档案已保存: ${rerankEditProfile.name}` });
	}, [rerankEditProfile, rerankEditApiKey, refreshState]);

	const handleDeleteRerankProfile = useCallback(async () => {
		if (!rerankEditProfile) return;
		const loaded = await loadConfig();
		const profiles = (loaded.knowledge.rerankProfiles ?? []).filter((p) => p.id !== rerankEditProfile.id);
		await deleteSecret(SECRET_KEYS.RERANK_API_KEY(rerankEditProfile.id));
		const newActiveId = profiles.length > 0 ? profiles[0].id : "";
		const newRerank = newActiveId
			? { baseUrl: profiles[0].baseUrl, model: profiles[0].model }
			: { baseUrl: "", model: "" };
		await updateConfig({
			knowledge: { ...loaded.knowledge, rerankProfiles: profiles, activeRerankProfileId: newActiveId, rerank: newRerank },
		});
		setRerankProfiles(profiles);
		setActiveRerankProfileId(newActiveId);
		setRerankEditAnchor(null);
		setRerankEditProfile(null);
		await refreshEmbeddingService();
		refreshState();
		setMessage({ type: "info", text: "Rerank 档案已删除" });
	}, [rerankEditProfile, refreshState]);

	// ── Rerank 连接测试 ──

	const testRerankConnection = useCallback(async (profile: RerankProfile, apiKey: string) => {
		setRerankTesting(true);
		setRerankTestResult(null);
		try {
			let baseUrl = profile.baseUrl.replace(/\/+$/, "").replace(/\/v1$/, "");
			const url = `${baseUrl}/v1/rerank`;
			const body = JSON.stringify({
				model: profile.model,
				query: "test query",
				documents: ["test document one", "test document two"],
				top_n: 2,
				return_documents: true,
			});
			const resp = await proxyRequest({
				url,
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body,
				secretKey: apiKey ? SECRET_KEYS.RERANK_API_KEY(profile.id) : undefined,
				timeoutMs: 15000,
			});
			if (resp.status >= 200 && resp.status < 300) {
				setRerankTestResult({ ok: true, text: `连接成功 (HTTP ${resp.status})` });
			} else {
				setRerankTestResult({ ok: false, text: `连接失败: HTTP ${resp.status} — ${resp.body.slice(0, 100)}` });
			}
		} catch (err) {
			setRerankTestResult({ ok: false, text: `连接失败: ${err instanceof Error ? err.message : String(err)}` });
		} finally {
			setRerankTesting(false);
		}
	}, []);

	const handleTestRerankConnection = useCallback(async () => {
		if (!rerankEditProfile?.baseUrl.trim() || !rerankEditProfile?.model.trim()) {
			setMessage({ type: "error", text: "请先填写 Base URL 和模型名称" });
			return;
		}
		const key = rerankEditApiKey || (rerankEditProfile.id
			? await getSecret(SECRET_KEYS.RERANK_API_KEY(rerankEditProfile.id)) ?? ""
			: "");
		testRerankConnection(rerankEditProfile, key);
	}, [rerankEditProfile, rerankEditApiKey, testRerankConnection]);

	const handleTestRerankFromMain = useCallback(async () => {
		const profile = rerankProfiles.find((p) => p.id === activeRerankProfileId);
		if (!profile) {
			setMessage({ type: "error", text: "请先选择一个 Rerank 档案" });
			return;
		}
		const key = (await getSecret(SECRET_KEYS.RERANK_API_KEY(profile.id))) ?? "";
		testRerankConnection(profile, key);
	}, [rerankProfiles, activeRerankProfileId, testRerankConnection]);

	// ── Knowledge operations ──

	const importFromText = useCallback(async (text: string, sourceName: string) => {
		const parsed = JSON.parse(text);
		let docs: KnowledgeDocument[];
		if (Array.isArray(parsed)) { docs = parsed; }
		else if (parsed.documents && Array.isArray(parsed.documents)) { docs = parsed.documents; }
		else { throw new Error("JSON 格式不正确：需要 KnowledgeDocument[] 或 { documents: [...] }"); }
		for (const doc of docs) {
			if (!doc.id || !doc.title || !doc.content) throw new Error(`文档缺少必要字段 (id/title/content)`);
			if (!doc.source) doc.source = sourceName;
		}
		const { knowledge } = getServices();
		return knowledge.importDocuments(docs);
	}, []);

	const handleFileImport = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
		const file = e.target.files?.[0];
		if (!file) return;
		setImporting(true);
		setMessage(null);
		try {
			const text = await file.text();
			const result = await importFromText(text, file.name);
			if (result.imported > 0) {
				setMessage({ type: result.errors.length > 0 ? "warning" : "success", text: `成功导入 ${result.imported} 条${result.errors.length > 0 ? `，${result.errors.length} 条失败` : ""}` });
			} else {
				setMessage({ type: "error", text: result.errors[0] ?? "导入失败" });
			}
			refreshState();
		} catch (err) {
			setMessage({ type: "error", text: `导入失败: ${err instanceof Error ? err.message : String(err)}` });
		} finally {
			setImporting(false);
			if (fileInputRef.current) fileInputRef.current.value = "";
		}
	}, [refreshState, importFromText]);

	const handleDrop = useCallback(async (e: React.DragEvent) => {
		e.preventDefault();
		setDragging(false);
		const file = e.dataTransfer.files[0];
		if (!file || !file.name.endsWith(".json")) {
			setMessage({ type: "error", text: "请拖入 .json 文件" });
			return;
		}
		if (file.size > 1024 * 1024) {
			setMessage({ type: "error", text: "文件过大（>1MB），请拆分后导入" });
			return;
		}
		setImporting(true);
		setMessage(null);
		try {
			const text = await file.text();
			const result = await importFromText(text, file.name);
			if (result.imported > 0) {
				setMessage({ type: result.errors.length > 0 ? "warning" : "success", text: `成功导入 ${result.imported} 条${result.errors.length > 0 ? `，${result.errors.length} 条失败` : ""}` });
			} else {
				setMessage({ type: "error", text: result.errors[0] ?? "导入失败" });
			}
			refreshState();
		} catch (err) {
			setMessage({ type: "error", text: `导入失败: ${err instanceof Error ? err.message : String(err)}` });
		} finally {
			setImporting(false);
		}
	}, [refreshState, importFromText]);

	const handleJsonImport = useCallback(async () => {
		if (!jsonInput.trim()) return;
		setImporting(true);
		setMessage(null);
		try {
			const result = await importFromText(jsonInput, "json-editor");
			if (result.imported > 0) {
				setMessage({ type: result.errors.length > 0 ? "warning" : "success", text: `成功导入 ${result.imported} 条${result.errors.length > 0 ? `，${result.errors.length} 条失败` : ""}` });
				setJsonInput("");
				setJsonError(null);
				setJsonDocCount(null);
			} else {
				setMessage({ type: "error", text: result.errors[0] ?? "导入失败" });
			}
			refreshState();
		} catch (err) {
			setMessage({ type: "error", text: `导入失败: ${err instanceof Error ? err.message : String(err)}` });
		} finally {
			setImporting(false);
		}
	}, [jsonInput, refreshState, importFromText]);

	const validateJsonInput = useCallback((text: string) => {
		setJsonInput(text);
		if (!text.trim()) {
			setJsonError(null);
			setJsonDocCount(null);
			return;
		}
		try {
			const parsed = JSON.parse(text);
			let docs: unknown[];
			if (Array.isArray(parsed)) { docs = parsed; }
			else if (parsed.documents && Array.isArray(parsed.documents)) { docs = parsed.documents; }
			else { setJsonError("JSON 格式不正确：需要数组 [] 或 { documents: [...] }"); setJsonDocCount(null); return; }
			const missing = docs.findIndex((d: any) => !d.id || !d.title || !d.content);
			if (missing >= 0) {
				setJsonError(`文档 #${missing + 1} 缺少必要字段 (id/title/content)`);
				setJsonDocCount(null);
				return;
			}
			setJsonError(null);
			setJsonDocCount(docs.length);
		} catch {
			setJsonError("JSON 解析失败，请检查语法");
			setJsonDocCount(null);
		}
	}, []);

	const handleDeleteDoc = useCallback(async (docId: string) => {
		try {
			const { knowledge } = getServices();
			await knowledge.removeDocument(docId);
			refreshState();
			setMessage({ type: "success", text: "已删除" });
		} catch (err) {
			setMessage({ type: "error", text: `删除失败: ${err instanceof Error ? err.message : String(err)}` });
		}
	}, [refreshState]);

	const handleAdd = useCallback(async () => {
		if (!addTitle.trim() || !addContent.trim()) return;
		setAdding(true);
		try {
			const doc: KnowledgeDocument = { id: `manual-${Date.now()}`, title: addTitle.trim(), content: addContent.trim(), source: "manual" };
			const { knowledge } = getServices();
			const result = await knowledge.addDocument(doc);
			if (result.success) {
				setMessage({ type: "success", text: `已添加: "${doc.title}"` });
				setAddTitle(""); setAddContent("");
				refreshState();
			} else {
				setMessage({ type: "error", text: result.error ?? "添加失败" });
			}
		} catch (err) {
			setMessage({ type: "error", text: `添加失败: ${err instanceof Error ? err.message : String(err)}` });
		} finally { setAdding(false); }
	}, [addTitle, addContent, refreshState]);

	const handleStartEdit = useCallback((doc: KnowledgeDocument) => {
		setEditingDocId(doc.id);
		setEditTitle(doc.title);
		setEditContent(doc.content);
	}, []);

	const handleCancelEdit = useCallback(() => {
		setEditingDocId(null);
		setEditTitle("");
		setEditContent("");
	}, []);

	const handleSaveEdit = useCallback(async () => {
		if (!editingDocId || !editTitle.trim() || !editContent.trim()) return;
		setSaving(true);
		try {
			const { knowledge } = getServices();
			const result = await knowledge.updateDocument(editingDocId, { title: editTitle.trim(), content: editContent.trim() });
			if (result.success) {
				setMessage({ type: "success", text: `已更新: "${editTitle.trim()}"` });
				setEditingDocId(null);
				setEditTitle("");
				setEditContent("");
				refreshState();
			} else {
				setMessage({ type: "error", text: result.error ?? "更新失败" });
			}
		} catch (err) {
			setMessage({ type: "error", text: `更新失败: ${err instanceof Error ? err.message : String(err)}` });
		} finally { setSaving(false); }
	}, [editingDocId, editTitle, editContent, refreshState]);

	const handleRebuild = useCallback(async () => {
		setRebuilding(true); setMessage(null);
		try {
			const { knowledge } = getServices();
			const result = await knowledge.rebuildIndex();
			setMessage(result.success ? { type: "success", text: "索引重建完成" } : { type: "error", text: result.error ?? "重建失败" });
			refreshState();
		} catch (err) {
			setMessage({ type: "error", text: `重建失败: ${err instanceof Error ? err.message : String(err)}` });
		} finally { setRebuilding(false); }
	}, [refreshState]);

	const executeSearch = useCallback(async (query: string) => {
		setSearching(true);
		setSearchResults(null);
		try {
			const { knowledge } = getServices();
			const results = await knowledge.query(query, { topK: 5 });
			setSearchResults(results);
		} catch (err) {
			setMessage({ type: "error", text: `搜索失败: ${err instanceof Error ? err.message : String(err)}` });
		} finally { setSearching(false); }
	}, []);

	const handleSearch = useCallback(async () => {
		if (!searchQuery.trim()) return;
		const { knowledge } = getServices();
		if (knowledge.getIndexStatus() === "needs_rebuild") {
			pendingSearchRef.current = searchQuery.trim();
			setShowRebuildGate(true);
			return;
		}
		executeSearch(searchQuery.trim());
	}, [searchQuery, executeSearch]);

	const handleGateRebuilt = useCallback(() => {
		setShowRebuildGate(false);
		refreshState();
		setMessage({ type: "success", text: "索引重建完成" });
		if (pendingSearchRef.current) {
			executeSearch(pendingSearchRef.current);
			pendingSearchRef.current = null;
		}
	}, [executeSearch, refreshState]);

	const handleGateCancel = useCallback(() => {
		setShowRebuildGate(false);
		pendingSearchRef.current = null;
	}, []);

	return (
		<Box sx={{ p: 1, display: "flex", flexDirection: "column", gap: 0.75, height: "100%", overflowY: "auto" }}>
			{/* Header */}
			<Stack direction="row" alignItems="center" spacing={0.5}>
				<Tooltip title="返回"><IconButton size="small" onClick={onClose}><ArrowBackIcon fontSize="small" /></IconButton></Tooltip>
				<Typography variant="subtitle1" fontWeight={700} sx={{ flex: 1 }}>知识库</Typography>
			</Stack>

			{message && (
				<Alert severity={message.type} onClose={() => setMessage(null)} sx={{ py: 0, fontSize: 11 }}>{message.text}</Alert>
			)}

			{/* Embedding Profile */}
			<SectionTitle>
				Embedding 配置
				<HelpTooltip title="配置向量化服务。支持 OpenAI 兼容的 /v1/embeddings API。每个档案有独立的 API Key。" />
			</SectionTitle>
			<Box sx={{ bgcolor: "background.paper", borderRadius: 1, p: 1, display: "flex", flexDirection: "column", gap: 0.75 }}>
				{embProfiles.length > 0 ? (
					<Stack direction="row" spacing={0.5} alignItems="center">
						<Select size="small" fullWidth value={activeEmbProfileId}
							onChange={(e: SelectChangeEvent) => handleSelectEmbProfile(e.target.value)}>
							{embProfiles.map((p) => (
								<MenuItem key={p.id} value={p.id}>{p.name} ({p.model})</MenuItem>
							))}
						</Select>
						<Tooltip title="编辑"><span>
							<IconButton size="small" onClick={(e) => {
								const profile = embProfiles.find((p) => p.id === activeEmbProfileId);
								if (profile) handleOpenEdit(e.currentTarget, profile);
							}} disabled={!activeEmbProfileId}><EditIcon fontSize="small" /></IconButton>
						</span></Tooltip>
					</Stack>
				) : (
					<Typography variant="caption" color="text.secondary">尚未配置 Embedding 档案</Typography>
				)}
				<Button size="small" variant="outlined" startIcon={<AddIcon />} onClick={(e) => handleOpenEdit(e.currentTarget)}>
					新增 Embedding 档案
				</Button>
			</Box>

			{/* Embedding 测试 */}
			<SectionTitle>
				Embedding 测试
				<HelpTooltip title="在左侧选择或新建 Embedding 档案并保存后，点击此处测试连接是否可达。测试结果仅供参考。" />
			</SectionTitle>
			<Box sx={{ bgcolor: "background.paper", borderRadius: 1, p: 1, display: "flex", flexDirection: "column", gap: 0.75 }}>
				<Typography variant="caption" color="text.secondary" sx={{ fontSize: 10 }}>
					当前读取：{activeEmbProfileId
						? `档案「${embProfiles.find((p) => p.id === activeEmbProfileId)?.name || "(未命名)"}」`
						: "无激活档案"}
					{activeEmbProfileId && (() => {
						const p = embProfiles.find((p) => p.id === activeEmbProfileId);
						return p ? ` · ${p.baseUrl} · ${p.model}` : "";
					})()}
				</Typography>
				<Button
					size="small" variant="outlined"
					startIcon={<NetworkCheckIcon />}
					onClick={handleTestEmbFromMain}
					disabled={embTesting || !activeEmbProfileId}
				>
					{embTesting ? "测试中..." : "测试连接"}
				</Button>
				{embTestResult && (
					<Alert severity={embTestResult.ok ? "success" : "error"} sx={{ py: 0, fontSize: 11 }}>
						{embTestResult.text}
					</Alert>
				)}
			</Box>

			{/* Edit Popover */}
			<Popover open={!!editAnchor} anchorEl={editAnchor} onClose={() => { setEditAnchor(null); setEditProfile(null); }}
				anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
				slotProps={{ paper: { sx: { p: 1.5, width: 320, display: "flex", flexDirection: "column", gap: 1 } } }}>
				{editProfile && (
					<>
						<Typography variant="subtitle2" fontWeight={600}>
							{embProfiles.some((p) => p.id === editProfile.id) ? "编辑 Embedding 档案" : "新建 Embedding 档案"}
						</Typography>
						<TextField size="small" fullWidth label="档案名称" value={editProfile.name}
							onChange={(e) => setEditProfile({ ...editProfile, name: e.target.value })} />
						<TextField size="small" fullWidth label="Base URL" value={editProfile.baseUrl}
							onChange={(e) => setEditProfile({ ...editProfile, baseUrl: e.target.value })}
							helperText="如 https://www.dmxapi.cn 或 https://api.openai.com" />
						<Stack direction="row" spacing={0.5}>
							<TextField size="small" sx={{ flex: 2 }} label="模型名称" value={editProfile.model}
								onChange={(e) => setEditProfile({ ...editProfile, model: e.target.value })} />
							<TextField size="small" sx={{ flex: 1 }} label="维度" type="number" value={editProfile.dimension}
								onChange={(e) => setEditProfile({ ...editProfile, dimension: parseInt(e.target.value) || 1536 })}
								slotProps={{ htmlInput: { min: 64, max: 4096, step: 64 } }} />
						</Stack>
						<TextField size="small" fullWidth label="API Key" type="password" value={editApiKey}
							onChange={(e) => setEditApiKey(e.target.value)} helperText="密钥安全存储在系统钥匙串中" />
						<Stack direction="row" spacing={0.5} justifyContent="space-between">
							{embProfiles.some((p) => p.id === editProfile.id) && (
								<Button size="small" color="error" onClick={handleDeleteProfile}>删除</Button>
							)}
							<Box sx={{ flex: 1 }} />
							<Button size="small" variant="outlined" startIcon={<NetworkCheckIcon />}
								onClick={handleTestEmbConnection} disabled={embTesting}>
								{embTesting ? "测试中..." : "测试连接"}
							</Button>
							<Button size="small" onClick={() => { setEditAnchor(null); setEditProfile(null); }}>取消</Button>
							<Button size="small" variant="contained" onClick={handleSaveProfile}
								disabled={!editProfile.name.trim() || !editProfile.baseUrl.trim() || !editProfile.model.trim()}>
								保存
							</Button>
						</Stack>
					</>
				)}
			</Popover>

			{/* Rerank 配置 */}
			<SectionTitle>
				Rerank 配置
				<HelpTooltip title="Rerank 对初次召回结果进行二次精排，提升检索质量。支持兼容 /v1/rerank 端点的服务（DMXAPI、Jina、Cohere 等）。" />
			</SectionTitle>
			<Box sx={{ bgcolor: "background.paper", borderRadius: 1, p: 1, display: "flex", flexDirection: "column", gap: 0.75 }}>
				<Stack direction="row" spacing={1} alignItems="center">
					<Typography variant="caption" sx={{ fontSize: 11 }}>启用 Rerank</Typography>
					<Button size="small" variant={rerankEnabled ? "contained" : "outlined"}
						color={rerankEnabled ? "primary" : "inherit"}
						onClick={() => handleToggleRerank(!rerankEnabled)}
						sx={{ minWidth: 60, fontSize: 11 }}>
						{rerankEnabled ? "已启用" : "未启用"}
					</Button>
				</Stack>
				{rerankEnabled && (
					<>
						{rerankProfiles.length > 0 ? (
							<Stack direction="row" spacing={0.5} alignItems="center">
							<Select size="small" fullWidth value={activeRerankProfileId}
									onChange={(e: SelectChangeEvent) => handleSelectRerankProfile(e.target.value)}>
								{rerankProfiles.map((p) => (
									<MenuItem key={p.id} value={p.id}>{p.name} ({p.model})</MenuItem>
								))}
							</Select>
							<Tooltip title="编辑"><span>
								<IconButton size="small" onClick={(e) => {
									const profile = rerankProfiles.find((p) => p.id === activeRerankProfileId);
									if (profile) handleOpenRerankEdit(e.currentTarget, profile);
								}} disabled={!activeRerankProfileId}><EditIcon fontSize="small" /></IconButton>
							</span></Tooltip>
						</Stack>
						) : (
							<Typography variant="caption" color="text.secondary">尚未配置 Rerank 档案</Typography>
						)}
						<Button size="small" variant="outlined" startIcon={<AddIcon />} onClick={(e) => handleOpenRerankEdit(e.currentTarget)}>
							新增 Rerank 档案
						</Button>
					</>
				)}
			</Box>

			{/* Rerank 测试 */}
			<SectionTitle>
				Rerank 测试
				<HelpTooltip title="在左侧选择或新建 Rerank 档案并保存后，点击此处测试连接是否可达。测试结果仅供参考。" />
			</SectionTitle>
			<Box sx={{ bgcolor: "background.paper", borderRadius: 1, p: 1, display: "flex", flexDirection: "column", gap: 0.75 }}>
				<Typography variant="caption" color="text.secondary" sx={{ fontSize: 10 }}>
					当前读取：{activeRerankProfileId
						? `档案「${rerankProfiles.find((p) => p.id === activeRerankProfileId)?.name || "(未命名)"}」`
						: "无激活档案"}
					{activeRerankProfileId && (() => {
						const p = rerankProfiles.find((p) => p.id === activeRerankProfileId);
						return p ? ` · ${p.baseUrl} · ${p.model}` : "";
					})()}
				</Typography>
				<Button
					size="small" variant="outlined"
					startIcon={<NetworkCheckIcon />}
					onClick={handleTestRerankFromMain}
					disabled={rerankTesting || !activeRerankProfileId}
				>
					{rerankTesting ? "测试中..." : "测试连接"}
				</Button>
				{rerankTestResult && (
					<Alert severity={rerankTestResult.ok ? "success" : "error"} sx={{ py: 0, fontSize: 11 }}>
						{rerankTestResult.text}
					</Alert>
				)}
			</Box>

			{/* Rerank Edit Popover */}
			<Popover open={!!rerankEditAnchor} anchorEl={rerankEditAnchor} onClose={() => { setRerankEditAnchor(null); setRerankEditProfile(null); }}
				anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
				slotProps={{ paper: { sx: { p: 1.5, width: 320, display: "flex", flexDirection: "column", gap: 1 } } }}>
				{rerankEditProfile && (
					<>
						<Typography variant="subtitle2" fontWeight={600}>
							{rerankProfiles.some((p) => p.id === rerankEditProfile.id) ? "编辑 Rerank 档案" : "新建 Rerank 档案"}
						</Typography>
						<TextField size="small" fullWidth label="档案名称" value={rerankEditProfile.name}
							onChange={(e) => setRerankEditProfile({ ...rerankEditProfile, name: e.target.value })} />
						<TextField size="small" fullWidth label="Base URL" value={rerankEditProfile.baseUrl}
							onChange={(e) => setRerankEditProfile({ ...rerankEditProfile, baseUrl: e.target.value })}
							helperText="如 https://www.dmxapi.cn" />
						<TextField size="small" fullWidth label="模型名称" value={rerankEditProfile.model}
							onChange={(e) => setRerankEditProfile({ ...rerankEditProfile, model: e.target.value })}
							helperText="如 qwen3-reranker-8b 或 bge-reranker-v2-m3-free" />
						<TextField size="small" fullWidth label="API Key" type="password" value={rerankEditApiKey}
							onChange={(e) => setRerankEditApiKey(e.target.value)} helperText="密钥安全存储在系统钥匙串中" />
						<Stack direction="row" spacing={0.5} justifyContent="space-between">
							{rerankProfiles.some((p) => p.id === rerankEditProfile.id) && (
								<Button size="small" color="error" onClick={handleDeleteRerankProfile}>删除</Button>
							)}
							<Box sx={{ flex: 1 }} />
							<Button size="small" variant="outlined" startIcon={<NetworkCheckIcon />}
								onClick={handleTestRerankConnection} disabled={rerankTesting}>
								{rerankTesting ? "测试中..." : "测试连接"}
							</Button>
							<Button size="small" onClick={() => { setRerankEditAnchor(null); setRerankEditProfile(null); }}>取消</Button>
							<Button size="small" variant="contained" onClick={handleSaveRerankProfile}
								disabled={!rerankEditProfile.name.trim() || !rerankEditProfile.baseUrl.trim() || !rerankEditProfile.model.trim()}>
								保存
							</Button>
						</Stack>
					</>
				)}
			</Popover>

			{/* Status */}
			<Box sx={{ bgcolor: "background.paper", borderRadius: 1, p: 1 }}>
				<Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
					<Chip label={`${documents.length} 文档`} size="small" variant="outlined" />
					<Chip label={`${chunkCount} chunks`} size="small" variant="outlined" />
					<Chip
						label={
							!knowledgeReady ? "初始化中..."
								: indexStatus === "needs_rebuild" ? "需要重建索引"
									: indexStatus === "rebuilding" ? "重建中..."
										: indexStatus === "error" ? "索引异常"
											: hasIndex ? "索引就绪" : "无索引"
						}
						size="small"
						color={
							!knowledgeReady ? "warning"
								: indexStatus === "needs_rebuild" ? "warning"
									: indexStatus === "rebuilding" ? "info"
										: indexStatus === "error" ? "error"
											: hasIndex ? "success" : "default"
						}
						variant="outlined"
					/>
				</Stack>
			</Box>

			{/* Rebuild Gate */}
			{showRebuildGate && (
				<RebuildGate onRebuilt={handleGateRebuilt} onCancel={handleGateCancel} />
			)}

			{/* Drop Zone */}
			<input ref={fileInputRef} type="file" accept=".json" style={{ display: "none" }} onChange={handleFileImport} />
			<Box
				onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
				onDragLeave={() => setDragging(false)}
				onDrop={handleDrop}
				onClick={() => fileInputRef.current?.click()}
				sx={{
					border: "2px dashed", borderColor: dragging ? "primary.main" : "divider",
					borderRadius: 1, p: 1.5, textAlign: "center", cursor: "pointer",
					bgcolor: dragging ? "action.hover" : "background.paper",
					transition: "all 0.2s",
					"&:hover": { borderColor: "primary.main", bgcolor: "action.hover" },
				}}
			>
				<UploadFileIcon sx={{ fontSize: 28, color: "text.secondary", mb: 0.5 }} />
				<Typography variant="caption" color="text.secondary" display="block">
					拖拽 JSON 文件到此处，或点击选择文件
				</Typography>
			</Box>

			{/* Mode Tabs + Actions */}
			<Stack direction="row" spacing={0.5} alignItems="center" flexWrap="wrap">
				<Button size="small" variant={inputMode === "simple" ? "contained" : "outlined"} onClick={() => setInputMode("simple")} sx={{ fontSize: 11 }}>
					简洁模式
				</Button>
				<Button size="small" variant={inputMode === "json" ? "contained" : "outlined"} onClick={() => setInputMode("json")} sx={{ fontSize: 11 }}>
					JSON 模式
				</Button>
				<Box sx={{ flex: 1 }} />
				{documents.length > 0 && (
					<Button size="small" variant="outlined" color="warning" startIcon={<RefreshIcon />} onClick={handleRebuild} disabled={rebuilding}>
						{rebuilding ? "重建中..." : "重建索引"}
					</Button>
				)}
			</Stack>

			{(importing || rebuilding) && <LinearProgress sx={{ my: 0.5 }} />}

			{/* Simple Mode: single doc add */}
			{inputMode === "simple" && (
				<Box sx={{ bgcolor: "background.paper", borderRadius: 1, p: 1, display: "flex", flexDirection: "column", gap: 0.75 }}>
					<Typography variant="caption" fontWeight={600}>添加知识条目</Typography>
					<TextField size="small" fullWidth label="标题"
						value={addTitle} onChange={(e) => setAddTitle(e.target.value)}
						error={addTitle.length > 0 && !addTitle.trim()}
						helperText="标题参与语义索引——填写能概括内容主题的关键词或短语"
					/>
					<TextField size="small" fullWidth multiline minRows={2} maxRows={6} label="内容"
						value={addContent} onChange={(e) => setAddContent(e.target.value)}
						error={addContent.length > 0 && !addContent.trim()}
						helperText="正文会被切块并向量化，是语义检索的主文本"
					/>
					<Stack direction="row" spacing={0.5} justifyContent="flex-end">
						<Button size="small" onClick={() => { setAddTitle(""); setAddContent(""); }}>清空</Button>
						<Button size="small" variant="contained" onClick={handleAdd} disabled={adding || !addTitle.trim() || !addContent.trim()}>{adding ? "添加中..." : "添加"}</Button>
					</Stack>
				</Box>
			)}

			{/* JSON Mode: batch import from text */}
			{inputMode === "json" && (
				<Box sx={{ bgcolor: "background.paper", borderRadius: 1, p: 1, display: "flex", flexDirection: "column", gap: 0.75 }}>
					<Stack direction="row" alignItems="center" spacing={0.5}>
						<Typography variant="caption" fontWeight={600}>JSON 批量导入</Typography>
						<Button size="small" variant="text" onClick={() => setShowTemplate(!showTemplate)} sx={{ fontSize: 10, minWidth: 0, p: 0 }}>
							{showTemplate ? "收起模板" : "查看模板"}
						</Button>
					</Stack>
					{showTemplate && (
						<Box sx={{ bgcolor: "background.default", borderRadius: 1, p: 1, position: "relative" }}>
							<Typography variant="caption" color="text.secondary" sx={{ fontSize: 10, display: "block", mb: 0.5 }}>
								字段说明：id（唯一标识）、title（标题，参与语义索引）、content（正文，切块后向量化）、source（来源标注，可选）、category（分类，可选）
							</Typography>
							<Box component="pre" sx={{ fontSize: 10, m: 0, overflow: "auto", maxHeight: 160, fontFamily: "monospace", whiteSpace: "pre-wrap" }}>
{`[
  {
    "id": "faq-001",
    "title": "退款政策",
    "content": "商品签收后7天内可申请无理由退款，定制商品除外。",
    "source": "FAQ",
    "category": "policy"
  }
]`}
							</Box>
							<Button size="small" variant="text" sx={{ fontSize: 10, position: "absolute", top: 4, right: 4 }}
								onClick={() => {
									navigator.clipboard.writeText(`[\n  {\n    "id": "example-001",\n    "title": "示例标题",\n    "content": "示例正文内容",\n    "source": "manual",\n    "category": "general"\n  }\n]`);
									setMessage({ type: "info", text: "模板已复制到剪贴板" });
								}}>
								复制模板
							</Button>
						</Box>
					)}
					<TextField
						size="small" fullWidth multiline minRows={4} maxRows={10}
						placeholder='粘贴 JSON 数组，如 [{"id":"...","title":"...","content":"..."}]'
						value={jsonInput}
						onChange={(e) => validateJsonInput(e.target.value)}
						error={!!jsonError}
						sx={{ "& textarea": { fontFamily: "monospace", fontSize: 11 } }}
					/>
					{jsonError && <Typography variant="caption" color="error" sx={{ fontSize: 10 }}>{jsonError}</Typography>}
					{jsonDocCount !== null && !jsonError && <Typography variant="caption" color="success.main" sx={{ fontSize: 10 }}>解析成功，共 {jsonDocCount} 条文档</Typography>}
					<Stack direction="row" spacing={0.5} justifyContent="flex-end">
						<Button size="small" onClick={() => { setJsonInput(""); setJsonError(null); setJsonDocCount(null); }}>清空</Button>
						<Button size="small" variant="contained" onClick={handleJsonImport} disabled={importing || !jsonInput.trim() || !!jsonError}>
							{importing ? "导入中..." : "导入"}
						</Button>
					</Stack>
				</Box>
			)}

			{/* 索引文本说明 */}
			<Box sx={{ bgcolor: "background.paper", borderRadius: 1, p: 1 }}>
				<Typography variant="caption" color="text.secondary" sx={{ fontSize: 10, lineHeight: 1.6 }}>
					<strong>title</strong> 和 <strong>content</strong> 均参与语义检索。title 作为前缀拼入每个文本块的 embedding 输入，同时也作为 Orama 全文索引的独立字段。
					id / source / category 不参与检索，仅用于标识和展示。
				</Typography>
			</Box>

			{/* Document list with CRUD */}
			{documents.length > 0 && (
				<Box sx={{ bgcolor: "background.paper", borderRadius: 1, p: 1, display: "flex", flexDirection: "column", gap: 0.5 }}>
					<Typography variant="caption" fontWeight={600}>已导入文档 ({documents.length})</Typography>
					{documents.map((doc) => (
						<Box key={doc.id}>
							{editingDocId === doc.id ? (
								<Box sx={{ border: "1px solid", borderColor: "primary.main", borderRadius: 1, p: 1, display: "flex", flexDirection: "column", gap: 0.5 }}>
									<TextField size="small" fullWidth label="标题" value={editTitle} onChange={(e) => setEditTitle(e.target.value)} />
									<TextField size="small" fullWidth multiline minRows={2} maxRows={6} label="内容" value={editContent} onChange={(e) => setEditContent(e.target.value)} />
									<Stack direction="row" spacing={0.5} justifyContent="flex-end">
										<Button size="small" onClick={handleCancelEdit}>取消</Button>
										<Button size="small" variant="contained" onClick={handleSaveEdit} disabled={saving || !editTitle.trim() || !editContent.trim()}>
											{saving ? "保存中..." : "保存"}
										</Button>
									</Stack>
								</Box>
							) : (
								<Box sx={{ cursor: "pointer", "&:hover": { bgcolor: "action.hover" }, borderRadius: 0.5, px: 0.5, py: 0.25 }}
									onClick={() => handleStartEdit(doc)}>
									<Stack direction="row" alignItems="center" spacing={0.5}>
										<Typography variant="caption" sx={{ flex: 1, fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: 600 }}>{doc.title}</Typography>
										{doc.source && <Typography variant="caption" color="text.secondary" sx={{ fontSize: 9 }}>{doc.source}</Typography>}
										<IconButton size="small" onClick={(e) => { e.stopPropagation(); handleStartEdit(doc); }} sx={{ p: 0.25 }}><EditIcon sx={{ fontSize: 14 }} /></IconButton>
										<IconButton size="small" onClick={(e) => { e.stopPropagation(); handleDeleteDoc(doc.id); }} sx={{ p: 0.25 }}><DeleteIcon sx={{ fontSize: 14 }} /></IconButton>
									</Stack>
									<Typography variant="caption" color="text.secondary" sx={{ fontSize: 10, display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
										{doc.content.slice(0, 80)}{doc.content.length > 80 ? "…" : ""}
									</Typography>
								</Box>
							)}
						</Box>
					))}
				</Box>
			)}

			{/* Search */}
			<Box sx={{ bgcolor: "background.paper", borderRadius: 1, p: 1, display: "flex", flexDirection: "column", gap: 0.75 }}>
				<Stack direction="row" alignItems="center" spacing={0.5}>
					<Typography variant="caption" fontWeight={600}>搜索验证</Typography>
					<HelpTooltip title="输入文本进行语义检索测试，验证知识库检索质量。" />
				</Stack>
				<Stack direction="row" spacing={0.5}>
					<TextField size="small" fullWidth placeholder="输入搜索文本" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") handleSearch(); }} />
					<Button size="small" variant="contained" onClick={handleSearch} disabled={searching || !searchQuery.trim()}>{searching ? "..." : "搜索"}</Button>
				</Stack>
				{searching && <LinearProgress sx={{ my: 0.25 }} />}
				{searchResults !== null && (
					<Box sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
						{searchResults.length === 0 ? (
							<Typography variant="caption" color="text.secondary">无匹配结果</Typography>
						) : searchResults.map((r, i) => (
							<Box key={`${r.docId}-${i}`} sx={{ borderLeft: "2px solid", borderColor: "primary.main", pl: 1, py: 0.25 }}>
								<Stack direction="row" spacing={0.5} alignItems="center">
									<Typography variant="caption" fontWeight={600} sx={{ fontSize: 11 }}>{r.title}</Typography>
									<Typography variant="caption" color="text.secondary" sx={{ fontSize: 9 }}>score: {r.score.toFixed(4)}</Typography>
								</Stack>
								<Typography variant="caption" sx={{ fontSize: 10, color: "text.secondary", display: "block", mt: 0.25 }}>{r.chunkText.length > 200 ? r.chunkText.slice(0, 200) + "…" : r.chunkText}</Typography>
								<Typography variant="caption" sx={{ fontSize: 9, color: "text.disabled" }}>来源: {r.source}</Typography>
							</Box>
						))}
					</Box>
				)}
			</Box>
		</Box>
	);
}
