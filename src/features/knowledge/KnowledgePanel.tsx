import { useState, useEffect, useCallback, useRef } from "react";
import {
	Box, Button, Typography, Stack, TextField, Select, MenuItem,
	Alert, IconButton, Tooltip, Popover, Chip, LinearProgress, Divider, Checkbox, ButtonGroup,
	type SelectChangeEvent,
} from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import UploadFileIcon from "@mui/icons-material/UploadFile";
import DeleteIcon from "@mui/icons-material/Delete";
import AddIcon from "@mui/icons-material/Add";
import RefreshIcon from "@mui/icons-material/Refresh";
import EditIcon from "@mui/icons-material/Edit";
import NetworkCheckIcon from "@mui/icons-material/NetworkCheck";
import WarningIcon from "@mui/icons-material/Warning";
import {
	SECRET_KEYS,
	loadConfig, updateConfig,
	setSecret, getSecret, deleteSecret,
	proxyRequest,
} from "@/services/config";
import { HelpTooltip } from "@/components";
import { useI18n } from "@/contexts/I18nProvider";
import { getServices, refreshEmbeddingService } from "@/services";
import type { KnowledgeDocument, RetrievalResult, EmbeddingProfile, RerankProfile } from "@/types/knowledge";
import type { IndexStatus } from "@/services/knowledge";
import { RebuildGate } from "./RebuildGate";

interface KnowledgePanelProps {
	onClose?: () => void;
	embedded?: boolean;
}

const SectionTitle = ({ children }: { children: React.ReactNode }) => (
	<Typography variant="caption" color="text.secondary" fontWeight={600} sx={{ display: "flex", alignItems: "center", gap: 0.25 }}>
		{children}
	</Typography>
);

