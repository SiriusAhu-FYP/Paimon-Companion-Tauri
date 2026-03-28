import { useState, useEffect, useCallback, useRef } from "react";
import {
	Box, Button, Typography, Stack, TextField, Select, MenuItem,
	Divider, Alert, IconButton, Tooltip,
	Popover, Chip, LinearProgress,
	type SelectChangeEvent,
} from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import NetworkCheckIcon from "@mui/icons-material/NetworkCheck";
import VolumeUpIcon from "@mui/icons-material/VolumeUp";
import SearchIcon from "@mui/icons-material/Search";
import UploadFileIcon from "@mui/icons-material/UploadFile";
import DeleteIcon from "@mui/icons-material/Delete";
import AddIcon from "@mui/icons-material/Add";
import RefreshIcon from "@mui/icons-material/Refresh";
import {
	type AppConfig, type LLMProviderType, type TTSProviderType,
	type LLMProfile, type TTSProfile,
	type TTSProviderConfig,
	DEFAULT_CONFIG, SECRET_KEYS,
	loadConfig, updateConfig,
	proxyRequest,
	setSecret, getSecret, deleteSecret,
} from "@/services/config";
import { createLogger } from "@/services/logger";
import { GptSovitsTTSService, MockTTSService, splitText, normalizeForSpeech, SpeechQueue } from "@/services/tts";
import { AudioPlayer } from "@/services/audio/audio-player";
import { HelpTooltip } from "@/components";
import { refreshProviders, getServices, refreshEmbeddingService } from "@/services";
import type { KnowledgeDocument, KnowledgeCategory, RetrievalResult, EmbeddingApiKeySource } from "@/types/knowledge";

const log = createLogger("settings");

interface SettingsPanelProps {
	onClose: () => void;
}

