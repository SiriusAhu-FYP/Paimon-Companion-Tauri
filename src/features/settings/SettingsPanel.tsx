import { useState, useEffect, useCallback } from "react";
import {
	Box, Button, Typography, Stack, TextField, Select, MenuItem,
	Divider, Alert, IconButton, Tooltip,
	Dialog, DialogTitle, DialogContent, DialogActions,
	type SelectChangeEvent,
} from "@mui/material";
import SaveIcon from "@mui/icons-material/Save";
import RestoreIcon from "@mui/icons-material/Restore";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import NetworkCheckIcon from "@mui/icons-material/NetworkCheck";
import VolumeUpIcon from "@mui/icons-material/VolumeUp";
import {
	type AppConfig, type LLMProviderType, type TTSProviderType,
	type LLMProfile, type TTSProfile,
	type TTSProviderConfig,
	DEFAULT_CONFIG, SECRET_KEYS,
	loadConfig, updateConfig, resetConfig,
	hasSecret, setSecret, deleteSecret,
	proxyRequest,
} from "@/services/config";
import { createLogger } from "@/services/logger";
import { GptSovitsTTSService, MockTTSService, splitText, normalizeForSpeech, SpeechQueue } from "@/services/tts";
import { AudioPlayer } from "@/services/audio/audio-player";
import { broadcastControl } from "@/utils/window-sync";

const log = createLogger("settings");

interface SettingsPanelProps {
	onClose: () => void;
}