export function KnowledgePanel({ onClose, embedded = false }: KnowledgePanelProps) {
	const { t } = useI18n();
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

	// Batch selection & delete confirmation
	const [selectedDocIds, setSelectedDocIds] = useState<Set<string>>(new Set());
	const [batchMode, setBatchMode] = useState(false);
	const [confirmDeleteTarget, setConfirmDeleteTarget] = useState<string | "batch" | null>(null);
	const [deleteCountdown, setDeleteCountdown] = useState(0);

	// 添加知识 tab
	const [addMode, setAddMode] = useState<"drop" | "simple" | "json" | null>(null);
	const [jsonInput, setJsonInput] = useState("");
	const [jsonError, setJsonError] = useState<string | null>(null);
	const [jsonDocCount, setJsonDocCount] = useState<number | null>(null);
	const [dragging, setDragging] = useState(false);

	// 文档编辑模式
	const [editMode, setEditMode] = useState<"simple" | "json">("simple");

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
		try {
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
				setMessage({ type: "success", text: `${t("已切换 Embedding 档案", "Switched embedding profile")}: ${profile.name}` });
			}
		} catch (err) {
			setMessage({ type: "error", text: `${t("切换失败", "Switch failed")}: ${err instanceof Error ? err.message : String(err)}` });
		}
	}, [refreshState, t]);

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
		setMessage({ type: "success", text: `${t("Embedding 档案已保存", "Embedding profile saved")}: ${editProfile.name}` });
	}, [editProfile, editApiKey, refreshState, t]);

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
		setMessage({ type: "info", text: t("Embedding 档案已删除", "Embedding profile removed") });
	}, [editProfile, refreshState, t]);

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
				setEmbTestResult({ ok: true, text: `${t("连接成功", "Connected")} (HTTP ${resp.status})` });
			} else {
				setEmbTestResult({ ok: false, text: `${t("连接失败", "Connection failed")}: HTTP ${resp.status} — ${resp.body.slice(0, 100)}` });
			}
		} catch (err) {
			setEmbTestResult({ ok: false, text: `${t("连接失败", "Connection failed")}: ${err instanceof Error ? err.message : String(err)}` });
		} finally {
			setEmbTesting(false);
		}
	}, [t]);

	const handleTestEmbFromMain = useCallback(async () => {
		const profile = embProfiles.find((p) => p.id === activeEmbProfileId);
		if (!profile) {
			setMessage({ type: "error", text: t("请先选择一个 Embedding 档案", "Select an embedding profile first") });
			return;
		}
		const key = (await getSecret(SECRET_KEYS.EMBEDDING_API_KEY(profile.id))) ?? "";
		testEmbConnection(profile, key);
	}, [embProfiles, activeEmbProfileId, testEmbConnection, t]);

	// ── Rerank profile management ──

	const handleToggleRerank = useCallback(async (enabled: boolean) => {
		setRerankEnabled(enabled);
		try {
			const loaded = await loadConfig();
			await updateConfig({ knowledge: { ...loaded.knowledge, rerankEnabled: enabled } });
			await refreshEmbeddingService();
			refreshState();
			setMessage({ type: "info", text: enabled ? t("Rerank 已启用", "Rerank enabled") : t("Rerank 已关闭", "Rerank disabled") });
		} catch (err) {
			setRerankEnabled(!enabled);
			setMessage({ type: "error", text: `${t("操作失败", "Action failed")}: ${err instanceof Error ? err.message : String(err)}` });
		}
	}, [refreshState, t]);

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
			setMessage({ type: "success", text: `${t("已切换 Rerank 档案", "Switched rerank profile")}: ${profile.name}` });
		}
	}, [refreshState, t]);

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
		setMessage({ type: "success", text: `${t("Rerank 档案已保存", "Rerank profile saved")}: ${rerankEditProfile.name}` });
	}, [rerankEditProfile, rerankEditApiKey, refreshState, t]);

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
		setMessage({ type: "info", text: t("Rerank 档案已删除", "Rerank profile removed") });
	}, [rerankEditProfile, refreshState, t]);

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
				setRerankTestResult({ ok: true, text: `${t("连接成功", "Connected")} (HTTP ${resp.status})` });
			} else {
				setRerankTestResult({ ok: false, text: `${t("连接失败", "Connection failed")}: HTTP ${resp.status} — ${resp.body.slice(0, 100)}` });
			}
		} catch (err) {
			setRerankTestResult({ ok: false, text: `${t("连接失败", "Connection failed")}: ${err instanceof Error ? err.message : String(err)}` });
		} finally {
			setRerankTesting(false);
		}
	}, [t]);

	const handleTestRerankFromMain = useCallback(async () => {
		const profile = rerankProfiles.find((p) => p.id === activeRerankProfileId);
		if (!profile) {
			setMessage({ type: "error", text: t("请先选择一个 Rerank 档案", "Select a rerank profile first") });
			return;
		}
		const key = (await getSecret(SECRET_KEYS.RERANK_API_KEY(profile.id))) ?? "";
		testRerankConnection(profile, key);
	}, [rerankProfiles, activeRerankProfileId, testRerankConnection, t]);

	// ── Knowledge operations ──

	const importFromText = useCallback(async (text: string, sourceName: string) => {
		const parsed = JSON.parse(text);
		let docs: KnowledgeDocument[];
		if (Array.isArray(parsed)) { docs = parsed; }
		else if (parsed.documents && Array.isArray(parsed.documents)) { docs = parsed.documents; }
		else { throw new Error(t("JSON 格式不正确：需要 KnowledgeDocument[] 或 { documents: [...] }", "Invalid JSON format: expected KnowledgeDocument[] or { documents: [...] }")); }
		for (const doc of docs) {
			if (!doc.id || !doc.title || !doc.content) throw new Error(t("文档缺少必要字段 (id/title/content)", "Document is missing required fields (id/title/content)"));
			if (!doc.source) doc.source = sourceName;
		}
		const { knowledge } = getServices();
		return knowledge.importDocuments(docs);
	}, [t]);

	const handleFileImport = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
		const file = e.target.files?.[0];
		if (!file) return;
		setImporting(true);
		setMessage(null);
		try {
			const text = await file.text();
			const result = await importFromText(text, file.name);
			if (result.imported > 0) {
				setMessage({
					type: result.errors.length > 0 ? "warning" : "success",
					text: result.errors.length > 0
						? `${t("成功导入", "Imported")} ${result.imported} ${t("条", "items")}, ${result.errors.length} ${t("条失败", "failed")}`
						: `${t("成功导入", "Imported")} ${result.imported} ${t("条", "items")}`,
				});
			} else {
				setMessage({ type: "error", text: result.errors[0] ?? t("导入失败", "Import failed") });
			}
			refreshState();
		} catch (err) {
			setMessage({ type: "error", text: `${t("导入失败", "Import failed")}: ${err instanceof Error ? err.message : String(err)}` });
		} finally {
			setImporting(false);
			if (fileInputRef.current) fileInputRef.current.value = "";
		}
	}, [refreshState, importFromText, t]);

	const handleDrop = useCallback(async (e: React.DragEvent) => {
		e.preventDefault();
		setDragging(false);
		const file = e.dataTransfer.files[0];
		if (!file || !file.name.endsWith(".json")) {
			setMessage({ type: "error", text: t("请拖入 .json 文件", "Please drop a .json file") });
			return;
		}
		if (file.size > 1024 * 1024) {
			setMessage({ type: "error", text: t("文件过大（>1MB），请拆分后导入", "File too large (>1MB), split it before importing") });
			return;
		}
		setImporting(true);
		setMessage(null);
		try {
			const text = await file.text();
			const result = await importFromText(text, file.name);
			if (result.imported > 0) {
				setMessage({
					type: result.errors.length > 0 ? "warning" : "success",
					text: result.errors.length > 0
						? `${t("成功导入", "Imported")} ${result.imported} ${t("条", "items")}, ${result.errors.length} ${t("条失败", "failed")}`
						: `${t("成功导入", "Imported")} ${result.imported} ${t("条", "items")}`,
				});
			} else {
				setMessage({ type: "error", text: result.errors[0] ?? t("导入失败", "Import failed") });
			}
			refreshState();
		} catch (err) {
			setMessage({ type: "error", text: `${t("导入失败", "Import failed")}: ${err instanceof Error ? err.message : String(err)}` });
		} finally {
			setImporting(false);
		}
	}, [refreshState, importFromText, t]);

	const handleJsonImport = useCallback(async () => {
		if (!jsonInput.trim()) return;
		setImporting(true);
		setMessage(null);
		try {
			const result = await importFromText(jsonInput, "json-editor");
			if (result.imported > 0) {
				setMessage({
					type: result.errors.length > 0 ? "warning" : "success",
					text: result.errors.length > 0
						? `${t("成功导入", "Imported")} ${result.imported} ${t("条", "items")}, ${result.errors.length} ${t("条失败", "failed")}`
						: `${t("成功导入", "Imported")} ${result.imported} ${t("条", "items")}`,
				});
				setJsonInput("");
				setJsonError(null);
				setJsonDocCount(null);
			} else {
				setMessage({ type: "error", text: result.errors[0] ?? t("导入失败", "Import failed") });
			}
			refreshState();
		} catch (err) {
			setMessage({ type: "error", text: `${t("导入失败", "Import failed")}: ${err instanceof Error ? err.message : String(err)}` });
		} finally {
			setImporting(false);
		}
	}, [jsonInput, refreshState, importFromText, t]);

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
			else { setJsonError(t("JSON 格式不正确：需要数组 [] 或 { documents: [...] }", "Invalid JSON format: expected [] or { documents: [...] }")); setJsonDocCount(null); return; }
			const missing = docs.findIndex((d: any) => !d.id || !d.title || !d.content);
			if (missing >= 0) {
				setJsonError(`${t("文档", "Document")} #${missing + 1} ${t("缺少必要字段 (id/title/content)", "is missing required fields (id/title/content)")}`);
				setJsonDocCount(null);
				return;
			}
			setJsonError(null);
			setJsonDocCount(docs.length);
		} catch {
			setJsonError(t("JSON 解析失败，请检查语法", "JSON parse failed, please check syntax"));
			setJsonDocCount(null);
		}
	}, [t]);

	// 切换到 JSON 模式时预填样例
	const JSON_SAMPLE = t(
		'[\n  {\n    "id": "example-001",\n    "title": "示例：2048 方向策略",\n    "content": "优先保持最大数字停留在角落，避免在中盘频繁改变主堆叠方向。",\n    "source": "manual",\n    "category": "strategy"\n  }\n]',
		'[\n  {\n    "id": "example-001",\n    "title": "Example: 2048 directional strategy",\n    "content": "Keep the largest tile in a corner and avoid frequently changing the main stacking direction in mid-game.",\n    "source": "manual",\n    "category": "strategy"\n  }\n]',
	);
	useEffect(() => {
		if (addMode === "json" && !jsonInput.trim()) {
			validateJsonInput(JSON_SAMPLE);
		}
	}, [addMode]); // eslint-disable-line react-hooks/exhaustive-deps

	const handleAdd = useCallback(async () => {
		if (!addTitle.trim() || !addContent.trim()) return;
		setAdding(true);
		try {
			const doc: KnowledgeDocument = { id: `manual-${Date.now()}`, title: addTitle.trim(), content: addContent.trim(), source: "manual" };
			const { knowledge } = getServices();
			const result = await knowledge.addDocument(doc);
			if (result.success) {
				setMessage({ type: "success", text: `${t("已添加", "Added")}: "${doc.title}"` });
				setAddTitle(""); setAddContent("");
				refreshState();
			} else {
				setMessage({ type: "error", text: result.error ?? t("添加失败", "Add failed") });
			}
		} catch (err) {
			setMessage({ type: "error", text: `${t("添加失败", "Add failed")}: ${err instanceof Error ? err.message : String(err)}` });
		} finally { setAdding(false); }
	}, [addTitle, addContent, refreshState, t]);

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
				setMessage({ type: "success", text: `${t("已更新", "Updated")}: "${editTitle.trim()}"` });
				setEditingDocId(null);
				setEditTitle("");
				setEditContent("");
				refreshState();
			} else {
				setMessage({ type: "error", text: result.error ?? t("更新失败", "Update failed") });
			}
		} catch (err) {
			setMessage({ type: "error", text: `${t("更新失败", "Update failed")}: ${err instanceof Error ? err.message : String(err)}` });
		} finally { setSaving(false); }
	}, [editingDocId, editTitle, editContent, refreshState, t]);

	// ── 删除确认倒计时 ──
	useEffect(() => {
		if (deleteCountdown <= 0) return;
		const timer = setTimeout(() => setDeleteCountdown((c) => c - 1), 1000);
		return () => clearTimeout(timer);
	}, [deleteCountdown]);

	const requestDeleteDoc = useCallback((docId: string) => {
		setConfirmDeleteTarget(docId);
		setDeleteCountdown(2);
	}, []);

	const requestBatchDelete = useCallback(() => {
		if (selectedDocIds.size === 0) return;
		setConfirmDeleteTarget("batch");
		setDeleteCountdown(2);
	}, [selectedDocIds]);

	const confirmDelete = useCallback(async () => {
		const target = confirmDeleteTarget;
		setConfirmDeleteTarget(null);
		if (!target) return;
		try {
			const { knowledge } = getServices();
			if (target === "batch") {
				const ids = [...selectedDocIds];
				for (const id of ids) {
					await knowledge.removeDocument(id);
				}
				setSelectedDocIds(new Set());
				setMessage({ type: "success", text: `${t("已删除", "Deleted")} ${ids.length} ${t("条文档", "documents")}` });
			} else {
				await knowledge.removeDocument(target);
				setSelectedDocIds((prev) => { const next = new Set(prev); next.delete(target); return next; });
				setMessage({ type: "success", text: t("已删除", "Deleted") });
			}
			refreshState();
		} catch (err) {
			setMessage({ type: "error", text: `${t("删除失败", "Delete failed")}: ${err instanceof Error ? err.message : String(err)}` });
		}
	}, [confirmDeleteTarget, selectedDocIds, refreshState, t]);

	const cancelDelete = useCallback(() => {
		setConfirmDeleteTarget(null);
	}, []);

	const toggleDocSelection = useCallback((docId: string) => {
		setSelectedDocIds((prev) => {
			const next = new Set(prev);
			if (next.has(docId)) next.delete(docId);
			else next.add(docId);
			return next;
		});
	}, []);

	const handleRebuild = useCallback(async () => {
		setRebuilding(true); setMessage(null);
		try {
			const { knowledge } = getServices();
			const result = await knowledge.rebuildIndex();
			setMessage(result.success ? { type: "success", text: t("索引重建完成", "Index rebuild completed") } : { type: "error", text: result.error ?? t("重建失败", "Rebuild failed") });
			refreshState();
		} catch (err) {
			setMessage({ type: "error", text: `${t("重建失败", "Rebuild failed")}: ${err instanceof Error ? err.message : String(err)}` });
		} finally { setRebuilding(false); }
	}, [refreshState, t]);

	const executeSearch = useCallback(async (query: string) => {
		setSearching(true);
		setSearchResults(null);
		try {
			const { knowledge } = getServices();
			const results = await knowledge.query(query, { topK: 5 });
			setSearchResults(results);
		} catch (err) {
			setMessage({ type: "error", text: `${t("搜索失败", "Search failed")}: ${err instanceof Error ? err.message : String(err)}` });
		} finally { setSearching(false); }
	}, [t]);

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
		setMessage({ type: "success", text: t("索引重建完成", "Index rebuild completed") });
		if (pendingSearchRef.current) {
			executeSearch(pendingSearchRef.current);
			pendingSearchRef.current = null;
		}
	}, [executeSearch, refreshState, t]);

	const handleGateCancel = useCallback(() => {
		setShowRebuildGate(false);
		pendingSearchRef.current = null;
	}, []);

	return (
		<Box sx={{ p: 1.5, display: "flex", flexDirection: "column", gap: 1, height: "100%", overflowY: "auto" }}>
			{/* Header */}
			<Stack direction="row" alignItems="center" spacing={1}>
				{!embedded && onClose ? (
					<Tooltip title={t("返回控制面板", "Back to control panel")}><IconButton size="small" onClick={onClose}><ArrowBackIcon fontSize="small" /></IconButton></Tooltip>
				) : null}
				<Typography variant="subtitle2" sx={{ color: "primary.main", fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5 }}>
					{t("知识库", "Knowledge")}
				</Typography>
			</Stack>

			{message && (
				<Alert severity={message.type} onClose={() => setMessage(null)} sx={{ py: 0, fontSize: 11 }}>{message.text}</Alert>
			)}

			{/* ═══ 第一级：配置档案 ═══ */}

			{/* Embedding 配置 */}
			<SectionTitle>
				{t("Embedding 配置", "Embedding Configuration")}
				<HelpTooltip title={t("配置向量化服务。支持 OpenAI 兼容的 /v1/embeddings API。每个档案有独立的 API Key。", "Configure vectorization service. Supports OpenAI-compatible /v1/embeddings API. Each profile has its own API key.")} />
			</SectionTitle>
			<Stack direction="row" spacing={0.5} alignItems="center">
				<Select size="small" value={activeEmbProfileId}
					onChange={(e: SelectChangeEvent) => handleSelectEmbProfile(e.target.value)}
					displayEmpty sx={{ flex: 1, fontSize: 13 }}>
					<MenuItem value=""><em>{t("无（未配置）", "None (not configured)")}</em></MenuItem>
					{embProfiles.map((p) => (
						<MenuItem key={p.id} value={p.id}>{p.name || t("(未命名)", "(Unnamed)")}</MenuItem>
					))}
				</Select>
				<Tooltip title={t("编辑档案", "Edit profile")}>
					<span><IconButton size="small" onClick={(e) => {
						const profile = embProfiles.find((p) => p.id === activeEmbProfileId);
						if (profile) handleOpenEdit(e.currentTarget, profile);
					}} disabled={!activeEmbProfileId} sx={{ color: "text.secondary" }}><EditIcon sx={{ fontSize: 14 }} /></IconButton></span>
				</Tooltip>
				<Tooltip title={t("新增档案", "Add profile")}>
					<IconButton size="small" onClick={(e) => handleOpenEdit(e.currentTarget)} sx={{ color: "primary.main" }}>
						<AddIcon sx={{ fontSize: 14 }} />
					</IconButton>
				</Tooltip>
			</Stack>

			<Divider />

			{/* Rerank 配置 */}
			<SectionTitle>
				{t("Rerank 配置", "Rerank Configuration")}
				<HelpTooltip title={t("Rerank 对初次召回结果进行二次精排，提升检索质量。支持兼容 /v1/rerank 端点的服务。", "Rerank performs second-pass ranking on initial retrieval results to improve quality. Supports services compatible with /v1/rerank.")} />
			</SectionTitle>
			<Box sx={{ bgcolor: "background.paper", borderRadius: 1, p: 1, display: "flex", flexDirection: "column", gap: 0.75 }}>
				<Stack direction="row" spacing={1} alignItems="center">
					<Typography variant="caption" sx={{ fontSize: 11 }}>{t("启用 Rerank", "Enable Rerank")}</Typography>
					<Button size="small" variant={rerankEnabled ? "contained" : "outlined"}
						color={rerankEnabled ? "primary" : "inherit"}
						onClick={() => handleToggleRerank(!rerankEnabled)}
						sx={{ minWidth: 60, fontSize: 11 }}>
						{rerankEnabled ? t("已启用", "Enabled") : t("未启用", "Disabled")}
					</Button>
				</Stack>
				{rerankEnabled && (
					<>
						<Stack direction="row" spacing={0.5} alignItems="center">
							<Select size="small" value={activeRerankProfileId}
								onChange={(e: SelectChangeEvent) => handleSelectRerankProfile(e.target.value)}
								displayEmpty sx={{ flex: 1, fontSize: 13 }}>
								<MenuItem value=""><em>{t("无（未配置）", "None (not configured)")}</em></MenuItem>
								{rerankProfiles.map((p) => (
									<MenuItem key={p.id} value={p.id}>{p.name || t("(未命名)", "(Unnamed)")}</MenuItem>
								))}
							</Select>
							<Tooltip title={t("编辑档案", "Edit profile")}>
								<span><IconButton size="small" onClick={(e) => {
									const profile = rerankProfiles.find((p) => p.id === activeRerankProfileId);
									if (profile) handleOpenRerankEdit(e.currentTarget, profile);
								}} disabled={!activeRerankProfileId} sx={{ color: "text.secondary" }}><EditIcon sx={{ fontSize: 14 }} /></IconButton></span>
							</Tooltip>
							<Tooltip title={t("新增档案", "Add profile")}>
								<IconButton size="small" onClick={(e) => handleOpenRerankEdit(e.currentTarget)} sx={{ color: "primary.main" }}>
									<AddIcon sx={{ fontSize: 14 }} />
								</IconButton>
							</Tooltip>
						</Stack>
					</>
				)}
			</Box>

			{/* ═══ 第二级：连接测试 ═══ */}
			<Box sx={{ mt: 1, pt: 1, borderTop: 2, borderColor: "divider" }}>
				<Typography variant="caption" color="text.secondary" fontWeight={700} sx={{ textTransform: "uppercase", letterSpacing: 0.5, mb: 0.5, display: "block" }}>
					{t("连接测试", "Connection Tests")}
				</Typography>
			</Box>

			{/* Embedding 测试 */}
			<SectionTitle>
				{t("Embedding 测试", "Embedding Test")}
				<HelpTooltip title={t("选择或新建 Embedding 档案并保存后，点击测试连接是否可达。", "Select or create an embedding profile, save it, then test connectivity.")} />
			</SectionTitle>
			<Box sx={{ bgcolor: "background.paper", borderRadius: 1, p: 1, display: "flex", flexDirection: "column", gap: 0.75 }}>
				<Typography variant="caption" color="text.secondary" sx={{ fontSize: 10 }}>
					{t("当前读取", "Using")}: {activeEmbProfileId
						? `${t("档案", "Profile")} "${embProfiles.find((p) => p.id === activeEmbProfileId)?.name || t("(未命名)", "(Unnamed)")}"`
						: t("无激活档案", "No active profile")}
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
					{embTesting ? t("测试中...", "Testing...") : t("测试连接", "Test Connection")}
				</Button>
				{embTestResult && (
					<Alert severity={embTestResult.ok ? "success" : "error"} sx={{ py: 0, fontSize: 11 }}>
						{embTestResult.text}
					</Alert>
				)}
			</Box>

			<Divider />

			{/* Rerank 测试 */}
			<SectionTitle>
				{t("Rerank 测试", "Rerank Test")}
				<HelpTooltip title={t("选择或新建 Rerank 档案并保存后，点击测试连接是否可达。", "Select or create a rerank profile, save it, then test connectivity.")} />
			</SectionTitle>
			<Box sx={{ bgcolor: "background.paper", borderRadius: 1, p: 1, display: "flex", flexDirection: "column", gap: 0.75 }}>
				<Typography variant="caption" color="text.secondary" sx={{ fontSize: 10 }}>
					{t("当前读取", "Using")}: {activeRerankProfileId
						? `${t("档案", "Profile")} "${rerankProfiles.find((p) => p.id === activeRerankProfileId)?.name || t("(未命名)", "(Unnamed)")}"`
						: t("无激活档案", "No active profile")}
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
					{rerankTesting ? t("测试中...", "Testing...") : t("测试连接", "Test Connection")}
				</Button>
				{rerankTestResult && (
					<Alert severity={rerankTestResult.ok ? "success" : "error"} sx={{ py: 0, fontSize: 11 }}>
						{rerankTestResult.text}
					</Alert>
				)}
			</Box>

			{/* ═══ Popover 编辑区域（不占布局位置） ═══ */}

			{/* Embedding Edit Popover */}
			<Popover open={!!editAnchor} anchorEl={editAnchor} onClose={() => { setEditAnchor(null); setEditProfile(null); }}
				anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
				transformOrigin={{ vertical: "top", horizontal: "right" }}
				slotProps={{ paper: { sx: { width: 360, maxHeight: 480, overflowY: "auto" } } }}>
				<Box sx={{ p: 1.5 }}>
					{editProfile && (
						<Stack spacing={1}>
							<Typography variant="subtitle2">
								{embProfiles.some((p) => p.id === editProfile.id)
									? t("编辑 Embedding 档案", "Edit embedding profile")
									: t("新建 Embedding 档案", "Create embedding profile")}
							</Typography>
							<TextField size="small" fullWidth label={t("档案名称", "Profile Name")} value={editProfile.name}
								onChange={(e) => setEditProfile({ ...editProfile, name: e.target.value })} />
							<TextField size="small" fullWidth label="Base URL" value={editProfile.baseUrl}
								onChange={(e) => setEditProfile({ ...editProfile, baseUrl: e.target.value })}
								helperText={t("如 https://www.dmxapi.cn 或 https://api.openai.com", "e.g. https://www.dmxapi.cn or https://api.openai.com")} />
							<Stack direction="row" spacing={0.5}>
								<TextField size="small" sx={{ flex: 2 }} label={t("模型名称", "Model name")} value={editProfile.model}
									onChange={(e) => setEditProfile({ ...editProfile, model: e.target.value })} />
								<TextField size="small" sx={{ flex: 1 }} label={t("维度", "Dimensions")} type="number" value={editProfile.dimension}
									onChange={(e) => setEditProfile({ ...editProfile, dimension: parseInt(e.target.value) || 1536 })}
									slotProps={{ htmlInput: { min: 64, max: 4096, step: 64 } }} />
							</Stack>
							<TextField size="small" fullWidth label="API Key" type="password" value={editApiKey}
								onChange={(e) => setEditApiKey(e.target.value)} helperText={t("密钥安全存储在系统钥匙串中", "Secrets are securely stored in the system keychain")} />
							<Stack direction="row" spacing={0.5} justifyContent="space-between" alignItems="center">
								{embProfiles.some((p) => p.id === editProfile.id) ? (
									<Button size="small" color="error" onClick={handleDeleteProfile}>{t("删除档案", "Delete profile")}</Button>
								) : <Box />}
								<Stack direction="row" spacing={0.5}>
									<Button size="small" onClick={() => { setEditAnchor(null); setEditProfile(null); }}>{t("取消", "Cancel")}</Button>
									<Button size="small" variant="contained" onClick={handleSaveProfile}
										disabled={!editProfile.name.trim() || !editProfile.baseUrl.trim() || !editProfile.model.trim()}>
										{t("保存", "Save")}
									</Button>
								</Stack>
							</Stack>
						</Stack>
					)}
				</Box>
			</Popover>

			{/* Rerank Edit Popover */}
			<Popover open={!!rerankEditAnchor} anchorEl={rerankEditAnchor} onClose={() => { setRerankEditAnchor(null); setRerankEditProfile(null); }}
				anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
				transformOrigin={{ vertical: "top", horizontal: "right" }}
				slotProps={{ paper: { sx: { width: 360, maxHeight: 480, overflowY: "auto" } } }}>
				<Box sx={{ p: 1.5 }}>
					{rerankEditProfile && (
						<Stack spacing={1}>
							<Typography variant="subtitle2">
								{rerankProfiles.some((p) => p.id === rerankEditProfile.id)
									? t("编辑 Rerank 档案", "Edit rerank profile")
									: t("新建 Rerank 档案", "Create rerank profile")}
							</Typography>
							<TextField size="small" fullWidth label={t("档案名称", "Profile Name")} value={rerankEditProfile.name}
								onChange={(e) => setRerankEditProfile({ ...rerankEditProfile, name: e.target.value })} />
							<TextField size="small" fullWidth label="Base URL" value={rerankEditProfile.baseUrl}
								onChange={(e) => setRerankEditProfile({ ...rerankEditProfile, baseUrl: e.target.value })}
								helperText={t("如 https://www.dmxapi.cn", "e.g. https://www.dmxapi.cn")} />
							<TextField size="small" fullWidth label={t("模型名称", "Model name")} value={rerankEditProfile.model}
								onChange={(e) => setRerankEditProfile({ ...rerankEditProfile, model: e.target.value })}
								helperText={t("如 qwen3-reranker-8b 或 bge-reranker-v2-m3-free", "e.g. qwen3-reranker-8b or bge-reranker-v2-m3-free")} />
							<TextField size="small" fullWidth label="API Key" type="password" value={rerankEditApiKey}
								onChange={(e) => setRerankEditApiKey(e.target.value)} helperText={t("密钥安全存储在系统钥匙串中", "Secrets are securely stored in the system keychain")} />
							<Stack direction="row" spacing={0.5} justifyContent="space-between" alignItems="center">
								{rerankProfiles.some((p) => p.id === rerankEditProfile.id) ? (
									<Button size="small" color="error" onClick={handleDeleteRerankProfile}>{t("删除档案", "Delete profile")}</Button>
								) : <Box />}
								<Stack direction="row" spacing={0.5}>
									<Button size="small" onClick={() => { setRerankEditAnchor(null); setRerankEditProfile(null); }}>{t("取消", "Cancel")}</Button>
									<Button size="small" variant="contained" onClick={handleSaveRerankProfile}
										disabled={!rerankEditProfile.name.trim() || !rerankEditProfile.baseUrl.trim() || !rerankEditProfile.model.trim()}>
										{t("保存", "Save")}
									</Button>
								</Stack>
							</Stack>
						</Stack>
					)}
				</Box>
			</Popover>

			{/* ═══ 第三级：知识库管理 ═══ */}
			<Box sx={{ mt: 1, pt: 1, borderTop: 2, borderColor: "divider" }}>
				<Typography variant="caption" color="text.secondary" fontWeight={700} sx={{ textTransform: "uppercase", letterSpacing: 0.5, mb: 0.5, display: "block" }}>
					{t("知识库管理", "Knowledge Base Management")}
				</Typography>
			</Box>

			{/* Status */}
			<Box sx={{ bgcolor: "background.paper", borderRadius: 1, p: 1 }}>
				<Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
					<Chip label={`${documents.length} ${t("文档", "documents")}`} size="small" variant="outlined" />
					<Chip label={`${chunkCount} chunks`} size="small" variant="outlined" />
					<Chip
						label={
							!knowledgeReady ? t("初始化中...", "Initializing...")
								: indexStatus === "needs_rebuild" ? t("需要重建索引", "Index needs rebuild")
									: indexStatus === "rebuilding" ? t("重建中...", "Rebuilding...")
										: indexStatus === "error" ? t("索引异常", "Index error")
											: hasIndex ? t("索引就绪", "Index ready") : t("无索引", "No index")
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

		{/* 重建索引按钮 */}
		{documents.length > 0 && (
			<Button size="small" variant="outlined" color="warning" startIcon={<RefreshIcon />} onClick={handleRebuild} disabled={rebuilding} fullWidth>
				{rebuilding ? t("重建中...", "Rebuilding...") : t("重建索引", "Rebuild Index")}
			</Button>
		)}

		{(importing || rebuilding) && <LinearProgress sx={{ my: 0.5 }} />}

			{/* ═══ 添加知识 ═══ */}
			{addMode === null ? (
				<Button size="small" variant="outlined" startIcon={<AddIcon />} onClick={() => setAddMode("drop")} fullWidth
					sx={{ borderColor: "primary.main", color: "primary.main", fontWeight: 700 }}>
					{t("添加知识", "Add Knowledge")}
				</Button>
			) : (
				<Box sx={{ bgcolor: "background.paper", borderRadius: 1, p: 1.5, display: "flex", flexDirection: "column", gap: 1 }}>
					<Stack direction="row" alignItems="center" spacing={0.5}>
						<AddIcon sx={{ fontSize: 16, color: "primary.main" }} />
						<Typography variant="caption" fontWeight={700} sx={{ flex: 1, color: "primary.main" }}>{t("添加知识", "Add Knowledge")}</Typography>
						<Button size="small" onClick={() => setAddMode(null)} sx={{ fontSize: 10, minWidth: 0 }}>{t("收起", "Collapse")}</Button>
					</Stack>

					<ButtonGroup size="small" fullWidth>
						<Button variant={addMode === "drop" ? "contained" : "outlined"} onClick={() => setAddMode("drop")}>{t("拖放文件", "Drop File")}</Button>
						<Button variant={addMode === "simple" ? "contained" : "outlined"} onClick={() => setAddMode("simple")}>{t("单条添加", "Single Add")}</Button>
						<Button variant={addMode === "json" ? "contained" : "outlined"} onClick={() => setAddMode("json")}>{t("输入 JSON", "Input JSON")}</Button>
					</ButtonGroup>

					{addMode === "drop" && (
						<>
							<input ref={fileInputRef} type="file" accept=".json" style={{ display: "none" }} onChange={handleFileImport} />
							<Box
								onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
								onDragLeave={() => setDragging(false)}
								onDrop={handleDrop}
								onClick={() => fileInputRef.current?.click()}
								sx={{ border: "2px dashed", borderColor: dragging ? "primary.main" : "divider", borderRadius: 1, p: 2, textAlign: "center", cursor: "pointer", bgcolor: dragging ? "action.hover" : "background.default", "&:hover": { borderColor: "primary.main", bgcolor: "action.hover" } }}
							>
								<UploadFileIcon sx={{ fontSize: 28, color: "text.secondary", mb: 0.5 }} />
								<Typography variant="caption" color="text.secondary" display="block">{t("拖入 .json 文件，或点击选择文件", "Drop a .json file or click to select")}</Typography>
							</Box>
						</>
					)}

					{addMode === "simple" && (
						<Box sx={{ display: "flex", flexDirection: "column", gap: 0.75 }}>
							<TextField size="small" fullWidth label={t("标题", "Title")} placeholder={t("输入标题", "Enter title")} value={addTitle} onChange={(e) => setAddTitle(e.target.value)} error={addTitle.length > 0 && !addTitle.trim()} helperText={t("标题参与语义索引", "Title participates in semantic indexing")} />
							<TextField size="small" fullWidth multiline minRows={2} maxRows={5} label={t("内容", "Content")} placeholder={t("输入正文内容", "Enter content")} value={addContent} onChange={(e) => setAddContent(e.target.value)} error={addContent.length > 0 && !addContent.trim()} helperText={t("正文会被切块并向量化", "Content will be chunked and embedded")} />
							<Stack direction="row" spacing={0.5} justifyContent="flex-end">
								<Button size="small" onClick={() => { setAddTitle(""); setAddContent(""); }}>{t("清空", "Clear")}</Button>
								<Button size="small" variant="contained" onClick={handleAdd} disabled={adding || !addTitle.trim() || !addContent.trim()}>{adding ? t("添加中...", "Adding...") : t("添加", "Add")}</Button>
							</Stack>
						</Box>
					)}

					{addMode === "json" && (
						<Box sx={{ display: "flex", flexDirection: "column", gap: 0.75 }}>
							<Typography variant="caption" color="text.secondary" sx={{ fontSize: 9 }}>{t("id / title / content（必填），source / category（可选）。修改下方样例后点击导入。", "id / title / content are required; source / category optional. Edit sample then import.")}</Typography>
							<TextField size="small" fullWidth multiline minRows={4} maxRows={10} value={jsonInput} onChange={(e) => validateJsonInput(e.target.value)} error={!!jsonError} sx={{ "& textarea": { fontFamily: "monospace", fontSize: 11 } }} />
							{jsonError && <Typography variant="caption" color="error" sx={{ fontSize: 9 }}>{jsonError}</Typography>}
							{jsonDocCount !== null && !jsonError && <Typography variant="caption" color="success.main" sx={{ fontSize: 9 }}>{t("共", "Total")} {jsonDocCount} {t("条，可直接导入", "items, ready to import")}</Typography>}
							<Stack direction="row" spacing={0.5} justifyContent="flex-end">
								<Button size="small" onClick={() => { setJsonInput(""); setJsonError(null); setJsonDocCount(null); }}>{t("清空", "Clear")}</Button>
								<Button size="small" variant="contained" onClick={handleJsonImport} disabled={importing || !jsonInput.trim() || !!jsonError}>{importing ? t("导入中...", "Importing...") : t("导入", "Import")}</Button>
							</Stack>
						</Box>
					)}
				</Box>
			)}

			{/* ═══ 已导入文档 ═══ */}
			{documents.length > 0 && (
				<Box sx={{ bgcolor: "background.paper", borderRadius: 1, p: 1, display: "flex", flexDirection: "column", gap: 0.5 }}>
					<Stack direction="row" alignItems="center" spacing={0.5}>
						<Typography variant="caption" fontWeight={700} sx={{ flex: 1 }}>{t("已导入文档", "Imported Documents")} ({documents.length})</Typography>
						{!batchMode ? (
							<Button size="small" variant="outlined" onClick={() => setBatchMode(true)} sx={{ fontSize: 10 }}>{t("批量管理", "Batch Manage")}</Button>
						) : (
							<>
								<Button size="small" variant="outlined" onClick={() => {
									if (selectedDocIds.size === documents.length) setSelectedDocIds(new Set());
									else setSelectedDocIds(new Set(documents.map((d) => d.id)));
								}} sx={{ fontSize: 10 }}>
									{selectedDocIds.size === documents.length ? t("取消全选", "Deselect All") : t("全选", "Select All")}
								</Button>
								{selectedDocIds.size > 0 && (
									<Button size="small" color="error" variant="outlined" startIcon={<DeleteIcon />} onClick={requestBatchDelete} sx={{ fontSize: 10 }}>
										{t("删除", "Delete")} ({selectedDocIds.size})
									</Button>
								)}
								<Button size="small" onClick={() => { setBatchMode(false); setSelectedDocIds(new Set()); }} sx={{ fontSize: 10 }}>{t("完成", "Done")}</Button>
							</>
						)}
					</Stack>

					{confirmDeleteTarget && (
						<Box sx={{ bgcolor: "background.default", border: "1px solid", borderColor: "error.main", borderRadius: 1, p: 1, mt: 0.5 }}>
							<Stack direction="row" spacing={0.5} alignItems="center" sx={{ mb: 0.5 }}>
								<WarningIcon sx={{ fontSize: 14, color: "error.main" }} />
								<Typography variant="caption" sx={{ color: "error.main" }}>
									{confirmDeleteTarget === "batch"
										? `${t("确定删除选中的", "Delete selected")} ${selectedDocIds.size} ${t("条文档？此操作不可撤销。", "documents? This action cannot be undone.")}`
										: t("确定删除此文档？此操作不可撤销。", "Delete this document? This action cannot be undone.")}
								</Typography>
							</Stack>
							<Stack direction="row" spacing={0.5} justifyContent="flex-end">
								<Button size="small" variant="contained" color="error" disabled={deleteCountdown > 0} onClick={confirmDelete}>
									{deleteCountdown > 0
										? `${t("确认删除", "Confirm Delete")} (${deleteCountdown}s)`
										: t("确认删除", "Confirm Delete")}
								</Button>
								<Button size="small" onClick={cancelDelete}>{t("取消", "Cancel")}</Button>
							</Stack>
						</Box>
					)}

					{documents.map((doc) => (
						<Box key={doc.id}>
							{editingDocId === doc.id ? (
								<Box sx={{ border: "1px solid", borderColor: "primary.main", borderRadius: 1, p: 1, display: "flex", flexDirection: "column", gap: 0.75 }}>
									<Stack direction="row" alignItems="center" spacing={0.5}>
										<Typography variant="caption" fontWeight={700} sx={{ flex: 1 }}>{t("编辑文档", "Edit Document")}</Typography>
										<ButtonGroup size="small">
											<Button variant={editMode === "simple" ? "contained" : "outlined"} onClick={() => setEditMode("simple")} sx={{ fontSize: 10 }}>{t("简洁", "Simple")}</Button>
											<Button variant={editMode === "json" ? "contained" : "outlined"} onClick={() => setEditMode("json")} sx={{ fontSize: 10 }}>JSON</Button>
										</ButtonGroup>
									</Stack>
									{editMode === "simple" && (
										<>
											<TextField size="small" fullWidth label={t("标题", "Title")} value={editTitle} onChange={(e) => setEditTitle(e.target.value)} />
											<TextField size="small" fullWidth multiline minRows={2} maxRows={5} label={t("内容", "Content")} value={editContent} onChange={(e) => setEditContent(e.target.value)} />
										</>
									)}
									{editMode === "json" && (
										<TextField
											size="small" fullWidth multiline minRows={3} maxRows={8}
											value={JSON.stringify({ id: doc.id, title: editTitle, content: editContent, source: doc.source, category: (doc as any).category }, null, 2)}
											onChange={(e) => { try { const p = JSON.parse(e.target.value); setEditTitle(p.title ?? ""); setEditContent(p.content ?? ""); } catch { /* ignore partial edits */ } }}
											sx={{ "& textarea": { fontFamily: "monospace", fontSize: 11 } }}
										/>
									)}
									<Stack direction="row" spacing={0.5} justifyContent="flex-end">
										<Button size="small" onClick={handleCancelEdit}>{t("取消", "Cancel")}</Button>
										<Button size="small" variant="contained" onClick={handleSaveEdit} disabled={saving || !editTitle.trim() || !editContent.trim()}>{saving ? t("保存中...", "Saving...") : t("保存", "Save")}</Button>
									</Stack>
								</Box>
							) : (
								<Stack direction="row" alignItems="flex-start" spacing={0}>
									{batchMode && (
										<Checkbox size="small" checked={selectedDocIds.has(doc.id)} onChange={() => toggleDocSelection(doc.id)} sx={{ p: 0, mt: 0.25 }} />
									)}
									<Box sx={{ flex: 1, cursor: "pointer", overflow: "hidden", "&:hover": { bgcolor: "action.hover" }, borderRadius: 0.5, px: 0.5, py: 0.25, minWidth: 0 }}
										onClick={() => handleStartEdit(doc)}>
										<Stack direction="row" alignItems="center" spacing={0.5} sx={{ minWidth: 0 }}>
											<Typography variant="caption" noWrap sx={{ flex: 1, fontSize: 11, fontWeight: 600, minWidth: 0 }}>{doc.title}</Typography>
											{doc.source && <Typography variant="caption" color="text.secondary" sx={{ fontSize: 9, flexShrink: 0 }}>{doc.source}</Typography>}
											<IconButton size="small" onClick={(e) => { e.stopPropagation(); handleStartEdit(doc); }} sx={{ p: 0.25, flexShrink: 0 }}><EditIcon sx={{ fontSize: 14 }} /></IconButton>
											<IconButton size="small" onClick={(e) => { e.stopPropagation(); requestDeleteDoc(doc.id); }} sx={{ p: 0.25, flexShrink: 0 }}><DeleteIcon sx={{ fontSize: 14 }} /></IconButton>
										</Stack>
										<Typography variant="caption" noWrap color="text.secondary" sx={{ fontSize: 10, display: "block" }}>
											{doc.content.slice(0, 80)}
										</Typography>
									</Box>
								</Stack>
							)}
						</Box>
					))}
				</Box>
			)}


				{/* Search */}
			<Box sx={{ bgcolor: "background.paper", borderRadius: 1, p: 1, display: "flex", flexDirection: "column", gap: 0.75 }}>
				<Stack direction="row" alignItems="center" spacing={0.5}>
					<Typography variant="caption" fontWeight={600}>{t("搜索验证", "Search Validation")}</Typography>
					<HelpTooltip title={t("输入文本进行语义检索测试，验证知识库检索质量。", "Enter text to run semantic retrieval and validate knowledge search quality.")} />
				</Stack>
				<Stack direction="row" spacing={0.5}>
					<TextField size="small" fullWidth placeholder={t("输入搜索文本", "Enter search text")} value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") handleSearch(); }} />
					<Button size="small" variant="contained" onClick={handleSearch} disabled={searching || !searchQuery.trim()}>{searching ? "..." : t("搜索", "Search")}</Button>
				</Stack>
				{searching && <LinearProgress sx={{ my: 0.25 }} />}
				{searchResults !== null && (
					<Box sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
						{searchResults.length === 0 ? (
							<Typography variant="caption" color="text.secondary">{t("无匹配结果", "No matching results")}</Typography>
						) : searchResults.map((r, i) => (
							<Box key={`${r.docId}-${i}`} sx={{ borderLeft: "2px solid", borderColor: "primary.main", pl: 1, py: 0.25 }}>
								<Stack direction="row" spacing={0.5} alignItems="center">
									<Typography variant="caption" fontWeight={600} sx={{ fontSize: 11 }}>{r.title}</Typography>
									<Typography variant="caption" color="text.secondary" sx={{ fontSize: 9 }}>score: {r.score.toFixed(4)}</Typography>
								</Stack>
								<Typography variant="caption" sx={{ fontSize: 10, color: "text.secondary", display: "block", mt: 0.25 }}>{r.chunkText.length > 200 ? r.chunkText.slice(0, 200) + "…" : r.chunkText}</Typography>
								<Typography variant="caption" sx={{ fontSize: 9, color: "text.disabled" }}>{t("来源", "Source")}: {r.source}</Typography>
							</Box>
						))}
					</Box>
				)}
			</Box>
		</Box>
	);
}