export function SettingsPanel({ onClose }: SettingsPanelProps) {
	const [config, setConfig] = useState<AppConfig>(DEFAULT_CONFIG);
	const [message, setMessage] = useState<{ type: "success" | "error" | "info" | "warning"; text: string } | null>(null);
	const [llmTestResult, setLlmTestResult] = useState<{ ok: boolean; text: string } | null>(null);
	const [ttsTestResult, setTtsTestResult] = useState<{ ok: boolean; text: string } | null>(null);
	const [testing, setTesting] = useState<"llm" | "tts" | null>(null);
	const [ttsTestText, setTtsTestText] = useState("你好，我是测试文本");
	const [ttsTesting, setTtsTesting] = useState(false);

	useEffect(() => {
		let cancelled = false;
		(async () => {
			const loaded = await loadConfig();
			if (cancelled) return;
			setConfig(loaded);
			log.info("settings loaded");
		})();
		return () => { cancelled = true; };
	}, []);

	const updateCharacter = useCallback((patch: Partial<AppConfig["character"]>) => {
		setConfig((c) => ({ ...c, character: { ...c.character, ...patch } }));
	}, []);

	/** 从激活的 LLM 档案或根配置中获取当前 LLM 配置 */
	const getActiveLlmConfig = useCallback(() => {
		if (config.activeLlmProfileId) {
			const profile = config.llmProfiles.find((p) => p.id === config.activeLlmProfileId);
			if (profile) return profile;
		}
		return config.llm;
	}, [config]);

	/** 从激活的 TTS 档案或根配置中获取当前 TTS 配置 */
	const getActiveTtsConfig = useCallback(() => {
		if (config.activeTtsProfileId) {
			const profile = config.ttsProfiles.find((p) => p.id === config.activeTtsProfileId);
			if (profile) {
				log.info("[settings] getActiveTtsConfig: using profile", {
					profileId: profile.id,
					name: profile.name,
					baseUrl: profile.baseUrl,
					gptPath: profile.gptWeightsPath,
					sovitsPath: profile.sovitsWeightsPath,
				});
				return profile;
			}
		}
		log.info("[settings] getActiveTtsConfig: no active profile, using config.tts", {
			ttsBaseUrl: config.tts.baseUrl,
		});
		return config.tts;
	}, [config]);

	const handleTestLLM = useCallback(async () => {
		setTesting("llm");
		setLlmTestResult(null);
		try {
			const llmCfg = getActiveLlmConfig();
			let base = (llmCfg.baseUrl || "").replace(/\/+$/, "");
			if (!base) {
				setLlmTestResult({ ok: false, text: "请先在档案中配置 Base URL" });
				return;
			}
			// 兼容有无 /v1 后缀
			if (!base.endsWith("/v1")) base += "/v1";
			const url = base + "/models";
			const profileId = config.activeLlmProfileId || null;
			const resp = await proxyRequest({
				url,
				method: "GET",
				headers: { "Content-Type": "application/json" },
				secretKey: profileId ? SECRET_KEYS.LLM_API_KEY(profileId) : undefined,
				timeoutMs: 10000,
			});
			if (resp.status >= 200 && resp.status < 400) {
				setLlmTestResult({ ok: true, text: `连接成功 (HTTP ${resp.status})` });
				log.info("LLM connection test passed", { status: resp.status });
			} else {
				setLlmTestResult({ ok: false, text: `HTTP ${resp.status}: ${resp.body.slice(0, 100)}` });
			}
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			setLlmTestResult({ ok: false, text: msg });
			log.warn("LLM connection test failed", msg);
		} finally {
			setTesting(null);
		}
	}, [getActiveLlmConfig, config.activeLlmProfileId]);

	const handleTestTTS = useCallback(async () => {
		setTesting("tts");
		setTtsTestResult(null);
		try {
			const ttsCfg = getActiveTtsConfig();
			if (!ttsCfg.baseUrl || !ttsCfg.baseUrl.trim()) {
				setTtsTestResult({ ok: false, text: "请先在档案中配置服务地址" });
				return;
			}
			const base = ttsCfg.baseUrl.replace(/\/+$/, "");
			const testUrl = `${base}/set_gpt_weights?weights_path=/tmp/dummy`;
			const resp = await proxyRequest({
				url: testUrl,
				method: "GET",
				timeoutMs: 8000,
			});
			setTtsTestResult({ ok: true, text: `服务可达 (HTTP ${resp.status})` });
			log.info("TTS connection test passed", { status: resp.status });
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			setTtsTestResult({ ok: false, text: msg });
			log.warn("TTS connection test failed", msg);
		} finally {
			setTesting(null);
		}
	}, [getActiveTtsConfig]);

	const handleTestTTSDirect = useCallback(async () => {
		if (!ttsTestText.trim()) return;

		setTtsTesting(true);
		setMessage(null);
		try {
			const ttsCfg = getActiveTtsConfig();
			if (!ttsCfg.baseUrl || !ttsCfg.baseUrl.trim()) {
				setMessage({ type: "error", text: "请先在档案中配置服务地址" });
				return;
			}
			let ttsService: GptSovitsTTSService | MockTTSService;
			if (ttsCfg.provider === "gpt-sovits") {
				ttsService = new GptSovitsTTSService(ttsCfg as unknown as TTSProviderConfig);
			} else {
				ttsService = new MockTTSService();
			}
			const player = new AudioPlayer();
			const queue = new SpeechQueue(ttsService, player, (speaking) => {
				if (speaking) {
					setMessage({ type: "info", text: "正在播放语音..." });
				}
			});

			const spokenText = normalizeForSpeech(ttsTestText);
			const segments = splitText(spokenText);

			log.info("TTS test with full pipeline", {
				original: ttsTestText,
				spoken: spokenText,
				segments: segments.map((s) => `[${s.lang}]"${s.text.slice(0, 20)}"`),
			});

			if (!segments.length) {
				setMessage({ type: "error", text: "切片结果为空，请检查输入文本" });
				return;
			}

			const preview = segments
				.map((s) => `[${s.lang}]${s.text.slice(0, 15)}${s.text.length > 15 ? "…" : ""}`)
				.join(" | ");
			setMessage({ type: "success", text: `切片完成：${segments.length} 段，正在合成... — ${preview}` });

			const result = await queue.speakAll(segments);

			if (result.stopped) {
				setMessage({ type: "warning", text: "播放已中断" });
			} else if (result.playedSegments > 0) {
				setMessage({ type: "success", text: `播放完成 (${result.playedSegments}/${result.totalSegments} 段)` });
			} else if (result.errors.length > 0) {
				const firstErr = result.errors[0].length > 120 ? result.errors[0].slice(0, 120) + "…" : result.errors[0];
				setMessage({ type: "error", text: `合成失败: ${firstErr}` });
			} else {
				setMessage({ type: "warning", text: "合成完成但未能播放任何段落，请检查 TTS 配置" });
			}
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			setMessage({ type: "error", text: `TTS 测试失败: ${msg}` });
			log.error("TTS direct test failed", err);
		} finally {
			setTtsTesting(false);
		}
	}, [getActiveTtsConfig, ttsTestText]);

	return (
		<Box sx={{ p: 1.5, display: "flex", flexDirection: "column", gap: 1, height: "100%", overflowY: "auto" }}>
			<Stack direction="row" alignItems="center" spacing={1}>
				<Tooltip title="返回控制面板">
					<IconButton size="small" onClick={onClose}>
						<ArrowBackIcon fontSize="small" />
					</IconButton>
				</Tooltip>
				<Typography variant="subtitle2" sx={{ color: "primary.main", fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5 }}>
					设置
				</Typography>
			</Stack>

			{message && (
				<Alert severity={message.type} onClose={() => setMessage(null)} sx={{ py: 0 }}>
					{message.text}
				</Alert>
			)}

			{/* ── LLM 配置档案 ── */}
			<SectionTitle>LLM 配置</SectionTitle>
			<LLMProfilesSection
				profiles={config.llmProfiles}
				activeId={config.activeLlmProfileId}
				onAdd={(p) => setConfig((c) => ({ ...c, llmProfiles: [...c.llmProfiles, p] }))}
				onUpdate={(p) => setConfig((c) => ({ ...c, llmProfiles: c.llmProfiles.map((x) => x.id === p.id ? p : x) }))}
				onDelete={(id) => setConfig((c) => ({ ...c, llmProfiles: c.llmProfiles.filter((x) => x.id !== id), activeLlmProfileId: c.activeLlmProfileId === id ? "" : c.activeLlmProfileId }))}
				onSelect={(id) => { setConfig((c) => ({ ...c, activeLlmProfileId: id })); updateConfig({ activeLlmProfileId: id }); refreshProviders(); }}
				onPersist={async (newProfiles, newActiveId) => (await updateConfig({ llmProfiles: newProfiles, activeLlmProfileId: newActiveId }), refreshProviders())}
			/>

			<Divider />

			{/* ── LLM 测试 ── */}
			<SectionTitle>
				LLM 测试
				<HelpTooltip title="在左侧选择或新建 LLM 档案并保存后，点击此处测试连接是否可达。测试结果仅供参考。" />
			</SectionTitle>
			<Box sx={{ bgcolor: "background.paper", borderRadius: 1, p: 1, display: "flex", flexDirection: "column", gap: 0.75 }}>
				<Typography variant="caption" color="text.secondary" sx={{ fontSize: 10 }}>
					当前读取：{config.activeLlmProfileId
						? `档案「${config.llmProfiles.find((p) => p.id === config.activeLlmProfileId)?.name || "(未命名)"}」`
						: "根配置（无激活档案）"}
					· {getActiveLlmConfig().model || getActiveLlmConfig().provider}
				</Typography>
				<Button
					size="small" variant="outlined"
					startIcon={<NetworkCheckIcon />}
					onClick={handleTestLLM}
					disabled={testing === "llm"}
				>
					{testing === "llm" ? "测试中..." : "测试连接"}
				</Button>
				{llmTestResult && (
					<Alert severity={llmTestResult.ok ? "success" : "error"} sx={{ py: 0, fontSize: 11 }}>
						{llmTestResult.text}
					</Alert>
				)}
			</Box>

			<Divider />

			{/* ── TTS 配置档案 ── */}
			<SectionTitle>TTS 配置</SectionTitle>
			<TTSProfilesSection
				profiles={config.ttsProfiles}
				activeId={config.activeTtsProfileId}
				onAdd={(p) => setConfig((c) => ({ ...c, ttsProfiles: [...c.ttsProfiles, p] }))}
				onUpdate={(p) => setConfig((c) => ({ ...c, ttsProfiles: c.ttsProfiles.map((x) => x.id === p.id ? p : x) }))}
				onDelete={(id) => setConfig((c) => ({ ...c, ttsProfiles: c.ttsProfiles.filter((x) => x.id !== id), activeTtsProfileId: c.activeTtsProfileId === id ? "" : c.activeTtsProfileId }))}
				onSelect={(id) => { setConfig((c) => ({ ...c, activeTtsProfileId: id })); updateConfig({ activeTtsProfileId: id }); refreshProviders(); }}
				onPersist={async (newProfiles, newActiveId) => (await updateConfig({ ttsProfiles: newProfiles, activeTtsProfileId: newActiveId }), refreshProviders())}
			/>

			<Divider />

			{/* ── TTS 测试 ── */}
			<SectionTitle>
				TTS 测试
				<HelpTooltip title="在左侧选择或新建 TTS 档案（配置服务地址、权重路径等）并保存后，点击此处测试连接是否可达。测试结果仅供参考。" />
			</SectionTitle>
			<Box sx={{ bgcolor: "background.paper", borderRadius: 1, p: 1, display: "flex", flexDirection: "column", gap: 0.75 }}>
				<Typography variant="caption" color="text.secondary" sx={{ fontSize: 10 }}>
					当前读取：{config.activeTtsProfileId
						? `档案「${config.ttsProfiles.find((p) => p.id === config.activeTtsProfileId)?.name || "(未命名)"}」`
						: "根配置（无激活档案）"}
					· {getActiveTtsConfig().provider}
				</Typography>
				<Button
					size="small" variant="outlined"
					startIcon={<NetworkCheckIcon />}
					onClick={handleTestTTS}
					disabled={testing === "tts"}
				>
					{testing === "tts" ? "测试中..." : "测试连接"}
				</Button>
				{ttsTestResult && (
					<Alert severity={ttsTestResult.ok ? "success" : "error"} sx={{ py: 0, fontSize: 11 }}>
						{ttsTestResult.text}
					</Alert>
				)}

				<Divider sx={{ my: 0.5 }} />

				<Typography variant="caption" color="text.secondary" sx={{ fontSize: 10 }}>TTS 直测（合成并播放）</Typography>
				<TextField
					size="small" fullWidth
					placeholder="输入测试文本"
					value={ttsTestText}
					onChange={(e) => setTtsTestText(e.target.value)}
				/>
				<Button
					size="small" variant="contained"
					startIcon={<VolumeUpIcon />}
					onClick={handleTestTTSDirect}
					disabled={ttsTesting}
				>
					{ttsTesting ? "合成中..." : "合成并播放"}
				</Button>
			</Box>

			<Divider />

			{/* ── 角色设置 ── */}
			<SectionTitle>角色设置</SectionTitle>
			<Box sx={{ bgcolor: "background.paper", borderRadius: 1, p: 1, display: "flex", flexDirection: "column", gap: 0.75 }}>
				<Stack direction="row" alignItems="center" spacing={0.5}>
					<FieldLabel>自定义人设</FieldLabel>
					<HelpTooltip title="仅在未选择角色卡时生效，优先级最低。角色卡内设定 > 自定义人设。" />
				</Stack>
				<TextField
					size="small" fullWidth multiline minRows={3} maxRows={6}
					value={config.character.customPersona}
					onChange={(e) => updateCharacter({ customPersona: e.target.value })}
				/>
			</Box>

			<Divider />

			{/* ── 知识库管理 ── */}
			<KnowledgeSection />
		</Box>
	);
}

