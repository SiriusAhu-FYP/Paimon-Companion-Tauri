import { useState, useEffect, useCallback } from "react";
import {
	Box, Button, Typography, Stack, TextField, Select, MenuItem,
	Divider, Alert, InputAdornment, IconButton, Tooltip,
	type SelectChangeEvent,
} from "@mui/material";
import VisibilityIcon from "@mui/icons-material/Visibility";
import VisibilityOffIcon from "@mui/icons-material/VisibilityOff";
import SaveIcon from "@mui/icons-material/Save";
import RestoreIcon from "@mui/icons-material/Restore";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import NetworkCheckIcon from "@mui/icons-material/NetworkCheck";
import VolumeUpIcon from "@mui/icons-material/VolumeUp";
import {
	type AppConfig, type LLMProviderType, type TTSProviderType,
	type LLMProfile, type TTSProfile,
	DEFAULT_CONFIG, SECRET_KEYS,
	loadConfig, updateConfig, resetConfig,
	hasSecret, setSecret, deleteSecret,
	proxyRequest,
} from "@/services/config";
import { createLogger } from "@/services/logger";
import { GptSovitsTTSService, MockTTSService, splitText, normalizeForSpeech, SpeechQueue } from "@/services/tts";
import { AudioPlayer } from "@/services/audio/audio-player";

const log = createLogger("settings");

interface SettingsPanelProps {
	onClose: () => void;
}