export function SettingsPanel({ onClose }: SettingsPanelProps) {
	const [config, setConfig] = useState<AppConfig>(DEFAULT_CONFIG);
	const [llmApiKey, setLlmApiKey] = useState("");
	const [llmKeyExists, setLlmKeyExists] = useState(false);
	const [saving, setSaving] = useState(false);
	const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
	const [llmTestResult, setLlmTestResult] = useState<{ ok: boolean; text: string } | null>(null);
	const [ttsTestResult, setTtsTestResult] = useState<{ ok: boolean; text: string } | null>(null);
	const [testing, setTesting] = useState<"llm" | "tts" | null>(null);
	const [ttsTestText, setTtsTestText] = useState("你好，我是测试文本");
	const [ttsTesting, setTtsTesting] = useState(false);

	// Settings 打开时暂时解除 Stage 置顶，关闭时恢复
	useEffect(() => {
		broadcastControl({ type: "set-always-on-top", value: false });
		return () => {
			broadcastControl({ type: "restore-always-on-top" });
		};
	}, []);

	useEffect(() => {
		let cancelled = false;
		(async () => {
			const loaded = await loadConfig();
			if (cancelled) return;
			setConfig(loaded);
			const llmHas = await hasSecret(SECRET_KEYS.LLM_API_KEY);
			if (cancelled) return;
			setLlmKeyExists(llmHas);
			log.info("settings loaded", { llmKeyExists: llmHas });
		})();
		return () => { cancelled = true; };
	}, []);

	const handleSave = useCallback(async () => {
		setSaving(true);
		setMessage(null);
		try {
			await updateConfig(config);

			if (llmApiKey.trim()) {
				await setSecret(SECRET_KEYS.LLM_API_KEY, llmApiKey.trim());
				setLlmKeyExists(true);
				setLlmApiKey("");
			}

			setMessage({ type: "success", text: "设置已保存" });
			log.info("settings saved");
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			setMessage({ type: "error", text: `保存失败: ${msg}` });
			log.error("settings save failed", err);
		} finally {
			setSaving(false);
		}
	}, [config, llmApiKey]);

	const handleReset = useCallback(async () => {
		const defaults = await resetConfig();
		setConfig(defaults);
		await deleteSecret(SECRET_KEYS.LLM_API_KEY);
		await deleteSecret(SECRET_KEYS.TTS_API_KEY);
		setLlmKeyExists(false);
		setLlmApiKey("");
		setMessage({ type: "success", text: "已恢复默认设置" });
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
			if (profile) return profile;
		}
		return config.tts;
	}, [config]);

	const handleTestLLM = useCallback(async () => {
		setTesting("llm");
		setLlmTestResult(null);
		try {
			const llmCfg = getActiveLlmConfig();
			const url = (llmCfg.baseUrl || "").replace(/\/+$/, "") + "/models";
			if (!url || url === "/models") {
				setLlmTestResult({ ok: false, text: "请先在档案中配置 Base URL" });
				return;
			}
			const needsKey = !isLocalUrl(llmCfg.baseUrl);
			const resp = await proxyRequest({
				url,
				method: "GET",
				headers: { "Content-Type": "application/json" },
				secretKey: needsKey ? SECRET_KEYS.LLM_API_KEY : undefined,
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
	}, [getActiveLlmConfig]);

	const handleTestTTS = useCallback(async () => {
		setTesting("tts");
		setTtsTestResult(null);
		try {
			const ttsCfg = getActiveTtsConfig();
			const base = (ttsCfg.baseUrl || "http://localhost:9880").replace(/\/+$/, "");
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
			let ttsService: GptSovitsTTSService | MockTTSService;
			if (ttsCfg.provider === "gpt-sovits") {
				ttsService = new GptSovitsTTSService(ttsCfg as unknown as TTSProviderConfig);
			} else {
				ttsService = new MockTTSService();
			}
			const player = new AudioPlayer();
			const queue = new SpeechQueue(ttsService, player, (_speaking) => {
				/* Settings 测试入口不需要更新 UI 状态 */
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
			setMessage({ type: "success", text: `切片完成：${segments.length} 段 — ${preview}` });

			await queue.speakAll(segments);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			setMessage({ type: "error", text: `TTS 测试失败: ${msg}` });
			log.error("TTS direct test failed", err);
		} finally {
			setTtsTesting(false);
		}
	}, [getActiveTtsConfig, ttsTestText]);

	const needsLlmKey = getActiveLlmConfig().provider !== "mock" && !llmKeyExists && !llmApiKey.trim();

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

			{/* LLM 测试（从激活档案读取） */}
			<SectionTitle>LLM 测试</SectionTitle>
			<Box sx={{ bgcolor: "background.paper", borderRadius: 1, p: 1, display: "flex", flexDirection: "column", gap: 0.75 }}>
				<Typography variant="caption" color="text.secondary" sx={{ fontSize: 10 }}>
					当前读取{config.activeLlmProfileId ? "激活档案" : "根配置"}：{getActiveLlmConfig().model || getActiveLlmConfig().provider}
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

				{needsLlmKey && (
					<Alert severity="warning" sx={{ py: 0, fontSize: 12 }}>
						真实 LLM 需要配置 API Key（档案中配置）
					</Alert>
				)}
			</Box>

			<Divider />

			{/* TTS 测试（从激活档案读取） */}
			<SectionTitle>TTS 测试</SectionTitle>
			<Box sx={{ bgcolor: "background.paper", borderRadius: 1, p: 1, display: "flex", flexDirection: "column", gap: 0.75 }}>
				<Typography variant="caption" color="text.secondary" sx={{ fontSize: 10 }}>
					当前读取{config.activeTtsProfileId ? "激活档案" : "根配置"}：{getActiveTtsConfig().provider}
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

				<Typography variant="caption" color="text.secondary" sx={{ fontSize: 10 }}>TTS 直测</Typography>
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

			{/* 角色设置 */}
			<SectionTitle>角色设置</SectionTitle>
			<Box sx={{ bgcolor: "background.paper", borderRadius: 1, p: 1, display: "flex", flexDirection: "column", gap: 0.75 }}>
				<FieldLabel>自定义人设（无角色卡时生效）</FieldLabel>
				<Typography variant="caption" color="text.secondary" sx={{ fontSize: 10 }}>
					仅在"当前角色"未选择任何角色卡时拼入 system prompt。优先级最低：
					角色卡内设定 &gt; 自定义人设。
				</Typography>
				<TextField
					size="small" fullWidth multiline minRows={3} maxRows={6}
					value={config.character.customPersona}
					onChange={(e) => updateCharacter({ customPersona: e.target.value })}
				/>
			</Box>

			<Divider />

			{/* LLM Profiles */}
			<SectionTitle>LLM 配置档案</SectionTitle>
			<LLMProfilesSection
				profiles={config.llmProfiles}
				activeId={config.activeLlmProfileId}
				onAdd={(p) => setConfig((c) => ({ ...c, llmProfiles: [...c.llmProfiles, p] }))}
				onUpdate={(p) => setConfig((c) => ({ ...c, llmProfiles: c.llmProfiles.map((x) => x.id === p.id ? p : x) }))}
				onDelete={(id) => setConfig((c) => ({ ...c, llmProfiles: c.llmProfiles.filter((x) => x.id !== id), activeLlmProfileId: c.activeLlmProfileId === id ? "" : c.activeLlmProfileId }))}
				onSelect={(id) => setConfig((c) => ({ ...c, activeLlmProfileId: id }))}
			/>

			<Divider />

			{/* TTS Profiles */}
			<SectionTitle>TTS 配置档案</SectionTitle>
			<TTSProfilesSection
				profiles={config.ttsProfiles}
				activeId={config.activeTtsProfileId}
				onAdd={(p) => setConfig((c) => ({ ...c, ttsProfiles: [...c.ttsProfiles, p] }))}
				onUpdate={(p) => setConfig((c) => ({ ...c, ttsProfiles: c.ttsProfiles.map((x) => x.id === p.id ? p : x) }))}
				onDelete={(id) => setConfig((c) => ({ ...c, ttsProfiles: c.ttsProfiles.filter((x) => x.id !== id), activeTtsProfileId: c.activeTtsProfileId === id ? "" : c.activeTtsProfileId }))}
				onSelect={(id) => setConfig((c) => ({ ...c, activeTtsProfileId: id }))}
			/>

			{/* 操作按钮 */}
			<Stack direction="row" spacing={1} sx={{ mt: 1, flexShrink: 0 }}>
				<Button
					variant="contained" size="small" fullWidth
					startIcon={<SaveIcon />}
					onClick={handleSave}
					disabled={saving}
				>
					{saving ? "保存中..." : "保存"}
				</Button>
				<Button
					variant="outlined" size="small" color="warning"
					startIcon={<RestoreIcon />}
					onClick={handleReset}
				>
					重置
				</Button>
			</Stack>
		</Box>
	);
}

function SectionTitle({ children }: { children: React.ReactNode }) {
	return (
		<Typography variant="caption" color="text.secondary" fontWeight={600} sx={{ display: "block" }}>
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

function isLocalUrl(url: string): boolean {
	try {
		const u = new URL(url);
		const host = u.hostname;
		return host === "localhost" || host === "127.0.0.1" || host.startsWith("192.168.") || host.startsWith("10.") || host.endsWith(".local");
	} catch {
		return false;
	}
}

// ── LLM Profile 管理组件 ───────────────────────────────────────────────────

interface LLMProfilesSectionProps {
	profiles: LLMProfile[];
	activeId: string;
	onAdd: (p: LLMProfile) => void;
	onUpdate: (p: LLMProfile) => void;
	onDelete: (id: string) => void;
	onSelect: (id: string) => void;
}

function LLMProfilesSection({ profiles, activeId, onAdd, onUpdate, onDelete, onSelect }: LLMProfilesSectionProps) {
	const [dialogOpen, setDialogOpen] = useState(false);
	const [editingProfile, setEditingProfile] = useState<LLMProfile | null>(null);

	const handleEdit = () => {
		if (activeId) {
			setEditingProfile(profiles.find((p) => p.id === activeId) ?? null);
		} else {
			setEditingProfile({
				id: `llm-${Date.now()}`,
				name: "",
				provider: "openai-compatible",
				baseUrl: "",
				model: "",
				temperature: 0.7,
				maxTokens: 2048,
			});
		}
		setDialogOpen(true);
	};

	const handleNew = () => {
		setEditingProfile({
			id: `llm-${Date.now()}`,
			name: "",
			provider: "openai-compatible",
			baseUrl: "",
			model: "",
			temperature: 0.7,
			maxTokens: 2048,
		});
		setDialogOpen(true);
	};

	const handleDialogSave = () => {
		if (!editingProfile) return;
		const exists = profiles.some((p) => p.id === editingProfile.id);
		if (exists) {
			onUpdate(editingProfile);
		} else {
			onAdd(editingProfile);
			onSelect(editingProfile.id);
		}
		setDialogOpen(false);
		setEditingProfile(null);
	};

	const handleDialogClose = () => {
		setDialogOpen(false);
		setEditingProfile(null);
	};

	const handleDelete = (id: string) => {
		onDelete(id);
		if (id === activeId) onSelect("");
		setDialogOpen(false);
		setEditingProfile(null);
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

			<Dialog open={dialogOpen} onClose={handleDialogClose} maxWidth="sm" fullWidth>
				<DialogTitle>LLM 配置档案</DialogTitle>
				<DialogContent dividers>
					{editingProfile && (
						<Stack spacing={1} sx={{ pt: 0.5 }}>
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
							<TextField size="small" fullWidth label="Base URL" value={editingProfile.baseUrl}
								onChange={(e) => setEditingProfile({ ...editingProfile, baseUrl: e.target.value })} />
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

							{profiles.length > 1 && (
								<Box sx={{ bgcolor: "error.main", borderRadius: 1, p: 1 }}>
									<Typography variant="caption" sx={{ color: "#fff", fontSize: 11 }}>
										⚠️ 删除此档案将无法恢复
									</Typography>
									<Button
										size="small" color="inherit" fullWidth
										onClick={() => handleDelete(editingProfile.id)}
										sx={{ mt: 0.5, color: "#fff" }}
									>
										删除档案
									</Button>
								</Box>
							)}
						</Stack>
					)}
				</DialogContent>
				<DialogActions>
					<Button size="small" onClick={handleDialogClose}>取消</Button>
					<Button size="small" variant="contained" onClick={handleDialogSave}>保存</Button>
				</DialogActions>
			</Dialog>
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
}

function TTSProfilesSection({ profiles, activeId, onAdd, onUpdate, onDelete, onSelect }: TTSProfilesSectionProps) {
	const [dialogOpen, setDialogOpen] = useState(false);
	const [editingProfile, setEditingProfile] = useState<TTSProfile | null>(null);

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

	const handleEdit = () => {
		if (activeId) {
			setEditingProfile(profiles.find((p) => p.id === activeId) ?? null);
		} else {
			setEditingProfile(defaultTTS());
		}
		setDialogOpen(true);
	};

	const handleNew = () => {
		setEditingProfile(defaultTTS());
		setDialogOpen(true);
	};

	const handleDialogSave = () => {
		if (!editingProfile) return;
		const exists = profiles.some((p) => p.id === editingProfile.id);
		if (exists) {
			onUpdate(editingProfile);
		} else {
			onAdd(editingProfile);
			onSelect(editingProfile.id);
		}
		setDialogOpen(false);
		setEditingProfile(null);
	};

	const handleDialogClose = () => {
		setDialogOpen(false);
		setEditingProfile(null);
	};

	const handleDelete = (id: string) => {
		onDelete(id);
		if (id === activeId) onSelect("");
		setDialogOpen(false);
		setEditingProfile(null);
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

			<Dialog open={dialogOpen} onClose={handleDialogClose} maxWidth="sm" fullWidth>
				<DialogTitle>TTS 配置档案</DialogTitle>
				<DialogContent dividers>
					{editingProfile && (
						<Stack spacing={1} sx={{ pt: 0.5 }}>
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

							{profiles.length > 1 && (
								<Box sx={{ bgcolor: "error.main", borderRadius: 1, p: 1 }}>
									<Typography variant="caption" sx={{ color: "#fff", fontSize: 11 }}>
										⚠️ 删除此档案将无法恢复
									</Typography>
									<Button
										size="small" color="inherit" fullWidth
										onClick={() => handleDelete(editingProfile.id)}
										sx={{ mt: 0.5, color: "#fff" }}
									>
										删除档案
									</Button>
								</Box>
							)}
						</Stack>
					)}
				</DialogContent>
				<DialogActions>
					<Button size="small" onClick={handleDialogClose}>取消</Button>
					<Button size="small" variant="contained" onClick={handleDialogSave}>保存</Button>
				</DialogActions>
			</Dialog>
		</>
	);
}