function SectionTitle({ children }: { children: React.ReactNode }) {
	return (
		<Typography variant="caption" color="text.secondary" fontWeight={600} sx={{ display: "flex", alignItems: "center", gap: 0.25 }}>
			{children}
		</Typography>
	);
}

function FieldLabel({ children }: { children: React.ReactNode }) {
	return (
		<Typography variant="caption" color="text.secondary" sx={{ fontSize: 11 }}>
			{children}
		</Typography>
	);
}

// ── LLM Profile 管理组件 ───────────────────────────────────────────────────

interface LLMProfilesSectionProps {
	profiles: LLMProfile[];
	activeId: string;
	onAdd: (p: LLMProfile) => void;
	onUpdate: (p: LLMProfile) => void;
	onDelete: (id: string) => void;
	onSelect: (id: string) => void;
	/** Popover 保存/删除后立即持久化（传入更新后的完整 profiles 数组） */
	onPersist: (newProfiles: LLMProfile[], newActiveId: string) => Promise<unknown>;
}

function LLMProfilesSection({ profiles, activeId, onAdd, onUpdate, onDelete, onSelect, onPersist }: LLMProfilesSectionProps) {
	const [dialogOpen, setDialogOpen] = useState(false);
	const [editingProfile, setEditingProfile] = useState<LLMProfile | null>(null);
	const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
	const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
	const [deleteCountdown, setDeleteCountdown] = useState(0);

	// 组件挂载时清理旧版全局 keyring 条目（key = "llm-api-key"）
	useEffect(() => {
		deleteSecret("llm-api-key").catch(() => { /* ignore if not exists */ });
	}, []);

	// 删除倒计时
	useEffect(() => {
		if (deleteCountdown <= 0) return;
		const timer = setTimeout(() => setDeleteCountdown((c) => c - 1), 1000);
		return () => clearTimeout(timer);
	}, [deleteCountdown]);

	const handleEdit = async (event: React.MouseEvent<HTMLElement>) => {
		if (activeId) {
			const profile = profiles.find((p) => p.id === activeId) ?? null;
			if (profile) {
				// 从 keyring 读取 API key 填入表单
				const apiKey = await getSecret(SECRET_KEYS.LLM_API_KEY(profile.id)) ?? "";
				setEditingProfile({ ...profile, apiKey });
			} else {
				setEditingProfile(null);
			}
		} else {
			setEditingProfile({
				id: `llm-${Date.now()}`,
				name: "",
				provider: "openai-compatible",
				apiKey: "",
				baseUrl: "",
				model: "",
				temperature: 0.7,
				maxTokens: 4096,
			});
		}
		setAnchorEl(event.currentTarget);
		setDialogOpen(true);
	};

	const handleNew = (event: React.MouseEvent<HTMLElement>) => {
		setEditingProfile({
			id: `llm-${Date.now()}`,
			name: "",
			provider: "openai-compatible",
			apiKey: "",
			baseUrl: "",
			model: "",
			temperature: 0.7,
			maxTokens: 4096,
		});
		setAnchorEl(event.currentTarget);
		setDialogOpen(true);
	};

	const handleDialogSave = async () => {
		if (!editingProfile) return;
		// API key 写入 per-profile keyring
		if (editingProfile.apiKey) {
			await setSecret(SECRET_KEYS.LLM_API_KEY(editingProfile.id), editingProfile.apiKey);
		}
		const exists = profiles.some((p) => p.id === editingProfile.id);
		let newProfiles: LLMProfile[];
		let newActiveId = activeId;
		// 保存时剔除 apiKey 明文（key 已在 keyring）
		const profileToSave = { ...editingProfile, apiKey: "" };
		if (exists) {
			onUpdate(profileToSave);
			newProfiles = profiles.map((p) => p.id === editingProfile.id ? profileToSave : p);
		} else {
			onAdd(profileToSave);
			onSelect(editingProfile.id);
			newActiveId = editingProfile.id;
			newProfiles = [...profiles, profileToSave];
		}
		setDialogOpen(false);
		setEditingProfile(null);
		setAnchorEl(null);
		await onPersist(newProfiles, newActiveId);
	};

	const handleDialogClose = () => {
		setDialogOpen(false);
		setEditingProfile(null);
		setAnchorEl(null);
	};

	const handleDelete = async (id: string) => {
		onDelete(id);
		if (id === activeId) onSelect("");
		// 删除 keyring 中的 key
		await deleteSecret(SECRET_KEYS.LLM_API_KEY(id));
		setDialogOpen(false);
		setEditingProfile(null);
		setAnchorEl(null);
		const newProfiles = profiles.filter((p) => p.id !== id);
		await onPersist(newProfiles, id === activeId ? "" : activeId);
	};

	return (
		<>
			<Stack direction="row" spacing={0.5} alignItems="center">
				<Select
					size="small"
					value={activeId}
					onChange={(e: SelectChangeEvent) => onSelect(e.target.value)}
					displayEmpty
					sx={{ flex: 1, fontSize: 13 }}
				>
					<MenuItem value=""><em>无（使用手动配置）</em></MenuItem>
					{profiles.map((p) => (
						<MenuItem key={p.id} value={p.id}>{p.name || "(未命名)"}</MenuItem>
					))}
				</Select>
				<Tooltip title="编辑档案">
					<IconButton
						size="small"
						onClick={handleEdit}
						disabled={!activeId && profiles.length === 0}
						sx={{ color: "text.secondary" }}
					>
						<Box sx={{ fontSize: 14 }}>✏️</Box>
					</IconButton>
				</Tooltip>
				<Tooltip title="新增档案">
					<IconButton size="small" onClick={handleNew} sx={{ color: "primary.main" }}>
						<Box sx={{ fontSize: 14 }}>➕</Box>
					</IconButton>
				</Tooltip>
			</Stack>

			<Popover
				open={dialogOpen}
				anchorEl={anchorEl}
				onClose={handleDialogClose}
				anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
				transformOrigin={{ vertical: "top", horizontal: "right" }}
				slotProps={{ paper: { sx: { width: 360, maxHeight: 480, overflowY: "auto" } } }}
			>
				<Box sx={{ p: 1.5 }}>
					<Typography variant="subtitle2" sx={{ mb: 1 }}>LLM 配置档案</Typography>
					{editingProfile && (
						<Stack spacing={1}>
							<TextField
								size="small" fullWidth label="档案名称"
								value={editingProfile.name}
								onChange={(e) => setEditingProfile({ ...editingProfile, name: e.target.value })}
							/>
							<Select
								size="small" fullWidth label="Provider"
								value={editingProfile.provider}
								onChange={(e: SelectChangeEvent) => setEditingProfile({ ...editingProfile, provider: e.target.value as LLMProviderType })}
							>
								<MenuItem value="mock">Mock（模拟）</MenuItem>
								<MenuItem value="openai-compatible">OpenAI 兼容 API</MenuItem>
							</Select>
							<TextField size="small" fullWidth label="API Key" type="password" value={editingProfile.apiKey ?? ""}
								onChange={(e) => setEditingProfile({ ...editingProfile, apiKey: e.target.value })}
								helperText="密钥将安全存储在系统钥匙串中" />
							<TextField size="small" fullWidth label="Base URL" value={editingProfile.baseUrl}
								onChange={(e) => setEditingProfile({ ...editingProfile, baseUrl: e.target.value })}
								helperText="支持是否带 /v1 后缀" />
							<TextField size="small" fullWidth label="模型名称" value={editingProfile.model}
								onChange={(e) => setEditingProfile({ ...editingProfile, model: e.target.value })} />
							<Stack direction="row" spacing={0.5}>
								<TextField size="small" fullWidth label="Temperature" type="number"
									slotProps={{ htmlInput: { min: 0, max: 2, step: 0.1 } }}
									value={editingProfile.temperature}
									onChange={(e) => setEditingProfile({ ...editingProfile, temperature: parseFloat(e.target.value) || 0.7 })} />
								<TextField size="small" fullWidth label="Max Tokens" type="number"
									slotProps={{ htmlInput: { min: 100, max: 16384, step: 256 } }}
									value={editingProfile.maxTokens}
									onChange={(e) => setEditingProfile({ ...editingProfile, maxTokens: parseInt(e.target.value) || 2048 })} />
							</Stack>

							<Stack direction="row" spacing={0.5} justifyContent="space-between" alignItems="center">
								{profiles.length > 1 ? (
									<Button size="small" color="error" onClick={() => { setConfirmDeleteOpen(true); setDeleteCountdown(2); }}>
										删除档案
									</Button>
								) : <Box />}
								<Stack direction="row" spacing={0.5}>
									<Button size="small" onClick={handleDialogClose}>取消</Button>
									<Button size="small" variant="contained" onClick={handleDialogSave}>保存</Button>
								</Stack>
							</Stack>

							{confirmDeleteOpen && editingProfile && (
								<Box sx={{ bgcolor: "background.default", border: "1px solid", borderColor: "error.main", borderRadius: 1, p: 1.5, mt: 0.5 }}>
									<Typography variant="subtitle2" sx={{ mb: 1, color: "error.main" }}>⚠️ 删除此档案将无法恢复</Typography>
									<Stack direction="row" spacing={0.5} justifyContent="flex-end">
										<Button
											size="small" variant="contained" color="error"
											disabled={deleteCountdown > 0}
											onClick={() => { setConfirmDeleteOpen(false); handleDelete(editingProfile.id); }}
										>
											{deleteCountdown > 0 ? `确认删除 (${deleteCountdown}s)` : "确认删除"}
										</Button>
										<Button size="small" onClick={() => setConfirmDeleteOpen(false)}>取消</Button>
									</Stack>
								</Box>
							)}
						</Stack>
					)}
				</Box>
			</Popover>
		</>
	);
}