export function SettingsPanel({ onClose }: SettingsPanelProps) {
	const [config, setConfig] = useState<AppConfig>(DEFAULT_CONFIG);
	const [llmApiKey, setLlmApiKey] = useState("");
	const [ttsApiKey, setTtsApiKey] = useState("");
	const [llmKeyExists, setLlmKeyExists] = useState(false);
	const [showLlmKey, setShowLlmKey] = useState(false);
	const [saving, setSaving] = useState(false);
	const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
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
			const llmHas = await hasSecret(SECRET_KEYS.LLM_API_KEY);
			if (cancelled) return;
			setLlmKeyExists(llmHas);
			log.info("settings loaded", { provider: loaded.llm.provider, llmKeyExists: llmHas });
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

			if (ttsApiKey.trim()) {
				await setSecret(SECRET_KEYS.TTS_API_KEY, ttsApiKey.trim());
				setTtsApiKey("");
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
	}, [config, llmApiKey, ttsApiKey]);

	const handleReset = useCallback(async () => {
		const defaults = await resetConfig();
		setConfig(defaults);
		await deleteSecret(SECRET_KEYS.LLM_API_KEY);
		await deleteSecret(SECRET_KEYS.TTS_API_KEY);
		setLlmKeyExists(false);
		setLlmApiKey("");
		setTtsApiKey("");
		setMessage({ type: "success", text: "已恢复默认设置" });
	}, []);

	const updateLLM = useCallback((patch: Partial<AppConfig["llm"]>) => {
		setConfig((c) => ({ ...c, llm: { ...c.llm, ...patch } }));
	}, []);

	const updateTTS = useCallback((patch: Partial<AppConfig["tts"]>) => {
		setConfig((c) => ({ ...c, tts: { ...c.tts, ...patch } }));
	}, []);

	const updateCharacter = useCallback((patch: Partial<AppConfig["character"]>) => {
		setConfig((c) => ({ ...c, character: { ...c.character, ...patch } }));
	}, []);

	const handleTestLLM = useCallback(async () => {
		setTesting("llm");
		setLlmTestResult(null);
		try {
			const url = config.llm.baseUrl.replace(/\/+$/, "") + "/models";
			const needsKey = !isLocalUrl(config.llm.baseUrl);
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
	}, [config.llm.baseUrl]);

	const handleTestTTS = useCallback(async () => {
		setTesting("tts");
		setTtsTestResult(null);
		try {
			const base = (config.tts.baseUrl || "http://localhost:9880").replace(/\/+$/, "");

			// GPT-SoVITS /set_gpt_weights 需要 weights_path 参数才返回 200，空参数返回 400
			// 用一个肯定存在的路径做探测即可（路径是否存在不影响 HTTP 状态码）
			const testUrl = `${base}/set_gpt_weights?weights_path=/tmp/dummy`;
			const resp = await proxyRequest({
				url: testUrl,
				method: "GET",
				timeoutMs: 8000,
			});
			// 任何 HTTP 响应都说明服务器可达（GPT-SoVITS 不认识路径但会返回 200）
			setTtsTestResult({ ok: true, text: `服务可达 (HTTP ${resp.status})` });
			log.info("TTS connection test passed", { status: resp.status });
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			setTtsTestResult({ ok: false, text: msg });
			log.warn("TTS connection test failed", msg);
		} finally {
			setTesting(null);
		}
	}, [config.tts.baseUrl]);

	const handleTestTTSDirect = useCallback(async () => {
		if (!ttsTestText.trim()) return;

		setTtsTesting(true);
		setMessage(null);
		try {
			let ttsService: GptSovitsTTSService | MockTTSService;
			if (config.tts.provider === "gpt-sovits") {
				ttsService = new GptSovitsTTSService(config.tts);
			} else {
				ttsService = new MockTTSService();
			}
			const player = new AudioPlayer();
			const queue = new SpeechQueue(ttsService, player, (_speaking) => {
				/* Settings 测试入口不需要更新 UI 状态 */
			});

			// 复用正式链路前处理：normalize → 切片 → 语言路由
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

			// 显示切片结果预览
			const preview = segments
				.map((s) => `[${s.lang}]${s.text.slice(0, 15)}${s.text.length > 15 ? "…" : ""}`)
				.join(" | ");
			setMessage({ type: "success", text: `切片完成：${segments.length} 段 — ${preview}` });

			// 实际合成并播放
			await queue.speakAll(segments);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			setMessage({ type: "error", text: `TTS 测试失败: ${msg}` });
			log.error("TTS direct test failed", err);
		} finally {
			setTtsTesting(false);
		}
	}, [config.tts, ttsTestText]);

	const needsLlmKey = config.llm.provider !== "mock" && !llmKeyExists && !llmApiKey.trim();

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

			{/* LLM 设置 */}
			<SectionTitle>LLM 设置</SectionTitle>
			<Box sx={{ bgcolor: "background.paper", borderRadius: 1, p: 1, display: "flex", flexDirection: "column", gap: 0.75 }}>
				<FieldLabel>Provider</FieldLabel>
				<Select
					size="small"
					value={config.llm.provider}
					onChange={(e: SelectChangeEvent) => updateLLM({ provider: e.target.value as LLMProviderType })}
					fullWidth
				>
					<MenuItem value="mock">Mock（模拟）</MenuItem>
					<MenuItem value="openai-compatible">OpenAI 兼容 API</MenuItem>
				</Select>

				{config.llm.provider !== "mock" && (
					<>
						<FieldLabel>Base URL</FieldLabel>
						<TextField
							size="small" fullWidth
							placeholder="https://api.openai.com/v1"
							value={config.llm.baseUrl}
							onChange={(e) => updateLLM({ baseUrl: e.target.value })}
						/>

						<FieldLabel>模型名称</FieldLabel>
						<TextField
							size="small" fullWidth
							placeholder="gpt-4o"
							value={config.llm.model}
							onChange={(e) => updateLLM({ model: e.target.value })}
						/>

						<FieldLabel>API Key {llmKeyExists && <KeyBadge />}</FieldLabel>
						<TextField
							size="small" fullWidth
							type={showLlmKey ? "text" : "password"}
							placeholder={llmKeyExists ? "已保存（输入新值覆盖）" : "请输入 API Key"}
							value={llmApiKey}
							onChange={(e) => setLlmApiKey(e.target.value)}
							slotProps={{
								input: {
									endAdornment: (
										<InputAdornment position="end">
											<IconButton size="small" onClick={() => setShowLlmKey(!showLlmKey)}>
												{showLlmKey ? <VisibilityOffIcon fontSize="small" /> : <VisibilityIcon fontSize="small" />}
											</IconButton>
										</InputAdornment>
									),
								},
							}}
						/>

						{needsLlmKey && (
							<Alert severity="warning" sx={{ py: 0, fontSize: 12 }}>
								选择真实 LLM provider 需要配置 API Key
							</Alert>
						)}

						<Stack direction="row" spacing={1}>
							<Box sx={{ flex: 1 }}>
								<FieldLabel>Temperature</FieldLabel>
								<TextField
									size="small" fullWidth type="number"
									slotProps={{ htmlInput: { min: 0, max: 2, step: 0.1 } }}
									value={config.llm.temperature}
									onChange={(e) => updateLLM({ temperature: parseFloat(e.target.value) || 0.7 })}
								/>
							</Box>
							<Box sx={{ flex: 1 }}>
								<FieldLabel>Max Tokens</FieldLabel>
								<TextField
									size="small" fullWidth type="number"
									slotProps={{ htmlInput: { min: 100, max: 16384, step: 256 } }}
									value={config.llm.maxTokens}
									onChange={(e) => updateLLM({ maxTokens: parseInt(e.target.value) || 2048 })}
								/>
							</Box>
						</Stack>

						<Button
							size="small" variant="outlined"
							startIcon={<NetworkCheckIcon />}
							onClick={handleTestLLM}
							disabled={!config.llm.baseUrl || testing === "llm"}
						>
							{testing === "llm" ? "测试中..." : "测试连接"}
						</Button>
						{llmTestResult && (
							<Alert severity={llmTestResult.ok ? "success" : "error"} sx={{ py: 0, fontSize: 11 }}>
								{llmTestResult.text}
							</Alert>
						)}
					</>
				)}
			</Box>

			<Divider />

			{/* TTS 设置 */}
			<SectionTitle>TTS 设置</SectionTitle>
			<Box sx={{ bgcolor: "background.paper", borderRadius: 1, p: 1, display: "flex", flexDirection: "column", gap: 0.75 }}>
				<FieldLabel>Provider</FieldLabel>
				<Select
					size="small"
					value={config.tts.provider}
					onChange={(e: SelectChangeEvent) => updateTTS({ provider: e.target.value as TTSProviderType })}
					fullWidth
				>
					<MenuItem value="mock">Mock（模拟）</MenuItem>
					<MenuItem value="gpt-sovits">GPT-SoVITS</MenuItem>
				</Select>

				{config.tts.provider === "gpt-sovits" && (
					<>
						<FieldLabel>GPT-SoVITS 服务地址</FieldLabel>
						<TextField
							size="small" fullWidth
							placeholder="http://localhost:9880"
							value={config.tts.baseUrl}
							onChange={(e) => updateTTS({ baseUrl: e.target.value })}
						/>

						<FieldLabel>GPT 权重路径（服务端路径）</FieldLabel>
						<TextField
							size="small" fullWidth
							placeholder="/path/to/model.ckpt"
							value={config.tts.gptWeightsPath}
							onChange={(e) => updateTTS({ gptWeightsPath: e.target.value })}
						/>

						<FieldLabel>SoVITS 权重路径（服务端路径）</FieldLabel>
						<TextField
							size="small" fullWidth
							placeholder="/path/to/model.pth"
							value={config.tts.sovitsWeightsPath}
							onChange={(e) => updateTTS({ sovitsWeightsPath: e.target.value })}
						/>

						<FieldLabel>参考音频路径（服务端路径）</FieldLabel>
						<TextField
							size="small" fullWidth
							placeholder="/path/to/ref_audio.wav"
							value={config.tts.refAudioPath}
							onChange={(e) => updateTTS({ refAudioPath: e.target.value })}
						/>

						<FieldLabel>参考音频文本</FieldLabel>
						<TextField
							size="small" fullWidth
							placeholder="参考音频对应的文字内容"
							value={config.tts.promptText}
							onChange={(e) => updateTTS({ promptText: e.target.value })}
						/>

						<Stack direction="row" spacing={1}>
							<Box sx={{ flex: 1 }}>
								<FieldLabel>参考音频语言</FieldLabel>
								<Select
									size="small" fullWidth
									value={config.tts.promptLang}
									onChange={(e: SelectChangeEvent) => updateTTS({ promptLang: e.target.value })}
								>
									<MenuItem value="zh">中文</MenuItem>
									<MenuItem value="en">English</MenuItem>
									<MenuItem value="ja">日本語</MenuItem>
								</Select>
							</Box>
							<Box sx={{ flex: 1 }}>
								<FieldLabel>合成语言</FieldLabel>
								<Select
									size="small" fullWidth
									value={config.tts.textLang}
									onChange={(e: SelectChangeEvent) => updateTTS({ textLang: e.target.value })}
								>
									<MenuItem value="zh">中文</MenuItem>
									<MenuItem value="en">English</MenuItem>
									<MenuItem value="ja">日本語</MenuItem>
								</Select>
							</Box>
						</Stack>

						<Button
							size="small" variant="outlined"
							startIcon={<NetworkCheckIcon />}
							onClick={handleTestTTS}
							disabled={!config.tts.baseUrl || testing === "tts"}
						>
							{testing === "tts" ? "测试中..." : "测试连接"}
						</Button>
						{ttsTestResult && (
							<Alert severity={ttsTestResult.ok ? "success" : "error"} sx={{ py: 0, fontSize: 11 }}>
								{ttsTestResult.text}
							</Alert>
						)}

						<Divider sx={{ my: 1 }} />

						<FieldLabel>TTS 直测输入框</FieldLabel>
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
							disabled={!config.tts.baseUrl || ttsTesting}
						>
							{ttsTesting ? "合成中..." : "合成并播放"}
						</Button>
					</>
				)
				}
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

function KeyBadge() {
	return (
		<Typography component="span" sx={{ fontSize: 10, color: "success.main", ml: 0.5 }}>
			(已保存)
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
	const [editing, setEditing] = useState<LLMProfile | null>(null);

	const startAdd = () => {
		setEditing({
			id: `llm-${Date.now()}`,
			name: "",
			provider: "openai-compatible",
			baseUrl: "",
			model: "",
			temperature: 0.7,
			maxTokens: 2048,
		});
	};

	const startEdit = (p: LLMProfile) => {
		setEditing({ ...p });
	};

	const cancelEdit = () => setEditing(null);

	const saveEdit = () => {
		if (!editing) return;
		const exists = profiles.some((p) => p.id === editing.id);
		if (exists) {
			onUpdate(editing);
		} else {
			onAdd(editing);
		}
		setEditing(null);
	};

	return (
		<Box sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
			{profiles.length > 0 && (
				<Box sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
					{profiles.map((p) => (
						<Stack key={p.id} direction="row" spacing={0.5} alignItems="center">
							<Box
								sx={{
									flex: 1,
									bgcolor: "background.paper",
									borderRadius: 1,
									px: 1,
									py: 0.5,
									cursor: "pointer",
									border: p.id === activeId ? "1px solid" : "1px solid transparent",
									borderColor: p.id === activeId ? "primary.main" : "transparent",
								}}
								onClick={() => onSelect(p.id)}
							>
								<Typography variant="body2" sx={{ fontSize: 12, fontWeight: p.id === activeId ? 700 : 400 }}>
									{p.name || "(未命名)"}
								</Typography>
								<Typography variant="caption" color="text.secondary" sx={{ fontSize: 10 }}>
									{p.provider} · {p.model || "未设置模型"}
								</Typography>
							</Box>
							<IconButton size="small" onClick={() => startEdit(p)} sx={{ color: "text.secondary" }}>
								<Box sx={{ fontSize: 14 }}>✏️</Box>
							</IconButton>
							<IconButton size="small" onClick={() => onDelete(p.id)} sx={{ color: "error.main" }}>
								<Box sx={{ fontSize: 14 }}>🗑️</Box>
							</IconButton>
						</Stack>
					))}
				</Box>
			)}

			{editing ? (
				<Box sx={{ bgcolor: "background.paper", borderRadius: 1, p: 1, display: "flex", flexDirection: "column", gap: 0.5 }}>
					<TextField
						size="small" fullWidth label="档案名称"
						value={editing.name}
						onChange={(e) => setEditing({ ...editing, name: e.target.value })}
					/>
					<Select
						size="small" fullWidth label="Provider"
						value={editing.provider}
						onChange={(e: SelectChangeEvent) => setEditing({ ...editing, provider: e.target.value as LLMProviderType })}
					>
						<MenuItem value="mock">Mock（模拟）</MenuItem>
						<MenuItem value="openai-compatible">OpenAI 兼容 API</MenuItem>
					</Select>
					<TextField size="small" fullWidth label="Base URL" value={editing.baseUrl}
						onChange={(e) => setEditing({ ...editing, baseUrl: e.target.value })} />
					<TextField size="small" fullWidth label="模型名称" value={editing.model}
						onChange={(e) => setEditing({ ...editing, model: e.target.value })} />
					<Stack direction="row" spacing={0.5}>
						<TextField size="small" fullWidth label="Temperature" type="number"
							slotProps={{ htmlInput: { min: 0, max: 2, step: 0.1 } }}
							value={editing.temperature}
							onChange={(e) => setEditing({ ...editing, temperature: parseFloat(e.target.value) || 0.7 })} />
						<TextField size="small" fullWidth label="Max Tokens" type="number"
							slotProps={{ htmlInput: { min: 100, max: 16384, step: 256 } }}
							value={editing.maxTokens}
							onChange={(e) => setEditing({ ...editing, maxTokens: parseInt(e.target.value) || 2048 })} />
					</Stack>
					<Stack direction="row" spacing={0.5}>
						<Button size="small" variant="contained" onClick={saveEdit} sx={{ flex: 1 }}>保存</Button>
						<Button size="small" variant="outlined" onClick={cancelEdit} sx={{ flex: 1 }}>取消</Button>
					</Stack>
				</Box>
			) : (
				<Button size="small" variant="outlined" onClick={startAdd} sx={{ fontSize: 11 }}>
					+ 新增 LLM 档案
				</Button>
			)}
		</Box>
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
	const [editing, setEditing] = useState<TTSProfile | null>(null);

	const defaultTTS: TTSProfile = {
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
	};

	const startAdd = () => setEditing({ ...defaultTTS, id: `tts-${Date.now()}` });
	const startEdit = (p: TTSProfile) => setEditing({ ...p });
	const cancelEdit = () => setEditing(null);

	const saveEdit = () => {
		if (!editing) return;
		const exists = profiles.some((x) => x.id === editing.id);
		if (exists) onUpdate(editing);
		else onAdd(editing);
		setEditing(null);
	};

	return (
		<Box sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
			{profiles.length > 0 && (
				<Box sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
					{profiles.map((p) => (
						<Stack key={p.id} direction="row" spacing={0.5} alignItems="center">
							<Box
								sx={{
									flex: 1,
									bgcolor: "background.paper",
									borderRadius: 1,
									px: 1,
									py: 0.5,
									cursor: "pointer",
									border: p.id === activeId ? "1px solid" : "1px solid transparent",
									borderColor: p.id === activeId ? "primary.main" : "transparent",
								}}
								onClick={() => onSelect(p.id)}
							>
								<Typography variant="body2" sx={{ fontSize: 12, fontWeight: p.id === activeId ? 700 : 400 }}>
									{p.name || "(未命名)"}
								</Typography>
								<Typography variant="caption" color="text.secondary" sx={{ fontSize: 10 }}>
									{p.provider} · {p.baseUrl || "localhost"}
								</Typography>
							</Box>
							<IconButton size="small" onClick={() => startEdit(p)} sx={{ color: "text.secondary" }}>
								<Box sx={{ fontSize: 14 }}>✏️</Box>
							</IconButton>
							<IconButton size="small" onClick={() => onDelete(p.id)} sx={{ color: "error.main" }}>
								<Box sx={{ fontSize: 14 }}>🗑️</Box>
							</IconButton>
						</Stack>
					))}
				</Box>
			)}

			{editing ? (
				<Box sx={{ bgcolor: "background.paper", borderRadius: 1, p: 1, display: "flex", flexDirection: "column", gap: 0.5 }}>
					<TextField size="small" fullWidth label="档案名称"
						value={editing.name}
						onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
					<Select size="small" fullWidth label="Provider"
						value={editing.provider}
						onChange={(e: SelectChangeEvent) => setEditing({ ...editing, provider: e.target.value as TTSProviderType })}>
						<MenuItem value="mock">Mock（模拟）</MenuItem>
						<MenuItem value="gpt-sovits">GPT-SoVITS</MenuItem>
					</Select>
					<TextField size="small" fullWidth label="服务地址"
						value={editing.baseUrl}
						onChange={(e) => setEditing({ ...editing, baseUrl: e.target.value })} />
					<TextField size="small" fullWidth label="GPT 权重路径"
						value={editing.gptWeightsPath}
						onChange={(e) => setEditing({ ...editing, gptWeightsPath: e.target.value })} />
					<TextField size="small" fullWidth label="SoVITS 权重路径"
						value={editing.sovitsWeightsPath}
						onChange={(e) => setEditing({ ...editing, sovitsWeightsPath: e.target.value })} />
					<TextField size="small" fullWidth label="参考音频路径"
						value={editing.refAudioPath}
						onChange={(e) => setEditing({ ...editing, refAudioPath: e.target.value })} />
					<TextField size="small" fullWidth label="参考音频文本"
						value={editing.promptText}
						onChange={(e) => setEditing({ ...editing, promptText: e.target.value })} />
					<Stack direction="row" spacing={0.5}>
						<Select size="small" sx={{ flex: 1 }} label="参考语言"
							value={editing.promptLang}
							onChange={(e: SelectChangeEvent) => setEditing({ ...editing, promptLang: e.target.value })}>
							<MenuItem value="zh">中文</MenuItem>
							<MenuItem value="en">English</MenuItem>
							<MenuItem value="ja">日本語</MenuItem>
						</Select>
						<Select size="small" sx={{ flex: 1 }} label="合成语言"
							value={editing.textLang}
							onChange={(e: SelectChangeEvent) => setEditing({ ...editing, textLang: e.target.value })}>
							<MenuItem value="zh">中文</MenuItem>
							<MenuItem value="en">English</MenuItem>
							<MenuItem value="ja">日本語</MenuItem>
						</Select>
					</Stack>
					<Stack direction="row" spacing={0.5}>
						<Button size="small" variant="contained" onClick={saveEdit} sx={{ flex: 1 }}>保存</Button>
						<Button size="small" variant="outlined" onClick={cancelEdit} sx={{ flex: 1 }}>取消</Button>
					</Stack>
				</Box>
			) : (
				<Button size="small" variant="outlined" onClick={startAdd} sx={{ fontSize: 11 }}>
					+ 新增 TTS 档案
				</Button>
			)}
		</Box>
	);
}