// ── TTS Profile 管理组件 ───────────────────────────────────────────────────

interface TTSProfilesSectionProps {
	profiles: TTSProfile[];
	activeId: string;
	onAdd: (p: TTSProfile) => void;
	onUpdate: (p: TTSProfile) => void;
	onDelete: (id: string) => void;
	onSelect: (id: string) => void;
	/** Popover 保存/删除后立即持久化（传入更新后的完整 profiles 数组） */
	onPersist: (newProfiles: TTSProfile[], newActiveId: string) => Promise<unknown>;
}

function TTSProfilesSection({ profiles, activeId, onAdd, onUpdate, onDelete, onSelect, onPersist }: TTSProfilesSectionProps) {
	const [dialogOpen, setDialogOpen] = useState(false);
	const [editingProfile, setEditingProfile] = useState<TTSProfile | null>(null);
	const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
	const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
	const [deleteCountdown, setDeleteCountdown] = useState(0);

	// 删除倒计时
	useEffect(() => {
		if (deleteCountdown <= 0) return;
		const timer = setTimeout(() => setDeleteCountdown((c) => c - 1), 1000);
		return () => clearTimeout(timer);
	}, [deleteCountdown]);

	const defaultTTS = (): TTSProfile => ({
		id: `tts-${Date.now()}`,
		name: "",
		provider: "gpt-sovits",
		baseUrl: "http://localhost:9880",
		speakerId: "",
		speed: 1.0,
		gptWeightsPath: "",
		sovitsWeightsPath: "",
		refAudioPath: "",
		promptText: "",
		promptLang: "zh",
		textLang: "zh",
	});

	const handleEdit = (event: React.MouseEvent<HTMLElement>) => {
		if (activeId) {
			setEditingProfile(profiles.find((p) => p.id === activeId) ?? null);
		} else {
			setEditingProfile(defaultTTS());
		}
		setAnchorEl(event.currentTarget);
		setDialogOpen(true);
	};

	const handleNew = (event: React.MouseEvent<HTMLElement>) => {
		setEditingProfile(defaultTTS());
		setAnchorEl(event.currentTarget);
		setDialogOpen(true);
	};

	const handleDialogSave = async () => {
		if (!editingProfile) return;
		const exists = profiles.some((p) => p.id === editingProfile.id);
		let newProfiles: TTSProfile[];
		let newActiveId = activeId;
		if (exists) {
			onUpdate(editingProfile);
			newProfiles = profiles.map((p) => p.id === editingProfile.id ? editingProfile : p);
		} else {
			onAdd(editingProfile);
			onSelect(editingProfile.id);
			newActiveId = editingProfile.id;
			newProfiles = [...profiles, editingProfile];
		}
		setDialogOpen(false);
		setEditingProfile(null);
		setAnchorEl(null);
		await onPersist(newProfiles, newActiveId);
	};

	const handleDialogClose = () => {
		setDialogOpen(false);
		setEditingProfile(null);
		setAnchorEl(null);
	};

	const handleDelete = async (id: string) => {
		onDelete(id);
		if (id === activeId) onSelect("");
		setDialogOpen(false);
		setEditingProfile(null);
		setAnchorEl(null);
		const newProfiles = profiles.filter((p) => p.id !== id);
		await onPersist(newProfiles, id === activeId ? "" : activeId);
	};

	const isGptSovits = editingProfile?.provider === "gpt-sovits";

	return (
		<>
			<Stack direction="row" spacing={0.5} alignItems="center">
				<Select
					size="small"
					value={activeId}
					onChange={(e: SelectChangeEvent) => onSelect(e.target.value)}
					displayEmpty
					sx={{ flex: 1, fontSize: 13 }}
				>
					<MenuItem value=""><em>无（使用手动配置）</em></MenuItem>
					{profiles.map((p) => (
						<MenuItem key={p.id} value={p.id}>{p.name || "(未命名)"}</MenuItem>
					))}
				</Select>
				<Tooltip title="编辑档案">
					<IconButton
						size="small"
						onClick={handleEdit}
						disabled={!activeId && profiles.length === 0}
						sx={{ color: "text.secondary" }}
					>
						<Box sx={{ fontSize: 14 }}>✏️</Box>
					</IconButton>
				</Tooltip>
				<Tooltip title="新增档案">
					<IconButton size="small" onClick={handleNew} sx={{ color: "primary.main" }}>
						<Box sx={{ fontSize: 14 }}>➕</Box>
					</IconButton>
				</Tooltip>
			</Stack>

			<Popover
				open={dialogOpen}
				anchorEl={anchorEl}
				onClose={handleDialogClose}
				anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
				transformOrigin={{ vertical: "top", horizontal: "right" }}
				slotProps={{ paper: { sx: { width: 360, maxHeight: 480, overflowY: "auto" } } }}
			>
				<Box sx={{ p: 1.5 }}>
					<Typography variant="subtitle2" sx={{ mb: 1 }}>TTS 配置档案</Typography>
					{editingProfile && (
						<Stack spacing={1}>
							<TextField size="small" fullWidth label="档案名称"
								value={editingProfile.name}
								onChange={(e) => setEditingProfile({ ...editingProfile, name: e.target.value })} />
							<Select size="small" fullWidth label="Provider"
								value={editingProfile.provider}
								onChange={(e: SelectChangeEvent) => setEditingProfile({ ...editingProfile, provider: e.target.value as TTSProviderType })}>
								<MenuItem value="mock">Mock（模拟）</MenuItem>
								<MenuItem value="gpt-sovits">GPT-SoVITS</MenuItem>
							</Select>
							<TextField size="small" fullWidth label="服务地址"
								value={editingProfile.baseUrl}
								onChange={(e) => setEditingProfile({ ...editingProfile, baseUrl: e.target.value })} />

							{isGptSovits && (
								<>
									<TextField size="small" fullWidth label="GPT 权重路径"
										value={editingProfile.gptWeightsPath}
										onChange={(e) => setEditingProfile({ ...editingProfile, gptWeightsPath: e.target.value })} />
									<TextField size="small" fullWidth label="SoVITS 权重路径"
										value={editingProfile.sovitsWeightsPath}
										onChange={(e) => setEditingProfile({ ...editingProfile, sovitsWeightsPath: e.target.value })} />
									<TextField size="small" fullWidth label="参考音频路径"
										value={editingProfile.refAudioPath}
										onChange={(e) => setEditingProfile({ ...editingProfile, refAudioPath: e.target.value })} />
									<TextField size="small" fullWidth label="参考音频文本"
										value={editingProfile.promptText}
										onChange={(e) => setEditingProfile({ ...editingProfile, promptText: e.target.value })} />
									<Stack direction="row" spacing={0.5}>
										<Select size="small" sx={{ flex: 1 }} label="参考语言"
											value={editingProfile.promptLang}
											onChange={(e: SelectChangeEvent) => setEditingProfile({ ...editingProfile, promptLang: e.target.value })}>
											<MenuItem value="zh">中文</MenuItem>
											<MenuItem value="en">English</MenuItem>
											<MenuItem value="ja">日本語</MenuItem>
										</Select>
										<Select size="small" sx={{ flex: 1 }} label="合成语言"
											value={editingProfile.textLang}
											onChange={(e: SelectChangeEvent) => setEditingProfile({ ...editingProfile, textLang: e.target.value })}>
											<MenuItem value="zh">中文</MenuItem>
											<MenuItem value="en">English</MenuItem>
											<MenuItem value="ja">日本語</MenuItem>
										</Select>
									</Stack>
								</>
							)}

							<Stack direction="row" spacing={0.5} justifyContent="space-between" alignItems="center">
								{profiles.length > 1 ? (
									<Button size="small" color="error" onClick={() => { setConfirmDeleteOpen(true); setDeleteCountdown(2); }}>
										删除档案
									</Button>
								) : <Box />}
								<Stack direction="row" spacing={0.5}>
									<Button size="small" onClick={handleDialogClose}>取消</Button>
									<Button size="small" variant="contained" onClick={handleDialogSave}>保存</Button>
								</Stack>
							</Stack>

							{confirmDeleteOpen && editingProfile && (
								<Box sx={{ bgcolor: "background.default", border: "1px solid", borderColor: "error.main", borderRadius: 1, p: 1.5, mt: 0.5 }}>
									<Typography variant="subtitle2" sx={{ mb: 1, color: "error.main" }}>⚠️ 删除此档案将无法恢复</Typography>
									<Stack direction="row" spacing={0.5} justifyContent="flex-end">
										<Button
											size="small" variant="contained" color="error"
											disabled={deleteCountdown > 0}
											onClick={() => { setConfirmDeleteOpen(false); handleDelete(editingProfile.id); }}
										>
											{deleteCountdown > 0 ? `确认删除 (${deleteCountdown}s)` : "确认删除"}
										</Button>
										<Button size="small" onClick={() => setConfirmDeleteOpen(false)}>取消</Button>
									</Stack>
								</Box>
							)}
						</Stack>
					)}
				</Box>
			</Popover>
		</>
	);
}

// ── 知识库管理组件 ───────────────────────────────────────────────────

function KnowledgeSection() {
	const [documents, setDocuments] = useState<KnowledgeDocument[]>([]);
	const [chunkCount, setChunkCount] = useState(0);
	const [hasIndex, setHasIndex] = useState(false);
	const [knowledgeReady, setKnowledgeReady] = useState(false);
	const [message, setMessage] = useState<{ type: "success" | "error" | "info" | "warning"; text: string } | null>(null);
	const [importing, setImporting] = useState(false);
	const [searchQuery, setSearchQuery] = useState("");
	const [searchResults, setSearchResults] = useState<RetrievalResult[] | null>(null);
	const [searching, setSearching] = useState(false);
	const [rebuilding, setRebuilding] = useState(false);

	const [showAddForm, setShowAddForm] = useState(false);
	const [addCategory, setAddCategory] = useState<KnowledgeCategory>("text");
	const [addTitle, setAddTitle] = useState("");
	const [addContent, setAddContent] = useState("");
	const [adding, setAdding] = useState(false);

	// Embedding 配置
	const [embBaseUrl, setEmbBaseUrl] = useState("");
	const [embModel, setEmbModel] = useState("");
	const [embDimension, setEmbDimension] = useState(1536);
	const [embKeySource, setEmbKeySource] = useState<EmbeddingApiKeySource>("llm");
	const [embDedicatedKey, setEmbDedicatedKey] = useState("");
	const [embSaving, setEmbSaving] = useState(false);

	const fileInputRef = useRef<HTMLInputElement>(null);

	const refreshState = useCallback(() => {
		try {
			const { knowledge } = getServices();
			setDocuments([...knowledge.getDocuments()]);
			setChunkCount(knowledge.getChunkCount());
			setHasIndex(knowledge.hasIndex());
			setKnowledgeReady(knowledge.isInitialized());
		} catch {
			// services not yet initialized
		}
	}, []);

	useEffect(() => {
		// 加载 embedding 配置
		(async () => {
			const loaded = await loadConfig();
			const emb = loaded.knowledge.embedding;
			setEmbBaseUrl(emb.baseUrl);
			setEmbModel(emb.model);
			setEmbDimension(emb.dimension);
			setEmbKeySource(emb.apiKeySource);
			// 尝试读取已保存的 dedicated key
			if (emb.apiKeySource === "dedicated") {
				const key = await getSecret(SECRET_KEYS.EMBEDDING_API_KEY);
				if (key) setEmbDedicatedKey(key);
			}
		})();
		// 轮询等待知识库初始化完成
		const timer = setInterval(() => {
			refreshState();
		}, 500);
		refreshState();
		return () => clearInterval(timer);
	}, [refreshState]);

	// 初始化完成后停止轮询
	useEffect(() => {
		if (knowledgeReady) {
			refreshState();
		}
	}, [knowledgeReady, refreshState]);

	const handleSaveEmbeddingConfig = useCallback(async () => {
		setEmbSaving(true);
		setMessage(null);
		try {
			// 保存 dedicated key
			if (embKeySource === "dedicated" && embDedicatedKey) {
				await setSecret(SECRET_KEYS.EMBEDDING_API_KEY, embDedicatedKey);
			}
			// 更新 config
			await updateConfig({
				knowledge: {
					embedding: {
						baseUrl: embBaseUrl,
						model: embModel,
						dimension: embDimension,
						apiKeySource: embKeySource,
					},
					retrievalTopK: 5,
					searchMode: "vector",
				},
			});
			// 刷新 embedding service
			await refreshEmbeddingService();
			refreshState();
			setMessage({ type: "success", text: "Embedding 配置已保存并生效" });
		} catch (err) {
			setMessage({ type: "error", text: `保存失败: ${err instanceof Error ? err.message : String(err)}` });
		} finally {
			setEmbSaving(false);
		}
	}, [embBaseUrl, embModel, embDimension, embKeySource, embDedicatedKey, refreshState]);

	const handleFileImport = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
		const file = e.target.files?.[0];
		if (!file) return;
		setImporting(true);
		setMessage(null);
		try {
			const text = await file.text();
			const parsed = JSON.parse(text);
			let docs: KnowledgeDocument[];
			if (Array.isArray(parsed)) { docs = parsed; }
			else if (parsed.documents && Array.isArray(parsed.documents)) { docs = parsed.documents; }
			else { throw new Error("JSON 格式不正确：需要 KnowledgeDocument[] 数组或 { documents: [...] }"); }
			for (const doc of docs) {
				if (!doc.id || !doc.title || !doc.content) throw new Error(`文档缺少必要字段 (id/title/content): ${JSON.stringify(doc).slice(0, 100)}`);
				if (!doc.category) doc.category = "text";
				if (!doc.source) doc.source = file.name;
			}
			const { knowledge } = getServices();
			const result = await knowledge.importDocuments(docs);
			if (result.imported > 0) {
				setMessage({ type: result.errors.length > 0 ? "warning" : "success", text: `成功导入 ${result.imported} 条文档${result.errors.length > 0 ? `，${result.errors.length} 条失败` : ""}` });
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
	}, [refreshState]);

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

	const handleSearch = useCallback(async () => {
		if (!searchQuery.trim()) return;
		setSearching(true);
		setSearchResults(null);
		try {
			const { knowledge } = getServices();
			const results = await knowledge.query(searchQuery.trim(), { topK: 5 });
			setSearchResults(results);
		} catch (err) {
			setMessage({ type: "error", text: `搜索失败: ${err instanceof Error ? err.message : String(err)}` });
		} finally {
			setSearching(false);
		}
	}, [searchQuery]);

	const handleAdd = useCallback(async () => {
		if (!addTitle.trim() || !addContent.trim()) return;
		setAdding(true);
		try {
			const doc: KnowledgeDocument = { id: `manual-${Date.now()}`, category: addCategory, title: addTitle.trim(), content: addContent.trim(), source: "manual" };
			const { knowledge } = getServices();
			const result = await knowledge.addDocument(doc);
			if (result.success) {
				setMessage({ type: "success", text: `已添加: "${doc.title}"` });
				setAddTitle(""); setAddContent(""); setShowAddForm(false);
				refreshState();
			} else {
				setMessage({ type: "error", text: result.error ?? "添加失败" });
			}
		} catch (err) {
			setMessage({ type: "error", text: `添加失败: ${err instanceof Error ? err.message : String(err)}` });
		} finally { setAdding(false); }
	}, [addCategory, addTitle, addContent, refreshState]);

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

	const catLabel = (c: KnowledgeCategory) => c === "faq" ? "FAQ" : c === "product" ? "商品" : "文本";

	return (
		<>
			<SectionTitle>
				知识库管理
				<HelpTooltip title="导入 JSON 或手动添加知识条目。条目会被自动切块、向量化并建立索引，用于语义检索注入 LLM 上下文。" />
			</SectionTitle>

			{message && (
				<Alert severity={message.type} onClose={() => setMessage(null)} sx={{ py: 0, fontSize: 11 }}>{message.text}</Alert>
			)}

			{/* Embedding 配置 */}
			<Box sx={{ bgcolor: "background.paper", borderRadius: 1, p: 1, display: "flex", flexDirection: "column", gap: 0.75 }}>
				<Stack direction="row" alignItems="center" spacing={0.5}>
					<Typography variant="caption" fontWeight={600}>Embedding 配置</Typography>
					<HelpTooltip title="配置向量化服务端点。支持 OpenAI 兼容的 /v1/embeddings API（如 DMXAPI、SiliconFlow 等）。密钥来源可选复用 LLM 档案或独立配置。" />
				</Stack>
				<TextField size="small" fullWidth label="Base URL" value={embBaseUrl} onChange={(e) => setEmbBaseUrl(e.target.value)}
					helperText="如 https://api.dmxapi.com/v1 或 https://api.openai.com/v1" />
				<Stack direction="row" spacing={0.5}>
					<TextField size="small" sx={{ flex: 2 }} label="模型名称" value={embModel} onChange={(e) => setEmbModel(e.target.value)}
						helperText="如 text-embedding-3-small、text-embedding-v4" />
					<TextField size="small" sx={{ flex: 1 }} label="维度" type="number" value={embDimension}
						onChange={(e) => setEmbDimension(parseInt(e.target.value) || 1536)}
						slotProps={{ htmlInput: { min: 64, max: 4096, step: 64 } }} />
				</Stack>
				<Select size="small" fullWidth value={embKeySource}
					onChange={(e: SelectChangeEvent) => setEmbKeySource(e.target.value as EmbeddingApiKeySource)}>
					<MenuItem value="llm">复用当前 LLM 档案的 API Key</MenuItem>
					<MenuItem value="dedicated">使用独立的 Embedding API Key</MenuItem>
				</Select>
				{embKeySource === "dedicated" && (
					<TextField size="small" fullWidth label="Embedding API Key" type="password" value={embDedicatedKey}
						onChange={(e) => setEmbDedicatedKey(e.target.value)}
						helperText="密钥将安全存储在系统钥匙串中" />
				)}
				<Button size="small" variant="contained" onClick={handleSaveEmbeddingConfig} disabled={embSaving || !embBaseUrl.trim() || !embModel.trim()}>
					{embSaving ? "保存中..." : "保存 Embedding 配置"}
				</Button>
			</Box>

			{/* 状态栏 */}
			<Box sx={{ bgcolor: "background.paper", borderRadius: 1, p: 1 }}>
				<Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
					<Chip label={`${documents.length} 文档`} size="small" variant="outlined" />
					<Chip label={`${chunkCount} chunks`} size="small" variant="outlined" />
					<Chip label={knowledgeReady ? (hasIndex ? "索引就绪" : "无索引") : "初始化中..."} size="small"
						color={knowledgeReady ? (hasIndex ? "success" : "default") : "warning"} variant="outlined" />
				</Stack>
			</Box>

			<Stack direction="row" spacing={0.5} flexWrap="wrap">
				<input ref={fileInputRef} type="file" accept=".json" style={{ display: "none" }} onChange={handleFileImport} />
				<Button size="small" variant="outlined" startIcon={<UploadFileIcon />} onClick={() => fileInputRef.current?.click()} disabled={importing}>
					{importing ? "导入中..." : "导入 JSON"}
				</Button>
				<Button size="small" variant="outlined" startIcon={<AddIcon />} onClick={() => setShowAddForm(!showAddForm)}>手动添加</Button>
				{documents.length > 0 && (
					<Button size="small" variant="outlined" color="warning" startIcon={<RefreshIcon />} onClick={handleRebuild} disabled={rebuilding}>
						{rebuilding ? "重建中..." : "重建索引"}
					</Button>
				)}
			</Stack>

			{(importing || rebuilding) && <LinearProgress sx={{ my: 0.5 }} />}

			{showAddForm && (
				<Box sx={{ bgcolor: "background.paper", borderRadius: 1, p: 1, display: "flex", flexDirection: "column", gap: 0.75 }}>
					<Typography variant="caption" fontWeight={600}>手动添加知识条目</Typography>
					<Select size="small" fullWidth value={addCategory} onChange={(e: SelectChangeEvent) => setAddCategory(e.target.value as KnowledgeCategory)}>
						<MenuItem value="text">普通文本</MenuItem>
						<MenuItem value="faq">FAQ（问答）</MenuItem>
						<MenuItem value="product">商品资料</MenuItem>
					</Select>
					<TextField size="small" fullWidth label={addCategory === "faq" ? "问题" : addCategory === "product" ? "商品名称" : "标题"} value={addTitle} onChange={(e) => setAddTitle(e.target.value)} />
					<TextField size="small" fullWidth multiline minRows={2} maxRows={6} label={addCategory === "faq" ? "回答" : addCategory === "product" ? "商品描述" : "内容"} value={addContent} onChange={(e) => setAddContent(e.target.value)} />
					<Stack direction="row" spacing={0.5} justifyContent="flex-end">
						<Button size="small" onClick={() => setShowAddForm(false)}>取消</Button>
						<Button size="small" variant="contained" onClick={handleAdd} disabled={adding || !addTitle.trim() || !addContent.trim()}>{adding ? "添加中..." : "添加"}</Button>
					</Stack>
				</Box>
			)}

			{documents.length > 0 && (
				<Box sx={{ bgcolor: "background.paper", borderRadius: 1, p: 1, display: "flex", flexDirection: "column", gap: 0.5 }}>
					<Typography variant="caption" fontWeight={600}>已导入文档</Typography>
					{documents.map((doc) => (
						<Stack key={doc.id} direction="row" alignItems="center" spacing={0.5} sx={{ py: 0.25 }}>
							<Chip label={catLabel(doc.category)} size="small" sx={{ fontSize: 10, height: 18 }} />
							<Typography variant="caption" sx={{ flex: 1, fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{doc.title}</Typography>
							{doc.source && <Typography variant="caption" color="text.secondary" sx={{ fontSize: 9 }}>{doc.source}</Typography>}
							<IconButton size="small" onClick={() => handleDeleteDoc(doc.id)} sx={{ p: 0.25 }}><DeleteIcon sx={{ fontSize: 14 }} /></IconButton>
						</Stack>
					))}
				</Box>
			)}

			<Box sx={{ bgcolor: "background.paper", borderRadius: 1, p: 1, display: "flex", flexDirection: "column", gap: 0.75 }}>
				<Stack direction="row" alignItems="center" spacing={0.5}>
					<Typography variant="caption" fontWeight={600}>搜索验证</Typography>
					<HelpTooltip title="输入文本进行语义检索测试，验证知识库检索质量。" />
				</Stack>
				<Stack direction="row" spacing={0.5}>
					<TextField size="small" fullWidth placeholder='输入搜索文本（如"好看的手办"）' value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") handleSearch(); }} />
					<Button size="small" variant="contained" startIcon={<SearchIcon />} onClick={handleSearch} disabled={searching || !searchQuery.trim()}>{searching ? "..." : "搜索"}</Button>
				</Stack>
				{searching && <LinearProgress sx={{ my: 0.25 }} />}
				{searchResults !== null && (
					<Box sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
						{searchResults.length === 0 ? (
							<Typography variant="caption" color="text.secondary">无匹配结果</Typography>
						) : searchResults.map((r, i) => (
							<Box key={`${r.docId}-${i}`} sx={{ borderLeft: "2px solid", borderColor: "primary.main", pl: 1, py: 0.25 }}>
								<Stack direction="row" spacing={0.5} alignItems="center">
									<Chip label={catLabel(r.category)} size="small" sx={{ fontSize: 9, height: 16 }} />
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
		</>
	);
}
